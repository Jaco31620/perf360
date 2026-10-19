/*
 * Super-admin — liste des albums (avec utilisation) et création.
 * À la création, le code admin (PIN) est renvoyé UNE seule fois (seule son
 * empreinte est stockée) ; il peut être régénéré ensuite.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isSuper, randomCode, sha256, computeExpiry } from "@/lib/clicclac/server";
import { normalizeSettings, MAX_NAME } from "@/lib/clicclac/settings";
import { isEmail } from "@/lib/clicclac/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  if (!isSuper(req)) return Response.json({ error: "Accès refusé." }, { status: 401 });
  try {
    const sb = getSupabaseAdmin();
    const { data: albums, error } = await sb.from("clicclac_albums").select("id,code,name,event_date,admin_email,settings,expires_at,created_at").order("created_at", { ascending: false });
    if (error) throw error;
    const { data: photos, error: e2 } = await sb.from("clicclac_photos").select("album_id,bytes,status");
    if (e2) throw e2;
    const usage = {};
    for (const p of photos) {
      const u = (usage[p.album_id] ??= { photos: 0, pending: 0, bytes: 0 });
      u.photos++; u.bytes += p.bytes || 0; if (p.status === "pending") u.pending++;
    }
    return Response.json({
      albums: albums.map((a) => ({ ...a, settings: normalizeSettings(a.settings), usage: usage[a.id] || { photos: 0, pending: 0, bytes: 0 } })),
      totalBytes: photos.reduce((s, p) => s + (p.bytes || 0), 0),
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("clicclac albums GET:", e);
    return Response.json({ error: "Chargement impossible." }, { status: 502 });
  }
}

export async function POST(req) {
  if (!isSuper(req)) return Response.json({ error: "Accès refusé." }, { status: 401 });
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  const name = String(body?.name || "").trim().slice(0, MAX_NAME);
  if (!name) return Response.json({ error: "Nom de l'événement requis." }, { status: 400 });
  const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(body?.eventDate || "") ? body.eventDate : null;
  const settings = normalizeSettings(body?.settings);
  const pin = randomCode(8);
  try {
    const sb = getSupabaseAdmin();
    for (let i = 0; i < 6; i++) {
      const code = randomCode(6);
      const { data, error } = await sb.from("clicclac_albums").insert({
        code, name, event_date: eventDate, admin_hash: sha256(pin),
        admin_email: isEmail(body?.adminEmail) ? body.adminEmail.trim() : null,
        settings, expires_at: computeExpiry(eventDate, settings.retentionDays),
      }).select("id,code").single();
      if (!error) return Response.json({ id: data.id, code: data.code, pin });
      if (error.code !== "23505") throw error;
    }
    return Response.json({ error: "Génération du code impossible, réessayez." }, { status: 503 });
  } catch (e) {
    console.error("clicclac albums POST:", e);
    return Response.json({ error: "Création impossible." }, { status: 502 });
  }
}
