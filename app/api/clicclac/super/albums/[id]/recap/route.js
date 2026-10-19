/*
 * Super-admin — e-mail récapitulatif d'un album à l'organisateur.
 * Body : { to?, pin?, regenPin?, qr? (PNG base64), message? }
 *  - pin : code organisateur connu (juste après création) — vérifié avant envoi ;
 *  - regenPin : génère un nouveau code organisateur et l'inclut (l'ancien expire) ;
 *  - sinon le récap est envoyé sans code organisateur.
 *  - qr : QR code invités (rendu côté navigateur) joint en image.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isSuper, randomCode, sha256, checkPin } from "@/lib/clicclac/server";
import { normalizeSettings } from "@/lib/clicclac/settings";
import { sendMail, wrapHtml, esc, isEmail, OWNER_EMAIL, SITE } from "@/lib/clicclac/mail";

export const runtime = "nodejs";

const fmt = (d) => (d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }) : "");

export async function POST(req, { params }) {
  if (!isSuper(req)) return Response.json({ error: "Accès refusé." }, { status: 401 });
  const { id } = await params;
  let b;
  try { b = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  try {
    const sb = getSupabaseAdmin();
    const { data: a, error } = await sb.from("clicclac_albums").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!a) return Response.json({ error: "Album introuvable." }, { status: 404 });
    const to = String(b?.to || a.admin_email || "").trim();
    if (!isEmail(to)) return Response.json({ error: "Adresse de l'organisateur invalide." }, { status: 400 });

    let pin = null;
    if (b?.regenPin) {
      pin = randomCode(8); // enregistré seulement APRÈS un envoi réussi (sinon l'ancien code reste valable)
    } else if (b?.pin) {
      if (!checkPin(b.pin, a.admin_hash)) return Response.json({ error: "Ce code organisateur n'est plus valable." }, { status: 400 });
      pin = String(b.pin).toUpperCase().trim();
    }

    const s = normalizeSettings(a.settings);
    const guest = `${SITE}/clic-clac/${a.code}`, admin = `${guest}/admin`, live = `${guest}/live`;
    const qr = typeof b?.qr === "string" && /^[A-Za-z0-9+/=]+$/.test(b.qr) && b.qr.length < 400000 ? b.qr : null;
    const message = String(b?.message || "").trim().slice(0, 1000);
    const row = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#777;white-space:nowrap">${k}</td><td style="padding:4px 0"><b>${v}</b></td></tr>`;

    const html = wrapHtml(`Votre album « ${a.name} » est prêt`, `
      ${message ? `<p style="white-space:pre-wrap">${esc(message)}</p>` : ""}
      <h3 style="margin:22px 0 8px">📱 Pour les invités</h3>
      <p>Ils scannent le QR code (ou ouvrent le lien) et saisissent leur prénom — aucune application à installer.</p>
      <table>${row("Lien", `<a href="${guest}" style="color:#ff5a5f">${guest}</a>`)}${row("Code de l'album", `<span style="letter-spacing:3px;font-size:18px">${esc(a.code)}</span>`)}</table>
      ${qr ? `<p><img src="cid:qr" alt="QR code de l'album" width="220" height="220" style="border:1px solid #eee;border-radius:12px"></p><p style="color:#777;font-size:13px">Le QR code est aussi joint à cet e-mail, prêt à imprimer ou à afficher.</p>` : ""}
      <h3 style="margin:22px 0 8px">🔑 Votre espace organisateur</h3>
      <table>${row("Lien", `<a href="${admin}" style="color:#ff5a5f">${admin}</a>`)}${row("Code organisateur", pin ? `<span style="letter-spacing:3px;font-size:18px">${esc(pin)}</span>` : "celui qui vous a été communiqué")}</table>
      <p>Vous pourrez y valider les photos (si la modération est activée), régler cadres et filtres, ouvrir la <b>borne photo</b> sur une tablette ou un ordinateur, et <b>télécharger l'album complet</b>.</p>
      <h3 style="margin:22px 0 8px">📺 Écran live</h3>
      <p>Diaporama des photos en direct, à ouvrir sur une TV ou un vidéoprojecteur : <a href="${live}" style="color:#ff5a5f">${live}</a></p>
      <h3 style="margin:22px 0 8px">📋 Votre album</h3>
      <table>
        ${a.event_date ? row("Date", fmt(a.event_date)) : ""}
        ${row("Photos", `${s.maxPhotos} maximum`)}
        ${row("Par invité", s.guestQuota ? `${s.guestQuota} photos` : "illimité")}
        ${row("Modération", s.moderation ? "oui (photos validées avant publication)" : "non (publication directe)")}
        ${row("Haute définition", s.keepHd ? "conservée (pour impression)" : "non")}
        ${row("Suppression", `${fmt(a.expires_at)} — pensez à télécharger l'album avant (rappel envoyé 3 jours avant)`)}
      </table>
      <p style="margin-top:20px">Une question ? Répondez simplement à cet e-mail.</p>`);

    const text = `Votre album Clic-Clac « ${a.name} » est prêt.\n\nINVITÉS : ${guest} — code ${a.code}\nORGANISATEUR : ${admin} — code organisateur : ${pin || "celui qui vous a été communiqué"}\nÉCRAN LIVE : ${live}\n\nPhotos max : ${s.maxPhotos} · par invité : ${s.guestQuota || "illimité"} · suppression le ${fmt(a.expires_at)}.`;

    await sendMail({
      to,
      replyTo: OWNER_EMAIL,
      subject: `📸 Clic-Clac — votre album « ${a.name} »`,
      html,
      text,
      ...(qr ? { attachments: [{ filename: `qr-clic-clac-${a.code}.png`, content: qr, contentId: "qr" }, { filename: `qr-clic-clac-${a.code}.png`, content: qr }] } : {}),
    });
    const patch = {};
    if (b?.regenPin) patch.admin_hash = sha256(pin);
    if (!a.admin_email) patch.admin_email = to;
    if (Object.keys(patch).length) {
      const { error: e3 } = await sb.from("clicclac_albums").update(patch).eq("id", id);
      if (e3) throw e3;
    }
    return Response.json({ ok: true, to, pin: b?.regenPin ? pin : undefined });
  } catch (e) {
    console.error("clicclac recap:", e);
    return Response.json({ error: e.message || "Envoi impossible." }, { status: 502 });
  }
}
