/*
 * Jukebox — mode clip v2 (SERVEUR uniquement) : « 🎬 Proposer le clip » en
 * soirée, recherche de nuit des versions manquantes. Règles :
 * lib/jukeboxClipRules.js.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { parseVideoId } from "@/lib/jukebox";
import { catalog, getVersion, versionKey, allVersions } from "@/lib/jukeboxCatalog";
import { ytVideo, rememberSong, deezerTrack, youtubeForSong, findClip, REJECT_MESSAGES } from "@/lib/jukeboxServer";
import { logChange } from "@/lib/jukeboxChanges";
import { clipState, parolesOk } from "@/lib/jukeboxClipRules";

/* Lien du clip proposé pour un titre de la file qui passe sa version paroles
 * (mention « pas de clip validé ») : le lien passe pour CE titre seulement ;
 * pour la mémoire, il devient le clip à vérifier de la chanson (clip en
 * attente ou à vérifier), ou une proposition au super-admin (clip validé ou
 * « pas de clip »). → { error } ou { video, memory }. */
export async function proposeClip(s, track, link, { admin = false } = {}) {
  if (!track || track.status !== "queued") return { error: "Ce titre n'est plus dans la file." };
  if (!track.no_clip) return { error: "Ce titre passe déjà avec son clip." };
  const id = parseVideoId(link);
  if (!id) return { error: "Collez un lien YouTube (youtube.com ou youtu.be)." };
  const { video, reason } = await ytVideo(id, { musicOnly: true });
  if (!video) return { error: REJECT_MESSAGES[reason] };

  // la chanson : d'après la vidéo paroles qui devait passer
  const { data: rows } = await catalog("work_id,mode").eq("video_id", track.video_id);
  const workId = (rows || []).find((r) => r.mode === "normal")?.work_id || (rows || [])[0]?.work_id || null;

  const { error } = await getSupabaseAdmin().from("jukebox_tracks").update({
    video_id: video.id, duration: video.duration, video_title: video.title || null, no_clip: false,
    ...(String(track.thumb || "").includes("ytimg") ? { thumb: video.thumb } : {}), // pochette Deezer conservée
  }).eq("id", track.id).eq("status", "queued");
  if (error) throw error;

  let memory = null;
  if (workId) {
    const key = versionKey(workId, "clip");
    const clip = await getVersion(key).catch(() => null);
    const session = { code: s.code, name: s.name, options: s.options };
    if (!clip || clip.video_id !== video.id) {
      const st = clipState(clip);
      memory = st === "ok" || st === "noclip" ? "proposed" : "applied";
      if (memory === "applied") await rememberSong(key, video, null, false, { source: admin ? "regie" : "guest", session: s.name || s.code });
      await logChange({ key, oldVideo: clip?.video_id || null, video, status: memory, session });
    }
  }
  return { video, memory };
}

/* ---------- Recherche de nuit (après le pré-remplissage, reste du quota) ----------
 * 1. versions paroles absentes (chansons ajoutées en soirée clip) : il en faut
 *    une pour pouvoir décider « pas de clip » ;
 * 2. clips en attente des chansons dont la version paroles est validée, les
 *    plus jouées puis les plus populaires d'abord.
 * Jamais : « pas de clip », clips à vérifier, karaoké, chansons non validées. */
const LAST_KEY = "clip_scan_last";

export async function missingVersions() {
  const rows = await allVersions((q) => q.in("mode", ["normal", "clip"]));
  const by = new Map();
  for (const r of rows) {
    const w = by.get(r.work_id) || by.set(r.work_id, { workId: r.work_id, deezerId: r.deezer_id, plays: r.plays || 0, rank: r.rank || 0 }).get(r.work_id);
    w[r.mode === "clip" ? "clip" : "paroles"] = r;
  }
  const works = [...by.values()].filter((w) => w.deezerId)
    .sort((a, b) => b.plays - a.plays || b.rank - a.rank);
  return [
    ...works.filter((w) => !w.paroles).map((w) => ({ ...w, kind: "normal" })),
    ...works.filter((w) => parolesOk(w.paroles) && clipState(w.clip) === "wait").map((w) => ({ ...w, kind: "clip" })),
  ];
}

export async function scanState() {
  const [{ data }, todo] = await Promise.all([
    getSupabaseAdmin().from("jukebox_config").select("value").eq("key", LAST_KEY).maybeSingle(),
    missingVersions().catch(() => null),
  ]);
  let last = null;
  try { last = data?.value ? JSON.parse(data.value) : null; } catch (e) { last = null; }
  return { paroles: todo ? todo.filter((w) => w.kind === "normal").length : null, clips: todo ? todo.filter((w) => w.kind === "clip").length : null, last };
}

export async function scanVersions(budgetMs = 60e3, max = 1000) {
  const start = Date.now();
  const list = (await missingVersions()).slice(0, max);
  let paroles = 0, clips = 0, failed = 0, errors = 0, stop = list.length ? "done" : "empty", error = null;
  for (const w of list) {
    if (Date.now() - start > budgetMs) { stop = "time"; break; }
    try {
      const song = await deezerTrack(w.deezerId); // fiche Deezer complète (gratuite)
      const video = !song ? null : w.kind === "clip" ? await findClip(song, w.workId, { source: "scan" }) : await youtubeForSong(song, "normal", { source: "scan" });
      if (!video) failed++;
      else if (w.kind === "clip") clips++;
      else paroles++;
      errors = 0;
    } catch (e) {
      if (e?.quota) { stop = "quota"; break; }
      error = String(e?.message || e);
      console.error("jukebox scan:", w.workId, error);
      if (++errors >= 3) { stop = "error"; break; }
    }
  }
  const report = { at: new Date().toISOString(), paroles, clips, failed, stop, remaining: Math.max(0, list.length - paroles - clips - failed), ...(stop === "error" ? { error } : {}) };
  await getSupabaseAdmin().from("jukebox_config").upsert({ key: LAST_KEY, value: JSON.stringify(report) }).then(() => {}, () => {});
  return report;
}
