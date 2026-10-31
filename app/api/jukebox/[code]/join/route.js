/*
 * Route PUBLIQUE — accès régie d'un nouvel appareil (lib/jukeboxAccess.js).
 * Body : { pin } (code régie à 6 chiffres) ou { pass } (QR à usage unique).
 * Réponse : { token } (jeton propre à l'appareil, gardé en localStorage).
 */
import { loadSession } from "@/lib/jukeboxServer";
import { joinWithCode, joinWithPass } from "@/lib/jukeboxAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req, { params }) {
  const { code } = await params;
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  try {
    const s = await loadSession(code);
    if (!s) return Response.json({ error: "Soirée introuvable." }, { status: 404 });
    const ua = req.headers.get("user-agent") || "";
    const r = body?.pass ? await joinWithPass(s, body.pass, ua) : await joinWithCode(s, body?.pin, ua);
    if (r.error) return Response.json({ error: r.error }, { status: r.status });
    return Response.json({ ok: true, token: r.token });
  } catch (e) {
    console.error("jukebox join:", e);
    return Response.json({ error: "Connexion impossible, réessayez." }, { status: 502 });
  }
}
