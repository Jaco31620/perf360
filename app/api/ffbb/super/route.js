/*
 * Route serveur — opérations du SUPER-ADMIN (gestion des instances + mot de passe
 * maître). Toutes exigent un jeton master valide (en-tête x-ffbb-auth).
 *
 * Actions : list | create | delete | loadMaster | saveMaster
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireMaster } from "@/lib/ffbbAuth";
import { RESERVED_SLUGS, DEFAULT_CONFIG } from "@/app/ffbb-test/configDefaults";

export const runtime = "nodejs";

export async function POST(req) {
  if (!requireMaster(req)) return Response.json({ error: "Non autorisé." }, { status: 401 });

  let payload;
  try { payload = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  const { action } = payload || {};

  try {
    const sb = getSupabaseAdmin();

    switch (action) {
      case "list": {
        const { data, error } = await sb
          .from("ffbb_campaigns").select("id,slug,name,config,created_at")
          .order("created_at", { ascending: true });
        if (error) throw error;
        return Response.json({ campaigns: data || [] });
      }

      case "create": {
        const slug = String(payload.slug || "").trim();
        const name = String(payload.name || slug).trim();
        const config = payload.config && typeof payload.config === "object" ? payload.config : structuredClone(DEFAULT_CONFIG);
        if (!slug) return Response.json({ error: "Slug requis." }, { status: 400 });
        if (RESERVED_SLUGS.includes(slug)) return Response.json({ error: `Le slug « ${slug} » est réservé.` }, { status: 400 });

        const { data: existing } = await sb.from("ffbb_campaigns").select("id").eq("slug", slug).maybeSingle();
        if (existing) return Response.json({ error: `Le slug « ${slug} » existe déjà.` }, { status: 409 });

        const { data, error } = await sb
          .from("ffbb_campaigns").insert({ slug, name, config }).select().single();
        if (error) throw error;
        return Response.json({ campaign: data });
      }

      case "delete": {
        const id = payload.id;
        if (!id) return Response.json({ error: "Identifiant requis." }, { status: 400 });
        const { error } = await sb.from("ffbb_campaigns").delete().eq("id", id);
        if (error) throw error;
        return Response.json({ ok: true });
      }

      case "loadMaster": {
        const { data, error } = await sb.from("ffbb_config").select("data").eq("id", 1).maybeSingle();
        if (error) throw error;
        return Response.json({ master: data?.data || { masterPassword: "admin" } });
      }

      case "saveMaster": {
        const patch = payload.patch && typeof payload.patch === "object" ? payload.patch : {};
        const { data: cur } = await sb.from("ffbb_config").select("data").eq("id", 1).maybeSingle();
        const next = { ...(cur?.data || {}), ...patch };
        const { error } = await sb.from("ffbb_config").upsert({ id: 1, data: next }, { onConflict: "id" });
        if (error) throw error;
        return Response.json({ master: next });
      }

      default:
        return Response.json({ error: "Action inconnue." }, { status: 400 });
    }
  } catch (e) {
    console.error("super POST:", action, e);
    return Response.json({ error: "Opération impossible." }, { status: 502 });
  }
}
