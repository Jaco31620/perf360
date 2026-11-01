/*
 * Jukebox — helpers PURS partagés client + serveur (aucun accès base ici).
 */

import { normalizeBlind } from "@/lib/jukeboxBlind";

export const MAX_NAME_LEN = 80;

/* Conservation d'une soirée : supprimée N jours après sa dernière activité.
 * Réglage global (super-admin), ou propre à un code d'activation (hérité par
 * ses soirées) ou à une soirée (options.retentionDays). */
export const RETENTION_CHOICES = [1, 2, 3, 7, 14, 30, 90, 365];
export const retentionLabel = (n) => (n >= 365 ? "1 an" : n >= 90 ? "3 mois" : `${n} jour${n > 1 ? "s" : ""}`);
export const cleanRetention = (v) => (RETENTION_CHOICES.includes(Number(v)) ? Number(v) : null);
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

/* Mode de recherche choisi par la régie : mot ajouté à chaque recherche.
 * Normale : la recherche favorise les versions avec les paroles à l'écran
 * (le clip si aucune ne convient) ; l'ancien mode « Avec paroles » y est
 * ramené. */
export const SEARCH_MODES = [
  { id: "normal", label: "Normale", suffix: "paroles lyrics" },
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

/* Thème de soirée (fonction « theme ») : ambiance de couleurs, titre et
 * message d'accueil, logo (version = horodatage, image servie par
 * /api/jukebox/<code>/logo). Chaque ambiance fixe des variables CSS :
 * fond de la page invités et de l'écran, couleur d'accent, accent clair
 * (texte sur fond sombre), accent pâle (fond de ligne). */
export const THEMES = [
  { id: "festif", label: "Festif", guestBg: "linear-gradient(135deg,#c026d3,#7e22ce 50%,#312e81)", screenBg: "linear-gradient(135deg,rgba(112,26,117,.4),transparent 50%,rgba(30,27,75,.7))", accent: "#c026d3", accent2: "#4f46e5", light: "#f0abfc", soft: "#fdf4ff" },
  { id: "neon", label: "Néon", guestBg: "linear-gradient(135deg,#0f0c29,#302b63 55%,#0e7490)", screenBg: "linear-gradient(135deg,rgba(14,116,144,.45),transparent 50%,rgba(15,12,41,.85))", accent: "#0891b2", accent2: "#db2777", light: "#67e8f9", soft: "#ecfeff" },
  { id: "dore", label: "Doré", guestBg: "linear-gradient(135deg,#1c1917,#44403c 55%,#a16207)", screenBg: "linear-gradient(135deg,rgba(161,98,7,.45),transparent 50%,rgba(12,10,9,.85))", accent: "#b45309", accent2: "#78350f", light: "#fcd34d", soft: "#fffbeb" },
  { id: "pastel", label: "Pastel", guestBg: "linear-gradient(135deg,#f9a8d4,#c4b5fd 50%,#a5f3fc)", screenBg: "linear-gradient(135deg,rgba(244,114,182,.45),transparent 50%,rgba(129,140,248,.55))", accent: "#db2777", accent2: "#7c3aed", light: "#fbcfe8", soft: "#fdf2f8" },
  { id: "tropical", label: "Tropical", guestBg: "linear-gradient(135deg,#f97316,#e11d48 50%,#0f766e)", screenBg: "linear-gradient(135deg,rgba(249,115,22,.4),transparent 50%,rgba(15,118,110,.7))", accent: "#ea580c", accent2: "#0f766e", light: "#fdba74", soft: "#fff7ed" },
  { id: "nuit", label: "Nuit", guestBg: "linear-gradient(135deg,#020617,#1e293b 55%,#1e3a8a)", screenBg: "linear-gradient(135deg,rgba(30,58,138,.45),transparent 50%,rgba(2,6,23,.85))", accent: "#2563eb", accent2: "#475569", light: "#93c5fd", soft: "#eff6ff" },
];
export const MAX_THEME_TITLE_LEN = 60;
export const MAX_THEME_MESSAGE_LEN = 160;
export const MAX_LOGO_BYTES = 400 * 1024;
export function normalizeTheme(t) {
  return {
    palette: THEMES.some((x) => x.id === t?.palette) ? t.palette : "festif",
    title: String(t?.title || "").replace(/\s+/g, " ").trim().slice(0, MAX_THEME_TITLE_LEN),
    message: String(t?.message || "").trim().slice(0, MAX_THEME_MESSAGE_LEN),
    logo: Number(t?.logo) > 0 ? Number(t.logo) : null,
  };
}
/* Variables CSS d'une ambiance (thème désactivé : « festif », les couleurs d'origine). */
export function themeVars(theme) {
  const p = THEMES.find((x) => x.id === theme?.palette) || THEMES[0];
  return { "--jb-guest-bg": p.guestBg, "--jb-screen-bg": p.screenBg, "--jb-accent": p.accent, "--jb-accent2": p.accent2, "--jb-light": p.light, "--jb-soft": p.soft };
}

/* Réglages de départ des nouvelles soirées, choisis dans le super-admin :
 * réglages de la régie, limite par invité, ambiance (si thème activé) et
 * blind test (s'il est activé). La régie peut ensuite tout changer. */
export const SOIREE_DEFAULTS = {
  maxPerParticipant: DEFAULT_MAX_PER_PARTICIPANT, searchMode: "normal", fade: DEFAULT_FADE, authorReveal: 0,
  dedications: false, fairQueue: true, screenQueue: true, guestQueue: true, palette: THEMES[0].id,
  blind: { mode: "phone", reveal: 30, after: 10, lang: "all", decades: [], validated: false },
};
export function normalizeDefaults(v, base = SOIREE_DEFAULTS) {
  const pick = (k) => (v && k in v ? v[k] : base[k]);
  const out = {
    maxPerParticipant: normalizeMax(pick("maxPerParticipant")),
    searchMode: normalizeMode(pick("searchMode")),
    fade: normalizeFade(pick("fade")),
    authorReveal: normalizeReveal(pick("authorReveal")),
    palette: THEMES.some((t) => t.id === pick("palette")) ? pick("palette") : THEMES[0].id,
  };
  for (const k of ["dedications", "fairQueue", "screenQueue", "guestQueue"]) out[k] = !!pick(k);
  const { mode, reveal, after, lang, decades, validated } = normalizeBlind({ ...base.blind, ...v?.blind });
  out.blind = { mode, reveal, after, lang, decades, validated };
  return out;
}

/* ---------- Libellés propres ----------
 * Affichage des titres sans les mentions de version (« Radio Edit »,
 * « Remasterisé en 2006 », « Ragga Mix »…), le « feat. » étant gardé, et sans
 * les noms tout en majuscules (« MAGIC SYSTEM » → « Magic System » ; un seul
 * mot comme « ABBA » ou « IAM » reste tel quel). Le libellé Deezer d'origine
 * reste en mémoire ; une correction à la main (super-admin) l'emporte. */
const VERSION_RE = /\b(radio|edit|remaster\w*|mix|version|original|single|album|mono|st[eé]r[eé]o|bonus|extended|deluxe|19\d\d|20\d\d)\b/i;
const FEAT_RE = /\b(feat\.?|ft\.?|featuring)\s.*$/i;
const SMALL_WORDS = new Set(["de", "des", "du", "la", "le", "les", "et", "the", "of", "and", "a", "à", "en", "in", "on", "l", "d"]);

export function tidyCase(s) {
  s = String(s || "").trim();
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (letters.length < 4 || letters !== letters.toUpperCase() || !/\s/.test(s)) return s;
  let first = true;
  return s.toLowerCase().replace(/[\p{L}]+/gu, (w, at, all) => {
    const prev = all[at - 1], next = all[at + w.length];
    let out;
    if (prev === "'" || prev === "’") out = w; // « qu'on », « l'amour »
    else if (!first && (SMALL_WORDS.has(w) || ((next === "'" || next === "’") && w.length <= 2))) out = w; // « des », « s'attache »
    else if (w.length <= 2 && next !== "'" && next !== "’" && !SMALL_WORDS.has(w)) out = w.toUpperCase(); // DJ, MC
    else out = w[0].toUpperCase() + w.slice(1);
    first = false;
    return out;
  });
}

export function tidyTitle(s) {
  const t = String(s || "")
    .replace(/\s*[([]([^)\]]*)[)\]]/g, (m, inner) => {
      if (!VERSION_RE.test(inner)) return m;
      const feat = inner.match(FEAT_RE);
      return feat ? ` (${feat[0]})` : "";
    })
    .replace(/\s+[-–—]\s+([^-–—]*)$/, (m, tail) => (VERSION_RE.test(tail) ? "" : m))
    .trim();
  return tidyCase(t || s);
}
export const tidyArtist = tidyCase;

/* Interprète et titre affichés d'une ligne de la mémoire. */
export function songText(r) {
  const [a, ...rest] = String(r?.label || "").split(" – ");
  return {
    artist: r?.artist_fix || tidyArtist(rest.length ? a : ""),
    title: r?.title_fix || tidyTitle(rest.length ? rest.join(" – ") : r?.label || ""),
  };
}

/* Partie jouée d'un titre (rognage, lib/jukeboxTrim.js) : de `start` à `end`
 * en secondes de la vidéo ; `length` = durée affichée. Sans rognage : toute
 * la vidéo. */
/* « Renvoyer le son sur la télé » : demande valable ce temps-là (ms). */
export const HANDOFF_MS = 30000;
export const TV_PAIRED_KEY = (code) => `jukebox:tvpaired:${code}`; // télé jumelée par perf360.fr/tv

export function playSpan(t) {
  const full = Number(t?.duration) || 0;
  const start = Math.max(0, Number(t?.start) || 0);
  const end = t?.end != null && t.end > start ? (full ? Math.min(t.end, full) : t.end) : full;
  return { start, end, length: Math.max(0, end - start), trimmed: start > 0 || (t?.end != null && t.end < full) };
}
