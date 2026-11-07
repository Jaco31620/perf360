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
 * Une fois par chanson (catalogue v28 : toutes ses versions et fiches), via sa
 * fiche Deezer principale. Les corrections faites à la main dans le
 * super-admin ne sont jamais écrasées (enriched_at déjà posé).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cleanTitle, sameArtist } from "@/lib/jukeboxBlind";
import { parseKey, updateWork } from "@/lib/jukeboxCatalog";
import { songText } from "@/lib/jukebox";

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
  const isrc = t.isrc || ""; // "" : pas d'ISRC chez Deezer (ne pas redemander)
  const rank = Number(t.rank) || null; // popularité Deezer (ordre de la revue)
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
  // toujours aussi par artiste + titre : l'ISRC est parfois celui d'une réédition (remaster), datée de sa sortie
  if (title && artistName) {
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
  // Wikidata (les dates de Wikipédia) : la plus fiable quand la chanson y est
  if (title && artistName) {
    const wy = await wikidataYear(artistName, title).catch(() => null);
    if (wy) year = wy;
  }
  if (!year) {
    const y = yearOf(t.release_date) || yearOf(t.album?.release_date);
    if (y && y >= new Date().getFullYear() - 2) year = y;
  }
  // zxx = sans paroles ; mul = plusieurs langues
  const fr = lang && lang !== "mul" ? lang === "fra"
    : country ? FR_AREAS.has(country)
    : looksFrench(title) ? true : null;
  return { year, lang, country, fr, rank, isrc };
}

/* Lignes à compléter : année / langue pas encore cherchées, ou ISRC manquant. */
export async function enrichPending() {
  const { count } = await getSupabaseAdmin().from("jukebox_works").select("id", { count: "exact", head: true }).or("enriched_at.is.null,isrc.is.null");
  return count || 0;
}

/* Chansons à traiter → fiche Deezer principale (la plus petite), pour interroger Deezer. */
async function pendingWorks(filter) {
  const sb = getSupabaseAdmin();
  const { data, error } = await filter(sb.from("jukebox_works").select("id")).limit(1000);
  if (error) throw error;
  const ids = (data || []).map((w) => w.id);
  const out = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: al, error: e2 } = await sb.from("jukebox_work_aliases").select("deezer_id,work_id").in("work_id", ids.slice(i, i + 200)).order("deezer_id");
    if (e2) throw e2;
    for (const a of al || []) if (!out.has(a.work_id)) out.set(a.work_id, a.deezer_id);
  }
  return [...out.entries()]; // [workId, deezerId]
}

/* Enrichit les titres pas encore traités, jusqu'à la limite de temps. */
export async function enrichSongs(budgetMs = 45e3) {
  const start = Date.now();
  const sb = getSupabaseAdmin();
  const todo = await pendingWorks((q) => q.is("enriched_at", null));
  const artistCountry = new Map();
  let done = 0;
  for (const [workId, id] of todo) {
    if (Date.now() - start > budgetMs) break;
    let info;
    try { info = await lookup(id, artistCountry); } catch (e) {
      console.error("jukebox enrich:", id, e.message); // MusicBrainz saturé : titre repris au prochain passage
      await sleep(3000);
      continue;
    }
    // une fois par chanson (toutes ses versions) ; une correction faite entre-temps n'est pas écrasée
    await sb.from("jukebox_works").update({ ...info, enriched_at: new Date().toISOString() }).eq("id", workId).is("enriched_at", null);
    done++;
  }
  const isrc = await backfillIsrc(Math.max(0, budgetMs - (Date.now() - start))).catch((e) => ({ error: String(e?.message || e) }));
  return { done, left: Math.max(0, todo.length - done), isrc };
}

/* Passage de nuit : enrichissement puis vérification des années, en plusieurs
 * tours (une fonction Vercel dure 5 min au plus), chacun relancé par le
 * précédent (/api/jukebox/enrich) tant qu'il reste du travail et qu'il avance. */
const NIGHT_KEY = "enrich_night";
export const MAX_ROUNDS = 6;
export const nightStop = (round, { done, left }) => (left <= 0 ? "done" : done <= 0 ? "stalled" : round >= MAX_ROUNDS ? "rounds" : null);
/* Cron de secours (vercel.json) : inutile si la chaîne lancée par le
 * pré-remplissage a déjà tout fini cette nuit, ou tourne en ce moment. */
export const nightSkip = (report, now = Date.now()) => {
  const age = report?.at ? now - new Date(report.at).getTime() : Infinity;
  return (report?.stop === "done" && age < 4 * 3600e3) || (report?.stop == null && age < 6 * 60e3);
};

export async function enrichNight() {
  const { data } = await getSupabaseAdmin().from("jukebox_config").select("value").eq("key", NIGHT_KEY).maybeSingle();
  try { return data?.value ? JSON.parse(data.value) : null; } catch (e) { return null; }
}
const writeNight = (report) => getSupabaseAdmin().from("jukebox_config").upsert({ key: NIGHT_KEY, value: JSON.stringify(report) });

