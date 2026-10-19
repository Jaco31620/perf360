/* Page d'accueil Clic-Clac : formulaire « me contacter » → e-mail au propriétaire. */
import { sendMail, wrapHtml, esc, isEmail, OWNER_EMAIL } from "@/lib/clicclac/mail";

export const runtime = "nodejs";

export async function POST(req) {
  let b;
  try { b = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  if (b?.website) return Response.json({ ok: true }); // pot de miel anti-robots
  const name = String(b?.name || "").trim().slice(0, 80);
  const email = String(b?.email || "").trim().slice(0, 120);
  const message = String(b?.message || "").trim().slice(0, 2000);
  if (!name || !isEmail(email) || message.length < 5)
    return Response.json({ error: "Merci d'indiquer votre nom, un e-mail valide et un message." }, { status: 400 });
  try {
    await sendMail({
      to: OWNER_EMAIL,
      replyTo: email,
      subject: `Clic-Clac — demande de ${name}`,
      html: wrapHtml(`Nouvelle demande de ${name}`, `<p><b>E-mail :</b> ${esc(email)}</p><p style="white-space:pre-wrap">${esc(message)}</p>`),
      text: `De : ${name} <${email}>\n\n${message}`,
    });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("clicclac contact:", e);
    return Response.json({ error: "Envoi impossible pour le moment." }, { status: 502 });
  }
}
