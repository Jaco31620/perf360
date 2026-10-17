/*
 * Route serveur PUBLIQUE — création d'un nuage de mots. Génère un code à 6
 * chiffres (affiché aux participants) et un jeton présentateur (renvoyé une
 * seule fois, seul son hash est stocké).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { newAdminToken, hashToken } from "@/lib/nuageServer";
import { MAX_QUESTION_LEN, DEFAULT_MAX_PER_PARTICIPANT } from "@/lib/nuage";

export const runtime = "nodejs";

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }

  const question = String(body?.question || "").trim().slice(0, MAX_QUESTION_LEN);
  if (!question) return Response.json({ error: "Merci d'indiquer une question." }, { status: 400 });
  const max = Math.min(10, Math.max(1, parseInt(body?.maxPerParticipant, 10) || DEFAULT_MAX_PER_PARTICIPANT));

  const token = newAdminToken();
  try {
    const sb = getSupabaseAdmin();
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const { error } = await sb.from("nuage_sessions").insert({
        code, question, admin_hash: hashToken(token), max_per_participant: max,
      });
      if (!error) return Response.json({ code, adminToken: token });
      if (error.code !== "23505") throw error; // 23505 = code déjà pris → on retente
    }
    return Response.json({ error: "Impossible de générer un code, réessayez." }, { status: 503 });
  } catch (e) {
    console.error("nuage create:", e);
    return Response.json({ error: "Création impossible." }, { status: 502 });
  }
}
