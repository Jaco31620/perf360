/*
 * Rendu de l'e-mail de bienvenue FFBB × BLACKROLL — module PUR (pas de React,
 * pas de "use client"). Importé à la fois par la route serveur (/api/ffbb/send)
 * et par l'aperçu de l'admin, pour que l'aperçu soit identique à l'e-mail envoyé.
 *
 * Le corps (bodyHtml) est du HTML déjà « rempli » (variables remplacées). Comme
 * il est rédigé par l'admin (source de confiance) via l'éditeur WYSIWYG, il est
 * inséré tel quel dans le gabarit, habillé d'un en-tête co-brandé et d'un footer.
 */

export const isHttpUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || "").trim());

export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* Détecte un contenu déjà HTML (au moins une balise). Sert aux migrations. */
export const looksLikeHtml = (s) => /<[a-z][\s\S]*>/i.test(String(s || ""));

/* Version texte brut (fallback) à partir du HTML du corps. */
export function htmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* Bouton CTA (table-based pour compatibilité clients mail), seulement si URL http(s). */
function ctaButtonHtml(ctaUrl, ctaLabel) {
  if (!isHttpUrl(ctaUrl)) return "";
  const href = escapeHtml(String(ctaUrl).trim());
  const text = escapeHtml(ctaLabel && String(ctaLabel).trim() ? ctaLabel : "Profiter de mon code");
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto 4px"><tr><td>` +
    `<a href="${href}" style="display:inline-block;background:#1BE299;color:#0A0A0A;` +
    `font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;` +
    `text-decoration:none;padding:14px 28px;border-radius:999px">${text}</a>` +
    `</td></tr></table>`
  );
}

/* E-mail complet : en-tête co-brandé sombre + carte crème (corps) + bouton + footer. */
export function buildEmailHtml(bodyHtml, ctaUrl, ctaLabel) {
  const cta = ctaButtonHtml(ctaUrl, ctaLabel);
  return (
    `<!DOCTYPE html><html lang="fr"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `</head><body style="margin:0;padding:0;background:#0A0A0A;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;padding:28px 12px">` +
    `<tr><td align="center">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px">` +
    `<tr><td align="center" style="padding:4px 0 22px;font-family:Helvetica,Arial,sans-serif;` +
    `font-size:21px;font-weight:800;letter-spacing:-0.5px;color:#FEFFF0">` +
    `FFBB <span style="color:#1BE299">&#215;</span> BLACKROLL<sup style="font-size:9px">&#174;</sup>` +
    `</td></tr>` +
    `<tr><td style="background:#FEFFF0;border-radius:22px;padding:30px 28px;` +
    `font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#161614">` +
    `${bodyHtml}` +
    (cta ? `<div style="text-align:center">${cta}</div>` : "") +
    `</td></tr>` +
    `<tr><td align="center" style="padding:18px 8px 0;font-family:Helvetica,Arial,sans-serif;` +
    `font-size:12px;line-height:1.5;color:#8c8c84">` +
    `Dispositif licenci&#233;s FFBB &#215; BLACKROLL.` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
