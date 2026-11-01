/*
 * Recherche de titres pour une soirée : ?q=<texte> — catalogue Deezer (sans
 * quota ; titres déjà en mémoire en tête, la vidéo YouTube n'est cherchée
 * qu'à l'ajout) ou lien YouTube / YouTube Music collé (1 unité). Invités :
 * chansons uniquement (la régie, non).
 */
import { tooMany, clientIp } from "@/lib/jukeboxRate";
import { loadSession, publicSession, isAdminReq, ytVideo, deezerSearch, preferKnown, REJECT_MESSAGES, YoutubeError } from "@/lib/jukeboxServer";
import { MAX_QUERY_LEN, parseVideoId } from "@/lib/jukebox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const { code } = await params;
  const q = String(new URL(req.url).searchParams.get("q") || "").trim();
  if (q.length < 2) return Response.json({ results: [] });

  try {
    const s = await loadSession(code);
    if (!s) return Response.json({ error: "Soirée introuvable." }, { status: 404 });
    if (await tooMany(`search:${clientIp(req)}`, 600, 600))
      return Response.json({ results: [], error: "Beaucoup de recherches : patientez quelques minutes." }, { status: 429 });
    const id = parseVideoId(q);
    if (id) {
      const { video, reason } = await ytVideo(id, { musicOnly: !(await isAdminReq(req, s)) });
      return Response.json(video ? { results: [video] } : { results: [], error: REJECT_MESSAGES[reason] });
    }
    const query = q.slice(0, MAX_QUERY_LEN);
    return Response.json({ results: await preferKnown(await deezerSearch(query), publicSession(s).searchMode, query) });
  } catch (e) {
    if (e instanceof YoutubeError) return Response.json({ error: e.message }, { status: 503 });
    console.error("jukebox search:", e);
    return Response.json({ error: "Recherche impossible." }, { status: 502 });
  }
}
