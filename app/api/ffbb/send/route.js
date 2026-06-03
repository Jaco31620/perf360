/*
 * Route serveur — envoi de l'e-mail de bienvenue FFBB × BLACKROLL via Resend.
 * Clé API lue dans process.env.RESEND_FFBB_KEY. Expéditeur : noreply@perf360.fr.
 * Reçoit { to, subject, body } ; le corps (texte) est aussi décliné en HTML simple.
 */
import { Resend } from "resend";

export const runtime = "nodejs";

const FROM = "FFBB × BLACKROLL <noreply@perf360.fr>";
/* Adresse de réponse par défaut, si l'admin n'en a pas défini une dans la config. */
const DEFAULT_REPLY_TO = "jaco.barral@blackroll.com";

const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toHtml(body) {
  const inner = escapeHtml(body).replace(/\n/g, "<br>");
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#161614;white-space:normal">${inner}</div>`;
}

export async function POST(req) {
  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }

  const { to, subject, body, replyTo } = payload || {};
  if (!to || !subject || !body) {
    return Response.json({ error: "Champs requis manquants (to, subject, body)." }, { status: 400 });
  }
  if (!isEmail(to)) {
    return Response.json({ error: "Adresse destinataire invalide." }, { status: 400 });
  }

  /* reply_to administrable côté admin ; on retombe sur le défaut si invalide/absent. */
  const replyAddr = isEmail(replyTo) ? String(replyTo).trim() : DEFAULT_REPLY_TO;

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
      text: String(body),
      html: toHtml(body),
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
