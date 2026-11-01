/*
 * Route SUPER-ADMIN du jukebox (en-tête x-jukebox-super requis).
 * - GET  : toutes les soirées (activité, compteurs, date de suppression),
 *          réglages, recherches YouTube du jour.
 *          ?songs=1&q=…&status=all|todo|ok|missing|blind|lyrics|suspect|dups&mode=…&lang=fr|intl|unknown&decade=1980&sort=added|plays|rank|year|alpha : mémoire des titres.
 *          ?prefill=1 : file du pré-remplissage ; ?playlists=… : playlists Deezer.
 * - POST : { action, ... }
 *     settings { retentionDays?, creationMode?, defaultFeatures?, defaultOptions? }
 *     features { code, features } → fonctions activées pour une soirée
 *     trimVideo { videoId, start, end, source? } → rognage de la vidéo (toutes soirées)
 *     trimSuggest { videoId, duration } → suggestion SponsorBlock { start, end, segments }
 *     changeAccept / changeReject { id } → proposition de vidéo faite en soirée (adoptée : validée)
 *     changeRevert { id } → revenir à la vidéo d'avant un changement
 *     actCreate { label, maxParties?, expiresAt?, features? } → nouveau code d'activation
 *     actUpdate { id, label?, maxParties?, expiresAt?, revoked?, features?, resetUsed? }
 *     actDelete { id } → supprimer un code (les soirées créées restent)
 *     regie { code, reset?, logoutAll? } → code régie de la soirée (reset : nouveau code ; logoutAll : appareils déconnectés)
 *     delete { code }  → supprimer une soirée
 *     forgetSong { key } → oublier une correspondance de la mémoire
 *     songVideos { key } → autres vidéos possibles pour un titre mémorisé
 *     replaceSong { key, videoId } → changer la vidéo retenue (repasse « à vérifier »)
 *     deezerSearch { q } / retargetSong { key, deezerId } → rattacher la ligne au bon titre Deezer
 *     blindSong { key, blind } → titre (dans ce mode) utilisable par le blind test
 *     lyricsSong { key, lyrics } → la vidéo retenue affiche les paroles
     songMeta { key, year?, fr? } → corriger année / langue (toutes les versions du titre)
     enrich → enrichir des titres tout de suite (année, langue ; ~45 s par appel)
 *     validateSong { key, validated } → marquer la vidéo retenue comme vérifiée
 *     prefill { lines? | playlist?, modes[], blind? } (playlist : id ou lien Deezer)
 *     prefillEdit { keys[], op: "remove" | "top" } → retirer / traiter en premier → titres à pré-chercher (cron de 6 h)
 *     clearPrefill → vider la file de pré-remplissage
 *     password { current, next } → changer le mot de passe super-admin
 *                      (commun avec Clic-Clac)
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { withTrims, saveTrim, sponsorBlockTrim } from "@/lib/jukeboxTrim";
import { withChanges, proposedKeys, acceptChange, rejectChange, revertChange, logChange } from "@/lib/jukeboxChanges";
import { listActivations, createActivation, updateActivation, deleteActivation, ActivationError } from "@/lib/jukeboxActivation";
import { isJukeboxSuper, loadConfig, saveConfig, sessionsWithActivity, searchesToday } from "@/lib/jukeboxAdmin";
import { setSongText, mergeSongs, ignoreDuplicates, exportSongs, importSongs } from "@/lib/jukeboxLibrary";
import { loadSession, songsCount, listSongs, forgetSong, songCandidates, replaceSongVideo, validateSong, blindSong, lyricsSong, retargetSong, deezerSearch, deezerPlaylistSearch, deezerPlaylistId, YoutubeError } from "@/lib/jukeboxServer";
import { changeMasterPassword } from "@/lib/clicclac/server";
import { ensureRegieCode, resetRegieCode } from "@/lib/jukeboxAccess";
import { normalizeFeatures } from "@/lib/jukebox";
import { enrichSongs, enrichPending, editSongMeta } from "@/lib/jukeboxEnrich";
import { prefillState, prefillFromLines, prefillFromPlaylist, prefillItems, editPrefill, clearPrefill } from "@/lib/jukeboxPrefill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // pré-remplissage : jusqu'à 100 recherches Deezer

const DAY = 24 * 3600 * 1000;

export async function GET(req) {
  if (!isJukeboxSuper(req)) return Response.json({ error: "Accès refusé." }, { status: 401 });
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("prefill"))
      return Response.json({ items: await prefillItems() }, { headers: { "cache-control": "no-store" } });
    if (url.searchParams.get("playlists"))
      return Response.json({ playlists: await deezerPlaylistSearch(url.searchParams.get("playlists")) }, { headers: { "cache-control": "no-store" } });
    if (url.searchParams.get("songs")) {
      const params = Object.fromEntries(url.searchParams);
      const songs = params.status === "changes" // changements de vidéo proposés en soirée
        ? await listSongs({ ...params, status: "all", keys: await proposedKeys() })
        : await listSongs(params);
      await withTrims(songs); // rognage de chaque vidéo (start / end)
      await withChanges(songs); // propositions en attente, dernier changement
      return Response.json({ songs }, { headers: { "cache-control": "no-store" } });
    }
    const [config, sessions, searches, songs, prefill, enrich] = await Promise.all([loadConfig(), sessionsWithActivity(), searchesToday(), songsCount(), prefillState(), enrichPending().catch(() => null)]);
    // null : table jukebox_activations absente (SQL v19 à appliquer)
    const activations = await listActivations().catch(() => null);
    const proposals = (await proposedKeys()).length; // titres avec un changement de vidéo proposé
    return Response.json({
      config,
      searches,
      songs,
      prefill,
      enrich, // titres pas encore enrichis (année, langue)
      activations,
      proposals,
      sessions: sessions.map(({ id, ...s }) => ({ ...s, expiresAt: s.lastActivity + config.retentionDays * DAY })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("jukebox super GET:", e);
    return Response.json({ error: "Chargement impossible." }, { status: 502 });
  }
}

export async function POST(req) {
  if (!isJukeboxSuper(req)) return Response.json({ error: "Accès refusé." }, { status: 401 });
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  try {
    switch (body?.action) {
      case "settings":
        await saveConfig(body);
        return Response.json({ ok: true });
      case "songVideos": {
        const d = await songCandidates(body.key);
        if (!d) return Response.json({ error: "Titre introuvable." }, { status: 404 });
        return Response.json({ ok: true, ...d });
      }
      case "deezerSearch":
        return Response.json({ ok: true, results: await deezerSearch(String(body.q || "").slice(0, 200)) });
      case "retargetSong": {
        const r = await retargetSong(body.key, body.deezerId);
        if (typeof r === "string") return Response.json({ error: r }, { status: 422 });
        return Response.json({ ok: true, key: r.key });
      }
      case "replaceSong": {
        const { data: before } = await getSupabaseAdmin().from("jukebox_songs").select("video_id").eq("key", String(body.key || "")).maybeSingle();
        const err = await replaceSongVideo(body.key, body.videoId);
        if (err) return Response.json({ error: err }, { status: 422 });
        if (before && before.video_id !== body.videoId)
          await logChange({ key: body.key, oldVideo: before.video_id, video: { id: body.videoId }, status: "applied", bySuper: true });
        return Response.json({ ok: true });
      }
      case "changeAccept":
      case "changeReject":
      case "changeRevert": {
        const fn = { changeAccept: acceptChange, changeReject: rejectChange, changeRevert: revertChange }[body.action];
        const err = await fn(body.id);
        if (err) return Response.json({ error: err }, { status: 422 });
        return Response.json({ ok: true });
      }
      case "blindSong":
        await blindSong(body.key, body.blind);
        return Response.json({ ok: true });
      case "lyricsSong":
        await lyricsSong(body.key, body.lyrics);
        return Response.json({ ok: true });
      case "songMeta":
        await editSongMeta(body.key, body);
        return Response.json({ ok: true });
      case "enrich":
        return Response.json({ ok: true, ...(await enrichSongs(45e3)), pending: await enrichPending() });
      case "validateSong":
        await validateSong(body.key, body.validated);
        return Response.json({ ok: true });
      case "prefill": {
        if (body.playlist) {
          const id = await deezerPlaylistId(body.playlist);
          const r = id && await prefillFromPlaylist(id, body.modes, !!body.blind);
          if (!r) return Response.json({ error: "Playlist Deezer introuvable (vérifiez le lien, elle doit être publique)." }, { status: 404 });
          return Response.json({ ok: true, ...r });
        }
        return Response.json({ ok: true, ...(await prefillFromLines(body.lines, body.modes, !!body.blind)) });
      }
      case "prefillEdit":
        await editPrefill(body.keys, body.op);
        return Response.json({ ok: true });
      case "clearPrefill":
        await clearPrefill();
        return Response.json({ ok: true });
      case "songText":
        await setSongText(body.key, body.artist, body.title);
        return Response.json({ ok: true });
      case "mergeSongs": {
        const err = await mergeSongs(String(body.keep || ""), body.keys);
        if (err) return Response.json({ error: err }, { status: 422 });
        return Response.json({ ok: true });
      }
      case "ignoreDup":
        await ignoreDuplicates(body.keys);
        return Response.json({ ok: true });
      case "exportSongs":
        return Response.json({ ok: true, rows: await exportSongs() });
      case "importSongs":
        return Response.json({ ok: true, ...(await importSongs(body.rows)) });
      case "forgetSong":
        await forgetSong(body.key);
        return Response.json({ ok: true });
      case "trimVideo":
        return Response.json({ ok: true, trim: await saveTrim(body.videoId, body) });
      case "trimSuggest":
        return Response.json({ ok: true, hint: await sponsorBlockTrim(body.videoId, body.duration) });
      case "actCreate":
        return Response.json({ ok: true, activation: await createActivation(body) });
      case "actUpdate":
        await updateActivation(body.id, body);
        return Response.json({ ok: true });
      case "actDelete":
        await deleteActivation(body.id);
        return Response.json({ ok: true });
      case "password": {
        const err = await changeMasterPassword(body.current, body.next);
        if (err) {
          await new Promise((r) => setTimeout(r, 600)); // ralentit les essais
          return Response.json({ error: err }, { status: 400 });
        }
        return Response.json({ ok: true });
      }
      case "regie":
      case "features":
      case "delete": {
        const s = await loadSession(body.code);
        if (!s) return Response.json({ error: "Soirée introuvable." }, { status: 404 });
        const sb = getSupabaseAdmin();
        if (body.action === "features") {
          const options = { ...(s.options || {}), features: normalizeFeatures(body.features, normalizeFeatures(s.options?.features)) };
          const { error } = await sb.from("jukebox_sessions").update({ options }).eq("id", s.id);
          if (error) throw error;
          return Response.json({ ok: true });
        }
        if (body.action === "delete") {
          const { error } = await sb.from("jukebox_sessions").delete().eq("id", s.id);
          if (error) throw error;
          return Response.json({ ok: true });
        }
        // regie : code régie de la soirée (reset : nouveau code, logoutAll : appareils déconnectés)
        const regieCode = body.reset ? await resetRegieCode(s, !!body.logoutAll) : await ensureRegieCode(s);
        return Response.json({ ok: true, regieCode });
      }
      default:
        return Response.json({ error: "Action inconnue." }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof ActivationError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof YoutubeError) return Response.json({ error: e.message }, { status: 503 });
    console.error("jukebox super POST:", e);
    return Response.json({ error: "Action impossible." }, { status: 502 });
  }
}
