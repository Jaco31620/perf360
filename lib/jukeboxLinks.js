/*
 * Jukebox — vidéos ajoutées par lien YouTube en soirée (SERVEUR uniquement).
 * Elles n'entrent pas dans la mémoire (pas de fiche Deezer : on ne sait pas
 * de quelle chanson il s'agit, ni si c'en est une). File « 🔗 Ajoutés par
 * lien » du super-admin : ajouter à la mémoire (fiche Deezer choisie à la
 * main → version validée) ou ignorer (jukebox_link_ignore, SQL v35).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createWork, addAlias, workOfDeezer, getVersion, upsertVersion, versionKey } from "@/lib/jukeboxCatalog";
import { AUTO_PID } from "@/lib/jukeboxBlindServer";
import { deezerTrack, findSibling } from "@/lib/jukeboxServer";
import { isValidVideoId, SEARCH_MODES } from "@/lib/jukebox";

const sb = () => getSupabaseAdmin();

/* Vidéos jouées ou proposées en soirée absentes de la mémoire, pas ignorées :
 * la plus récente d'abord, avec la soirée et les signalements ouverts. */
export async function linkedVideos(limit = 100) {
  const { data: tracks, error } = await sb().from("jukebox_tracks")
    .select("video_id,title,channel,video_title,duration,session_id,created_at,participant_id")
    .or(`participant_id.is.null,participant_id.neq.${AUTO_PID}`).order("created_at", { ascending: false }).limit(3000);
  if (error) throw error;
  const byVideo = new Map();
  for (const t of tracks || []) if (!byVideo.has(t.video_id)) byVideo.set(t.video_id, { ...t, times: 0 });
  for (const t of tracks || []) byVideo.get(t.video_id).times++;
  const ids = [...byVideo.keys()];
  const known = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const [{ data: v }, { data: ig }] = await Promise.all([
      sb().from("jukebox_versions").select("video_id").in("video_id", part),
      sb().from("jukebox_link_ignore").select("video_id").in("video_id", part),
    ]);
    for (const r of [...(v || []), ...(ig || [])]) known.add(r.video_id);
  }
  const list = ids.filter((id) => !known.has(id)).map((id) => byVideo.get(id));
  const page = list.slice(0, limit);
  const sessions = [...new Set(page.map((t) => t.session_id))];
  const { data: ss } = sessions.length ? await sb().from("jukebox_sessions").select("id,name").in("id", sessions) : { data: [] };
  const names = new Map((ss || []).map((x) => [x.id, x.name]));
  const vids = page.map((t) => t.video_id);
  const { data: reps } = vids.length
    ? await sb().from("jukebox_reports").select("video_id,reasons,comment").eq("status", "open").is("song_key", null).in("video_id", vids)
    : { data: [] };
  return {
    total: list.length,
    items: page.map((t) => ({
      videoId: t.video_id, title: t.title, channel: t.channel, videoTitle: t.video_title, duration: t.duration,
      sessionName: names.get(t.session_id) || null, at: t.created_at, times: t.times,
      reports: (reps || []).filter((r) => r.video_id === t.video_id).map((r) => ({ reasons: r.reasons, comment: r.comment })),
    })),
  };
}
export async function linkedCount() {
  try { return (await linkedVideos(0)).total; } catch (e) { return 0; }
}

/* Ajout à la mémoire : la vidéo devient la version `kind` de la chanson de
 * cette fiche Deezer (créée au besoin), validée puisque choisie à la main.
 * La chanson a déjà cette version avec une autre vidéo : { conflict } sauf
 * replace. Ses signalements suivent (file 🚩 Signalements). */
export async function addLink({ videoId, deezerId, kind, replace }) {
  if (!isValidVideoId(videoId)) return { error: "Vidéo invalide." };
  if (!SEARCH_MODES.some((m) => m.id === kind)) return { error: "Version invalide." };
  const song = await deezerTrack(Number(deezerId));
  if (!song) return { error: "Fiche Deezer introuvable." };
  const label = `${song.rawArtist ?? song.channel} – ${song.rawTitle ?? song.title}`;
  let workId = await workOfDeezer(song.deezerId);
  if (!workId) {
    const sib = await findSibling(song); // même enregistrement déjà en mémoire (ISRC, texte)
    if (sib) { workId = sib.work_id; await addAlias(song.deezerId, workId, { label, songDuration: song.duration, isrc: song.isrc }); }
  }
  if (workId && !replace) {
    const cur = await getVersion(versionKey(workId, kind));
    if (cur && cur.video_id !== videoId) return { conflict: { videoId: cur.video_id, title: cur.video_title, validated: !!cur.validated } };
  }
  if (!workId) workId = await createWork({ deezerId: song.deezerId, label, songDuration: song.duration, isrc: song.isrc });
  const { data: t } = await sb().from("jukebox_tracks").select("duration,video_title,channel,session_id").eq("video_id", videoId).order("created_at").limit(1).maybeSingle();
  const { data: first } = t?.session_id ? await sb().from("jukebox_sessions").select("name,code").eq("id", t.session_id).maybeSingle() : { data: null }; // soirée d'origine
  await upsertVersion(workId, kind, {
    video_id: videoId, duration: t?.duration || null, video_title: t?.video_title || null,
    validated: true, missing: false, source: "link", source_session: first?.name || first?.code || null, confidence: null, checked_at: new Date().toISOString(),
  });
  const key = versionKey(workId, kind);
  await sb().from("jukebox_reports").update({ song_key: key }).eq("video_id", videoId).is("song_key", null).eq("status", "open");
  return { key };
}

export async function ignoreLink(videoId) {
  if (!isValidVideoId(videoId)) return;
  const { error } = await sb().from("jukebox_link_ignore").upsert({ video_id: videoId }, { onConflict: "video_id", ignoreDuplicates: true });
  if (error) throw error;
  await sb().from("jukebox_reports").update({ status: "rejected", decided_at: new Date().toISOString() }).eq("video_id", videoId).is("song_key", null).eq("status", "open");
}
