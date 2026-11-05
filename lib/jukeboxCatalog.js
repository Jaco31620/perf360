/*
 * Jukebox — accès au catalogue des titres (SERVEUR), modèle v28 :
 *  - jukebox_works : la chanson (texte, ISRC, année, langue, blind test, écoutes) ;
 *  - jukebox_work_aliases : fiches Deezer (album, single, best-of…) → chanson ;
 *  - jukebox_versions : une vidéo par chanson et par version (normal = paroles,
 *    clip, karaoke), avec sa validation ;
 *  - vue jukebox_catalog : une ligne par version, colonnes de l'ancienne table
 *    (lecture seule), clé « w:<chanson>:<version> », deezer_id = fiche principale.
 * Les écritures passent par ce module : une donnée de chanson (texte, année…)
 * est écrite une seule fois pour toutes ses versions et fiches.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const sb = () => getSupabaseAdmin();
export const KINDS = ["normal", "clip", "karaoke"];
const KEY_RE = /^w:([0-9a-f-]{36}):(normal|clip|karaoke)$/i;

export const versionKey = (workId, kind) => `w:${workId}:${kind}`;
export function parseKey(key) {
  const m = KEY_RE.exec(String(key || ""));
  return m ? { workId: m[1], kind: m[2] } : null;
}
export const isVersionKey = (key) => KEY_RE.test(String(key || ""));

/* Lecture : vue (une ligne par version). */
export const catalog = (cols = "*") => sb().from("jukebox_catalog").select(cols);

const WORK_COLS = ["label", "artist_fix", "title_fix", "isrc", "song_duration", "year", "lang", "country", "fr", "enriched_at", "rank", "plays", "blind", "difficulty", "difficulty_checked", "blind_decided_at", "blind_seen", "blind_seen_found", "year_suggest", "year_suggest_src", "year_checked_at", "created_at"];
const VERSION_COLS = ["video_id", "duration", "video_title", "video_channel", "lyrics", "validated", "missing", "confidence", "source", "checked_at", "created_at"];
const pick = (patch, cols) => Object.fromEntries(Object.entries(patch).filter(([k, v]) => cols.includes(k) && v !== undefined));

/* Une version par sa clé (ligne de la vue), ou null. */
export async function getVersion(key) {
  const p = parseKey(key);
  if (!p) return null;
  const { data, error } = await catalog().eq("work_id", p.workId).eq("mode", p.kind).maybeSingle();
  if (error) throw error;
  return data || null;
}

/* Écritures par clé de version : colonnes de version sur la version, colonnes
 * de chanson sur la chanson (toutes ses versions). */
export async function updateVersion(key, patch) {
  const p = parseKey(key);
  if (!p) return;
  const v = pick(patch, VERSION_COLS);
  const w = pick(patch, WORK_COLS);
  if (Object.keys(v).length) {
    const { error } = await sb().from("jukebox_versions").update(v).eq("work_id", p.workId).eq("kind", p.kind);
    if (error) throw error;
  }
  if (Object.keys(w).length) await updateWork(p.workId, w);
}

export async function updateWork(workId, patch) {
  const w = pick(patch, WORK_COLS);
  if (!workId || !Object.keys(w).length) return;
  const { error } = await sb().from("jukebox_works").update(w).eq("id", workId);
  if (error) throw error;
}

/* Version créée ou remplacée (vidéo trouvée, choisie à la main…). */
export async function upsertVersion(workId, kind, patch) {
  const { error } = await sb().from("jukebox_versions").upsert({ work_id: workId, kind, ...pick(patch, VERSION_COLS) }, { onConflict: "work_id,kind" });
  if (error) throw error;
}

/* Version retirée (« Oublier », vidéo disparue sans travail fait dessus) ;
 * la chanson sans plus aucune version est supprimée avec ses fiches Deezer
 * (le titre sera cherché à nouveau au prochain ajout). */
export async function deleteVersion(key) {
  const p = parseKey(key);
  if (!p) return;
  const { error } = await sb().from("jukebox_versions").delete().eq("work_id", p.workId).eq("kind", p.kind);
  if (error) throw error;
  const { count } = await sb().from("jukebox_versions").select("work_id", { count: "exact", head: true }).eq("work_id", p.workId);
  if (!count) await sb().from("jukebox_works").delete().eq("id", p.workId);
}

/* Chanson d'une fiche Deezer, ou null. */
export async function workOfDeezer(deezerId) {
  const id = Number(deezerId);
  if (!id) return null;
  const { data, error } = await sb().from("jukebox_work_aliases").select("work_id").eq("deezer_id", id).maybeSingle();
  if (error) throw error;
  return data?.work_id || null;
}

/* Fiches Deezer → chanson (Map deezerId (texte) → work_id). */
export async function worksOfDeezer(ids) {
  const list = [...new Set((ids || []).map(Number).filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await sb().from("jukebox_work_aliases").select("deezer_id,work_id").in("deezer_id", list.slice(i, i + 200));
    if (error) throw error;
    for (const a of data || []) out.set(String(a.deezer_id), a.work_id);
  }
  return out;
}

/* Nouvelle chanson avec sa première fiche Deezer. */
export async function createWork({ deezerId, label, songDuration, isrc }) {
  const { data, error } = await sb().from("jukebox_works")
    .insert({ label: label || null, song_duration: songDuration || null, isrc: isrc || null }).select("id").single();
  if (error) throw error;
  if (deezerId) await addAlias(deezerId, data.id, { label, songDuration, isrc });
  return data.id;
}

/* Fiche Deezer rattachée à une chanson (déjà rattachée : inchangée). */
export async function addAlias(deezerId, workId, { label, songDuration, isrc } = {}) {
  const { error } = await sb().from("jukebox_work_aliases").upsert({
    deezer_id: Number(deezerId), work_id: workId, label: label || null, song_duration: songDuration || null, isrc: isrc || null,
  }, { onConflict: "deezer_id", ignoreDuplicates: true });
  if (error) throw error;
}

/* Toutes les lignes de la vue (par pages : Supabase en renvoie 1 000 au plus). */
export async function allVersions(build = (q) => q, max = 20000) {
  const out = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(catalog()).order("key").range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

/* Écoutes : +1 sur la (les) chanson(s) dont une version utilise cette vidéo. */
export async function countPlay(videoId) {
  const { data } = await sb().from("jukebox_versions").select("work_id").eq("video_id", videoId);
  for (const workId of new Set((data || []).map((r) => r.work_id))) {
    const { data: w } = await sb().from("jukebox_works").select("plays").eq("id", workId).maybeSingle();
    if (w) await sb().from("jukebox_works").update({ plays: (w.plays || 0) + 1 }).eq("id", workId);
  }
}
