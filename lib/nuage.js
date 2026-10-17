/*
 * Nuage de mots — helpers PURS partagés client + serveur (aucun accès base ici).
 */

export const MAX_WORD_LEN = 30;
export const MAX_QUESTION_LEN = 200;
export const DEFAULT_MAX_PER_PARTICIPANT = 3;

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
