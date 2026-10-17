/*
 * Nuage de mots — helpers PURS partagés client + serveur (aucun accès base ici).
 */

export const MAX_WORD_LEN = 30;
export const MAX_QUESTION_LEN = 200;
export const DEFAULT_MAX_PER_PARTICIPANT = 3;

/* Choix proposés pour le nombre de mots par participant ; 0 = illimité. */
export const MAX_CHOICES = [1, 2, 3, 4, 5, 10, 0];
export const maxLabel = (n) => (n === 0 ? "Illimité" : String(n));
/* Garde-fou anti-abus en mode « illimité » (invisible pour un usage normal). */
export const UNLIMITED_CAP = 100;

export function normalizeMax(v) {
  const n = parseInt(v, 10);
  if (n === 0) return 0;
  if (!Number.isFinite(n)) return DEFAULT_MAX_PER_PARTICIPANT;
  return Math.min(10, Math.max(1, n));
}

/* Nettoie la saisie brute : espaces multiples, longueur max. */
export function cleanWord(raw) {
  return String(raw || "").replace(/\s+/g, " ").trim().slice(0, MAX_WORD_LEN);
}

/* Clé de regroupement : « Énergie », « energie » et « ÉNERGIE » comptent ensemble. */
export function wordKey(raw) {
  return cleanWord(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,;:!?'"«»()]+$/g, "")
    .trim();
}

export function isValidCode(code) {
  return /^\d{6}$/.test(String(code || ""));
}
