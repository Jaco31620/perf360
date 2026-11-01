/*
 * Jukebox — messages prêts à envoyer (copier, partager, WhatsApp, SMS,
 * e-mail) : invitation de l'organisateur (super-admin, régie), code
 * d'activation, message pour les invités. Tous renvoient au mode d'emploi.
 */
const spaced = (c) => (c ? `${String(c).slice(0, 3)} ${String(c).slice(3)}` : "…");
const hostOf = (origin) => String(origin || "").replace(/^https?:\/\//, "");
export const helpUrl = (origin) => `${origin}/jukebox/aide`;

/* Organisateur d'une soirée déjà créée. */
export function inviteText({ origin, code, name, regieCode }) {
  const base = `${origin}/jukebox/${code}`;
  return [
    `🎶 Jukebox · « ${name} »`,
    "",
    "Votre soirée est prête ! Pour la piloter :",
    `📱 sur votre téléphone (télécommande) : ${base}/telecommande`,
    `💻 ou sur un ordinateur (régie) : ${base}/regie`,
    `🔑 Code régie, si on vous le demande : ${spaced(regieCode)}`,
    "",
    `📺 Pour la musique sur la télé : ouvrez ${hostOf(origin)}/tv dans son navigateur, puis « Connecter une télé » sur la télécommande.`,
    `❓ Mode d'emploi : ${helpUrl(origin)}`,
    "",
    `Les invités rejoignent avec le QR code affiché à l'écran, ou sur ${base} (code ${spaced(code)}). Gardez le code régie pour vous.`,
  ].join("\n");
}

/* Code d'activation : l'organisateur crée lui-même ses soirées. */
export function activationText({ origin, code, label, partiesText, expiresText, validText }) {
  return [
    `Bonjour ${label},`,
    "",
    `Voici votre code d'activation Jukebox : ${code}`,
    `Il vous permet de créer ${partiesText}${expiresText ? `, jusqu'au ${expiresText}` : ""}.`,
    ...(validText ? [`Chaque soirée reste ouverte ${validText} à partir de sa création.`] : []),
    "",
    `1. Créez votre soirée : ${origin}/jukebox?activation=${code}`,
    "2. Pilotez-la depuis votre téléphone (télécommande) ou un ordinateur (régie).",
    `3. Pour la musique sur la télé : ouvrez ${hostOf(origin)}/tv dans son navigateur et connectez-la depuis la télécommande.`,
    "",
    `❓ Mode d'emploi : ${helpUrl(origin)}`,
  ].join("\n");
}

/* Invités (groupe WhatsApp de la soirée…). */
export function guestText({ origin, code, name }) {
  return [
    `🎶 « ${name} » : c'est vous qui choisissez la musique !`,
    `Proposez vos titres ici 👉 ${origin}/jukebox/${code}`,
    `(ou code ${spaced(code)} sur ${hostOf(origin)}/jukebox)`,
  ].join("\n");
}
