/*
 * Jukebox — gestion de la mémoire des titres (super-admin) : affichage d'une
 * ligne, titres suspects, doublons et fusion, texte corrigé à la main,
 * export / import (sauvegarde).
 *
 *  - Suspects (calculés, sans quota) : vidéo bien plus longue ou plus courte
 *    que le titre Deezer, titre de la vidéo qui ne contient pas le titre
 *    cherché, mots « live », « cover », « reprise »… absents du libellé.
 *    Un titre validé à la main n'est jamais suspect.
 *  - Doublons : même mode et même vidéo, ou interprète + titre identiques une
 *    fois nettoyés, fautes de frappe tolérées. « Ce ne sont pas des doublons »
 *    est retenu (jukebox_config « dup_ignore »).
 *  - Fusion : les chansons sont réunies sur celle de la ligne gardée (fiches
 *    Deezer, versions des autres modes, écoutes, étiquettes, année, langue,
 *    ISRC) : leurs fiches Deezer donnent la vidéo gardée, sans nouvelle
 *    recherche YouTube.
 * Lignes = versions du catalogue v28 (vue jukebox_catalog, lib/jukeboxCatalog.js).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { songText, SEARCH_MODES } from "@/lib/jukebox";
import { checkAnswer, normalizeText, cleanTitle, distance, tolerance } from "@/lib/jukeboxBlind";
import { allVersions, parseKey, getVersion, updateWork, isVersionKey } from "@/lib/jukeboxCatalog";
import { planMigration } from "@/lib/jukeboxMigrate";

const sb = () => getSupabaseAdmin();

/* Toutes les lignes (par pages : Supabase en renvoie 1 000 au plus). */
export const allSongs = allVersions;

const SUSPECT_WORDS = /\b(cover|covers|reprise|live|concert|tribute|hommage|remix|nightcore|slowed|sped up|8d)\b/i;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
export function suspectReasons(r) {
  if (r.validated || r.missing) return [];
  const out = [];
  if (r.song_duration && r.duration) {
    const d = r.duration - r.song_duration;
    if (Math.abs(d) > Math.max(30, r.song_duration * 0.2))
      out.push(`vidéo ${d > 0 ? "plus longue" : "plus courte"} (${mmss(r.duration)} au lieu de ${mmss(r.song_duration)})`);
  }
  if (r.video_title) {
    const { artist, title } = songText(r);
    const c = checkAnswer(`${r.video_title} ${r.video_channel || ""}`, artist, title);
    if (!c.title) out.push(c.artist ? "titre absent de la vidéo" : "ni le titre ni l'interprète dans la vidéo");
    const w = r.video_title.match(SUSPECT_WORDS);
    if (w && !SUSPECT_WORDS.test(r.label || "")) out.push(`« ${w[0].toLowerCase()} » dans la vidéo`);
  }
  return out;
}

/* Ligne de la mémoire telle qu'affichée dans le super-admin. */
export function songOut(r) {
  const text = songText(r);
  return {
    key: r.key, mode: r.mode || r.key.split(":")[2], workId: r.work_id || null, deezerId: r.deezer_id ? Number(r.deezer_id) : null,
    label: r.label || null, videoId: r.video_id,
    artist: text.artist, title: text.title, fixed: !!(r.artist_fix || r.title_fix),
    duration: r.duration, songDuration: r.song_duration ?? null, checkedAt: r.checked_at,
    validated: !!r.validated, blind: !!r.blind, lyrics: !!r.lyrics, missing: !!r.missing, plays: r.plays || 0, rank: r.rank ?? null,
    year: r.year ?? null, fr: r.fr ?? null, enriched: !!r.enriched_at,
    videoTitle: r.video_title || null, videoChannel: r.video_channel || null,
    confidence: r.confidence ?? null, source: r.source || null, createdAt: r.created_at || null, sourceSession: r.source_session || null,
    // blind test : 2 = très difficile ; décision datée (null : à décider / « oui » d'avant à confirmer)
    difficulty: r.difficulty || 0, blindDecided: !!r.blind_decided_at,
    yearSuggest: r.year_suggest ?? null, yearSuggestSrc: r.year_suggest_src || null, // année plus ancienne proposée (à confirmer)
    blindSeen: r.blind_seen != null ? { n: r.blind_seen, found: r.blind_seen_found || 0 } : null,
    suspect: suspectReasons(r),
  };
}

