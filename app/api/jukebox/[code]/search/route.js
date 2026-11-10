/*
 * Recherche de titres pour une soirée : ?q=<texte> — catalogue Deezer (sans
 * quota ; titres déjà en mémoire en tête, la vidéo YouTube n'est cherchée
 * qu'à l'ajout) ou lien YouTube / YouTube Music collé (1 unité). Invités :
 * chansons uniquement (la régie, non).
 */
import { tooMany, clientIp } from "@/lib/jukeboxRate";
import { loadSession, publicSession, isAdminReq, ytVideo, deezerSearch, preferKnown, REJECT_MESSAGES, YoutubeError } from "@/lib/jukeboxServer";
import { MAX_QUERY_LEN, parseVideoId, PLAYED_RECENT_MS } from "@/lib/jukebox";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const norm = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

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
    const results = await preferKnown(await deezerSearch(query), publicSession(s).searchMode, query);
    // titres déjà passés ce soir (même titre + artiste, ou même vidéo) : heure du dernier passage
    const { data: played } = await getSupabaseAdmin().from("jukebox_tracks").select("title,channel,video_id,played_at")
      .eq("session_id", s.id).in("status", ["played", "skipped"]).gte("played_at", new Date(Date.now() - PLAYED_RECENT_MS).toISOString()).order("played_at", { ascending: false }).limit(500);
    const last = new Map();
    for (const t of played || []) {
      for (const k of [`${norm(t.title)}|${norm(t.channel)}`, t.video_id]) if (!last.has(k)) last.set(k, t.played_at);
    }
    return Response.json({ results: results.map((r) => {
      const at = last.get(`${norm(r.title)}|${norm(r.channel)}`) || last.get(r.id);
      return at ? { ...r, playedAt: at } : r;
    }) });
  } catch (e) {
    if (e instanceof YoutubeError) return Response.json({ error: e.message }, { status: 503 });
    console.error("jukebox search:", e);
    return Response.json({ error: "Recherche impossible." }, { status: 502 });
  }
}
