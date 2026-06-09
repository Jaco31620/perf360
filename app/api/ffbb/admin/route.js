/*
 * Route serveur — opérations de l'admin d'une INSTANCE. Toutes exigent un jeton
 * autorisant cette campagne (jeton de campagne OU jeton master), vérifié contre
 * le `cid` fourni. Dispatch par `action`.
 *
 * Actions : stats | regsPage | search | exportAll | addCodes | reset | saveConfig
 *           | rename | headerUsedElsewhere
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireCampaign } from "@/lib/ffbbAuth";
import { normalizeConfig } from "@/app/ffbb-test/configDefaults";

export const runtime = "nodejs";

const withDate = (rows) => (rows || []).map((r) => ({ ...r, date: r.created_at }));

export async function POST(req) {
  let payload;
  try { payload = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }

  const { action, cid } = payload || {};
  if (!cid) return Response.json({ error: "Instance inconnue." }, { status: 400 });
  if (!requireCampaign(req, cid)) return Response.json({ error: "Non autorisé." }, { status: 401 });

  try {
    const sb = getSupabaseAdmin();

    switch (action) {
      case "getConfig": {
        // Revalide un jeton stocké au rechargement + renvoie la config COMPLÈTE.
        const { data, error } = await sb.from("ffbb_campaigns").select("name,config").eq("id", cid).maybeSingle();
        if (error) throw error;
        if (!data) return Response.json({ error: "Instance introuvable." }, { status: 404 });
        return Response.json({ name: data.name, config: normalizeConfig(data.config) });
      }

      case "stats": {
        const [tot, avail, regs, news] = await Promise.all([
          sb.from("ffbb_codes").select("*", { count: "exact", head: true }).eq("campaign_id", cid),
          sb.from("ffbb_codes").select("*", { count: "exact", head: true }).eq("campaign_id", cid).eq("status", "available"),
          sb.from("ffbb_registrations").select("*", { count: "exact", head: true }).eq("campaign_id", cid),
          sb.from("ffbb_registrations").select("*", { count: "exact", head: true }).eq("campaign_id", cid).eq("newsletter", true),
        ]);
        const t = tot.count || 0, a = avail.count || 0;
        return Response.json({ counts: { total: t, available: a, assigned: t - a, regs: regs.count || 0, newsletter: news.count || 0 } });
      }

      case "regsPage": {
        const from = Math.max(0, Number(payload.from) || 0);
        const size = Math.min(200, Math.max(1, Number(payload.size) || 50));
        const { data, error } = await sb
          .from("ffbb_registrations").select("*").eq("campaign_id", cid)
          .order("created_at", { ascending: false }).range(from, from + size - 1);
        if (error) throw error;
        return Response.json({ rows: withDate(data) });
      }

      case "search": {
        const term = String(payload.q || "").trim();
        if (!term) return Response.json({ rows: [] });
        const esc = term.replace(/[%,()]/g, " ");
        const { data, error } = await sb
          .from("ffbb_registrations").select("*").eq("campaign_id", cid)
          .or(`code.ilike.%${esc}%,email.ilike.%${esc}%,nom.ilike.%${esc}%,prenom.ilike.%${esc}%`)
          .order("created_at", { ascending: false }).limit(50);
        if (error) throw error;
        return Response.json({ rows: withDate(data) });
      }

      case "exportAll": {
        const all = [];
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await sb
            .from("ffbb_registrations").select("*").eq("campaign_id", cid)
            .order("created_at", { ascending: true }).range(from, from + PAGE - 1);
          if (error) throw error;
          all.push(...(data || []));
          if (!data || data.length < PAGE) break;
        }
        return Response.json({ rows: withDate(all) });
      }

      case "addCodes": {
        const list = Array.isArray(payload.codes) ? payload.codes.map((s) => String(s).trim()).filter(Boolean) : [];
        const seen = new Set();
        const fresh = [];
        list.forEach((code) => { const k = code.toLowerCase(); if (!seen.has(k)) { seen.add(k); fresh.push(code); } });
        if (!fresh.length) return Response.json({ added: 0, total: list.length });
        const before = (await sb.from("ffbb_codes").select("*", { count: "exact", head: true }).eq("campaign_id", cid)).count || 0;
        for (let i = 0; i < fresh.length; i += 500) {
          const rows = fresh.slice(i, i + 500).map((code) => ({ campaign_id: cid, code, status: "available", assigned_to: null }));
          const { error } = await sb.from("ffbb_codes").upsert(rows, { onConflict: "campaign_id,code", ignoreDuplicates: true });
          if (error) throw error;
        }
        const after = (await sb.from("ffbb_codes").select("*", { count: "exact", head: true }).eq("campaign_id", cid)).count || 0;
        return Response.json({ added: after - before, total: list.length });
      }

      case "reset": {
        const r1 = await sb.from("ffbb_registrations").delete().eq("campaign_id", cid);
        const r2 = await sb.from("ffbb_codes").delete().eq("campaign_id", cid);
        if (r1.error || r2.error) throw (r1.error || r2.error);
        return Response.json({ ok: true });
      }

      case "saveConfig": {
        const config = payload.config;
        if (!config || typeof config !== "object") return Response.json({ error: "Config invalide." }, { status: 400 });
        const { error } = await sb.from("ffbb_campaigns").update({ config }).eq("id", cid);
        if (error) throw error;
        return Response.json({ ok: true });
      }

      case "rename": {
        const name = String(payload.name ?? "");
        const { error } = await sb.from("ffbb_campaigns").update({ name }).eq("id", cid);
        if (error) throw error;
        return Response.json({ ok: true });
      }

      case "headerUsedElsewhere": {
        const url = payload.url;
        if (!url) return Response.json({ used: false });
        const { data, error } = await sb
          .from("ffbb_campaigns").select("id").eq("config->>headerImageUrl", url).neq("id", cid).limit(1);
        if (error) { console.error(error); return Response.json({ used: true }); } // en cas de doute, ne pas supprimer
        return Response.json({ used: (data || []).length > 0 });
      }

      default:
        return Response.json({ error: "Action inconnue." }, { status: 400 });
    }
  } catch (e) {
    console.error("admin POST:", action, e);
    return Response.json({ error: "Opération impossible." }, { status: 502 });
  }
}
