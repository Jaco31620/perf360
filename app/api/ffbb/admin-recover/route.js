/*
 * Route serveur — « mot de passe oublié » du super-admin.
 * Envoie le mot de passe maître (ffbb_config id=1 → data.masterPassword) par
 * e-mail via Resend. SÉCURITÉ : le destinataire est CODÉ EN DUR (RECOVERY_EMAIL),
 * pas fourni par le client — un visiteur ne peut donc pas se faire envoyer le
 * mot de passe ; il n'arrive que dans la boîte du propriétaire.
 */
import { Resend } from "resend";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const FROM_EMAIL = "noreply@perf360.fr";
/* Destinataire fixe de la récupération — ne JAMAIS le rendre paramétrable côté client. */
const RECOVERY_EMAIL = "jaco31@gmail.com";

export async function POST() {
  const apiKey = process.env.RESEND_FFBB_KEY;
  if (!apiKey) {
    return Response.json({ error: "Service non configuré." }, { status: 500 });
  }

  let masterPassword;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("ffbb_config").select("data").eq("id", 1).maybeSingle();
    if (error) throw error;
    masterPassword = data?.data?.masterPassword || "admin";
  } catch (e) {
    console.error("Recover load error:", e);
    return Response.json({ error: "Lecture impossible." }, { status: 502 });
  }

  const subject = "BLACKROLL Codes — votre mot de passe super-administrateur";
  const text =
    `Bonjour,\n\n` +
    `Voici le mot de passe d'accès au super-administrateur (BLACKROLL Codes) :\n\n` +
    `    ${masterPassword}\n\n` +
    `Vous pouvez le changer après connexion dans la carte « Sécurité ».\n\n` +
    `Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : ` +
    `le mot de passe reste inchangé et n'a été envoyé qu'à cette adresse.`;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.5">` +
    `<p>Bonjour,</p>` +
    `<p>Voici le mot de passe d'accès au <b>super-administrateur</b> (BLACKROLL Codes) :</p>` +
    `<p style="font-size:20px;font-weight:bold;letter-spacing:1px;background:#f3f3f3;` +
    `border-radius:8px;padding:12px 16px;display:inline-block">${escapeHtml(masterPassword)}</p>` +
    `<p>Vous pouvez le changer après connexion dans la carte «&nbsp;Sécurité&nbsp;».</p>` +
    `<p style="color:#888;font-size:13px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail&nbsp;: ` +
    `le mot de passe reste inchangé et n'a été envoyé qu'à cette adresse.</p>` +
    `</div>`;

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: `BLACKROLL Codes <${FROM_EMAIL}>`,
      to: RECOVERY_EMAIL,
      subject,
      text,
      html,
    });
    if (error) {
      console.error("Recover send error:", error);
      return Response.json({ error: "Échec de l'envoi." }, { status: 502 });
    }
  } catch (e) {
    console.error("Recover send exception:", e);
    return Response.json({ error: "Échec de l'envoi." }, { status: 502 });
  }

  /* On ne renvoie qu'un indice masqué de l'adresse — jamais le mot de passe. */
  return Response.json({ ok: true, hint: maskEmail(RECOVERY_EMAIL) });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function maskEmail(email) {
  const [user, domain] = String(email).split("@");
  const head = user.slice(0, 1);
  return `${head}${"*".repeat(Math.max(2, user.length - 1))}@${domain}`;
}
