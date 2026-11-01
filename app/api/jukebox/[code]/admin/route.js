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
 *   reset                  → vider la file (titre en cours compris ; l'historique reste)
 *   theme { palette?, title?, message? } → thème de la soirée (fonction « thème »)
 *   logo { dataUrl | null } → logo du thème (image ≤ 400 Ko, en data URL)
 *   blind { on?, mode?, auto?, reveal?, after? } → blind test (fonction « blind test »)
 *   blindReveal            → dévoiler le titre en cours
 *   blindAccept { participantId, name, part } → accepter l'artiste ou le titre d'un invité
 *   blindReset             → remettre les scores à zéro
 *   history                → titres joués (fonction « historique »)
 *   replay { id }          → remettre un titre joué en fin de file
 *   clearHistory           → effacer l'historique
 *   delete                 → supprimer la soirée
 *   access                 → code régie et appareils autorisés
 *   joinPass               → passe à usage unique pour ajouter un appareil (QR, 10 min)
 *   revokeDevice { id }    → retirer un appareil
 *   regieCode { logoutAll } → nouveau code régie (appareils déconnectés si logoutAll)
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { soireeVideoChange } from "@/lib/jukeboxChanges";
import { isJukeboxSuper } from "@/lib/jukeboxAdmin";
import { adminAccess, ensureRegieCode, listDevices, createJoinPass, revokeDevice, resetRegieCode } from "@/lib/jukeboxAccess";
import { loadSession, publicSession, regieOptions, songAlternatives, findSongKey, rememberSong, countPlay, ytVideo, REJECT_MESSAGES, YoutubeError } from "@/lib/jukeboxServer";
import { MAX_NAME_LEN, MAX_LOGO_BYTES, normalizeMax, normalizeMode, normalizeTheme } from "@/lib/jukebox";
import { normalizeBlind } from "@/lib/jukeboxBlind";
import { sessionBlind, topUpBlind, dropBlindPicks, acceptAnswer, playPos, AUTO_PID } from "@/lib/jukeboxBlindServer";

export const runtime = "nodejs";

export async function POST(req, { params }) {
  const receivedAt = Date.now(); // horodatage de `playback` : avant tout accès base
  const { code } = await params;
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }

  try {
    const s = await loadSession(code);
    if (!s) return Response.json({ error: "Soirée introuvable." }, { status: 404 });
    const access = await adminAccess(req, s);
    if (!access.ok)
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
        res = await update({ options: { ...(s.options || {}), searchMode: normalizeMode(body.mode) } });
        break;
      case "options": {
        const { searchMode, ...rest } = body; // le mode a sa propre action
        res = await update({ options: regieOptions(rest, s.options || {}) });
        break;
      }
      case "name": {
        const name = String(body.name || "").trim().slice(0, MAX_NAME_LEN);
        if (!name) return Response.json({ error: "Nom vide." }, { status: 400 });
        res = await update({ name });
        break;
      }
      case "next": {
        const { data: cur, error } = await tracks().select("id,video_id").eq("session_id", s.id).eq("status", "playing");
        if (error) throw error;
        if ((cur[0]?.id || null) !== (body.from || null)) break;
        if (cur.length) {
          res = await tracks().update({ status: body.skip ? "skipped" : "played" })
            .eq("session_id", s.id).eq("status", "playing");
          if (res.error) break;
          if (!body.skip) await countPlay(cur[0].video_id);
        }
        await topUpBlind(s); // blind test automatique : file complétée
        const [nxt] = await queued();
        if (nxt) res = await tracks().update({ status: "playing", played_at: new Date().toISOString() }).eq("id", nxt.id);
        if (!res.error) await topUpBlind(s);
        break;
      }
      case "playback": {
        const pos = Number(body.pos);
        if (typeof body.id !== "string" || !Number.isFinite(pos) || pos < 0 || pos > 86400)
          return Response.json({ error: "Position invalide." }, { status: 400 });
        const volume = Math.min(100, Math.max(0, Math.round(Number(body.volume))));
        // Un seul lecteur à la fois (télé ou ordinateur) : `player` = appareil qui
        // joue le son. Un autre lecteur ne peut le remplacer qu'en le demandant
        // (claim : « Prendre le son ici ») ; sinon son état est ignoré et il
        // apprend qui joue (il se coupe). Lecteur muet depuis 20 s : place libre.
        const me = body.player && typeof body.player.id === "string"
          ? { id: body.player.id.slice(0, 40), kind: body.player.kind === "tv" ? "tv" : "pc" } : null;
        const holder = s.playback?.player || null;
        const alive = !!s.playback && receivedAt - (Number(s.playback.at) || 0) < 20000;
        if (me && holder && holder.id !== me.id && alive && !body.claim)
          return Response.json({ ok: false, owner: holder });
        const player = me ? { ...me, since: body.claim || !holder || holder.id !== me.id ? receivedAt : holder.since } : holder;
        res = await update({ playback: { id: body.id, pos, playing: !!body.playing, at: receivedAt, ...(Number.isFinite(volume) ? { volume } : {}), ...(player ? { player } : {}) } });
        if (!res.error) return Response.json({ ok: true, since: player?.since ?? null });
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
        if (Number.isInteger(body.to)) { // glisser-déposer : place `to` dans la file
          const rest = q.filter((t) => t.id !== body.id);
          const to = Math.max(0, Math.min(rest.length, body.to));
          if (to === i) break;
          const prev = rest[to - 1], next = rest[to];
          const position = prev && next ? (Number(prev.position) + Number(next.position)) / 2
            : prev ? Number(prev.position) + 1 : Number(next.position) - 1;
          res = await tracks().update({ position }).eq("id", body.id);
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
          video_id: video.id, duration: video.duration, video_title: video.title || null,
          ...(String(t.thumb || "").includes("ytimg") ? { thumb: video.thumb } : {}), // pochette Deezer conservée
        }).eq("id", t.id);
        if (res.error) break;
        // mémoire (prochaines soirées) : titre validé → proposition au super-admin ; sinon vidéo retenue, à vérifier (trace dans les deux cas)
        const memory = key ? await soireeVideoChange({
          key, video, session: s, bySuper: isJukeboxSuper(req), remember: () => rememberSong(key, video, null, false),
        }) : null;
        return Response.json({ ok: true, memory });
      }
      case "access":
        return Response.json({ ok: true, regieCode: await ensureRegieCode(s), devices: await listDevices(s, access.deviceId) });
      case "joinPass":
        return Response.json({ ok: true, pass: await createJoinPass(s) });
      case "revokeDevice":
        await revokeDevice(s, body.id);
        return Response.json({ ok: true, devices: await listDevices(s, access.deviceId) });
      case "regieCode": {
        const regieCode = await resetRegieCode(s, !!body.logoutAll);
        return Response.json({ ok: true, regieCode, devices: body.logoutAll ? [] : await listDevices(s, access.deviceId) });
      }
      case "remove": {
        // titre pioché par le blind test : écarté (pas repioché ce soir), un autre le remplace
        const { data: t } = await tracks().select("participant_id").eq("session_id", s.id).eq("id", String(body.id || "")).eq("status", "queued").maybeSingle();
        if (!t) break;
        res = t.participant_id === AUTO_PID
          ? await tracks().update({ status: "removed" }).eq("id", String(body.id))
          : await tracks().delete().eq("id", String(body.id));
        if (!res.error && t.participant_id === AUTO_PID) await topUpBlind(s);
        break;
      }
      case "reset":
        res = await tracks().delete().eq("session_id", s.id).in("status", ["queued", "playing"]);
        break;
      case "theme":
      case "logo": {
        if (!publicSession(s).features.theme) return Response.json({ error: "Thème non activé pour cette soirée." }, { status: 403 });
        const theme = normalizeTheme(s.options?.theme);
        if (body.action === "theme") {
          for (const k of ["palette", "title", "message"]) if (k in body) theme[k] = body[k];
        } else {
          const key = `logo:${s.id}`;
          if (body.dataUrl) {
            const url = String(body.dataUrl);
            if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url) || url.length * 0.75 > MAX_LOGO_BYTES)
              return Response.json({ error: "Image invalide ou trop lourde." }, { status: 400 });
            const { error } = await sb.from("jukebox_config").upsert({ key, value: url });
            if (error) throw error;
            theme.logo = Date.now();
          } else {
            await sb.from("jukebox_config").delete().eq("key", key);
            theme.logo = null;
          }
        }
        res = await update({ options: { ...(s.options || {}), theme: normalizeTheme(theme) } });
        break;
      }
      case "blind":
      case "blindReveal":
      case "blindAccept":
      case "blindNewGame":
      case "blindReset": {
        const blind = sessionBlind(s);
        if (!blind) return Response.json({ error: "Blind test non activé pour cette soirée." }, { status: 403 });
        if (body.action === "blindReset") {
          res = await sb.from("jukebox_answers").delete().eq("session_id", s.id);
          break;
        }
        if (body.action === "blindNewGame") {
          // tous les titres redeviennent piochables (scores remis à zéro si demandé)
          res = await update({ options: { ...(s.options || {}), blind: { ...blind, since: Date.now(), holdId: null } } });
          if (res.error) break;
          if (body.scores) await sb.from("jukebox_answers").delete().eq("session_id", s.id);
          await dropBlindPicks(s);
          await topUpBlind(await loadSession(code));
          break;
        }
        const { data: cur } = await tracks().select("id").eq("session_id", s.id).eq("status", "playing").maybeSingle();
        if (body.action === "blindAccept") {
          if (!cur) return Response.json({ error: "Aucun titre en cours." }, { status: 409 });
          await acceptAnswer(s, cur.id, String(body.participantId || ""), String(body.name || ""), body.part === "title" ? "title" : "artist");
          break;
        }
        const next = body.action === "blindReveal"
          ? { ...blind, revealedId: cur?.id || null, revealedPos: cur ? playPos(s, cur) : null }
          : normalizeBlind({ ...blind, ...Object.fromEntries(["on", "mode", "reveal", "after", "lang", "decades", "validated", "holdId"].filter((k) => k in body).map((k) => [k, body[k]])) });
        res = await update({ options: { ...(s.options || {}), blind: next } });
        if (!res.error && body.action === "blind") {
          // arrêt ou filtres changés : titres piochés pas encore joués retirés, puis nouvelle pioche
          if (["on", "lang", "decades", "validated"].some((k) => k in body)) await dropBlindPicks(s);
          await topUpBlind({ ...s, options: { ...(s.options || {}), blind: next } });
        }
        break;
      }
      case "history":
      case "replay":
      case "clearHistory": {
        if (!publicSession(s).features.history) return Response.json({ error: "Historique non activé pour cette soirée." }, { status: 403 });
        const played = () => tracks().select("*").eq("session_id", s.id).in("status", ["played", "skipped"]);
        if (body.action === "clearHistory") {
          res = await tracks().delete().eq("session_id", s.id).in("status", ["played", "skipped"]);
          break;
        }
        if (body.action === "history") {
          const { data, error } = await played().order("played_at", { ascending: false }).limit(500);
          if (error) throw error;
          return Response.json({ ok: true, history: data.map((t) => ({
            id: t.id, videoId: t.video_id, title: t.title, channel: t.channel, thumb: t.thumb, duration: t.duration,
            author: t.author, dedication: t.dedication || null, playedAt: t.played_at, skipped: t.status === "skipped",
          })) });
        }
        const { data: t, error } = await played().eq("id", String(body.id || "")).maybeSingle();
        if (error) throw error;
        if (!t) return Response.json({ error: "Titre introuvable." }, { status: 404 });
        const { data: active } = await tracks().select("id").eq("session_id", s.id).eq("video_id", t.video_id).in("status", ["queued", "playing"]);
        if (active?.length) return Response.json({ error: "Ce titre est déjà dans la file." }, { status: 409 });
        res = await tracks().insert({
          session_id: s.id, video_id: t.video_id, title: t.title, channel: t.channel, thumb: t.thumb,
          duration: t.duration, video_title: t.video_title || null, participant_id: "regie-replay", author: t.author, position: Date.now(),
        });
        break;
      }
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
