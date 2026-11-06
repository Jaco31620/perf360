/*
 * Route serveur PUBLIQUE d'une soirée jukebox.
 * - GET    : soirée, titre en cours et file d'attente. Avec ?pid=<participant>,
 *            marque ses titres (mine) et compte ceux en attente.
 *            Avec l'en-tête x-jukebox-admin (ou x-jukebox-super) valide, ajoute admin: true.
 *            Sans lui, la file est réduite selon les choix de la régie : vide
 *            pour ?view=ecran si l'écran ne l'affiche pas, limitée aux titres
 *            du participant si les invités ne voient pas toute la file.
 *            Chaque titre porte `ahead` (titres avant lui) ; `total` = taille
 *            de la file complète. `playback` (position de la régie, horodatée
 *            par le serveur) + `serverTime` : synchronisation de l'écran.
 *            Blind test en cours (`blind`) : tant que la réponse n'est pas
 *            dévoilée, le public ne voit ni le titre en cours (now.hidden)
 *            ni la file ; classement et réponses de l'invité.
 *            ?view=ecran&engine=1 avec le jeton régie (écran en mode son,
 *            qui joue la musique) : vue publique de l'écran + `engine`
 *            (titre en cours, file complète, ordre de la télécommande).
 * - POST   : ajout d'un titre { participantId, author, videoId | deezerId, dedication? }. Les infos
 *            sont relues chez YouTube (pas de confiance au client). Placement
 *            en file équitable (alternance des invités) si la régie l'a choisi. La régie
 *            (en-tête admin) n'est soumise ni à la limite ni à la fermeture.
 * - DELETE : retrait d'un de SES titres encore en attente { participantId, id }.
 */
import { tooMany, clientIp } from "@/lib/jukeboxRate";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { withTrims } from "@/lib/jukeboxTrim";
import { loadSession, publicSession, isAdminReq, fairPosition, hideAuthors, trackOut, ytVideo, deezerTrack, youtubeForSong, REJECT_MESSAGES, YoutubeError } from "@/lib/jukeboxServer";
import { isValidVideoId, MAX_AUTHOR_LEN, MAX_DEDICATION_LEN, UNLIMITED_CAP, closedReason } from "@/lib/jukebox";
import { isJukeboxSuper } from "@/lib/jukeboxAdmin";
import { sessionBlind, blindView, blindFacets, AUTO_PID } from "@/lib/jukeboxBlindServer";
import { logEvent, actorOf } from "@/lib/jukeboxEvents";
import { notify } from "@/lib/jukeboxLive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// identifiants réservés au serveur (titres piochés par le blind test, rejoués par la régie)
const validPid = (pid) => /^[a-z0-9-]{8,64}$/i.test(String(pid || "")) && !/^(blind-|regie-)/i.test(String(pid));

async function activeTracks(sb, sessionId) {
  const { data, error } = await sb.from("jukebox_tracks").select("*")
    .eq("session_id", sessionId).in("status", ["queued", "playing"]).order("position");
  if (error) throw error;
  return data;
}

