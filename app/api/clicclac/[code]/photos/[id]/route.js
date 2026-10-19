/*
 * Une photo.
 * - GET    : (détenteur du code) lien signé — page « Récupérer ma photo ».
 * - PATCH  : (organisateur) { status: "published" | "pending", caption }.
 * - DELETE : organisateur, ou l'invité auteur (?guest=<id>).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAlbum, roleFor, canAdmin, signUrls, removeFiles } from "@/lib/clicclac/server";
import { MAX_CAPTION } from "@/lib/clicclac/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s || ""));

async function load(code, id) {
  if (!isUuid(id)) return {};
  const a = await loadAlbum(code);
  if (!a) return {};
  const { data, error } = await getSupabaseAdmin().from("clicclac_photos").select("*").eq("id", id).eq("album_id", a.id).maybeSingle();
  if (error) throw error;
  return { a, p: data };
}

export async function GET(req, { params }) {
  const { code, id } = await params;
  try {
    const { a, p } = await load(code, id);
    if (!p || p.status !== "published") return Response.json({ error: "Photo introuvable." }, { status: 404 });
    const [full] = await signUrls([p.path]);
    return Response.json({
      photo: { id: p.id, full, name: p.guest_name || "", caption: p.caption || "", kind: p.kind },
      album: { name: a.name, code: a.code, guestDownload: a.settings.guestDownload },
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("clicclac photo GET:", e);
    return Response.json({ error: "Chargement impossible." }, { status: 502 });
  }
}

export async function PATCH(req, { params }) {
  const { code, id } = await params;
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  try {
    const { a, p } = await load(code, id);
    if (!p) return Response.json({ error: "Photo introuvable." }, { status: 404 });
    if (!canAdmin(roleFor(req, a))) return Response.json({ error: "Accès refusé." }, { status: 401 });
    const patch = {};
    if (["published", "pending"].includes(body?.status)) patch.status = body.status;
    if (body?.caption !== undefined) patch.caption = String(body.caption).trim().slice(0, MAX_CAPTION) || null;
    const { error } = await getSupabaseAdmin().from("clicclac_photos").update(patch).eq("id", p.id);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("clicclac photo PATCH:", e);
    return Response.json({ error: "Modification impossible." }, { status: 502 });
  }
}

export async function DELETE(req, { params }) {
  const { code, id } = await params;
  try {
    const { a, p } = await load(code, id);
    if (!p) return Response.json({ error: "Photo introuvable." }, { status: 404 });
    const guest = new URL(req.url).searchParams.get("guest");
    const owner = guest && p.guest_id && guest === p.guest_id;
    if (!owner && !canAdmin(roleFor(req, a))) return Response.json({ error: "Accès refusé." }, { status: 401 });
    await removeFiles([p.path, p.thumb_path, p.hd_path]);
    const { error } = await getSupabaseAdmin().from("clicclac_photos").delete().eq("id", p.id);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("clicclac photo DELETE:", e);
    return Response.json({ error: "Suppression impossible." }, { status: 502 });
  }
}