/* Un tour ; stop null : à relancer. Le rapport cumule les tours de la nuit. */
export async function enrichRound(round, budgetMs = 265e3) {
  const start = Date.now();
  const fail = (e) => ({ error: String(e?.message || e) });
  // trace dès le début : une nuit lancée mais coupée se voit dans le super-admin
  if (round === 1) await writeNight({ at: new Date().toISOString(), rounds: 0, stop: null });
  const enrich = await enrichSongs(budgetMs).catch(fail);
  const years = await checkYears(Math.max(0, budgetMs - (Date.now() - start))).catch(fail);
  const isrc = enrich.isrc || {};
  const done = (enrich.done || 0) + (isrc.done || 0) + (years.done || 0);
  const left = (enrich.left || 0) + (isrc.left || 0) + (years.left || 0);
  const stop = nightStop(round, { done, left });
  const prev = round > 1 ? (await enrichNight()) || {} : {};
  const error = enrich.error || isrc.error || years.error || null;
  await writeNight({
    at: new Date().toISOString(), rounds: round,
    enriched: (prev.enriched || 0) + (enrich.done || 0),
    years: (prev.years || 0) + (years.done || 0),
    suggested: (prev.suggested || 0) + (years.suggested || 0),
    left, stop, error,
  });
  return { round, done, left, stop, error };
}

/* Lance un tour sans attendre sa fin : la fonction appelée continue après la
 * coupure (au bout de 4 s, le cas normal). Un refus est noté dans le rapport. */
export async function launchEnrichRound(origin, round) {
  const secret = process.env.CRON_SECRET;
  try {
    const res = await fetch(`${origin}/api/jukebox/enrich?round=${round}`, {
      cache: "no-store", signal: AbortSignal.timeout(4000), headers: secret ? { authorization: `Bearer ${secret}` } : {},
    });
    if (res.ok) return;
    throw new Error(`relance refusée (${res.status})`);
  } catch (e) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") return;
    console.error("jukebox enrich relance:", e);
    await writeNight({ ...((await enrichNight()) || {}), at: new Date().toISOString(), stop: "relaunch", error: String(e?.message || e) });
  }
}

/* ISRC des titres enrichis avant la colonne (SQL v26) : Deezer seul, rapide
 * (limite Deezer : 50 requêtes / 5 s). "" = Deezer n'en a pas. */