export async function GET(req, { params }) {
  const { code } = await params;
  try {
    const s = await loadSession(code, { any: isJukeboxSuper(req) }); // super-admin : aussi les soirées fermées (dépannage)
    if (!s) {
      // closed : la soirée existe mais elle est fermée (reason : "manual" à la main, "auto" par son délai)
      const any = await loadSession(code, { any: true });
      return Response.json({ session: null, closed: !!any, reason: any ? closedReason(any) : null }, { status: 404 });
    }
    const url = new URL(req.url);
    const pid = url.searchParams.get("pid");
    const me = validPid(pid) ? pid : null;
    const rows = await activeTracks(getSupabaseAdmin(), s.id);
    const now = rows.find((r) => r.status === "playing");
    const queue = rows.filter((r) => r.status === "queued");
    const session = publicSession(s);
    const isAdmin = await isAdminReq(req, s);
    const engine = url.searchParams.get("engine") === "1" && isAdmin;
    const admin = !engine && isAdmin; // mode son : l'écran reste vu comme le public
    let list = queue.map((r, i) => ({ ...trackOut(r, me), ahead: i }));
    if (!admin) {
      if (url.searchParams.get("view") === "ecran") { if (!session.screenQueue) list = []; }
      else if (!session.guestQueue) list = list.filter((t) => t.mine);
    }
    let nowOut = now ? trackOut(now, me) : null;
    if (!admin) hideAuthors(nowOut, list, now, session.authorReveal);
    const blind = sessionBlind(s);
    const blindOut = blind?.on ? await blindView(s, blind, now, { admin, pid: me })
      : blind && admin ? { on: false, facets: await blindFacets(s) } : null; // régie : nombres de la pioche avant le lancement
    if (blindOut && !admin) {
      list = []; // la file trahirait les prochains titres
      if (nowOut && !blindOut.revealed) nowOut = { id: nowOut.id, hidden: true, duration: nowOut.duration };
    }
    if (blind?.on) { // blind test : « proposé par » n'a pas de sens (titres piochés)
      for (const t of [nowOut, ...list]) if (t) { t.author = null; delete t.revealIn; }
    }
    const out = {
      session,
      now: nowOut,
      queue: list,
      total: queue.length,
      pending: me ? queue.filter((r) => r.participant_id === me).length : 0,
      playback: s.playback || null,
      serverTime: Date.now(),
      blind: blindOut,
    };
    if (engine) out.engine = {
      now: now ? trackOut(now, null) : null,
      queue: queue.map((r) => trackOut(r, null)),
      command: s.command || null,
    };
    // rognage (début / fin d'habillage) : pour les lecteurs et la télécommande
    // rognage selon l'usage : version de la soirée ; titres piochés par le blind test : version paroles, sinon clip
    const autoIds = new Set(rows.filter((r) => r.participant_id === AUTO_PID).map((r) => r.id));
    const mode = publicSession(s).searchMode;
    const kinds = (t) => (autoIds.has(t.id) ? ["normal", "clip"] : [mode]);
    if (admin) await withTrims([out.now, ...out.queue], kinds);
    if (engine) await withTrims([out.engine.now, ...out.engine.queue], kinds);
    if (admin) {
      out.admin = true;
      out.command = s.command || null; // dernier ordre de la télécommande
    }
    return Response.json(out, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("jukebox GET:", e);
    return Response.json({ error: "Chargement impossible." }, { status: 502 });
  }
}

const norm = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
class AddLimit extends Error {}
const sameSong = (r, song) => norm(r.title) === norm(song.title) && norm(r.channel) === norm(song.channel);

export async function POST(req, { params }) {
  const { code } = await params;
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }

  const pid = body?.participantId;
  const author = String(body?.author || "").replace(/\s+/g, " ").trim().slice(0, MAX_AUTHOR_LEN);
  const videoId = String(body?.videoId || "");
  const deezerId = parseInt(body?.deezerId, 10) || 0; // titre trouvé via la recherche Deezer
  const dedication = String(body?.dedication || "").replace(/\s+/g, " ").trim().slice(0, MAX_DEDICATION_LEN);
  if (!validPid(pid)) return Response.json({ error: "Participant invalide." }, { status: 400 });
  if (!isValidVideoId(videoId) && deezerId <= 0) return Response.json({ error: "Titre invalide." }, { status: 400 });

  try {
    const s = await loadSession(code);
    if (!s) return Response.json({ error: "Soirée introuvable." }, { status: 404 });
    const admin = await isAdminReq(req, s);
    if (!admin && s.status !== "open") return Response.json({ error: "Les ajouts de titres sont bloqués pour le moment." }, { status: 403 });
    if (!admin && sessionBlind(s)?.on) return Response.json({ error: "Blind test en cours : les ajouts reprendront après." }, { status: 403 });
    if (!admin && !author) return Response.json({ error: "Merci d'indiquer votre prénom." }, { status: 400 });

    const sb = getSupabaseAdmin();
    const rows = await activeTracks(sb, s.id);
    if (!admin) {
      const mine = rows.filter((r) => r.status === "queued" && r.participant_id === pid).length;
      const limit = s.max_per_participant > 0 ? s.max_per_participant : UNLIMITED_CAP;
      if (mine >= limit)
        return Response.json({ error: `Vous avez déjà ${mine} titre${mine > 1 ? "s" : ""} en attente : patientez qu'il${mine > 1 ? "s" : ""} passe${mine > 1 ? "nt" : ""}.` }, { status: 429 });
    }

    // anti-abus large, sur toutes les tentatives (les invités d'une salle partagent souvent la même adresse IP)
    if (!admin && await tooMany(`addip:${clientIp(req)}`, 120, 600))
      return Response.json({ error: "Beaucoup d'ajouts en ce moment : réessayez dans quelques minutes." }, { status: 429 });
    // quota YouTube partagé par toutes les soirées : seuls les ajouts qui lancent une vraie recherche
    // YouTube (titre absent du catalogue et du cache) comptent, par invité et par soirée
    const beforeSearch = admin ? undefined : async () => {
      if (await tooMany(`addp:${s.id}:${pid}`, 10, 600))
        throw new AddLimit("Vous avez proposé beaucoup de nouveaux titres d'un coup : réessayez dans quelques minutes.");
      if (await tooMany(`add:${s.id}`, 150, 600))
        throw new AddLimit("Beaucoup d'ajouts en ce moment : réessayez dans quelques minutes.");
    };

    // doublons : la file d'attente ; la régie peut remettre le titre en cours (il repassera)
    const waiting = admin ? rows.filter((r) => r.status !== "playing") : rows;
    let v;
    if (deezerId > 0) {
      // titre Deezer → sa vidéo YouTube (affichage : titre, artiste et pochette Deezer)
      const song = await deezerTrack(deezerId);
      if (!song) return Response.json({ error: "Titre introuvable." }, { status: 422 });
      // déjà dans la file (même titre, même artiste) : refusé avant toute recherche YouTube
      if (waiting.some((r) => sameSong(r, song))) return Response.json({ error: "Ce titre est déjà dans la file." }, { status: 409 });
      const yt = await youtubeForSong(song, publicSession(s).searchMode, { beforeSearch, source: admin ? "regie" : "guest", session: s.name || s.code });
      if (!yt) return Response.json({ error: "Impossible de trouver ce titre sur YouTube." }, { status: 422 });
      v = { id: yt.id, title: yt.text?.title || song.title, channel: yt.text?.artist || song.channel, thumb: song.thumb || yt.thumb, duration: yt.duration, videoTitle: yt.title || null };
    } else {
      // chansons uniquement pour les invités ; la régie peut ajouter n'importe quelle vidéo jouable
      const { video, reason } = await ytVideo(videoId, { musicOnly: !admin });
      if (!video) return Response.json({ error: REJECT_MESSAGES[reason] }, { status: 422 });
      v = video;
    }
    if (waiting.some((r) => r.video_id === v.id))
      return Response.json({ error: "Ce titre est déjà dans la file." }, { status: 409 });

    const { error } = await sb.from("jukebox_tracks").insert({
      session_id: s.id, video_id: v.id, title: v.title, channel: v.channel, thumb: v.thumb,
      duration: v.duration, video_title: v.videoTitle || v.title || null, participant_id: pid, author: author || "Régie",
      ...(dedication && publicSession(s).dedications ? { dedication } : {}),
      position: publicSession(s).fairQueue ? fairPosition(rows.filter((r) => r.status === "queued"), pid) : Date.now(),
    });
    if (error) throw error;
    await Promise.all([
      logEvent(s.id, "add", admin ? actorOf(req, { isSuper: true }) : `Invité · ${author}`, { title: `${v.channel} – ${v.title}`, via: deezerId > 0 ? "Deezer" : "YouTube" }),
      notify(s.code, "queue"),
    ]);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof AddLimit) return Response.json({ error: e.message }, { status: 429 });
    if (e instanceof YoutubeError) return Response.json({ error: e.message }, { status: 503 });
    console.error("jukebox POST:", e);
    return Response.json({ error: "Ajout impossible." }, { status: 502 });
  }
}

export async function DELETE(req, { params }) {
  const { code } = await params;
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  const pid = body?.participantId;
  if (!validPid(pid)) return Response.json({ error: "Participant invalide." }, { status: 400 });
  if (!/^[0-9a-f-]{36}$/i.test(String(body?.id || ""))) return Response.json({ error: "Titre introuvable." }, { status: 404 });

  try {
    const s = await loadSession(code);
    if (!s) return Response.json({ error: "Soirée introuvable." }, { status: 404 });
    const { data: gone, error } = await getSupabaseAdmin().from("jukebox_tracks").delete()
      .eq("session_id", s.id).eq("id", String(body?.id || "")).eq("participant_id", pid).eq("status", "queued").select("title,channel,author");
    if (error) throw error;
    if (gone?.length) await Promise.all([
      logEvent(s.id, "unadd", `Invité · ${gone[0].author}`, { title: `${gone[0].channel} – ${gone[0].title}` }),
      notify(s.code, "queue"),
    ]);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("jukebox DELETE:", e);
    return Response.json({ error: "Retrait impossible." }, { status: 502 });
  }
}
