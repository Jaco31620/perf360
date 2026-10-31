/*
 * Route serveur PUBLIQUE — création d'une soirée jukebox. Génère un code à 6
 * chiffres (affiché aux participants) et un jeton régie (renvoyé une seule
 * fois, seul son hash est stocké).
 * Création selon le réglage super-admin : ouverte à tous, sur code de
 * création, ou réservée au super-admin (en-tête x-jukebox-super).
 * Fonctions (historique, thème, blind test) : celles choisies par le
 * super-admin à la création, sinon ses valeurs par défaut. Réglages de la
 * régie : ceux du super-admin ({ options }) à la création, sinon les réglages
 * de départ fixés dans le super-admin.
 * GET : mode de création en vigueur et limite par invité par défaut (accueil).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { newAdminToken, hashToken, regieOptions } from "@/lib/jukeboxServer";
import { newRegieCode, deviceLabel } from "@/lib/jukeboxAccess";
import { MAX_NAME_LEN, normalizeMax, normalizeFeatures, normalizeDefaults } from "@/lib/jukebox";
import { loadConfig, isJukeboxSuper, sameCode } from "@/lib/jukeboxAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { creationMode, defaultOptions } = await loadConfig();
    return Response.json({ creationMode, defaultMax: defaultOptions.maxPerParticipant });
  } catch (e) {
    return Response.json({ creationMode: "open" });
  }
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }

  const name = String(body?.name || "").trim().slice(0, MAX_NAME_LEN);
  if (!name) return Response.json({ error: "Merci de nommer la soirée." }, { status: 400 });

  const token = newAdminToken();
  try {
    const config = await loadConfig();
    const isSuper = isJukeboxSuper(req);
    const d = isSuper && body?.options && typeof body.options === "object"
      ? normalizeDefaults(body.options, config.defaultOptions) : config.defaultOptions;
    const max = body?.maxPerParticipant == null ? d.maxPerParticipant : normalizeMax(body.maxPerParticipant);
    const options = {
      ...regieOptions(d),
      theme: { palette: d.palette },
      blind: { ...d.blind, on: false },
      features: isSuper ? normalizeFeatures(body?.features, config.defaultFeatures) : config.defaultFeatures,
    };
    if (!isSuper) {
      const { creationMode, creationCode } = config;
      if (creationMode === "super")
        return Response.json({ error: "La création de soirées est réservée à l'administrateur." }, { status: 403 });
      if (creationMode === "code" && !sameCode(body?.creationCode, creationCode))
        return Response.json({ error: "Code de création incorrect." }, { status: 403 });
    }
    const sb = getSupabaseAdmin();
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const regieCode = newRegieCode();
      const { data: row, error } = await sb.from("jukebox_sessions").insert({
        code, name, admin_hash: hashToken(token), max_per_participant: max, options, regie_code: regieCode,
      }).select("id").maybeSingle();
      if (!error) {
        // le créateur est le premier appareil autorisé (super-admin : son jeton sert au lien d'invitation)
        await sb.from("jukebox_devices").insert({ session_id: row.id, token_hash: hashToken(token), label: deviceLabel(req.headers.get("user-agent") || "") });
        return Response.json({ code, adminToken: token, regieCode });
      }
      if (error.code !== "23505") throw error; // 23505 = code déjà pris → on retente
    }
    return Response.json({ error: "Impossible de générer un code, réessayez." }, { status: 503 });
  } catch (e) {
    console.error("jukebox create:", e);
    return Response.json({ error: "Création impossible." }, { status: 502 });
  }
}
