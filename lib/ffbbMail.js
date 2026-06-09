/*
 * Envoi e-mail SERVEUR du dispositif FFBB (Resend). Centralise la construction
 * et l'envoi de l'e-mail de bienvenue pour que les routes /api/ffbb/register et
 * /api/ffbb/resend l'envoient elles-mêmes — sans jamais renvoyer au navigateur
 * les données d'un autre inscrit (e-mail, code).
 *
 * Module serveur uniquement (lit RESEND_FFBB_KEY).
 */
import { Resend } from "resend";
import { buildEmailHtml, htmlToText, isHttpUrl } from "../app/ffbb-test/emailTemplate";

const FROM_EMAIL = "noreply@perf360.fr";
const DEFAULT_REPLY_TO = "jaco.barral@blackroll.com";

const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());
const senderName = (n) => String(n || "").replace(/[<>"\r\n]/g, "").trim() || "BLACKROLL";

/* Remplace les variables {prenom}/{nom}/{licence}/{code}/{email} dans un gabarit. */
export function fillTemplate(str, v) {
  return (str || "")
    .replace(/\{prenom\}/gi, v.prenom || "")
    .replace(/\{nom\}/gi, v.nom || "")
    .replace(/\{licence\}/gi, v.licence || "")
    .replace(/\{code\}/gi, v.code || "")
    .replace(/\{email\}/gi, v.email || "");
}

/* Envoi bas niveau d'un e-mail habillé (mêmes en-tête/carte/CTA/footer que l'aperçu). */
export async function sendBrandedEmail({ to, fromName, replyTo, subject, body, ctaUrl, ctaLabel, headerImageUrl, altText, footer }) {
  if (!to || !subject || !body) throw new Error("Champs requis manquants (to, subject, body).");
  if (!isEmail(to)) throw new Error("Adresse destinataire invalide.");

  const apiKey = process.env.RESEND_FFBB_KEY;
  if (!apiKey) throw new Error("Service e-mail non configuré.");

  const replyAddr = isEmail(replyTo) ? String(replyTo).trim() : DEFAULT_REPLY_TO;
  const html = buildEmailHtml(String(body), ctaUrl, ctaLabel, headerImageUrl, altText, footer);
  let text = htmlToText(body);
  if (isHttpUrl(ctaUrl)) text += `\n\n${String(ctaLabel || "Profiter de mon code")} : ${String(ctaUrl).trim()}`;

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: `${senderName(fromName)} <${FROM_EMAIL}>`,
    to: String(to).trim(),
    replyTo: replyAddr,
    subject: String(subject),
    text,
    html,
    headers: { "List-Unsubscribe": `<mailto:${replyAddr}?subject=Desabonnement>` },
  });
  if (error) {
    console.error("Resend error:", error);
    throw new Error(error.message || "Échec de l'envoi.");
  }
  return data?.id;
}

/* Envoi de l'e-mail de bienvenue à un inscrit, à partir de la config de l'instance.
   `reg` = { prenom, nom, licence, code, email } ; `config` = config normalisée. */
export async function sendWelcomeEmail(reg, config) {
  const vars = { prenom: reg.prenom, nom: reg.nom, licence: reg.licence, code: reg.code, email: reg.email };
  const e = config.welcomeEmail || {};
  return sendBrandedEmail({
    to: reg.email,
    fromName: e.fromName,
    replyTo: e.replyTo,
    headerImageUrl: config.headerImageUrl,
    altText: config.federationName,
    ctaUrl: fillTemplate(e.ctaUrl, vars),
    ctaLabel: fillTemplate(e.ctaLabel, vars),
    footer: e.footer,
    subject: fillTemplate(e.subject, vars),
    body: fillTemplate(e.body, vars),
  });
}
