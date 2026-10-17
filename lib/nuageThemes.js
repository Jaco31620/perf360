/*
 * Nuage de mots — thèmes (module PUR, partagé client + serveur).
 * Une palette a deux déclinaisons : `dark` (pour fond sombre) et `light` (pour
 * fond clair). Le fond choisi détermine la déclinaison, puis chaque couleur est
 * ajustée si besoin pour garantir un contraste lisible (≥ 3:1, gros texte WCAG).
 */

export const PALETTES = {
  vif: {
    label: "Vif",
    dark: ["#f87171", "#fb923c", "#facc15", "#4ade80", "#22d3ee", "#818cf8", "#e879f9", "#f472b6"],
    light: ["#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#4f46e5", "#c026d3", "#db2777"],
  },
  ocean: {
    label: "Océan",
    dark: ["#67e8f9", "#38bdf8", "#60a5fa", "#a5b4fc", "#5eead4", "#e0f2fe"],
    light: ["#0e7490", "#0369a1", "#1d4ed8", "#4338ca", "#0f766e", "#155e75"],
  },
  sunset: {
    label: "Coucher de soleil",
    dark: ["#fda4af", "#fb7185", "#fb923c", "#fbbf24", "#f472b6", "#fdba74"],
    light: ["#be123c", "#e11d48", "#c2410c", "#b45309", "#be185d", "#9a3412"],
  },
  foret: {
    label: "Forêt",
    dark: ["#86efac", "#4ade80", "#a3e635", "#fde68a", "#6ee7b7", "#d9f99d"],
    light: ["#15803d", "#166534", "#4d7c0f", "#a16207", "#047857", "#3f6212"],
  },
  berry: {
    label: "Fruits rouges",
    dark: ["#f0abfc", "#e879f9", "#c084fc", "#a78bfa", "#f9a8d4", "#fda4af"],
    light: ["#a21caf", "#86198f", "#7e22ce", "#6d28d9", "#be185d", "#9f1239"],
  },
  terre: {
    label: "Automne",
    dark: ["#fcd34d", "#fdba74", "#fca5a5", "#d6d3d1", "#bef264", "#fde68a"],
    light: ["#92400e", "#9a3412", "#b91c1c", "#57534e", "#4d7c0f", "#a16207"],
  },
  pastel: {
    label: "Pastel",
    dark: ["#fbcfe8", "#c7d2fe", "#bae6fd", "#bbf7d0", "#fef08a", "#fed7aa", "#ddd6fe"],
    light: ["#d0628a", "#6f77d6", "#3b93b8", "#38955f", "#a8861c", "#cf6a2c", "#8e63c4"],
  },
  neon: {
    label: "Néon",
    dark: ["#39ff14", "#00f0ff", "#ff2bd6", "#fff01f", "#ff7a1a", "#c04dff"],
    light: ["#0a8f00", "#008a99", "#c4009f", "#8a7d00", "#c24f00", "#7a00cc"],
  },
  seventies: {
    label: "Années 70",
    // couleurs exactes du logo « made in 1976 » : orange, jaune, moutarde, rouille, brun
    dark: ["#fd9f27", "#fde264", "#d1920f", "#d84f12", "#9a4512"],
    light: ["#d97706", "#a87b00", "#b06d00", "#c2410c", "#7c3410"],
  },
  mono: {
    label: "Monochrome",
    dark: ["#ffffff", "#cbd5e1", "#94a3b8", "#e2e8f0", "#64748b"],
    light: ["#0f172a", "#475569", "#1e293b", "#64748b", "#334155"],
  },
};

export const BACKGROUNDS = [
  { label: "Nuit", value: "#0f172a" },
  { label: "Noir", value: "#000000" },
  { label: "Marine", value: "#0b1d3a" },
  { label: "Aubergine", value: "#1e1033" },
  { label: "Sapin", value: "#0f2a1f" },
  { label: "Café", value: "#2b2118" },
  { label: "Années 70", value: "#27100a" },
  { label: "Blanc", value: "#ffffff" },
  { label: "Crème", value: "#fdf8ef" },
  { label: "Brume", value: "#eef2f7" },
  { label: "Menthe", value: "#ecf7f0" },
  { label: "Rose poudré", value: "#fcf0f3" },
  { label: "Sable", value: "#f4ead5" },
  { label: "Crème 70", value: "#f6e3bd" },
];

export const DEFAULT_STYLE = { palette: "vif", bg: "#0f172a" };

const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ""));

/* Nettoie un style venant du client ou de la base. */
export function normalizeStyle(style) {
  const s = style || {};
  return {
    palette: PALETTES[s.palette] ? s.palette : DEFAULT_STYLE.palette,
    bg: isHex(s.bg) ? s.bg.toLowerCase() : DEFAULT_STYLE.bg,
  };
}

/* ── Couleurs ─────────────────────────────────────────────────── */
const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const mix = (hex, target, t) => {
  const a = toRgb(hex), b = toRgb(target);
  return toHex(a.map((v, i) => v + (b[i] - v) * t));
};

/* Éclaircit (fond sombre) ou fonce (fond clair) jusqu'au contraste minimal. */
function ensureContrast(color, bg, dark, min = 3) {
  let c = color;
  for (let t = 0.1; contrast(c, bg) < min && t <= 1; t += 0.1) c = mix(color, dark ? "#ffffff" : "#000000", t);
  return c;
}

const rgba = (hex, a) => `rgba(${toRgb(hex).join(",")},${a})`;

/* Style → couleurs effectives (fond, texte d'interface, mots). */
export function resolveTheme(style) {
  const { palette, bg } = normalizeStyle(style);
  const dark = luminance(bg) < 0.35;
  const fg = dark ? "#f8fafc" : "#0f172a";
  return {
    bg,
    dark,
    fg,
    sub: rgba(fg, 0.6),
    panel: rgba(fg, 0.09),
    colors: PALETTES[palette][dark ? "dark" : "light"].map((c) => ensureContrast(c, bg, dark)),
  };
}
