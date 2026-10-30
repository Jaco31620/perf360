/*
 * Jukebox — helpers PURS partagés client + serveur (aucun accès base ici).
 */

export const MAX_NAME_LEN = 80;
export const MAX_AUTHOR_LEN = 24;
export const MAX_QUERY_LEN = 80;
/* Au-delà, on refuse (mix d'une heure, live…). */
export const MAX_DURATION = 15 * 60;
/* En dessous, ce n'est pas une chanson (extrait, Short…). */
export const MIN_SONG_DURATION = 45;
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

/* Mode de recherche choisi par la régie : mot ajouté à chaque recherche. */
export const SEARCH_MODES = [
  { id: "normal", label: "Normale", suffix: "" },
  { id: "paroles", label: "Avec paroles", suffix: "paroles lyrics" },
  { id: "karaoke", label: "Karaoké", suffix: "karaoké" },
];
export const normalizeMode = (m) => (SEARCH_MODES.some((x) => x.id === m) ? m : "normal");

/* Fondu enchaîné entre deux titres (secondes, 0 = sans fondu). */
export const FADE_CHOICES = [0, 3, 5, 8, 12];
export const DEFAULT_FADE = 5;
export const normalizeFade = (v) => (FADE_CHOICES.includes(Number(v)) ? Number(v) : DEFAULT_FADE);

/* Dédicaces (si la régie les active). */
export const MAX_DEDICATION_LEN = 80;

/* Nom de l'invité qui a choisi le titre : affiché tout de suite, après N
 * secondes de lecture du titre (0 = tout de suite, -1 = jamais). Dans la
 * file, il n'est affiché qu'en mode « tout de suite ». */
export const AUTHOR_REVEAL_CHOICES = [
  { v: 0, label: "Tout de suite" },
  { v: 30, label: "Après 30 s de lecture" },
  { v: 60, label: "Après 1 min de lecture" },
  { v: 120, label: "Après 2 min de lecture" },
  { v: -1, label: "Jamais" },
];
export const normalizeReveal = (v) => (AUTHOR_REVEAL_CHOICES.some((c) => c.v === Number(v)) ? Number(v) : 0);

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

/* Fonctions activables par le super-admin, soirée par soirée (les soirées
 * créées par d'autres reçoivent les valeurs par défaut du super-admin). */
export const FEATURES = [
  { id: "history", label: "Historique", icon: "🕘", hint: "La régie voit les titres joués, les exporte et peut les rejouer." },
  { id: "theme", label: "Thème de soirée", icon: "🎨", hint: "Ambiance de couleurs, logo, titre et message d'accueil (écran et invités)." },
  { id: "blindtest", label: "Blind test", icon: "🕵️", hint: "Titres masqués, réponses des invités sur téléphone ou animation par la régie." },
];
export const DEFAULT_FEATURES = { history: true, theme: false, blindtest: false };
export function normalizeFeatures(f, base = DEFAULT_FEATURES) {
  const out = {};
  for (const { id } of FEATURES) out[id] = typeof f?.[id] === "boolean" ? f[id] : !!base[id];
  return out;
}
