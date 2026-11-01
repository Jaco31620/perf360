/*
 * Jukebox — demande d'accès (accueil /jukebox) : e-mail au propriétaire, qui
 * la valide en un clic (super-admin › Demandes : code d'activation créé et
 * envoyé par e-mail). Sans la table v23 : e-mail seul, réponse à la main.
 * Pot de miel + limite par adresse IP. L'adresse du propriétaire reste côté serveur.
 */
import { sendMail, esc, isEmail, OWNER_EMAIL } from "@/lib/clicclac/mail";
import { tooMany, clientIp } from "@/lib/jukeboxRate";
import { createRequest } from "@/lib/jukeboxRequests";
import { fmtDateFr } from "@/lib/dates";

export const runtime = "nodejs";

const ADMIN = "https://perf360.fr/jukebox/admin"; // domaine habituel : session super-admin déjà ouverte

const clip = (v, n) => String(v || "").trim().slice(0, n);

export async function POST(req) {
  let b;
  try { b = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  if (b?.website) return Response.json({ ok: true }); // pot de miel anti-robots
  const name = clip(b?.name, 80);
  const email = clip(b?.email, 120);
  const date = clip(b?.date, 60);
  const guests = clip(b?.guests, 40);
  const message = clip(b?.message, 2000);
  if (!name || !isEmail(email))
    return Response.json({ error: "Merci d'indiquer votre nom et un e-mail valide." }, { status: 400 });
  if (await tooMany(`contact:${clientIp(req)}`, 5, 3600))
    return Response.json({ error: "Trop de demandes, réessayez plus tard." }, { status: 429 });
  const id = await createRequest({ name, email, date, guests, message });
  const rows = [["E-mail", email], ["Date de la soirée", fmtDateFr(date)], ["Invités", guests]].filter(([, v]) => v);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;max-width:600px;margin:0 auto">
  <div style="font-size:22px;font-weight:800;color:#c026d3;margin-bottom:6px">🎶 Jukebox</div>
  <h2 style="margin:0 0 14px">Demande d'accès de ${esc(name)}</h2>
  ${rows.map(([k, v]) => `<p style="margin:4px 0"><b>${k} :</b> ${esc(v)}</p>`).join("")}
  ${message ? `<p style="white-space:pre-wrap;margin-top:12px">${esc(message)}</p>` : ""}
  ${id
    ? `<p style="margin-top:20px"><a href="${ADMIN}?demande=${id}" style="display:inline-block;background:#c026d3;color:#fff;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:999px">Voir et valider la demande</a></p>
  <p style="color:#666;font-size:13px">La validation crée le code d'activation et l'envoie par e-mail à ${esc(email)}.</p>`
    : `<p style="margin-top:18px">Pour répondre : <a href="${ADMIN}">super-admin</a> › Codes › créer un code puis 📨 Envoyer.</p>`}
  <p style="margin-top:22px;color:#999;font-size:12px">Jukebox · perf360</p>
</div>`;
  try {
    await sendMail({
      from: "Jukebox <noreply@perf360.fr>",
      to: OWNER_EMAIL,
      replyTo: email,
      subject: `Jukebox — demande d'accès de ${name}`,
      html,
      text: `De : ${name} <${email}>\n${rows.slice(1).map(([k, v]) => `${k} : ${v}`).join("\n")}\n\n${message}${id ? `\n\nValider : ${ADMIN}?demande=${id}` : ""}`,
    });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("jukebox contact:", e);
    return Response.json({ error: "Envoi impossible pour le moment." }, { status: 502 });
  }
}
