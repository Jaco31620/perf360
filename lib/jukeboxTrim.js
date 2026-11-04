/*
 * Jukebox — rognage des vidéos (SERVEUR uniquement, table jukebox_trims,
 * SQL v20). Certaines vidéos ont un habillage autour de la chanson (intro,
 * logo, scène parlée, générique) : on ne joue que la partie gardée, de
 * `start` à `end` (secondes ; end null = jusqu'au bout). Rangé par vidéo
 * YouTube et par usage (SQL v29, colonne kind) : « » = toutes les versions,
 * « normal » / « clip » / « karaoke » = réglage propre à cette version (une
 * même vidéo peut être rognée pour la version paroles — blind test — et
 * gardée entière pour la version clip). Toutes les soirées en profitent ; une
 * vidéo changée repart sans rognage.
 * Suggestion automatique : SponsorBlock (API publique, sans clé), catégories
 * music_offtopic (passages sans musique dans un clip), intro et outro.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidVideoId } from "@/lib/jukebox";

const round = (x) => Math.round(x * 10) / 10;

/* { videoId: { start, end } } pour les vidéos demandées (rognées seulement). */
const KINDS = ["normal", "clip", "karaoke"];
let kindColumn = true; // colonne kind (SQL v29) : sinon rognage par vidéo seulement, comme avant
const noKind = (e) => !!e && (e.code === "42703" || e.code === "PGRST204" || /kind/i.test(e.message || ""));

/* { "videoId|kind": { start, end, source } } pour les vidéos demandées (kind « » : toutes versions). */
export async function loadTrims(videoIds) {
  const ids = [...new Set(videoIds.filter(isValidVideoId))];
  if (!ids.length) return {};
  const sb = getSupabaseAdmin();
  let { data, error } = await sb.from("jukebox_trims").select(kindColumn ? "video_id,kind,start_at,end_at,source" : "video_id,start_at,end_at,source").in("video_id", ids);
  if (error && kindColumn && noKind(error)) {
    kindColumn = false;
    ({ data, error } = await sb.from("jukebox_trims").select("video_id,start_at,end_at,source").in("video_id", ids));
  }
  if (error) return {}; // table absente (SQL v20) : pas de rognage
  return Object.fromEntries((data || []).map((r) => [`${r.video_id}|${r.kind || ""}`, { start: r.start_at || 0, end: r.end_at ?? null, source: r.source, kind: r.kind || "" }]));
}

/* Ajoute start / end aux titres envoyés aux lecteurs et à la télécommande. */
/* kinds(t) : usages à essayer dans l'ordre (ex. ["clip"]) ; le réglage commun
 * « » sert de repli. Un réglage propre « sans rognage » (0 → fin) l'emporte. */
export async function withTrims(tracks, kinds = () => []) {
  const list = tracks.filter(Boolean);
  const trims = await loadTrims(list.map((t) => t.videoId));
  for (const t of list) {
    const tr = [...kinds(t), ""].map((k) => trims[`${t.videoId}|${k}`]).find(Boolean);
    if (tr) { t.start = tr.start; t.end = tr.end; t.trimSource = tr.source; t.trimKind = tr.kind || null; }
  }
}

export async function saveTrim(videoId, { start, end, source = "manual", kind = "" }) {
  if (!isValidVideoId(videoId)) throw new Error("Vidéo invalide.");
  kind = kindColumn && KINDS.includes(kind) ? kind : "";
  const s = Math.max(0, round(Number(start) || 0));
  const e = end == null || end === "" ? null : round(Number(end));
  const sb = getSupabaseAdmin();
  const where = (q) => (kindColumn ? q.eq("video_id", videoId).eq("kind", kind) : q.eq("video_id", videoId));
  if (!s && e == null) { // plus rien à rogner
    if (kind) { // réglage propre à la version : « entière » explicite si un réglage commun existe
      const { data: common } = await sb.from("jukebox_trims").select("video_id").eq("video_id", videoId).eq("kind", "").maybeSingle();
      if (common) {
        const { error } = await sb.from("jukebox_trims").upsert({ video_id: videoId, kind, start_at: 0, end_at: null, source: "manual", updated_at: new Date().toISOString() }, { onConflict: "video_id,kind" });
        if (error) throw error;
        return null;
      }
    }
    const { error } = await where(sb.from("jukebox_trims").delete());
    if (error) throw error;
    return null;
  }
  if (e != null && e <= s + 20) throw new Error("La partie gardée doit durer au moins 20 secondes.");
  if (s > 3600) throw new Error("Début invalide.");
  const row = { video_id: videoId, start_at: s, end_at: e, source: source === "sponsorblock" ? "sponsorblock" : "manual", updated_at: new Date().toISOString() };
  const { error } = kindColumn
    ? await sb.from("jukebox_trims").upsert({ ...row, kind }, { onConflict: "video_id,kind" })
    : await sb.from("jukebox_trims").upsert(row);
  if (error) throw error;
  return { start: s, end: e };
}

/* Suggestion SponsorBlock : passages collés au début (→ start) et à la fin
 * (→ end) de la vidéo ; les passages au milieu sont ignorés. */
export async function sponsorBlockTrim(videoId, duration) {
  if (!isValidVideoId(videoId)) return null;
  const cats = encodeURIComponent(JSON.stringify(["music_offtopic", "intro", "outro"]));
  let segs;
  try {
    const res = await fetch(`https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=${cats}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (res.status === 404) return { start: 0, end: null, segments: 0 }; // rien de signalé
    if (!res.ok) return null;
    segs = await res.json();
  } catch (e) { return null; }
  const len = Number(duration) || Math.max(0, ...segs.map((s) => s.videoDuration || 0));
  let start = 0;
  let end = null;
  // passages qui s'enchaînent depuis le début
  for (const s of [...segs].sort((a, b) => a.segment[0] - b.segment[0])) {
    if (s.segment[0] <= start + 2) start = Math.max(start, s.segment[1]);
  }
  // passages qui s'enchaînent jusqu'à la fin
  if (len) {
    let cut = len;
    for (const s of [...segs].sort((a, b) => b.segment[1] - a.segment[1])) {
      if (s.segment[1] >= cut - 2) cut = Math.min(cut, s.segment[0]);
    }
    if (cut < len - 1) end = cut;
  }
  if (end != null && end - start < 30) return { start: 0, end: null, segments: segs.length }; // incohérent : ignoré
  return { start: round(start), end: end == null ? null : round(end), segments: segs.length };
}
