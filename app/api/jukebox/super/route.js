/*
 * Route SUPER-ADMIN du jukebox (en-tête x-jukebox-super requis).
 * - GET  : toutes les soirées (activité, compteurs, date de suppression),
 *          réglages, recherches YouTube du jour.
 *          ?songs=1&q=…&status=all|todo|ok&mode=… : mémoire des titres.
 * - POST : { action, ... }
 *     settings { retentionDays?, creationMode?, creationCode? }
 *     regie { code }   → nouveau lien régie (l'ancien ne fonctionne plus)
 *     delete { code }  → supprimer une soirée
 *     forgetSong { key } → oublier une correspondance de la mémoire
 *     songVideos { key } → autres vidéos possibles pour un titre mémorisé
 *     replaceSong { key, videoId } → changer la vidéo retenue (elle devient validée)
 *     validateSong { key, validated } → marquer la vidéo retenue comme vérifiée
 *     password { current, next } → changer le mot de passe super-admin
 *                      (commun avec Clic-Clac)
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isJukeboxSuper, loadConfig, saveConfig, sessionsWithActivity, searchesToday } from "@/lib/jukeboxAdmin";
import { loadSession, newAdminToken, hashToken, songsCount, listSongs, forgetSong, songCandidates, replaceSongVideo, validateSong, YoutubeError } from "@/lib/jukeboxServer";
import { changeMasterPassword } from "@/lib/clicclac/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 3600 * 1000;

export async function GET(req) {
  if (!isJukeboxSuper(req)) return Response.json({ error: "Accès refusé." }, { status: 401 });
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("songs"))
      return Response.json({ songs: await listSongs(Object.fromEntries(url.searchParams)) }, { headers: { "cache-control": "no-store" } });
    const [config, sessions, searches, songs] = await Promise.all([loadConfig(), sessionsWithActivity(), searchesToday(), songsCount()]);
    return Response.json({
      config,
      searches,
      songs,
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
      case "replaceSong": {
        const err = await replaceSongVideo(body.key, body.videoId);
        if (err) return Response.json({ error: err }, { status: 422 });
        return Response.json({ ok: true });
      }
      case "validateSong":
        await validateSong(body.key, body.validated);
        return Response.json({ ok: true });
      case "forgetSong":
        await forgetSong(body.key);
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
      case "delete": {
        const s = await loadSession(body.code);
        if (!s) return Response.json({ error: "Soirée introuvable." }, { status: 404 });
        const sb = getSupabaseAdmin();
        if (body.action === "delete") {
          const { error } = await sb.from("jukebox_sessions").delete().eq("id", s.id);
          if (error) throw error;
          return Response.json({ ok: true });
        }
        const token = newAdminToken();
        const { error } = await sb.from("jukebox_sessions").update({ admin_hash: hashToken(token) }).eq("id", s.id);
        if (error) throw error;
        return Response.json({ ok: true, adminToken: token });
      }
      default:
        return Response.json({ error: "Action inconnue." }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof YoutubeError) return Response.json({ error: e.message }, { status: 503 });
    console.error("jukebox super POST:", e);
    return Response.json({ error: "Action impossible." }, { status: 502 });
  }
}
