/*
 * Route serveur PRÉSENTATEUR d'un nuage de mots (en-tête x-nuage-admin requis).
 * Body : { action, ... }
 *   open | close            → ouvrir / fermer les envois
 *   question { question }   → modifier la question
 *   max { max }             → nombre de mots par participant
 *   style { style }         → palette de couleurs + fond { palette, bg }
 *   hide | unhide { key }   → masquer / ré-afficher un mot
 *   reset                   → effacer tous les mots
 *   delete                  → supprimer le nuage
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadSession, checkToken } from "@/lib/nuageServer";
import { MAX_QUESTION_LEN } from "@/lib/nuage";
import { normalizeStyle } from "@/lib/nuageThemes";

export const runtime = "nodejs";

export async function POST(req, { params }) {
  const { code } = await params;
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }

  try {
    const s = await loadSession(code);
    if (!s) return Response.json({ error: "Nuage introuvable." }, { status: 404 });
    if (!checkToken(req.headers.get("x-nuage-admin"), s.admin_hash))
      return Response.json({ error: "Accès refusé." }, { status: 401 });

    const sb = getSupabaseAdmin();
    const update = (patch) => sb.from("nuage_sessions").update(patch).eq("id", s.id);
    let res;

    switch (body?.action) {
      case "open":
      case "close":
        res = await update({ status: body.action === "open" ? "open" : "closed" });
        break;
      case "question": {
        const q = String(body.question || "").trim().slice(0, MAX_QUESTION_LEN);
        if (!q) return Response.json({ error: "Question vide." }, { status: 400 });
        res = await update({ question: q });
        break;
      }
      case "max":
        res = await update({ max_per_participant: Math.min(10, Math.max(1, parseInt(body.max, 10) || 1)) });
        break;
      case "style":
        res = await update({ style: normalizeStyle(body.style) });
        break;
      case "hide":
      case "unhide": {
        const key = String(body.key || "");
        const set = new Set(s.hidden || []);
        body.action === "hide" ? set.add(key) : set.delete(key);
        res = await update({ hidden: [...set] });
        break;
      }
      case "reset":
        res = await sb.from("nuage_words").delete().eq("session_id", s.id);
        if (!res.error) res = await update({ hidden: [] });
        break;
      case "delete":
        res = await sb.from("nuage_sessions").delete().eq("id", s.id);
        break;
      default:
        return Response.json({ error: "Action inconnue." }, { status: 400 });
    }
    if (res.error) throw res.error;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("nuage admin:", e);
    return Response.json({ error: "Action impossible." }, { status: 502 });
  }
}
