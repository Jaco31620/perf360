/*
 * Authentification d'album.
 *  - { pin }   → jeton organisateur (12 h)
 *  - { booth } → (organisateur connecté) jeton de borne pour cet appareil (7 jours)
 */
import { loadAlbum, checkPin, signToken, roleFor, canAdmin } from "@/lib/clicclac/server";

export const runtime = "nodejs";

export async function POST(req, { params }) {
  const { code } = await params;
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  try {
    const a = await loadAlbum(code);
    if (!a) return Response.json({ error: "Album introuvable." }, { status: 404 });
    if (body?.booth) {
      if (!canAdmin(roleFor(req, a))) return Response.json({ error: "Accès refusé." }, { status: 401 });
      return Response.json({ token: signToken(`booth:${a.id}`, 7 * 24 * 3600 * 1000) });
    }
    if (!checkPin(body?.pin, a.admin_hash)) {
      await new Promise((r) => setTimeout(r, 600));
      return Response.json({ error: "Code organisateur incorrect." }, { status: 401 });
    }
    return Response.json({ token: signToken(`album:${a.id}`) });
  } catch (e) {
    console.error("clicclac auth:", e);
    return Response.json({ error: "Connexion impossible." }, { status: 502 });
  }
}
