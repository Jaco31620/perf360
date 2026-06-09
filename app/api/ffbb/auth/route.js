/*
 * Route serveur — connexion (vérification de mot de passe CÔTÉ SERVEUR).
 * Émet un jeton signé court (cf. lib/ffbbAuth).
 *
 *  - { scope: "master", password }            → super-admin (mot de passe maître,
 *      ffbb_config id=1 → data.masterPassword). Renvoie { token }.
 *  - { scope: "campaign", slug, password }    → admin d'une instance (config.adminPassword).
 *      Le mot de passe maître ouvre aussi n'importe quelle instance ; un jeton
 *      master valide (en-tête x-ffbb-auth) ouvre l'instance sans re-saisie.
 *      Renvoie { token, campaign: { id, slug, name, config } } (config complète).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeConfig } from "@/app/ffbb-test/configDefaults";
import { masterToken, campaignToken, requireMaster } from "@/lib/ffbbAuth";

export const runtime = "nodejs";

async function loadMasterPassword(sb) {
  const { data } = await sb.from("ffbb_config").select("data").eq("id", 1).maybeSingle();
  return data?.data?.masterPassword || "admin";
}

export async function POST(req) {
  let payload;
  try { payload = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }

  const { scope, slug } = payload || {};
  const password = String(payload?.password ?? "");

  try {
    const sb = getSupabaseAdmin();

    if (scope === "master") {
      const master = await loadMasterPassword(sb);
      if (requireMaster(req) || password === master) {
        return Response.json({ token: masterToken() });
      }
      return Response.json({ error: "Mot de passe incorrect." }, { status: 401 });
    }

    if (scope === "campaign") {
      if (!slug) return Response.json({ error: "Instance inconnue." }, { status: 400 });
      const { data: camp, error } = await sb
        .from("ffbb_campaigns").select("id,slug,name,config").eq("slug", slug).maybeSingle();
      if (error) throw error;
      if (!camp) return Response.json({ error: "Instance introuvable." }, { status: 404 });

      const config = normalizeConfig(camp.config);
      let ok = requireMaster(req) || password === config.adminPassword;
      if (!ok && password) {
        const master = await loadMasterPassword(sb);
        ok = password === master;
      }
      if (!ok) return Response.json({ error: "Mot de passe incorrect." }, { status: 401 });

      return Response.json({
        token: campaignToken(camp.id),
        campaign: { id: camp.id, slug: camp.slug, name: camp.name, config },
      });
    }

    return Response.json({ error: "Portée invalide." }, { status: 400 });
  } catch (e) {
    console.error("auth POST:", e);
    return Response.json({ error: "Connexion impossible." }, { status: 502 });
  }
}
