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
import { cleanTitle } from "@/lib/jukeboxBlind";

const UA = "perf360-jukebox/1.0 (https://perf360.vercel.app)";
const FR_COUNTRIES = ["FR", "BE", "CH", "LU", "MC"];
const MB_GAP = 1100; // ms entre deux requêtes MusicBrainz

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastMb = 0;
/* 503 = trop de requêtes (MusicBrainz est souvent chargé) : on patiente et
 * on réessaie, jusqu'à 3 fois. */
async function mb(path) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastMb + MB_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    lastMb = Date.now();
    const res = await fetch(`https://musicbrainz.org/ws/2/${path}${path.includes("?") ? "&" : "?"}fmt=json`, {
      cache: "no-store", headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (res.status === 404) return null;
    if (res.ok) return res.json();
    if ((res.status !== 503 && res.status !== 429) || attempt >= 3) throw new Error(`musicbrainz ${res.status}`);
    await sleep(1500 * (attempt + 1));
  }
}

const yearOf = (d) => {
  const y = parseInt(String(d || "").slice(0, 4), 10);
  return y >= 1900 && y <= 2100 ? y : null;
};

// France, Belgique, Suisse, Luxembourg, Monaco et outre-mer
const FR_AREAS = new Set([...FR_COUNTRIES, "GP", "MQ", "GF", "RE", "YT", "PF", "NC", "PM", "BL", "MF", "WF"]);
const esc = (s) => String(s || "").replace(/["\\]/g, " ").trim();

/* Langue unique des œuvres liées à un enregistrement (relations work-rels). */
function workLang(r) {
  for (const rel of r?.relations || []) {
    const langs = rel.work?.languages || (rel.work?.language ? [rel.work.language] : []);
    if (langs.length === 1) return langs[0];
  }
  return null;
}

/* Titre manifestement en français (dernier recours, jamais « international »). */
const FR_WORDS = /\b(le|la|les|un|une|des|du|de|et|est|ce|que|qui|pas|mon|ma|mes|ton|ta|tes|tu|je|il|elle|nous|vous|dans|sur|pour|avec|toi|moi|quand|comme|plus|petit|petite)\b/;
const looksFrench = (title) => /[àâçéèêëîïôûùœ]/i.test(title) || /\b[ldjmtsnqc]'/i.test(title) || FR_WORDS.test(String(title).toLowerCase());

/* Infos d'un titre Deezer : { year, lang, country, fr }.
 * 1. MusicBrainz par ISRC (le plus sûr) ; 2. sinon recherche artiste + titre ;
 * 3. pays de l'artiste si la langue reste inconnue ; 4. Deezer pour l'année
 * d'un titre récent seulement (sinon souvent la date d'une compilation). */
async function lookup(deezerId, artistCountry) {
  const res = await fetch(`https://api.deezer.com/track/${deezerId}`, { cache: "no-store" });
  const t = await res.json().catch(() => ({}));
  if (!t?.id) return { year: null, lang: null, country: null, fr: null };
  const artistName = t.artist?.name || "";
  const title = cleanTitle(t.title_short || t.title).trim();
  let year = null, lang = null, country = null, artistId = null;
  if (t.isrc) {
    const d = await mb(`isrc/${encodeURIComponent(t.isrc)}?inc=artist-credits+work-rels`);
    for (const r of d?.recordings || []) {
      const y = yearOf(r["first-release-date"]);
      if (y && (!year || y < year)) year = y;
      artistId ||= r["artist-credit"]?.[0]?.artist?.id || null;
      lang ||= workLang(r);
    }
  }
  if (!year && title && artistName) {
    const q = `recording:"${esc(title)}" AND artist:"${esc(artistName)}"`;
    const d = await mb(`recording?query=${encodeURIComponent(q)}&limit=25`);
    let best = null;
    for (const r of d?.recordings || []) {
      if (Number(r.score) < 90) continue;
      const y = yearOf(r["first-release-date"]);
      if (y && (!year || y < year)) { year = y; best = r; }
      artistId ||= r["artist-credit"]?.[0]?.artist?.id || null;
    }
    if (best && !lang) lang = workLang(await mb(`recording/${best.id}?inc=work-rels`).catch(() => null));
  }
  if (!lang || lang === "mul") {
    if (!artistId && artistName) {
      const d = await mb(`artist?query=${encodeURIComponent(`artist:"${esc(artistName)}"`)}&limit=1`).catch(() => null);
      const a = d?.artists?.[0];
      if (a && Number(a.score) >= 95) { artistId = a.id; artistCountry.set(a.id, a.country || null); }
    }
    if (artistId) {
      if (!artistCountry.has(artistId)) {
        const a = await mb(`artist/${artistId}`).catch(() => null);
        artistCountry.set(artistId, a?.country || null);
      }
      country = artistCountry.get(artistId);
    }
  }
  if (!year) {
    const y = yearOf(t.release_date) || yearOf(t.album?.release_date);
    if (y && y >= new Date().getFullYear() - 2) year = y;
  }
  // zxx = sans paroles ; mul = plusieurs langues
  const fr = lang && lang !== "mul" ? lang === "fra"
    : country ? FR_AREAS.has(country)
    : looksFrench(title) ? true : null;
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
    try { info = await lookup(id, artistCountry); } catch (e) {
      console.error("jukebox enrich:", id, e.message); // MusicBrainz saturé : titre repris au prochain passage
      await sleep(3000);
      continue;
    }
    await sb.from("jukebox_songs").update({ ...info, enriched_at: new Date().toISOString() })
      .like("key", `dz:${id}:%`).is("enriched_at", null);
    done++;
  }
  return { done, left: Math.max(0, ids.length - done) };
}

/* Correction à la main (super-admin) : année, français ou non ; appliquée
 * à toutes les versions (modes) du titre. */
export async function editSongMeta(key, patch) {
  const id = String(key || "").split(":")[1];
  if (!id) return;
  const row = {};
  if (!("year" in patch) && !("fr" in patch)) return;
  row.enriched_at = new Date().toISOString(); // plus d'enrichissement auto
  if ("year" in patch) row.year = yearOf(patch.year);
  if ("fr" in patch) row.fr = typeof patch.fr === "boolean" ? patch.fr : null;
  const { error } = await getSupabaseAdmin().from("jukebox_songs").update(row).like("key", `dz:${id}:%`);
  if (error) throw error;
}
