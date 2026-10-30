/*
 * Route serveur RÉGIE d'une soirée jukebox (en-tête x-jukebox-admin requis).
 * Body : { action, ... }
 *   open | close           → ouvrir / fermer les propositions
 *   max { max }            → titres en attente par participant (0 = illimité)
 *   searchMode { mode }    → recherche normale | paroles | karaoke
 *   options { screenQueue?, guestQueue?, fairQueue?, dedications?, authorReveal?, fade? } → file visible sur l'écran /
 *                            chez les invités, durée du fondu enchaîné
 *   name { name }          → renommer la soirée
 *   next { from, skip }    → titre suivant. `from` = id du titre que la régie
 *                            croit en cours (null si aucun) : si ce n'est plus
 *                            le cas, rien ne bouge (double appel, 2e onglet…)
 *   playback { id, pos, playing, volume } → état de lecture de la régie (pour
 *                            l'écran et la télécommande), horodaté par le serveur
 *   command { type, value } → ordre de la télécommande à la régie :
 *                            pause | play | volume (0-100)
 *   playnow { id }         → lancer tout de suite un titre de la file (le titre
 *                            en cours est interrompu)
 *   move { id, dir }       → up | down | top dans la file
 *   clearDedication { id } → effacer la dédicace d'un titre (modération)
 *   videos { id }          → autres vidéos possibles pour ce titre (« Mauvaise vidéo ? »)
 *   replaceVideo { id, videoId } → changer la vidéo d'un titre (en attente ou en
 *                            cours) et corriger la mémoire des titres
 *   remove { id }          → retirer un titre en attente
 *   reset                  → vider la file (et l'historique)
 *   delete                 → supprimer la soirée
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadSession, publicSession, isAdminReq, songAlternatives, findSongKey, rememberSong, ytVideo, REJECT_MESSAGES, YoutubeError } from "@/lib/jukeboxServer";
import { MAX_NAME_LEN, normalizeMax, normalizeMode, normalizeFade, normalizeReveal } from "@/lib/jukebox";

export const runtime = "nodejs";

export async function POST(req, { params }) {
  const receivedAt = Date.now(); // horodatage de `playback` : avant tout accès base
  const { code } = await params;
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }

  try {
    const s = await loadSession(code);
    if (!s) return Response.json({ error: "Soirée introuvable." }, { status: 404 });
    if (!isAdminReq(req, s))
      return Response.json({ error: "Accès refusé." }, { status: 401 });

    const sb = getSupabaseAdmin();
    const update = (patch) => sb.from("jukebox_sessions").update(patch).eq("id", s.id);
    const tracks = () => sb.from("jukebox_tracks");
    const queued = async () => {
      const { data, error } = await tracks().select("id,position")
        .eq("session_id", s.id).eq("status", "queued").order("position");
      if (error) throw error;
      return data;
    };
    let res = { error: null };

    switch (body?.action) {
      case "open":
      case "close":
        res = await update({ status: body.action === "open" ? "open" : "closed" });
        break;
      case "max":
        res = await update({ max_per_participant: normalizeMax(body.max) });
        break;
      case "searchMode":
        res = await update({ options: { ...(s.options || {}), searchMode: normalizeMode(body.mode) }, karaoke: false });
        break;
      case "options": {
        const options = { ...(s.options || {}) };
        for (const k of ["screenQueue", "guestQueue", "fairQueue", "dedications"]) if (k in body) options[k] = !!body[k];
        if ("fade" in body) options.fade = normalizeFade(body.fade);
        if ("authorReveal" in body) options.authorReveal = normalizeReveal(body.authorReveal);
        res = await update({ options });
        break;
      }
      case "name": {
        const name = String(body.name || "").trim().slice(0, MAX_NAME_LEN);
        if (!name) return Response.json({ error: "Nom vide." }, { status: 400 });
        res = await update({ name });
        break;
      }
      case "next": {
        const { data: cur, error } = await tracks().select("id").eq("session_id", s.id).eq("status", "playing");
        if (error) throw error;
        if ((cur[0]?.id || null) !== (body.from || null)) break;
        if (cur.length) {
          res = await tracks().update({ status: body.skip ? "skipped" : "played" })
            .eq("session_id", s.id).eq("status", "playing");
          if (res.error) break;
        }
        const [nxt] = await queued();
        if (nxt) res = await tracks().update({ status: "playing", played_at: new Date().toISOString() }).eq("id", nxt.id);
        break;
      }
      case "playback": {
        const pos = Number(body.pos);
        if (typeof body.id !== "string" || !Number.isFinite(pos) || pos < 0 || pos > 86400)
          return Response.json({ error: "Position invalide." }, { status: 400 });
        const volume = Math.min(100, Math.max(0, Math.round(Number(body.volume))));
        res = await update({ playback: { id: body.id, pos, playing: !!body.playing, at: receivedAt, ...(Number.isFinite(volume) ? { volume } : {}) } });
        break;
      }
      case "command": {
        if (!["pause", "play", "volume"].includes(body.type))
          return Response.json({ error: "Commande inconnue." }, { status: 400 });
        const value = body.type === "volume" ? Math.min(100, Math.max(0, Math.round(Number(body.value) || 0))) : null;
        res = await update({ command: { id: `${receivedAt}-${Math.random().toString(36).slice(2, 8)}`, type: body.type, value } });
        break;
      }
      case "playnow": {
        const { data: t, error } = await tracks().select("id")
          .eq("session_id", s.id).eq("id", String(body.id || "")).eq("status", "queued").maybeSingle();
        if (error) throw error;
        if (!t) return Response.json({ error: "Titre introuvable." }, { status: 404 });
        res = await tracks().update({ status: "skipped" }).eq("session_id", s.id).eq("status", "playing");
        if (!res.error) res = await tracks().update({ status: "playing", played_at: new Date().toISOString() }).eq("id", t.id);
        break;
      }
      case "move": {
        const q = await queued();
        const i = q.findIndex((t) => t.id === body.id);
        if (i < 0) return Response.json({ error: "Titre introuvable." }, { status: 404 });
        if (body.dir === "top") {
          if (i > 0) res = await tracks().update({ position: q[0].position - 1 }).eq("id", q[i].id);
          break;
        }
        const j = body.dir === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= q.length) break;
        res = await tracks().update({ position: q[j].position }).eq("id", q[i].id);
        if (!res.error) res = await tracks().update({ position: q[i].position }).eq("id", q[j].id);
        break;
      }
      case "clearDedication":
        res = await tracks().update({ dedication: null }).eq("session_id", s.id).eq("id", String(body.id || ""));
        break;
      case "videos":
      case "replaceVideo": {
        const { data: t, error } = await tracks().select("*")
          .eq("session_id", s.id).eq("id", String(body.id || "")).in("status", ["queued", "playing"]).maybeSingle();
        if (error) throw error;
        if (!t) return Response.json({ error: "Titre introuvable." }, { status: 404 });
        const mode = publicSession(s).searchMode;
        if (body.action === "videos") {
          const { candidates } = await songAlternatives(t, mode);
          return Response.json({ ok: true, current: t.video_id, candidates });
        }
        const { video, reason } = await ytVideo(String(body.videoId || ""), { musicOnly: false });
        if (!video) return Response.json({ error: REJECT_MESSAGES[reason] }, { status: 422 });
        const key = await findSongKey(t.video_id, mode);
        res = await tracks().update({
          video_id: video.id, duration: video.duration,
          ...(String(t.thumb || "").includes("ytimg") ? { thumb: video.thumb } : {}), // pochette Deezer conservée
        }).eq("id", t.id);
        if (!res.error && key) await rememberSong(key, video, null, true); // corrigé (et validé) pour les prochaines soirées
        break;
      }
      case "remove":
        res = await tracks().delete().eq("session_id", s.id).eq("id", String(body.id || "")).eq("status", "queued");
        break;
      case "reset":
        res = await tracks().delete().eq("session_id", s.id);
        break;
      case "delete":
        res = await sb.from("jukebox_sessions").delete().eq("id", s.id);
        break;
      default:
        return Response.json({ error: "Action inconnue." }, { status: 400 });
    }
    if (res.error) throw res.error;
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof YoutubeError) return Response.json({ error: e.message }, { status: 503 });
    console.error("jukebox admin:", e);
    return Response.json({ error: "Action impossible." }, { status: 502 });
  }
}
