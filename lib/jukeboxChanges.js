/*
 * Jukebox — changements de vidéo des titres de la mémoire (SERVEUR uniquement,
 * table jukebox_video_changes, SQL v21).
 * « Mauvaise vidéo ? » en soirée change toujours la vidéo de la soirée. Pour
 * la mémoire (prochaines soirées) : titre validé par le super-admin →
 * simple proposition, à adopter ou refuser dans le super-admin ; titre pas
 * encore validé → nouvelle vidéo retenue (à vérifier), avec la trace de qui
 * l'a changée et quand. Le super-admin change la mémoire directement, et peut
 * revenir à la vidéo d'avant.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { replaceSongVideo } from "@/lib/jukeboxServer";

const table = () => getSupabaseAdmin().from("jukebox_video_changes");

/* Trace d'un changement. session : ligne jukebox_sessions (null : super-admin). */
export async function logChange({ key, oldVideo, video, status, bySuper = false, session = null }) {
  const { error } = await table().insert({
    song_key: key, old_video: oldVideo || null, new_video: video.id,
    new_title: video.title || null, new_channel: video.channel || null, new_duration: video.duration || null,
    status, by_super: !!bySuper,
    session_code: session?.code || null, session_name: session?.name || null, organizer: session?.options?.organizer || null,
    ...(status === "applied" ? { decided_at: new Date().toISOString() } : {}),
  });
  if (error) console.error("jukebox logChange:", error.message); // la trace ne bloque pas le changement
}

/* « Mauvaise vidéo ? » en soirée : que faire de la mémoire ?
 * → "applied" (mémoire changée), "proposed" (titre validé : proposition) ou null. */
export async function soireeVideoChange({ key, video, session, bySuper, remember }) {
  const { data: row } = await getSupabaseAdmin().from("jukebox_songs").select("video_id,validated").eq("key", key).maybeSingle();
  if (!row || row.video_id === video.id) return null;
  const status = bySuper || !row.validated ? "applied" : "proposed";
  if (status === "applied") await remember();
  await logChange({ key, oldVideo: row.video_id, video, status, bySuper, session });
  return status;
}

const out = (r) => ({
  id: r.id, oldVideo: r.old_video, newVideo: r.new_video, newTitle: r.new_title, newChannel: r.new_channel, newDuration: r.new_duration,
  status: r.status, bySuper: r.by_super, sessionCode: r.session_code, sessionName: r.session_name, organizer: r.organizer,
  at: r.created_at, decidedAt: r.decided_at,
});

/* Ajoute à chaque titre : proposals (en attente) et lastChange (dernier
 * changement appliqué, pour revenir en arrière). */
export async function withChanges(songs) {
  const keys = [...new Set(songs.map((s) => s.key).filter(Boolean))];
  if (!keys.length) return;
  const { data, error } = await table().select("*").in("song_key", keys).in("status", ["proposed", "applied"]).order("created_at", { ascending: false });
  if (error) return; // table absente (SQL v21)
  for (const s of songs) {
    const rows = (data || []).filter((r) => r.song_key === s.key);
    s.proposals = rows.filter((r) => r.status === "proposed").map(out);
    const last = rows.find((r) => r.status === "applied" && r.new_video === s.videoId);
    s.lastChange = last ? out(last) : null;
  }
}

/* Clés des titres qui ont des propositions en attente. */
export async function proposedKeys() {
  const { data, error } = await table().select("song_key").eq("status", "proposed");
  if (error) return [];
  return [...new Set((data || []).map((r) => r.song_key))];
}

async function loadChange(id) {
  const { data } = await table().select("*").eq("id", String(id || "")).maybeSingle();
  return data;
}
const decide = (ids, status) => table().update({ status, decided_at: new Date().toISOString() }).in("id", ids);

/* Super-admin : adopter une proposition (la vidéo proposée devient celle de la
 * mémoire, validée : elle vient d'être comparée et choisie). */
export async function acceptChange(id) {
  const c = await loadChange(id);
  if (!c || c.status !== "proposed") return "Proposition introuvable.";
  const err = await replaceSongVideo(c.song_key, c.new_video);
  if (err) return err;
  await getSupabaseAdmin().from("jukebox_songs").update({ validated: true }).eq("key", c.song_key);
  // les autres propositions de ce titre : même vidéo → adoptées, sinon refusées
  const { data: others } = await table().select("id,new_video").eq("song_key", c.song_key).eq("status", "proposed");
  const same = (others || []).filter((o) => o.new_video === c.new_video).map((o) => o.id);
  const rest = (others || []).filter((o) => o.new_video !== c.new_video).map((o) => o.id);
  if (same.length) await decide(same, "applied");
  if (rest.length) await decide(rest, "rejected");
  return null;
}

export async function rejectChange(id) {
  const c = await loadChange(id);
  if (!c || c.status !== "proposed") return "Proposition introuvable.";
  await decide([c.id], "rejected");
  return null;
}

/* Super-admin : revenir à la vidéo d'avant un changement appliqué. */
export async function revertChange(id) {
  const c = await loadChange(id);
  if (!c || c.status !== "applied" || !c.old_video) return "Changement introuvable.";
  const err = await replaceSongVideo(c.song_key, c.old_video);
  if (err) return err;
  await decide([c.id], "reverted");
  return null;
}
