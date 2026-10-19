/*
 * Super-admin — modification / suppression d'un album.
 * PATCH { name?, eventDate?, adminEmail?, settings? (clés super), extendDays?, regenPin? }
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isSuper, randomCode, sha256, computeExpiry, deleteAlbum } from "@/lib/clicclac/server";
import { normalizeSettings, SUPER_KEYS, MAX_NAME } from "@/lib/clicclac/settings";
import { isEmail } from "@/lib/clicclac/mail";

export const runtime = "nodejs";

async function load(id) {
  const { data, error } = await getSupabaseAdmin().from("clicclac_albums").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? { ...data, settings: normalizeSettings(data.settings) } : null;
}

export async function PATCH(req, { params }) {
  if (!isSuper(req)) return Response.json({ error: "Accès refusé." }, { status: 401 });
  const { id } = await params;
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  try {
    const a = await load(id);
    if (!a) return Response.json({ error: "Album introuvable." }, { status: 404 });
    const patch = {};
    if (body.name !== undefined) {
      const n = String(body.name).trim().slice(0, MAX_NAME);
      if (!n) return Response.json({ error: "Nom requis." }, { status: 400 });
      patch.name = n;
    }
    if (body.eventDate !== undefined) patch.event_date = /^\d{4}-\d{2}-\d{2}$/.test(body.eventDate || "") ? body.eventDate : null;
    if (body.adminEmail !== undefined) patch.admin_email = isEmail(body.adminEmail) ? body.adminEmail.trim() : null;
    let settings = a.settings;
    if (body.settings) {
      const next = { ...a.settings };
      for (const k of SUPER_KEYS) if (body.settings[k] !== undefined) next[k] = body.settings[k];
      settings = normalizeSettings(next);
      patch.settings = settings;
    }
    // date / durée modifiées → nouvelle échéance ; prolongation explicite en plus
    if (patch.event_date !== undefined || body.settings?.retentionDays !== undefined) {
      patch.expires_at = computeExpiry(patch.event_date !== undefined ? patch.event_date : a.event_date, settings.retentionDays);
      patch.reminded = false;
    }
    const days = parseInt(body.extendDays, 10);
    if (Number.isFinite(days) && days > 0 && days <= 365) {
      const from = Math.max(Date.now(), new Date(patch.expires_at || a.expires_at || Date.now()).getTime());
      patch.expires_at = new Date(from + days * 86400000).toISOString();
      patch.reminded = false;
    }
    let pin = null;
    if (body.regenPin) { pin = randomCode(8); patch.admin_hash = sha256(pin); }
    if (Object.keys(patch).length) {
      const { error } = await getSupabaseAdmin().from("clicclac_albums").update(patch).eq("id", id);
      if (error) throw error;
    }
    return Response.json({ ok: true, pin });
  } catch (e) {
    console.error("clicclac album PATCH:", e);
    return Response.json({ error: "Modification impossible." }, { status: 502 });
  }
}

export async function DELETE(req, { params }) {
  if (!isSuper(req)) return Response.json({ error: "Accès refusé." }, { status: 401 });
  const { id } = await params;
  try {
    const a = await load(id);
    if (!a) return Response.json({ error: "Album introuvable." }, { status: 404 });
    await deleteAlbum(a);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("clicclac album DELETE:", e);
    return Response.json({ error: "Suppression impossible." }, { status: 502 });
  }
}