/* ---------- Texte corrigé à la main ----------
 * Pour toutes les lignes du titre Deezer (tous modes). Vide, ou identique au
 * libellé nettoyé automatiquement : retour à l'automatique. */
export async function setSongText(key, artist, title) {
  const row = await getVersion(String(key || ""));
  if (!row) return;
  const auto = songText({ label: row.label });
  const a = String(artist || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const t = String(title || "").replace(/\s+/g, " ").trim().slice(0, 200);
  await updateWork(row.work_id, { // texte de la chanson : toutes ses versions et fiches
    artist_fix: a && a !== auto.artist ? a : null,
    title_fix: t && t !== auto.title ? t : null,
  });
}

/* ---------- Doublons ---------- */
async function ignoredPairs() {
  const { data } = await sb().from("jukebox_config").select("value").eq("key", "dup_ignore").maybeSingle();
  try { return new Set(JSON.parse(data?.value || "[]")); } catch (e) { return new Set(); }
}
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export async function ignoreDuplicates(keys) {
  keys = [...new Set((keys || []).map(String))].slice(0, 20);
  const set = await ignoredPairs();
  for (const a of keys) for (const b of keys) if (a < b) set.add(pairKey(a, b));
  const { error } = await sb().from("jukebox_config").upsert({ key: "dup_ignore", value: JSON.stringify([...set].slice(-5000)) });
  if (error) throw error;
}

/* Groupes de doublons possibles : lignes au format songOut + group, dupWhy. */
export async function findDuplicates() {
  const rows = await allSongs((q) => q.is("merged_into", null));
  const ignored = await ignoredPairs();
  const parent = new Map(rows.map((r) => [r.key, r.key]));
  const find = (k) => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k))), parent.get(k)));
  const why = new Map();
  const link = (a, b, reason) => {
    if (a.key === b.key || ignored.has(pairKey(a.key, b.key))) return;
    parent.set(find(a.key), find(b.key));
    for (const k of [a.key, b.key]) if (!why.has(k)) why.set(k, reason);
  };
  for (const { id: mode } of SEARCH_MODES) {
    const list = rows.filter((r) => r.key.endsWith(`:${mode}`)).map((r) => {
      const t = songText(r);
      return { r, artist: normalizeText(cleanTitle(t.artist)), title: normalizeText(cleanTitle(t.title)) };
    });
    const bucket = (f) => {
      const m = new Map();
      for (const x of list) if (f(x)) (m.get(f(x)) || m.set(f(x), []).get(f(x))).push(x);
      return [...m.values()].filter((g) => g.length > 1);
    };
    for (const g of bucket((x) => x.r.video_id)) for (const x of g.slice(1)) link(g[0].r, x.r, "même vidéo");
    for (const g of bucket((x) => x.r.isrc || null)) for (const x of g.slice(1)) link(g[0].r, x.r, "même enregistrement (ISRC)");
    // même interprète : titres proches ; même titre : interprètes proches
    for (const g of bucket((x) => x.artist))
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const a = g[i].title.replace(/ /g, ""), b = g[j].title.replace(/ /g, "");
        if (a && distance(a, b) <= tolerance(Math.min(a.length, b.length))) link(g[i].r, g[j].r, a === b ? "même titre" : "titres proches");
      }
    for (const g of bucket((x) => x.title))
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const a = g[i].artist.replace(/ /g, ""), b = g[j].artist.replace(/ /g, "");
        if (a && distance(a, b) <= tolerance(Math.min(a.length, b.length))) link(g[i].r, g[j].r, "interprètes proches");
      }
  }
  const groups = new Map();
  for (const r of rows) {
    const root = find(r.key);
    (groups.get(root) || groups.set(root, []).get(root)).push(r);
  }
  return [...groups.values()].filter((g) => g.length > 1).slice(0, 100)
    .flatMap((g, i) => g.sort((a, b) => (b.validated - a.validated) || (b.plays || 0) - (a.plays || 0))
      .map((r) => ({ ...songOut(r), group: i, dupWhy: why.get(r.key) || null })));
}

