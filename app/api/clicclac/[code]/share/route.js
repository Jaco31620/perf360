/* Organisateur — envoi du lien de l'album par e-mail (10 destinataires max). */
import { loadAlbum, roleFor, canAdmin } from "@/lib/clicclac/server";
import { sendMail, wrapHtml, esc, isEmail, SITE } from "@/lib/clicclac/mail";

export const runtime = "nodejs";

export async function POST(req, { params }) {
  const { code } = await params;
  let b;
  try { b = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  const to = [...new Set((Array.isArray(b?.to) ? b.to : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  if (!to.length || to.length > 10) return Response.json({ error: "1 à 10 destinataires." }, { status: 400 });
  const bad = to.filter((e) => !isEmail(e));
  if (bad.length) return Response.json({ error: `Adresse invalide : ${bad.join(", ")}` }, { status: 400 });
  const message = String(b?.message || "").trim().slice(0, 1000);
  try {
    const a = await loadAlbum(code);
    if (!a) return Response.json({ error: "Album introuvable." }, { status: 404 });
    if (!canAdmin(roleFor(req, a))) return Response.json({ error: "Accès refusé." }, { status: 401 });
    const link = `${SITE}/clic-clac/${a.code}`;
    await sendMail({
      to,
      replyTo: isEmail(b?.replyTo) ? b.replyTo.trim() : undefined,
      subject: `📸 Les photos de « ${a.name} »`,
      html: wrapHtml(`Les photos de « ${a.name} »`, `
        ${message ? `<p style="white-space:pre-wrap">${esc(message)}</p>` : ""}
        <p>Retrouvez et téléchargez les photos de l'événement :</p>
        <p><a href="${link}" style="display:inline-block;background:#ff5a5f;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px">Voir l'album</a></p>
        <p style="color:#666">Code de l'album : <b style="letter-spacing:2px">${esc(a.code)}</b></p>`),
      text: `${message ? message + "\n\n" : ""}Les photos de « ${a.name} » : ${link} (code ${a.code})`,
    });
    return Response.json({ ok: true, sent: to.length });
  } catch (e) {
    console.error("clicclac share:", e);
    return Response.json({ error: e.message || "Envoi impossible." }, { status: 502 });
  }
}
