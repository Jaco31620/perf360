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
import { isValidVideoId, MAX_AUTHOR_LEN, MAX_DEDICATION_LEN, UNLIMITED_CAP } from "@/lib/jukebox";
import { sessionBlind, blindView, blindFacets } from "@/lib/jukeboxBlindServer";

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
    const s = await loadSession(code);
    // closed : la soirée existe mais sa durée d'utilisation est passée (fermée)
    if (!s) return Response.json({ session: null, closed: !!(await loadSession(code, { any: true })) }, { status: 404 });
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
    if (admin) await withTrims([out.now, ...out.queue]);
    if (engine) await withTrims([out.engine.now, ...out.engine.queue]);
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

    // quota YouTube partagé par toutes les soirées : ajouts des invités limités
    if (!admin && (await tooMany(`add:${s.id}`, 60, 600) || await tooMany(`addip:${clientIp(req)}`, 20, 600)))
      return Response.json({ error: "Beaucoup d'ajouts en ce moment : réessayez dans quelques minutes." }, { status: 429 });

    let v;
    if (deezerId > 0) {
      // titre Deezer → sa vidéo YouTube (affichage : titre, artiste et pochette Deezer)
      const song = await deezerTrack(deezerId);
      if (!song) return Response.json({ error: "Titre introuvable." }, { status: 422 });
      const yt = await youtubeForSong(song, publicSession(s).searchMode);
      if (!yt) return Response.json({ error: "Impossible de trouver ce titre sur YouTube." }, { status: 422 });
      v = { id: yt.id, title: yt.text?.title || song.title, channel: yt.text?.artist || song.channel, thumb: song.thumb || yt.thumb, duration: yt.duration, videoTitle: yt.title || null };
    } else {
      // chansons uniquement pour les invités ; la régie peut ajouter n'importe quelle vidéo jouable
      const { video, reason } = await ytVideo(videoId, { musicOnly: !admin });
      if (!video) return Response.json({ error: REJECT_MESSAGES[reason] }, { status: 422 });
      v = video;
    }
    if (rows.some((r) => r.video_id === v.id))
      return Response.json({ error: "Ce titre est déjà dans la file." }, { status: 409 });

    const { error } = await sb.from("jukebox_tracks").insert({
      session_id: s.id, video_id: v.id, title: v.title, channel: v.channel, thumb: v.thumb,
      duration: v.duration, video_title: v.videoTitle || v.title || null, participant_id: pid, author: author || "Régie",
      ...(dedication && publicSession(s).dedications ? { dedication } : {}),
      position: publicSession(s).fairQueue ? fairPosition(rows.filter((r) => r.status === "queued"), pid) : Date.now(),
    });
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
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
    const { error } = await getSupabaseAdmin().from("jukebox_tracks").delete()
      .eq("session_id", s.id).eq("id", String(body?.id || "")).eq("participant_id", pid).eq("status", "queued");
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("jukebox DELETE:", e);
    return Response.json({ error: "Retrait impossible." }, { status: 502 });
  }
}
