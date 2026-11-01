/*
 * Titres joués d'une soirée, pour les invités (page /jukebox/<code>/playlist) :
 * aussi après la fermeture. Titres et artistes seulement (pas les prénoms).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadSession } from "@/lib/jukeboxServer";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const { code } = await params;
  try {
    const s = await loadSession(code, { any: true });
    if (!s) return Response.json({ error: "Soirée introuvable." }, { status: 404 });
    const { data, error } = await getSupabaseAdmin().from("jukebox_tracks").select("title,channel,video_id,played_at")
      .eq("session_id", s.id).eq("status", "played").order("played_at", { ascending: true }).limit(500);
    if (error) throw error;
    return Response.json({
      name: s.options?.theme?.title || s.name,
      tracks: (data || []).map((t) => ({ title: t.title, artist: t.channel, videoId: t.video_id })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("jukebox playlist:", e);
    return Response.json({ error: "Chargement impossible." }, { status: 502 });
  }
}
