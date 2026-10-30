/*
 * Recherche de titres pour une soirée : ?q=<texte> (YouTube, catégorie Musique,
 * ou versions avec paroles / karaoké selon la régie ; cache 7 jours) ou lien YouTube /
 * YouTube Music collé (1 unité).
 */
import { loadSession, publicSession, ytSearch, ytVideos, YoutubeError } from "@/lib/jukeboxServer";
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
    const id = parseVideoId(q);
    const results = id ? await ytVideos([id]) : await ytSearch(q.slice(0, MAX_QUERY_LEN), publicSession(s).searchMode);
    if (id && !results.length)
      return Response.json({ results, error: "Ce titre ne peut pas être joué ici (trop long ou lecture bloquée)." });
    return Response.json({ results });
  } catch (e) {
    if (e instanceof YoutubeError) return Response.json({ error: e.message }, { status: 503 });
    console.error("jukebox search:", e);
    return Response.json({ error: "Recherche impossible." }, { status: 502 });
  }
}
