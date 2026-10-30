/* Super-admin Jukebox : mot de passe (celui de Clic-Clac) → jeton (3 jours). */
import { checkSuperPassword, superToken } from "@/lib/jukeboxAdmin";

export const runtime = "nodejs";

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  try {
    if (!(await checkSuperPassword(body?.password))) {
      await new Promise((r) => setTimeout(r, 600)); // ralentit les essais
      return Response.json({ error: "Mot de passe incorrect." }, { status: 401 });
    }
    return Response.json({ token: superToken() });
  } catch (e) {
    console.error("jukebox super login:", e);
    return Response.json({ error: "Connexion impossible." }, { status: 502 });
  }
}
