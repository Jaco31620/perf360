/*
 * Route serveur PUBLIQUE — création d'une soirée jukebox. Génère un code à 6
 * chiffres (affiché aux participants) et un jeton régie (renvoyé une seule
 * fois, seul son hash est stocké).
 * Création selon le réglage super-admin : ouverte à tous, sur code de
 * création, ou réservée au super-admin (en-tête x-jukebox-super).
 * GET : mode de création en vigueur (pour l'accueil).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { newAdminToken, hashToken } from "@/lib/jukeboxServer";
import { MAX_NAME_LEN, normalizeMax } from "@/lib/jukebox";
import { loadConfig, isJukeboxSuper, sameCode } from "@/lib/jukeboxAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { creationMode } = await loadConfig();
    return Response.json({ creationMode });
  } catch (e) {
    return Response.json({ creationMode: "open" });
  }
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }

  const name = String(body?.name || "").trim().slice(0, MAX_NAME_LEN);
  if (!name) return Response.json({ error: "Merci de nommer la soirée." }, { status: 400 });
  const max = normalizeMax(body?.maxPerParticipant);

  const token = newAdminToken();
  try {
    if (!isJukeboxSuper(req)) {
      const { creationMode, creationCode } = await loadConfig();
      if (creationMode === "super")
        return Response.json({ error: "La création de soirées est réservée à l'administrateur." }, { status: 403 });
      if (creationMode === "code" && !sameCode(body?.creationCode, creationCode))
        return Response.json({ error: "Code de création incorrect." }, { status: 403 });
    }
    const sb = getSupabaseAdmin();
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const { error } = await sb.from("jukebox_sessions").insert({
        code, name, admin_hash: hashToken(token), max_per_participant: max,
      });
      if (!error) return Response.json({ code, adminToken: token });
      if (error.code !== "23505") throw error; // 23505 = code déjà pris → on retente
    }
    return Response.json({ error: "Impossible de générer un code, réessayez." }, { status: 503 });
  } catch (e) {
    console.error("jukebox create:", e);
    return Response.json({ error: "Création impossible." }, { status: 502 });
  }
}
