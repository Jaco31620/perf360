/*
 * Route serveur PUBLIQUE — inscription au dispositif. Fait TOUT côté serveur
 * (service_role) de façon atomique : détection de doublon (e-mail / licence),
 * attribution d'un code disponible (ou code générique), création de l'inscription,
 * puis envoi de l'e-mail de bienvenue. Ne renvoie JAMAIS au navigateur les données
 * d'un autre inscrit (e-mail, code) — au pire un e-mail masqué + un jeton opaque.
 *
 * Réponses : { status: "ok" | "resent" | "conflict" | "error", ... }
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeConfig } from "@/app/ffbb-test/configDefaults";
import { sendWelcomeEmail } from "@/lib/ffbbMail";
import { resendToken } from "@/lib/ffbbAuth";

export const runtime = "nodejs";

const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());

function maskEmail(email) {
  const at = (email || "").indexOf("@");
  if (at < 1) return email || "";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const name = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return local[0] + "***@" + (name[0] || "") + "***" + tld;
}

/* Réserve atomiquement un code « available » de cette campagne. Retourne le code ou null. */
async function claimCode(sb, cid) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: free, error } = await sb
      .from("ffbb_codes").select("code").eq("campaign_id", cid).eq("status", "available").limit(1).maybeSingle();
    if (error) throw error;
    if (!free) return null;
    const { data: claimed, error: upErr } = await sb
      .from("ffbb_codes").update({ status: "assigned" })
      .eq("campaign_id", cid).eq("code", free.code).eq("status", "available")
      .select();
    if (upErr) throw upErr;
    if (claimed && claimed.length === 1) return free.code;
    // pris entre-temps → nouvelle tentative
  }
  return null;
}

export async function POST(req) {
  let payload;
  try { payload = await req.json(); } catch (e) { return Response.json({ status: "error", message: "Requête invalide." }, { status: 400 }); }

  const { slug, prenom, nom, licence, email, newsletter } = payload || {};
  if (!slug) return Response.json({ status: "error", message: "Instance inconnue." }, { status: 400 });

  // Validation serveur (le client valide aussi, mais on ne fait pas confiance au client).
  if (!String(prenom || "").trim() || !String(nom || "").trim())
    return Response.json({ status: "invalid", message: "Merci d'indiquer votre prénom et votre nom." }, { status: 400 });
  if (!isEmail(email))
    return Response.json({ status: "invalid", message: "Adresse e-mail invalide." }, { status: 400 });

  const emailNorm = String(email).trim();
  const licNorm = String(licence || "").trim();

  try {
    const sb = getSupabaseAdmin();
    const { data: camp, error: cErr } = await sb
      .from("ffbb_campaigns").select("id,config").eq("slug", slug).maybeSingle();
    if (cErr) throw cErr;
    if (!camp) return Response.json({ status: "error", message: "Cette page n'existe pas ou n'est plus disponible." }, { status: 404 });

    const cid = camp.id;
    const config = normalizeConfig(camp.config);

    if (config.license.enabled !== false && !licNorm)
      return Response.json({ status: "invalid", message: "Le numéro de licence est requis." }, { status: 400 });

    // Doublon e-mail → renvoi du code existant à CETTE adresse (celle saisie).
    const { data: byEmail } = await sb
      .from("ffbb_registrations").select("*").eq("campaign_id", cid).ilike("email", emailNorm).limit(1).maybeSingle();
    if (byEmail) {
      await sendWelcomeEmail(byEmail, config);
      return Response.json({ status: "resent" });
    }

    // Doublon licence (≠ e-mail) → écran de conflit, sans fuite de PII.
    if (config.license.enabled !== false && licNorm) {
      const { data: byLicence } = await sb
        .from("ffbb_registrations").select("id,email").eq("campaign_id", cid).ilike("licence", licNorm).limit(1).maybeSingle();
      if (byLicence) {
        return Response.json({
          status: "conflict",
          maskedEmail: maskEmail(byLicence.email),
          resendToken: resendToken(byLicence.id, cid),
        });
      }
    }

    // Détermination du code selon le mode de distribution.
    const generic = config.codeMode === "generic";
    let code;
    if (generic) {
      code = (config.genericCode || "").trim();
      if (!code) return Response.json({ status: "error", message: "Le code n'est pas encore disponible. Merci de réessayer plus tard." }, { status: 409 });
    } else {
      code = await claimCode(sb, cid);
      if (!code) return Response.json({ status: "error", message: "Aucun code disponible pour le moment. Merci de réessayer plus tard." }, { status: 409 });
    }

    // Création de l'inscription.
    const { data: reg, error: insErr } = await sb
      .from("ffbb_registrations")
      .insert({ campaign_id: cid, prenom: String(prenom).trim(), nom: String(nom).trim(), licence: licNorm, email: emailNorm, newsletter: !!newsletter, code })
      .select().single();
    if (insErr) {
      // Mode liste : on relâche le code réservé pour ne pas le perdre.
      if (!generic) await sb.from("ffbb_codes").update({ status: "available", assigned_to: null }).eq("campaign_id", cid).eq("code", code);
      throw insErr;
    }

    // Mode liste : lien code → inscription. Puis envoi de l'e-mail réel.
    if (!generic) await sb.from("ffbb_codes").update({ assigned_to: String(reg.id) }).eq("campaign_id", cid).eq("code", code);
    await sendWelcomeEmail(reg, config);
    return Response.json({ status: "ok", email: emailNorm });
  } catch (e) {
    console.error("register POST:", e);
    return Response.json({ status: "error", message: "Une erreur est survenue. Merci de réessayer dans quelques instants." }, { status: 502 });
  }
}
