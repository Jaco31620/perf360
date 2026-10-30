/*
 * Route PUBLIQUE — logo du thème d'une soirée (stocké en data URL dans
 * jukebox_config, clé « logo:<id de la soirée> »). L'URL porte la version
 * (?v=…) : mise en cache longue durée.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadSession } from "@/lib/jukeboxServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const { code } = await params;
  try {
    const s = await loadSession(code);
    if (!s) return new Response("Introuvable", { status: 404 });
    const { data } = await getSupabaseAdmin().from("jukebox_config").select("value").eq("key", `logo:${s.id}`).maybeSingle();
    const m = String(data?.value || "").match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!m) return new Response("Introuvable", { status: 404 });
    return new Response(Buffer.from(m[2], "base64"), {
      headers: { "content-type": m[1], "cache-control": "public, max-age=31536000, immutable" },
    });
  } catch (e) {
    return new Response("Erreur", { status: 502 });
  }
}