/* Fusion : `keep` garde sa vidéo ; écoutes additionnées, étiquettes et
 * informations reprises des autres lignes quand elle ne les a pas. */
export async function mergeSongs(keep, keys) {
  const kp = parseKey(keep);
  if (!kp) return "Titres introuvables.";
  const others = [...new Set((keys || []).map((k) => parseKey(k)?.workId).filter((w) => w && w !== kp.workId))].slice(0, 20);
  if (!others.length) return "Titres introuvables.";
  const ids = [kp.workId, ...others];
  const [{ data: works, error: e1 }, { data: versions, error: e2 }] = await Promise.all([
    sb().from("jukebox_works").select("*").in("id", ids),
    sb().from("jukebox_versions").select("*").in("work_id", ids),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const k = works.find((w) => w.id === kp.workId);
  const rest = works.filter((w) => w.id !== kp.workId);
  if (!k || !rest.length) return "Titres introuvables.";
  const pickF = (f) => k[f] ?? rest.find((w) => w[f] != null && w[f] !== "")?.[f] ?? null;
  await updateWork(k.id, {
    plays: works.reduce((n, w) => n + (w.plays || 0), 0),
    rank: Math.max(0, ...works.map((w) => w.rank || 0)) || null,
    blind: works.some((w) => w.blind),
    ...Object.fromEntries(["year", "fr", "lang", "country", "isrc", "artist_fix", "title_fix", "song_duration", "enriched_at"].map((f) => [f, pickF(f)])),
  });
  // versions : celle de la chanson gardée l'emporte ; les autres modes sont repris
  const mine = new Map(versions.filter((v) => v.work_id === k.id).map((v) => [v.kind, v]));
  for (const v of versions.filter((x) => x.work_id !== k.id)) {
    const cur = mine.get(v.kind);
    if (!cur) {
      const { error } = await sb().from("jukebox_versions").update({ work_id: k.id }).eq("work_id", v.work_id).eq("kind", v.kind);
      if (error) throw error;
      mine.set(v.kind, v);
    } else if (!cur.validated && v.validated && v.video_id === cur.video_id) {
      await sb().from("jukebox_versions").update({ validated: true }).eq("work_id", k.id).eq("kind", v.kind);
      cur.validated = true;
    }
    // propositions de changement de vidéo : vers la version gardée
    await sb().from("jukebox_video_changes").update({ song_key: `w:${k.id}:${v.kind}` }).eq("song_key", `w:${v.work_id}:${v.kind}`);
  }
  // fiches Deezer : toutes vers la chanson gardée, puis chansons fusionnées supprimées (versions en double avec)
  const { error: e3 } = await sb().from("jukebox_work_aliases").update({ work_id: k.id }).in("work_id", others);
  if (e3) throw e3;
  const { error: e4 } = await sb().from("jukebox_works").delete().in("id", others);
  if (e4) throw e4;
  return null;
}

/* ---------- Export / import ---------- */
/* Une ligne par version ; `deezer_ids` : fiches Deezer de la chanson (séparées par des espaces). */
export const EXPORT_COLUMNS = ["key", "deezer_ids", "label", "artist_fix", "title_fix", "isrc", "video_id", "video_title", "video_channel", "duration", "song_duration",
  "validated", "blind", "lyrics", "missing", "plays", "rank", "year", "lang", "country", "fr", "checked_at", "enriched_at", "created_at"];

export async function exportSongs() {
  const rows = await allVersions();
  const aliases = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await sb().from("jukebox_work_aliases").select("deezer_id,work_id").order("deezer_id").range(from, from + 999);
    if (error) throw error;
    aliases.push(...data);
    if (data.length < 1000) break;
  }
  const fiches = new Map();
  for (const a of aliases) (fiches.get(a.work_id) || fiches.set(a.work_id, []).get(a.work_id)).push(a.deezer_id);
  return rows.map((r) => Object.fromEntries(EXPORT_COLUMNS.map((c) => [c, c === "deezer_ids" ? (fiches.get(r.work_id) || []).join(" ") : r[c] ?? null])));
}

const BOOL = ["validated", "blind", "lyrics", "missing"];
const INT = ["duration", "song_duration", "plays", "rank", "year"];
const TEXT = ["label", "artist_fix", "title_fix", "video_title", "video_channel", "merged_into", "isrc", "lang", "country"];
const DATE = ["checked_at", "enriched_at", "created_at"];
const OLD_KEY_RE = /^dz:\d+:(normal|clip|karaoke)$/; // ancien format (avant le catalogue v28)

/* Restauration : lignes ajoutées ou mises à jour (colonnes connues seulement). */
/* Restauration : chansons, fiches Deezer et versions ajoutées ou mises à jour
 * (rien n'est supprimé). Accepte l'export actuel (clé « w:… ») et l'ancien
 * (clé « dz:<id>:<mode> », converti comme la migration). */
export async function importSongs(input) {
  const rows = [];
  let skipped = 0;
  for (const x of (Array.isArray(input) ? input : []).slice(0, 20000)) {
    const v = (c) => (x?.[c] === undefined || x[c] === "" ? null : x[c]);
    const key = String(v("key"));
    if ((!isVersionKey(key) && !OLD_KEY_RE.test(key)) || !/^[\w-]{11}$/.test(String(v("video_id")))) { skipped++; continue; }
    const r = { key, video_id: String(v("video_id")), deezer_ids: String(v("deezer_ids") || "") };
    for (const c of BOOL) r[c] = v(c) === true || v(c) === "true" || v(c) === "1";
    for (const c of INT) r[c] = v(c) == null || !Number.isFinite(Number(v(c))) ? null : Math.round(Number(v(c)));
    for (const c of TEXT) r[c] = v(c) == null ? null : String(v(c)).slice(0, 500);
    for (const c of DATE) r[c] = v(c) && !Number.isNaN(Date.parse(v(c))) ? new Date(v(c)).toISOString() : null;
    r.fr = v("fr") == null ? null : v("fr") === true || v("fr") === "true";
    r.plays ??= 0;
    r.checked_at ??= new Date(0).toISOString(); // sans date : revérifié la nuit suivante
    rows.push(r);
  }
  const batch = async (table, list, onConflict) => {
    for (let i = 0; i < list.length; i += 500) {
      const { error } = await sb().from(table).upsert(list.slice(i, i + 500), { onConflict });
      if (error) throw error;
    }
  };
  // ancien format : converti comme la migration (fiches déjà connues : chanson existante)
  const old = rows.filter((r) => OLD_KEY_RE.test(r.key));
  if (old.length) {
    const { data: known } = await sb().from("jukebox_work_aliases").select("deezer_id,work_id")
      .in("deezer_id", [...new Set(old.map((r) => Number(r.key.split(":")[1])))].slice(0, 5000));
    const plan = planMigration(old, known || []);
    await batch("jukebox_works", plan.works, "id");
    await batch("jukebox_work_aliases", plan.aliases, "deezer_id");
    await batch("jukebox_versions", plan.versions, "work_id,kind");
  }
  // format actuel : chanson (id de la clé), ses fiches Deezer, la version
  const cur = rows.filter((r) => isVersionKey(r.key));
  const works = new Map(), aliases = new Map(), versions = [];
  for (const r of cur) {
    const { workId, kind } = parseKey(r.key);
    if (!works.has(workId)) works.set(workId, {
      id: workId, label: r.label, artist_fix: r.artist_fix, title_fix: r.title_fix, isrc: r.isrc, song_duration: r.song_duration,
      year: r.year, lang: r.lang, country: r.country, fr: r.fr, enriched_at: r.enriched_at, rank: r.rank, plays: r.plays, blind: r.blind,
      ...(r.created_at ? { created_at: r.created_at } : {}),
    });
    for (const id of r.deezer_ids.split(/\s+/).filter((d) => /^\d+$/.test(d))) aliases.set(id, { deezer_id: Number(id), work_id: workId });
    versions.push({
      work_id: workId, kind, video_id: r.video_id, duration: r.duration, video_title: r.video_title, video_channel: r.video_channel,
      lyrics: r.lyrics, validated: r.validated, missing: r.missing, checked_at: r.checked_at, ...(r.created_at ? { created_at: r.created_at } : {}),
    });
  }
  await batch("jukebox_works", [...works.values()], "id");
  await batch("jukebox_work_aliases", [...aliases.values()], "deezer_id");
  await batch("jukebox_versions", versions, "work_id,kind");
  return { imported: rows.length, skipped };
}
