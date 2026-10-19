/* Organisateur — cadre personnalisé (PNG transparent, 3 Mo max) : envoi / retrait. */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAlbum, roleFor, canAdmin, putFile, removeFiles, sniffImage } from "@/lib/clicclac/server";

export const runtime = "nodejs";

async function guard(req, params) {
  const { code } = await params;
  const a = await loadAlbum(code);
  if (!a) return { err: Response.json({ error: "Album introuvable." }, { status: 404 }) };
  if (!canAdmin(roleFor(req, a))) return { err: Response.json({ error: "Accès refusé." }, { status: 401 }) };
  return { a };
}

async function saveFrame(a, path) {
  const settings = { ...a.settings, customFrame: path };
  if (!path && settings.imposedFrame === "custom") settings.imposedFrame = "none";
  const { error } = await getSupabaseAdmin().from("clicclac_albums").update({ settings }).eq("id", a.id);
  if (error) throw error;
}

export async function POST(req, { params }) {
  try {
    const { a, err } = await guard(req, params);
    if (err) return err;
    let file;
    try { file = (await req.formData()).get("file"); } catch (e) { file = null; }
    if (!file || typeof file.arrayBuffer !== "function") return Response.json({ error: "Aucun fichier." }, { status: 400 });
    if (file.size > 3 * 1024 * 1024) return Response.json({ error: "Fichier trop lourd (3 Mo max)." }, { status: 413 });
    const buf = Buffer.from(await file.arrayBuffer());
    if (sniffImage(buf) !== "image/png") return Response.json({ error: "Le cadre doit être un PNG (avec transparence)." }, { status: 400 });
    const path = `${a.id}/cadre-${Date.now()}.png`;
    await putFile(path, buf, "image/png");
    if (a.settings.customFrame) await removeFiles([a.settings.customFrame]);
    await saveFrame(a, path);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("clicclac frame POST:", e);
    return Response.json({ error: "Envoi impossible." }, { status: 502 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const { a, err } = await guard(req, params);
    if (err) return err;
    if (a.settings.customFrame) await removeFiles([a.settings.customFrame]);
    await saveFrame(a, null);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("clicclac frame DELETE:", e);
    return Response.json({ error: "Suppression impossible." }, { status: 502 });
  }
}
