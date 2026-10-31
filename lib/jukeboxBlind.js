/*
 * Jukebox — blind test : helpers PURS (client + serveur).
 *
 * Les titres sont toujours piochés au hasard dans la mémoire (filtres :
 * langue, décennies, vidéos validées).
 *
 * Correction des réponses : une seule saisie (« queen bohemian rhapsody »,
 * « Queen », « bohemian »…), comparée à l'artiste et au titre, sans tenir
 * compte des majuscules, accents, ponctuation, articles de tête (the, le,
 * la, les, l'), ni des mentions entre parenthèses / après « feat. » ou « - »
 * (Remastered, Radio Edit, Live…). Fautes de frappe tolérées selon la
 * longueur : 0 jusqu'à 4 lettres, 1 jusqu'à 8, 2 jusqu'à 15, puis 20 %.
 * Artiste : son nom de famille suffit (« Hallyday »), et pour un duo, l'un
 * des deux noms.
 */

export const BLIND_MODES = [
  { id: "phone", label: "Réponses sur téléphone", hint: "Les invités tapent leur réponse, les points sont comptés." },
  { id: "anim", label: "Animé par la régie", hint: "Sans téléphone : l'écran masque le titre jusqu'à ce que vous le dévoiliez." },
];
export const BLIND_REVEAL_CHOICES = [
  { v: 20, label: "Après 20 s" },
  { v: 30, label: "Après 30 s" },
  { v: 45, label: "Après 45 s" },
  { v: 60, label: "Après 1 min" },
  { v: 0, label: "À la main" },
];
export const BLIND_AFTER_CHOICES = [
  { v: 10, label: "10 s après la réponse" },
  { v: 20, label: "20 s après la réponse" },
  { v: 0, label: "Titre en entier" },
];
/* Filtres de la pioche dans la mémoire (titres enrichis : année, langue). */
export const BLIND_LANGS = [
  { id: "all", label: "Tous" },
  { id: "fr", label: "🇫🇷 Français" },
  { id: "intl", label: "🌍 International" },
];
export const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
export const decadeLabel = (d) => (d < 2000 ? `${String(d).slice(2)}'s` : `${d}'s`);
export const MAX_ANSWER_LEN = 120;
export const MAX_ATTEMPTS = 10; // essais par titre et par invité
export const POINTS_BASE = 50; // par élément trouvé (artiste, titre)
export const POINTS_SPEED = 50; // bonus de rapidité maximum, par élément
export const SPEED_WINDOW = 45; // secondes, si la réponse est dévoilée à la main

export function normalizeBlind(b) {
  return {
    on: !!b?.on,
    mode: BLIND_MODES.some((m) => m.id === b?.mode) ? b.mode : "phone",
    lang: BLIND_LANGS.some((l) => l.id === b?.lang) ? b.lang : "all",
    decades: Array.isArray(b?.decades) ? DECADES.filter((d) => b.decades.map(Number).includes(d)) : [], // vide : toutes
    validated: !!b?.validated, // vidéos validées à la main seulement
    reveal: BLIND_REVEAL_CHOICES.some((c) => c.v === Number(b?.reveal)) ? Number(b.reveal) : 30,
    after: BLIND_AFTER_CHOICES.some((c) => c.v === Number(b?.after)) ? Number(b.after) : 10,
    revealedId: typeof b?.revealedId === "string" ? b.revealedId : null, // titre dévoilé à la main
    revealedAt: Number(b?.revealedAt) || null,
  };
}

/* « Beyoncé » → « beyonce » ; (…), […], feat., « - Remastered »… retirés. */
export function cleanTitle(s) {
  return String(s || "")
    .replace(/\s*[([].*?[)\]]/g, " ")
    .replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/i, "")
    .replace(/\s+[-–—]\s+.*(remaster|version|edit|live|mix|remix|mono|stereo|acoustic|bonus|demo).*$/i, "");
}
export function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " et ")
    .replace(/['’`]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(the|le|la|les|l) /, "")
    .trim();
}

export const tolerance = (len) => (len <= 4 ? 0 : len <= 8 ? 1 : len <= 15 ? 2 : Math.floor(len * 0.2));

/* Distance d'édition : lettre en trop, en moins, changée ou deux lettres
 * inversées (« stromea ») = 1 faute. */
export function distance(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[m][n];
}

/* La saisie contient-elle `target` (déjà normalisé) ? On essaie chaque suite
 * de mots de la saisie de longueur voisine, espaces ignorés. */
function contains(answerWords, target) {
  if (!target) return false;
  const t = target.replace(/ /g, "");
  const k = target.split(" ").length;
  const tol = tolerance(t.length);
  for (let size = Math.max(1, k - 1); size <= k + 1; size++)
    for (let i = 0; i + size <= answerWords.length; i++)
      if (distance(answerWords.slice(i, i + size).join(""), t) <= tol) return true;
  return false;
}

/* Variantes acceptées pour l'artiste : nom complet, chacun des artistes d'un
 * duo, nom de famille (dernier mot, 4 lettres et plus). */
function artistVariants(artist) {
  const full = normalizeText(cleanTitle(artist));
  const out = new Set([full]);
  for (const part of String(artist || "").split(/\s*(?:,|&|\bet\b|\band\b|\bx\b|\bfeat\.?|\bft\.?|\bvs\.?)\s*/i)) {
    const n = normalizeText(part);
    if (!n) continue;
    out.add(n);
    const words = n.split(" ");
    if (words.length >= 2 && words[words.length - 1].length >= 4) out.add(words[words.length - 1]);
  }
  return [...out].filter(Boolean);
}

/* { artist: bool, title: bool } */
export function checkAnswer(answer, artist, title) {
  const words = normalizeText(answer).split(" ").filter(Boolean);
  if (!words.length) return { artist: false, title: false };
  return {
    artist: artistVariants(artist).some((v) => contains(words, v)),
    title: contains(words, normalizeText(cleanTitle(title))),
  };
}

/* Points d'un élément trouvé `elapsed` secondes après le début du titre. */
export function pointsFor(elapsed, window) {
  const w = window > 0 ? window : SPEED_WINDOW;
  return POINTS_BASE + Math.round(POINTS_SPEED * Math.max(0, 1 - elapsed / w));
}

/* Artiste et titre d'une vidéo YouTube ajoutée par lien (« Artiste - Titre
 * (Official Video) », chaîne « ArtisteVEVO » ou « Artiste - Topic »). */
export function splitVideoTitle(title, channel) {
  const m = String(title || "").match(/^(.+?)\s+[-–—|]\s+(.+)$/);
  if (m) return { artist: m[1], title: m[2] };
  return { artist: String(channel || "").replace(/VEVO$|\s*-\s*Topic$|\s*Official$/i, ""), title };
}
