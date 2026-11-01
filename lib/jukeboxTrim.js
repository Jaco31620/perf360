/*
 * Jukebox — rognage des vidéos (SERVEUR uniquement, table jukebox_trims,
 * SQL v20). Certaines vidéos ont un habillage autour de la chanson (intro,
 * logo, scène parlée, générique) : on ne joue que la partie gardée, de
 * `start` à `end` (secondes ; end null = jusqu'au bout). Rangé par vidéo
 * YouTube : toutes les soirées et tous les modes en profitent, et une vidéo
 * changée repart sans rognage.
 * Suggestion automatique : SponsorBlock (API publique, sans clé), catégories
 * music_offtopic (passages sans musique dans un clip), intro et outro.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidVideoId } from "@/lib/jukebox";

const round = (x) => Math.round(x * 10) / 10;

/* { videoId: { start, end } } pour les vidéos demandées (rognées seulement). */
export async function loadTrims(videoIds) {
  const ids = [...new Set(videoIds.filter(isValidVideoId))];
  if (!ids.length) return {};
  const { data, error } = await getSupabaseAdmin().from("jukebox_trims").select("video_id,start_at,end_at,source").in("video_id", ids);
  if (error) return {}; // table absente (SQL v20) : pas de rognage
  return Object.fromEntries((data || []).map((r) => [r.video_id, { start: r.start_at || 0, end: r.end_at ?? null, source: r.source }]));
}

/* Ajoute start / end aux titres envoyés aux lecteurs et à la télécommande. */
export async function withTrims(tracks) {
  const list = tracks.filter(Boolean);
  const trims = await loadTrims(list.map((t) => t.videoId));
  for (const t of list) {
    const tr = trims[t.videoId];
    if (tr) { t.start = tr.start; t.end = tr.end; t.trimSource = tr.source; }
  }
}

export async function saveTrim(videoId, { start, end, source = "manual" }) {
  if (!isValidVideoId(videoId)) throw new Error("Vidéo invalide.");
  const s = Math.max(0, round(Number(start) || 0));
  const e = end == null || end === "" ? null : round(Number(end));
  const sb = getSupabaseAdmin();
  if (!s && e == null) { // plus rien à rogner
    const { error } = await sb.from("jukebox_trims").delete().eq("video_id", videoId);
    if (error) throw error;
    return null;
  }
  if (e != null && e <= s + 20) throw new Error("La partie gardée doit durer au moins 20 secondes.");
  if (s > 3600) throw new Error("Début invalide.");
  const { error } = await sb.from("jukebox_trims").upsert({
    video_id: videoId, start_at: s, end_at: e, source: source === "sponsorblock" ? "sponsorblock" : "manual", updated_at: new Date().toISOString(),
  });
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
