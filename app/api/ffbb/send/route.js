/*
 * Route serveur — envoi de l'e-mail de bienvenue FFBB × BLACKROLL via Resend.
 * Clé API lue dans process.env.RESEND_FFBB_KEY. Expéditeur : noreply@perf360.fr.
 * Reçoit { to, subject, body, replyTo, ctaUrl, ctaLabel } ; `body` est du HTML
 * (éditeur WYSIWYG de l'admin). Le gabarit/habillage est partagé avec l'aperçu
 * admin via ../../../ffbb-test/emailTemplate.
 */
import { Resend } from "resend";
import { buildEmailHtml, htmlToText, isHttpUrl } from "../../../ffbb-test/emailTemplate";

export const runtime = "nodejs";

const FROM = "FFBB × BLACKROLL <noreply@perf360.fr>";
/* Adresse de réponse par défaut, si l'admin n'en a pas défini une dans la config. */
const DEFAULT_REPLY_TO = "jaco.barral@blackroll.com";

const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());

export async function POST(req) {
  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }

  const { to, subject, body, replyTo, ctaUrl, ctaLabel } = payload || {};
  if (!to || !subject || !body) {
    return Response.json({ error: "Champs requis manquants (to, subject, body)." }, { status: 400 });
  }
  if (!isEmail(to)) {
    return Response.json({ error: "Adresse destinataire invalide." }, { status: 400 });
  }

  /* reply_to administrable côté admin ; on retombe sur le défaut si invalide/absent. */
  const replyAddr = isEmail(replyTo) ? String(replyTo).trim() : DEFAULT_REPLY_TO;

  /* HTML complet (en-tête + carte + bouton CTA + footer) + version texte de secours. */
  const html = buildEmailHtml(String(body), ctaUrl, ctaLabel);
  let text = htmlToText(body);
  if (isHttpUrl(ctaUrl)) {
    text += `\n\n${String(ctaLabel || "Profiter de mon code")} : ${String(ctaUrl).trim()}`;
  }

  const apiKey = process.env.RESEND_FFBB_KEY;
  if (!apiKey) {
    return Response.json({ error: "Service e-mail non configuré." }, { status: 500 });
  }

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: String(to).trim(),
      replyTo: replyAddr,
      subject: String(subject),
      text,
      html,
      headers: {
        "List-Unsubscribe": `<mailto:${replyAddr}?subject=Desabonnement>`,
      },
    });
    if (error) {
      console.error("Resend error:", error);
      return Response.json({ error: error.message || "Échec de l'envoi." }, { status: 502 });
    }
    return Response.json({ ok: true, id: data?.id });
  } catch (e) {
    console.error("Send exception:", e);
    return Response.json({ error: "Échec de l'envoi de l'e-mail." }, { status: 502 });
  }
}
