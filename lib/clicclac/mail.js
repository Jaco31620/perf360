/*
 * Clic-Clac — e-mails (Resend, expéditeur noreply@perf360.fr). Serveur uniquement.
 * L'adresse du propriétaire (contact, alertes) n'est jamais exposée au navigateur.
 */
import { Resend } from "resend";

const FROM = "Clic-Clac <noreply@perf360.fr>";
export const OWNER_EMAIL = "jaco31@gmail.com";
export const SITE = "https://perf360.vercel.app";

export const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function wrapHtml(title, inner) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;max-width:600px;margin:0 auto">
  <div style="font-size:22px;font-weight:800;color:#ff5a5f;margin-bottom:6px">📸 Clic-Clac</div>
  <h2 style="margin:0 0 14px">${esc(title)}</h2>
  ${inner}
  <p style="margin-top:22px;color:#999;font-size:12px">Clic-Clac — photo booth virtuel · perf360</p>
</div>`;
}

export async function sendMail({ to, subject, html, text, replyTo, attachments }) {
  const apiKey = process.env.RESEND_FFBB_KEY;
  if (!apiKey) throw new Error("Service e-mail non configuré.");
  const { error } = await new Resend(apiKey).emails.send({ from: FROM, to, subject, html, text, replyTo, ...(attachments ? { attachments } : {}) });
  if (error) throw new Error(error.message || "Échec de l'envoi.");
}
