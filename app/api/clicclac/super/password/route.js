/* Super-admin : changement du mot de passe (commun à Clic-Clac et Jukebox). */
import { isSuper, changeMasterPassword } from "@/lib/clicclac/server";

export const runtime = "nodejs";

export async function POST(req) {
  if (!isSuper(req)) return Response.json({ error: "Accès refusé." }, { status: 401 });
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  try {
    const err = await changeMasterPassword(body?.current, body?.next);
    if (err) {
      await new Promise((r) => setTimeout(r, 600)); // ralentit les essais
      return Response.json({ error: err }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error("clicclac password:", e);
    return Response.json({ error: "Changement impossible." }, { status: 502 });
  }
}
