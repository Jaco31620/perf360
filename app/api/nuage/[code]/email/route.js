/*
 * Route serveur PRÉSENTATEUR — envoi de l'image du nuage par e-mail (Resend).
 * En-tête x-nuage-admin requis (pas de relais d'e-mails ouvert au public).
 * Body : { to: string[] (≤ 10), message?: string, replyTo?: string, image: base64 PNG }
 */
import { Resend } from "resend";
import { loadSession, checkToken } from "@/lib/nuageServer";

export const runtime = "nodejs";

const FROM = "perf360 — Nuage de mots <noreply@perf360.fr>";
const MAX_TO = 10;
const MAX_IMAGE = 4 * 1024 * 1024; // octets (base64 décodé)
const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function POST(req, { params }) {
  const { code } = await params;
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }

  const to = [...new Set((Array.isArray(body?.to) ? body.to : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  if (!to.length) return Response.json({ error: "Indiquez au moins une adresse e-mail." }, { status: 400 });
  if (to.length > MAX_TO) return Response.json({ error: `${MAX_TO} destinataires maximum.` }, { status: 400 });
  const bad = to.filter((e) => !isEmail(e));
  if (bad.length) return Response.json({ error: `Adresse invalide : ${bad.join(", ")}` }, { status: 400 });
  const replyTo = isEmail(body?.replyTo) ? String(body.replyTo).trim() : undefined;
  const message = String(body?.message || "").trim().slice(0, 1000);

  const image = Buffer.from(String(body?.image || ""), "base64");
  const isPng = image.length > 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) return Response.json({ error: "Image invalide." }, { status: 400 });
  if (image.length > MAX_IMAGE) return Response.json({ error: "Image trop lourde." }, { status: 413 });

  try {
    const s = await loadSession(code);
    if (!s) return Response.json({ error: "Nuage introuvable." }, { status: 404 });
    if (!checkToken(req.headers.get("x-nuage-admin"), s.admin_hash))
      return Response.json({ error: "Accès refusé." }, { status: 401 });

    const apiKey = process.env.RESEND_FFBB_KEY;
    if (!apiKey) return Response.json({ error: "Service e-mail non configuré." }, { status: 503 });

    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:640px;margin:0 auto">
  <h2 style="margin:0 0 12px">${esc(s.question)}</h2>
  ${message ? `<p style="margin:0 0 16px;line-height:1.5">${esc(message).replace(/\n/g, "<br>")}</p>` : ""}
  <img src="cid:nuage" alt="Nuage de mots" width="640" style="width:100%;max-width:640px;border-radius:8px;display:block">
  <p style="margin:16px 0 0;color:#888;font-size:12px">Image jointe en haute définition (1920×1080). Créé avec Nuage de mots — perf360.</p>
</div>`;
    const text = `${s.question}\n\n${message ? message + "\n\n" : ""}Le nuage de mots est en pièce jointe (PNG 1920×1080).`;

    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: FROM,
      to,
      replyTo,
      subject: `Nuage de mots — ${s.question}`.slice(0, 150),
      html,
      text,
      attachments: [
        { filename: `nuage-${code}.png`, content: image.toString("base64"), contentId: "nuage" },
      ],
    });
    if (error) {
      console.error("nuage email Resend:", error);
      return Response.json({ error: error.message || "Échec de l'envoi." }, { status: 502 });
    }
    return Response.json({ ok: true, sent: to.length });
  } catch (e) {
    console.error("nuage email:", e);
    return Response.json({ error: "Envoi impossible." }, { status: 502 });
  }
}
