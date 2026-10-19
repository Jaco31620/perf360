/* Organisateur — réglages de l'album (clés « admin » uniquement ; quotas = super-admin). */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAlbum, roleFor, canAdmin } from "@/lib/clicclac/server";
import { normalizeSettings, ADMIN_KEYS } from "@/lib/clicclac/settings";

export const runtime = "nodejs";

export async function PATCH(req, { params }) {
  const { code } = await params;
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  try {
    const a = await loadAlbum(code);
    if (!a) return Response.json({ error: "Album introuvable." }, { status: 404 });
    if (!canAdmin(roleFor(req, a))) return Response.json({ error: "Accès refusé." }, { status: 401 });
    const next = { ...a.settings };
    for (const k of ADMIN_KEYS) if (body?.settings?.[k] !== undefined) next[k] = body.settings[k];
    const settings = normalizeSettings(next);
    const { error } = await getSupabaseAdmin().from("clicclac_albums").update({ settings }).eq("id", a.id);
    if (error) throw error;
    return Response.json({ ok: true, settings });
  } catch (e) {
    console.error("clicclac settings:", e);
    return Response.json({ error: "Enregistrement impossible." }, { status: 502 });
  }
}
