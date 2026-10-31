/*
 * Jukebox — enrichissement de la mémoire des titres (sans quota YouTube) :
 * année de première sortie et chanson française ou non, pour les filtres du
 * blind test.
 *  - Deezer (track/<id>) donne l'ISRC et une date de sortie, souvent celle
 *    d'une réédition ou d'une compilation (secours seulement).
 *  - MusicBrainz (isrc/<ISRC>) donne la vraie date de première sortie et la
 *    langue des paroles (œuvre liée) ; à défaut de langue, le pays de
 *    l'artiste (France, Belgique, Suisse… = français).
 * MusicBrainz impose 1 requête par seconde et un User-Agent identifiable.
 * Une ligne par titre Deezer et par mode : on enrichit le titre une fois et
 * on met à jour toutes ses lignes (dz:<id>:*). Les corrections faites à la
 * main dans le super-admin ne sont jamais écrasées (enriched_at déjà posé).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const UA = "perf360-jukebox/1.0 (https://perf360.vercel.app)";
const FR_COUNTRIES = new Set(["FR", "BE", "CH", "LU", "MC"]);
const MB_GAP = 1100; // ms entre deux requêtes MusicBrainz

let lastMb = 0;
async function mb(path) {
  const wait = lastMb + MB_GAP - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastMb = Date.now();
  const res = await fetch(`https://musicbrainz.org/ws/2/${path}${path.includes("?") ? "&" : "?"}fmt=json`, {
    cache: "no-store", headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`musicbrainz ${res.status}`);
  return res.json();
}

const yearOf = (d) => {
  const y = parseInt(String(d || "").slice(0, 4), 10);
  return y >= 1900 && y <= 2100 ? y : null;
};

/* Infos d'un titre Deezer : { year, lang, country, fr }. */
async function lookup(deezerId, artistCountry) {
  const res = await fetch(`https://api.deezer.com/track/${deezerId}`, { cache: "no-store" });
  const t = await res.json().catch(() => ({}));
  if (!t?.id) return { year: null, lang: null, country: null, fr: null };
  let year = null, lang = null, country = null, artistId = null;
  if (t.isrc) {
    const d = await mb(`isrc/${encodeURIComponent(t.isrc)}?inc=artist-credits+work-rels`);
    for (const r of d?.recordings || []) {
      const y = yearOf(r["first-release-date"]);
      if (y && (!year || y < year)) year = y;
      artistId ||= r["artist-credit"]?.[0]?.artist?.id || null;
      for (const rel of r.relations || []) {
        const langs = rel.work?.languages || (rel.work?.language ? [rel.work.language] : []);
        if (!lang && langs.length === 1) lang = langs[0];
      }
    }
  }
  if (artistId) {
    if (!artistCountry.has(artistId)) {
      const a = await mb(`artist/${artistId}`).catch(() => null);
      artistCountry.set(artistId, a?.country || null);
    }
    country = artistCountry.get(artistId);
  }
  year ||= yearOf(t.release_date) || yearOf(t.album?.release_date);
  // zxx = sans paroles ; mul = plusieurs langues (inconnu)
  const fr = lang && lang !== "mul" ? lang === "fra" : country ? FR_COUNTRIES.has(country) : null;
  return { year, lang, country, fr };
}

export async function enrichPending() {
  const { count } = await getSupabaseAdmin().from("jukebox_songs").select("key", { count: "exact", head: true }).is("enriched_at", null);
  return count || 0;
}

/* Enrichit les titres pas encore traités, jusqu'à la limite de temps. */
export async function enrichSongs(budgetMs = 45e3) {
  const start = Date.now();
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("jukebox_songs").select("key").is("enriched_at", null).limit(1000);
  if (error) throw error;
  const ids = [...new Set((data || []).map((r) => r.key.split(":")[1]).filter(Boolean))];
  const artistCountry = new Map();
  let done = 0;
  for (const id of ids) {
    if (Date.now() - start > budgetMs) break;
    let info;
    try { info = await lookup(id, artistCountry); } catch (e) { console.error("jukebox enrich:", id, e.message); break; } // MusicBrainz saturé : on reprendra
    await sb.from("jukebox_songs").update({ ...info, enriched_at: new Date().toISOString() })
      .like("key", `dz:${id}:%`).is("enriched_at", null);
    done++;
  }
  return { done, left: Math.max(0, ids.length - done) };
}

/* Correction à la main (super-admin) : année, français ou non, exclusion du
 * blind test ; appliquée à toutes les versions (modes) du titre. */
export async function editSongMeta(key, patch) {
  const id = String(key || "").split(":")[1];
  if (!id) return;
  const row = {};
  if ("year" in patch || "fr" in patch) row.enriched_at = new Date().toISOString(); // plus d'enrichissement auto
  if ("year" in patch) row.year = yearOf(patch.year);
  if ("fr" in patch) row.fr = typeof patch.fr === "boolean" ? patch.fr : null;
  if ("noBlind" in patch) row.no_blind = !!patch.noBlind;
  const { error } = await getSupabaseAdmin().from("jukebox_songs").update(row).like("key", `dz:${id}:%`);
  if (error) throw error;
}
