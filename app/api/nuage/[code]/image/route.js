/*
 * Route serveur PRÉSENTATEUR — image affichée à la place de la question en haut
 * de l'écran (logo, visuel…). En-tête x-nuage-admin requis.
 * - POST   (multipart, champ « file ») : PNG / JPEG / WebP / GIF, 3 Mo max.
 * - DELETE : retire l'image (la question réapparaît).
 * Stockage : bucket public « nuage-assets », écrit uniquement ici (service_role).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadSession, checkToken } from "@/lib/nuageServer";
import { normalizeStyle } from "@/lib/nuageThemes";

export const runtime = "nodejs";

const BUCKET = "nuage-assets";
const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX = 3 * 1024 * 1024;

/* Vérifie la signature binaire (on ne se fie pas au type annoncé). */
function sniff(buf) {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(0, 4).toString() === "GIF8") return "image/gif";
  return null;
}

async function authorize(req, params) {
  const { code } = await params;
  const s = await loadSession(code);
  if (!s) return { error: Response.json({ error: "Nuage introuvable." }, { status: 404 }) };
  if (!checkToken(req.headers.get("x-nuage-admin"), s.admin_hash))
    return { error: Response.json({ error: "Accès refusé." }, { status: 401 }) };
  return { s };
}

async function removeFiles(sb, code) {
  const { data: files } = await sb.storage.from(BUCKET).list(code);
  if (files?.length) await sb.storage.from(BUCKET).remove(files.map((f) => `${code}/${f.name}`));
}

export async function POST(req, { params }) {
  try {
    const { s, error } = await authorize(req, params);
    if (error) return error;

    let file;
    try { file = (await req.formData()).get("file"); } catch (e) { file = null; }
    if (!file || typeof file.arrayBuffer !== "function") return Response.json({ error: "Aucun fichier reçu." }, { status: 400 });
    if (file.size > MAX) return Response.json({ error: "Image trop lourde (3 Mo maximum)." }, { status: 413 });
    const buf = Buffer.from(await file.arrayBuffer());
    const type = sniff(buf);
    if (!type) return Response.json({ error: "Format non pris en charge (PNG, JPEG, WebP ou GIF)." }, { status: 400 });

    const sb = getSupabaseAdmin();
    await removeFiles(sb, s.code); // une seule image par nuage
    const path = `${s.code}/titre-${Date.now()}.${TYPES[type]}`;
    const up = await sb.storage.from(BUCKET).upload(path, buf, { contentType: type, cacheControl: "3600", upsert: true });
    if (up.error) throw up.error;
    const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    const style = { ...normalizeStyle(s.style), image: url };
    const { error: e2 } = await sb.from("nuage_sessions").update({ style }).eq("id", s.id);
    if (e2) throw e2;
    return Response.json({ ok: true, image: normalizeStyle(style).image });
  } catch (e) {
    console.error("nuage image POST:", e);
    return Response.json({ error: "Envoi de l'image impossible." }, { status: 502 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const { s, error } = await authorize(req, params);
    if (error) return error;
    const sb = getSupabaseAdmin();
    await removeFiles(sb, s.code);
    const { error: e2 } = await sb.from("nuage_sessions").update({ style: { ...normalizeStyle(s.style), image: null } }).eq("id", s.id);
    if (e2) throw e2;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("nuage image DELETE:", e);
    return Response.json({ error: "Suppression impossible." }, { status: 502 });
  }
}
