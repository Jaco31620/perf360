/*
 * Route serveur PUBLIQUE d'une soirée jukebox.
 * - GET    : soirée, titre en cours et file d'attente. Avec ?pid=<participant>,
 *            marque ses titres (mine) et compte ceux en attente.
 *            Avec l'en-tête x-jukebox-admin valide, ajoute admin: true.
 * - POST   : ajout d'un titre { participantId, author, videoId }. Les infos
 *            sont relues chez YouTube (pas de confiance au client). La régie
 *            (en-tête admin) n'est soumise ni à la limite ni à la fermeture.
 * - DELETE : retrait d'un de SES titres encore en attente { participantId, id }.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadSession, publicSession, checkToken, trackOut, ytVideos, YoutubeError } from "@/lib/jukeboxServer";
import { isValidVideoId, MAX_AUTHOR_LEN, UNLIMITED_CAP } from "@/lib/jukebox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const validPid = (pid) => /^[a-z0-9-]{8,64}$/i.test(String(pid || ""));
const COLS = "id,video_id,title,channel,thumb,duration,author,participant_id,status,position";

async function activeTracks(sb, sessionId) {
  const { data, error } = await sb.from("jukebox_tracks").select(COLS)
    .eq("session_id", sessionId).in("status", ["queued", "playing"]).order("position");
  if (error) throw error;
  return data;
}

export async function GET(req, { params }) {
  const { code } = await params;
  try {
    const s = await loadSession(code);
    if (!s) return Response.json({ session: null }, { status: 404 });
    const pid = new URL(req.url).searchParams.get("pid");
    const me = validPid(pid) ? pid : null;
    const rows = await activeTracks(getSupabaseAdmin(), s.id);
    const now = rows.find((r) => r.status === "playing");
    const queue = rows.filter((r) => r.status === "queued");
    const out = {
      session: publicSession(s),
      now: now ? trackOut(now, me) : null,
      queue: queue.map((r) => trackOut(r, me)),
      pending: me ? queue.filter((r) => r.participant_id === me).length : 0,
    };
    if (checkToken(req.headers.get("x-jukebox-admin"), s.admin_hash)) out.admin = true;
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
  if (!validPid(pid)) return Response.json({ error: "Participant invalide." }, { status: 400 });
  if (!isValidVideoId(videoId)) return Response.json({ error: "Titre invalide." }, { status: 400 });

  try {
    const s = await loadSession(code);
    if (!s) return Response.json({ error: "Soirée introuvable." }, { status: 404 });
    const admin = checkToken(req.headers.get("x-jukebox-admin"), s.admin_hash);
    if (!admin && s.status !== "open") return Response.json({ error: "Les propositions sont fermées." }, { status: 403 });
    if (!admin && !author) return Response.json({ error: "Merci d'indiquer votre prénom." }, { status: 400 });

    const sb = getSupabaseAdmin();
    const rows = await activeTracks(sb, s.id);
    if (rows.some((r) => r.video_id === videoId))
      return Response.json({ error: "Ce titre est déjà dans la file." }, { status: 409 });
    if (!admin) {
      const mine = rows.filter((r) => r.status === "queued" && r.participant_id === pid).length;
      const limit = s.max_per_participant > 0 ? s.max_per_participant : UNLIMITED_CAP;
      if (mine >= limit)
        return Response.json({ error: `Vous avez déjà ${mine} titre${mine > 1 ? "s" : ""} en attente : patientez qu'il${mine > 1 ? "s" : ""} passe${mine > 1 ? "nt" : ""}.` }, { status: 429 });
    }

    const [v] = await ytVideos([videoId]);
    if (!v) return Response.json({ error: "Ce titre ne peut pas être joué ici (trop long ou lecture bloquée)." }, { status: 422 });

    const { error } = await sb.from("jukebox_tracks").insert({
      session_id: s.id, video_id: v.id, title: v.title, channel: v.channel, thumb: v.thumb,
      duration: v.duration, participant_id: pid, author: author || "Régie", position: Date.now(),
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
