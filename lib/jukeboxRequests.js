/*
 * Jukebox — demandes d'accès (formulaire de /jukebox, table v23
 * jukebox_requests). Le super-admin valide (code d'activation créé et envoyé
 * par e-mail au demandeur) ou refuse. Serveur uniquement.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createActivation } from "@/lib/jukeboxActivation";
import { activationText } from "@/lib/jukeboxMessages";
import { sendMail, esc, SITE } from "@/lib/clicclac/mail";

const FROM = "Jukebox <noreply@perf360.fr>";
const ORIGINS = ["https://perf360.fr", "https://www.perf360.fr", "https://perf360.vercel.app"];
export const siteOrigin = (o) => (ORIGINS.includes(o) ? o : SITE);

const out = (r) => ({
  id: r.id, name: r.name, email: r.email, date: r.event_date, guests: r.guests, message: r.message,
  status: r.status, activationId: r.activation_id, createdAt: r.created_at, handledAt: r.handled_at,
});

/* Nouvelle demande ; null si la table n'existe pas encore (SQL v23). */
export async function createRequest({ name, email, date, guests, message }) {
  const { data, error } = await getSupabaseAdmin().from("jukebox_requests")
    .insert({ name, email, event_date: date || null, guests: guests || null, message: message || null })
    .select("id").maybeSingle();
  if (error) { console.warn("jukebox request:", error.message); return null; }
  return data?.id || null;
}

/* En attente + les 30 dernières traitées ; null : table absente. */
export async function listRequests() {
  const sb = getSupabaseAdmin();
  const [p, h] = await Promise.all([
    sb.from("jukebox_requests").select("*").eq("status", "pending").order("created_at", { ascending: false }),
    sb.from("jukebox_requests").select("*").neq("status", "pending").order("handled_at", { ascending: false }).limit(30),
  ]);
  if (p.error) return null;
  return [...(p.data || []), ...(h.data || [])].map(out);
}

export class RequestError extends Error {}

/* Passe la demande de pending à `status` (une seule fois) et la renvoie. */
async function take(id, status) {
  const { data, error } = await getSupabaseAdmin().from("jukebox_requests")
    .update({ status, handled_at: new Date().toISOString() }).eq("id", id).eq("status", "pending").select("*");
  if (error) throw error;
  if (!data?.length) throw new RequestError("Demande introuvable ou déjà traitée.");
  return data[0];
}

const mailHtml = (text) => `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;max-width:600px;margin:0 auto">
  <div style="font-size:22px;font-weight:800;color:#c026d3;margin-bottom:12px">🎶 Jukebox</div>
  <div style="white-space:pre-wrap;line-height:1.5">${esc(text).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>')}</div>
  <p style="margin-top:22px;color:#999;font-size:12px">Jukebox · perf360</p>
</div>`;

/* Valider : code d'activation créé, e-mail au demandeur. */
export async function approveRequest({ id, label, maxParties, expiresAt, features, validDays, partiesText, expiresText, validText, origin }) {
  const r = await take(id, "approved");
  let activation;
  try {
    activation = await createActivation({ label: label || r.name, maxParties, expiresAt, features, validDays });
  } catch (e) {
    await getSupabaseAdmin().from("jukebox_requests").update({ status: "pending", handled_at: null }).eq("id", id);
    throw e;
  }
  await getSupabaseAdmin().from("jukebox_requests").update({ activation_id: activation.id }).eq("id", id);
  const text = activationText({ origin: siteOrigin(origin), code: activation.code, label: activation.label, partiesText, expiresText, validText });
  let mailError = null;
  try {
    await sendMail({ from: FROM, to: r.email, subject: "Votre accès Jukebox", text, html: mailHtml(text) });
  } catch (e) {
    console.error("jukebox approve mail:", e);
    mailError = e.message || "Envoi impossible.";
  }
  return { activation, email: r.email, mailError };
}

/* Refuser (avec un e-mail poli si demandé). */
export async function rejectRequest({ id, notify }) {
  const r = await take(id, "rejected");
  if (notify) {
    const text = `Bonjour ${r.name},\n\nMerci pour votre intérêt pour le Jukebox. Je ne peux malheureusement pas donner suite à votre demande pour le moment.\n\nBonne soirée !`;
    await sendMail({ from: FROM, to: r.email, subject: "Votre demande Jukebox", text, html: mailHtml(text) }).catch((e) => console.error("jukebox reject mail:", e));
  }
}

export async function deleteRequest(id) {
  const { error } = await getSupabaseAdmin().from("jukebox_requests").delete().eq("id", id);
  if (error) throw error;
}
