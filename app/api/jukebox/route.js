/*
 * Route serveur PUBLIQUE — création d'une soirée jukebox. Génère un code à 6
 * chiffres (affiché aux participants) et un jeton régie (renvoyé une seule
 * fois, seul son hash est stocké).
 * Création selon le réglage super-admin : ouverte à tous, sur code
 * d'activation individuel (lib/jukeboxActivation.js : une soirée de moins sur
 * le code, ses fonctions, le nom de l'organisateur), ou réservée au
 * super-admin (en-tête x-jukebox-super).
 * Fonctions (historique, thème, blind test) : celles choisies par le
 * super-admin à la création, sinon ses valeurs par défaut. Réglages de la
 * régie : ceux du super-admin ({ options }) à la création, sinon les réglages
 * de départ fixés dans le super-admin.
 * GET : mode de création en vigueur et limite par invité par défaut (accueil) ;
 *       ?check=<code d'activation> → { ok, label, remaining } ou { ok: false, error }.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { newAdminToken, hashToken, regieOptions } from "@/lib/jukeboxServer";
import { newRegieCode, deviceLabel } from "@/lib/jukeboxAccess";
import { MAX_NAME_LEN, normalizeMax, normalizeFeatures, normalizeDefaults, cleanValid, autoCloseAt } from "@/lib/jukebox";
import { loadConfig, isJukeboxSuper } from "@/lib/jukeboxAdmin";
import { sendAccessMail } from "@/lib/jukeboxRequests";
import { checkActivation, consumeActivation, refundActivation, ActivationError } from "@/lib/jukeboxActivation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slow = () => new Promise((r) => setTimeout(r, 600)); // ralentit les essais de codes

export async function GET(req) {
  const check = new URL(req.url).searchParams.get("check");
  if (check) {
    try {
      const r = await checkActivation(check);
      if (!r.ok) await slow();
      return Response.json(r, { headers: { "cache-control": "no-store" } });
    } catch (e) {
      return Response.json({ ok: false, error: "Vérification impossible." }, { status: 502 });
    }
  }
  try {
    const { creationMode, defaultOptions } = await loadConfig();
    return Response.json({ creationMode, defaultMax: defaultOptions.maxPerParticipant });
  } catch (e) {
    return Response.json({ creationMode: "open" });
  }
}

export async function POST(req) {
  let activation = null;
  try {
    return await create(req, (a) => { activation = a; });
  } catch (e) {
    if (activation) await refundActivation(activation.id).catch(() => {});
    if (e instanceof ActivationError) {
      await slow();
      return Response.json({ error: e.message }, { status: 403 });
    }
    console.error("jukebox create:", e);
    return Response.json({ error: "Création impossible." }, { status: 502 });
  }
}

async function create(req, onActivation) {
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }

  const name = String(body?.name || "").trim().slice(0, MAX_NAME_LEN);
  if (!name) return Response.json({ error: "Merci de nommer la soirée." }, { status: 400 });

  const token = newAdminToken();
  {
    const config = await loadConfig();
    const isSuper = isJukeboxSuper(req);
    const d = isSuper && body?.options && typeof body.options === "object"
      ? normalizeDefaults(body.options, config.defaultOptions) : config.defaultOptions;
    const max = body?.maxPerParticipant == null ? d.maxPerParticipant : normalizeMax(body.maxPerParticipant);
    let activation = null;
    if (!isSuper) {
      if (config.creationMode === "super")
        return Response.json({ error: "La création de soirées est réservée à l'administrateur." }, { status: 403 });
      if (config.creationMode === "code") {
        activation = await consumeActivation(body?.creationCode); // lève ActivationError
        onActivation(activation);
      }
    }
    const validDays = isSuper ? cleanValid(body?.validDays) : activation?.validDays;
    const options = {
      ...regieOptions(d),
      theme: { palette: d.palette },
      blind: { ...d.blind, on: false },
      features: isSuper ? normalizeFeatures(body?.features, config.defaultFeatures) : activation?.features || config.defaultFeatures,
      ...(activation ? { organizer: activation.label, activationId: activation.id } : {}),
      ...(validDays ? { validDays } : {}), // durée d'utilisation depuis la création (sinon sans limite)
    };
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
        // accès de l'organisateur envoyés par e-mail (code d'activation issu d'une demande)
        const mailedTo = activation?.email
          ? await sendAccessMail({ to: activation.email, origin: new URL(req.url).origin, code, name, regieCode }).then(() => activation.email, () => null)
          : null;
        return Response.json({ code, adminToken: token, regieCode, endsAt: autoCloseAt(Date.now(), validDays), mailedTo });
      }
      if (error.code !== "23505") throw error; // 23505 = code déjà pris → on retente
    }
    throw new Error("Impossible de générer un code de soirée.");
  }
}