export async function backfillIsrc(budgetMs = 20e3) {
  const start = Date.now();
  const sb = getSupabaseAdmin();
  const todo = await pendingWorks((q) => q.is("isrc", null));
  let done = 0;
  for (const [workId, id] of todo) {
    if (Date.now() - start > budgetMs) break;
    const t = await fetch(`https://api.deezer.com/track/${id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (t?.error?.code === 4) { await sleep(5000); continue; } // quota Deezer : on patiente
    if (!t) continue;
    await sb.from("jukebox_works").update({ isrc: t.isrc || "" }).eq("id", workId).is("isrc", null);
    done++;
    await sleep(120);
  }
  return { done, left: Math.max(0, todo.length - done) };
}

/* Correction à la main (super-admin) : année, français ou non ; appliquée
 * à toutes les versions (modes) du titre. */
export async function editSongMeta(key, patch) {
  const p = parseKey(key);
  if (!p) return;
  const row = {};
  if (!("year" in patch) && !("fr" in patch)) return;
  row.enriched_at = new Date().toISOString(); // plus d'enrichissement auto
  if ("year" in patch) Object.assign(row, { year: yearOf(patch.year), year_suggest: null, year_suggest_src: "manual", year_checked_at: row.enriched_at }); // choisie à la main : plus jamais vérifiée
  if ("fr" in patch) row.fr = typeof patch.fr === "boolean" ? patch.fr : null;
  await updateWork(p.workId, row); // la chanson : toutes ses versions
}

/* ---------- Années à vérifier ----------
 * Année la plus ancienne connue de MusicBrainz, par ISRC et par artiste +
 * titre (score ≥ 90) : { year, src } ou null. */
async function earliestYear({ isrc, artist, title }) {
  let best = null;
  if (isrc) {
    const d = await mb(`isrc/${encodeURIComponent(isrc)}`);
    for (const r of d?.recordings || []) {
      const y = yearOf(r["first-release-date"]);
      if (y && (!best || y < best.year)) best = { year: y, src: "MusicBrainz (ISRC)" };
    }
  }
  if (title && artist) {
    const d = await mb(`recording?query=${encodeURIComponent(`recording:"${esc(title)}" AND artist:"${esc(artist)}"`)}&limit=25`);
    for (const r of d?.recordings || []) {
      if (Number(r.score) < 90) continue;
      const y = yearOf(r["first-release-date"]);
      if (y && (!best || y < best.year)) best = { year: y, src: `MusicBrainz (artiste + titre${r.disambiguation ? ` : ${r.disambiguation}` : ""})` };
    }
  }
  return best;
}

/* Wikidata : date de publication (P577) de la chanson dont l'interprète
 * (P175) correspond — ce sont les dates de Wikipédia. Plusieurs fiches
 * (single, rééditions…) : la plus ancienne. null si la chanson n'y est pas. */
const WD_UA = { "User-Agent": UA, Accept: "application/json" };
async function wd(params) {
  const res = await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ ...params, format: "json" })}`, {
    cache: "no-store", headers: WD_UA, signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`wikidata ${res.status}`);
  return res.json();
}
export async function wikidataYear(artist, title) {
  if (!artist || !title) return null;
  const ids = [];
  for (const language of ["en", "fr"]) {
    const d = await wd({ action: "wbsearchentities", search: title, language, type: "item", limit: "10" });
    for (const r of d.search || []) if (!ids.includes(r.id)) ids.push(r.id);
  }
  if (!ids.length) return null;
  const ents = (await wd({ action: "wbgetentities", ids: ids.slice(0, 50).join("|"), props: "claims" })).entities || {};
  const cands = [];
  const perf = new Set();
  for (const e of Object.values(ents)) {
    const ps = (e.claims?.P175 || []).map((x) => x.mainsnak?.datavalue?.value?.id).filter(Boolean);
    const ys = (e.claims?.P577 || []).map((x) => yearOf(String(x.mainsnak?.datavalue?.value?.time || "").slice(1))).filter(Boolean);
    if (ps.length && ys.length) { cands.push({ ps, year: Math.min(...ys) }); ps.forEach((p) => perf.add(p)); }
  }
  if (!cands.length) return null;
  const labels = (await wd({ action: "wbgetentities", ids: [...perf].slice(0, 50).join("|"), props: "labels|aliases", languages: "en|fr" })).entities || {};
  const names = (p) => [...Object.values(labels[p]?.labels || {}), ...Object.values(labels[p]?.aliases || {}).flat()].map((l) => l.value);
  const years = cands.filter((c) => c.ps.some((p) => names(p).some((n) => sameArtist(n, artist)))).map((c) => c.year);
  return years.length ? Math.min(...years) : null;
}

/* Chansons enrichies pas encore vérifiées : une autre année est PROPOSÉE
 * (year_suggest), à confirmer dans le super-admin. Wikidata d'abord (les
 * dates de Wikipédia : toute différence est proposée) ; sinon MusicBrainz,
 * seulement 2 ans plus tôt ou davantage (± 1 an : sortie de l'album ou du
 * single, souvent du bruit). Une fois par chanson ; jamais une année choisie
 * à la main (year_suggest_src = « manual »). */
export async function checkYears(budgetMs = 45e3) {
  const start = Date.now();
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("jukebox_works").select("id,label,artist_fix,title_fix,isrc,year,year_suggest_src")
    .not("enriched_at", "is", null).is("year_checked_at", null).limit(1000);
  if (error) throw error;
  let done = 0, suggested = 0;
  for (const w of data || []) {
    if (Date.now() - start > budgetMs) break;
    const text = songText(w);
    const title = cleanTitle(text.title).trim();
    let sug = null;
    try {
      const wy = await wikidataYear(text.artist, title).catch(() => null);
      if (wy) sug = wy !== w.year ? { year: wy, src: "Wikidata (Wikipédia)" } : null;
      else {
        const best = await earliestYear({ isrc: w.isrc, artist: text.artist, title });
        sug = best && (w.year == null || best.year <= w.year - 2) ? best : null;
      }
    } catch (e) {
      console.error("jukebox year check:", w.id, e.message);
      await sleep(3000);
      continue;
    }
    if (w.year_suggest_src === "manual") sug = null;
    await sb.from("jukebox_works").update({
      year_checked_at: new Date().toISOString(),
      ...(sug ? { year_suggest: sug.year, year_suggest_src: sug.src } : {}),
    }).eq("id", w.id);
    done++;
    if (sug) suggested++;
  }
  return { done, suggested, left: Math.max(0, (data || []).length - done) };
}
export async function yearsToCheck() {
  const { count } = await getSupabaseAdmin().from("jukebox_works").select("id", { count: "exact", head: true })
    .not("enriched_at", "is", null).is("year_checked_at", null);
  return count || 0;
}

/* Année proposée : acceptée (devient l'année) ou refusée (plus reproposée). */
export async function answerYear(key, accept) {
  const p = parseKey(key);
  if (!p) return;
  const { data: w } = await getSupabaseAdmin().from("jukebox_works").select("year_suggest").eq("id", p.workId).maybeSingle();
  await updateWork(p.workId, {
    ...(accept && w?.year_suggest ? { year: w.year_suggest } : {}),
    year_suggest: null, year_suggest_src: "manual", // décidé : plus reproposé
  });
}
