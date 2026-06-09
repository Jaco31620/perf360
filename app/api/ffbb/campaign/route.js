/*
 * Route serveur PUBLIQUE — charge une instance (campagne) par son slug pour le
 * formulaire public. Renvoie la config NORMALISÉE et SANS SECRET (le mot de passe
 * admin de l'instance est retiré). Lecture via service_role (la RLS interdit
 * désormais tout accès anonyme direct).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeConfig, publicConfig } from "@/app/ffbb-test/configDefaults";

export const runtime = "nodejs";

export async function GET(req) {
  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) return Response.json({ error: "slug requis." }, { status: 400 });

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("ffbb_campaigns")
      .select("id,slug,name,config")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ campaign: null });
    return Response.json({
      campaign: {
        id: data.id,
        slug: data.slug,
        name: data.name,
        config: publicConfig(normalizeConfig(data.config)),
      },
    });
  } catch (e) {
    console.error("campaign GET:", e);
    return Response.json({ error: "Chargement impossible." }, { status: 502 });
  }
}
