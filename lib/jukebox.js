/*
 * Jukebox — helpers PURS partagés client + serveur (aucun accès base ici).
 */

export const MAX_NAME_LEN = 80;
export const MAX_AUTHOR_LEN = 24;
export const MAX_QUERY_LEN = 80;
/* Au-delà, on refuse (mix d'une heure, live…). */
export const MAX_DURATION = 15 * 60;
export const DEFAULT_MAX_PER_PARTICIPANT = 3;

/* Titres en attente par participant ; 0 = illimité. */
export const MAX_CHOICES = [1, 2, 3, 5, 10, 0];
export const maxLabel = (n) => (n === 0 ? "Illimité" : String(n));
/* Garde-fou anti-abus en mode « illimité ». */
export const UNLIMITED_CAP = 50;

export function normalizeMax(v) {
  const n = parseInt(v, 10);
  if (n === 0) return 0;
  if (!Number.isFinite(n)) return DEFAULT_MAX_PER_PARTICIPANT;
  return Math.min(10, Math.max(1, n));
}

export const isValidCode = (code) => /^\d{6}$/.test(String(code || ""));
export const isValidVideoId = (id) => /^[\w-]{11}$/.test(String(id || ""));

/* Identifiant vidéo d'un lien YouTube / YouTube Music collé, sinon null. */
export function parseVideoId(input) {
  const s = String(input || "").trim();
  if (!/youtu\.?be/i.test(s)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const id = u.hostname.endsWith("youtu.be")
      ? u.pathname.slice(1, 12)
      : u.searchParams.get("v") || (u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/) || [])[1];
    return isValidVideoId(id) ? id : null;
  } catch (e) {
    return null;
  }
}

export function formatDuration(sec) {
  if (!sec && sec !== 0) return "";
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
