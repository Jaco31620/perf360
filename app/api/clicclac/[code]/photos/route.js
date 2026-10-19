/*
 * Photos d'un album.
 * - GET  : galerie (publiées ; + en attente pour l'organisateur), liens signés
 *          1 h vers miniature et version standard (+ HD pour l'organisateur).
 *          ?guest=<id> marque les photos de cet invité (« mine »).
 * - POST : envoi (multipart) — full (JPEG ≈1600 px), thumb (JPEG ≈480 px),
 *          hd (JPEG, si l'album conserve la HD), guestId, guestName, caption, kind.
 *          Quotas : capacité de l'album (tous) + quota par invité (sauf borne /
 *          organisateur). Modération : en attente sauf borne / organisateur.
 */
import crypto from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAlbum, roleFor, canAdmin, signUrls, putFile, removeFiles, sniffImage } from "@/lib/clicclac/server";
import { MAX_NAME, MAX_CAPTION } from "@/lib/clicclac/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const validGuest = (g) => /^[a-z0-9-]{8,64}$/i.test(String(g || ""));
const LIMITS = { full: 2.5 * 1024 * 1024, thumb: 400 * 1024, hd: 4 * 1024 * 1024 };

export async function GET(req, { params }) {
  const { code } = await params;
  try {
    const a = await loadAlbum(code);
    if (!a) return Response.json({ error: "Album introuvable." }, { status: 404 });
    const role = roleFor(req, a);
    const admin = canAdmin(role);
    const url = new URL(req.url);
    const guest = url.searchParams.get("guest");
    let q = getSupabaseAdmin().from("clicclac_photos")
      .select("id,path,thumb_path,hd_path,guest_id,guest_name,caption,kind,source,status,created_at")
      .eq("album_id", a.id).order("created_at", { ascending: false }).limit(2000);
    if (!admin) q = q.eq("status", "published");
    const { data, error } = await q;
    if (error) throw error;
    const withHd = admin && url.searchParams.get("hd") === "1";
    const paths = data.flatMap((p) => [p.thumb_path, p.path, ...(withHd ? [p.hd_path || p.path] : [])]);
    const urls = await signUrls(paths);
    const step = withHd ? 3 : 2;
    const photos = data.map((p, i) => ({
      id: p.id,
      name: p.guest_name || "",
      caption: p.caption || "",
      kind: p.kind,
      source: p.source,
      status: p.status,
      createdAt: p.created_at,
      thumb: urls[i * step],
      full: urls[i * step + 1],
      ...(withHd ? { hd: urls[i * step + 2] } : {}),
      mine: validGuest(guest) && p.guest_id === guest,
    }));
    return Response.json({ photos }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("clicclac photos GET:", e);
    return Response.json({ error: "Chargement impossible." }, { status: 502 });
  }
}

export async function POST(req, { params }) {
  const { code } = await params;
  let form;
  try { form = await req.formData(); } catch (e) { return Response.json({ error: "Envoi invalide." }, { status: 400 }); }
  try {
    const a = await loadAlbum(code);
    if (!a) return Response.json({ error: "Album introuvable." }, { status: 404 });
    const role = roleFor(req, a);
    const trusted = canAdmin(role) || role === "booth";
    const s = a.settings;
    const guestId = String(form.get("guestId") || "");
    if (!trusted && !validGuest(guestId)) return Response.json({ error: "Invité non identifié." }, { status: 400 });

    // fichiers
    const files = {};
    for (const k of ["full", "thumb", "hd"]) {
      const f = form.get(k);
      if (!f || typeof f.arrayBuffer !== "function") continue;
      if (f.size > LIMITS[k]) return Response.json({ error: "Photo trop lourde." }, { status: 413 });
      const buf = Buffer.from(await f.arrayBuffer());
      if (sniffImage(buf) !== "image/jpeg") return Response.json({ error: "Format de photo invalide." }, { status: 400 });
      files[k] = buf;
    }
    if (!files.full || !files.thumb) return Response.json({ error: "Photo manquante." }, { status: 400 });
    if (!s.keepHd) delete files.hd;

    // quotas
    const sb = getSupabaseAdmin();
    const { count: total } = await sb.from("clicclac_photos").select("id", { count: "exact", head: true }).eq("album_id", a.id);
    if ((total || 0) >= s.maxPhotos) return Response.json({ error: "L'album est complet." }, { status: 429 });
    if (!trusted && s.guestQuota > 0) {
      const { count: mine } = await sb.from("clicclac_photos").select("id", { count: "exact", head: true }).eq("album_id", a.id).eq("guest_id", guestId);
      if ((mine || 0) >= s.guestQuota) return Response.json({ error: `Vous avez atteint votre limite de ${s.guestQuota} photos.` }, { status: 429 });
    }

    const id = crypto.randomUUID();
    const base = `${a.id}/${id}`;
    const paths = { full: `${base}.jpg`, thumb: `${base}_t.jpg`, hd: files.hd ? `${base}_hd.jpg` : null };
    try {
      await putFile(paths.full, files.full, "image/jpeg");
      await putFile(paths.thumb, files.thumb, "image/jpeg");
      if (files.hd) await putFile(paths.hd, files.hd, "image/jpeg");
      const { error } = await sb.from("clicclac_photos").insert({
        id, album_id: a.id, path: paths.full, thumb_path: paths.thumb, hd_path: paths.hd,
        guest_id: validGuest(guestId) ? guestId : null,
        guest_name: String(form.get("guestName") || "").trim().slice(0, MAX_NAME) || null,
        caption: String(form.get("caption") || "").trim().slice(0, MAX_CAPTION) || null,
        kind: form.get("kind") === "strip" ? "strip" : "photo",
        source: role === "booth" ? "booth" : "guest",
        status: s.moderation && !trusted ? "pending" : "published",
        bytes: files.full.length + files.thumb.length + (files.hd?.length || 0),
      });
      if (error) throw error;
    } catch (e) {
      await removeFiles(Object.values(paths)).catch(() => {});
      throw e;
    }
    return Response.json({ ok: true, id, pending: s.moderation && !trusted });
  } catch (e) {
    console.error("clicclac photos POST:", e);
    return Response.json({ error: "Envoi impossible." }, { status: 502 });
  }
}
