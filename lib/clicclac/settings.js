/*
 * Clic-Clac — réglages d'album (module PUR, partagé client + serveur).
 * Deux familles de réglages :
 *  - SUPER : décidés par le super-admin (capacité, conservation, HD) ;
 *  - ADMIN : décidés par l'organisateur de l'album.
 */

export const FRAMES = [
  { id: "none", label: "Sans cadre" },
  { id: "polaroid", label: "Polaroïd" },
  { id: "band", label: "Bandeau" },
  { id: "film", label: "Pellicule" },
  { id: "neon", label: "Néon" },
  { id: "custom", label: "Cadre perso" },
];

export const FILTERS = [
  { id: "none", label: "Naturel" },
  { id: "nb", label: "Noir & blanc" },
  { id: "vintage", label: "Vintage" },
  { id: "chaud", label: "Chaud" },
  { id: "froid", label: "Froid" },
  { id: "contraste", label: "Contrasté" },
  { id: "doux", label: "Doux" },
];

/* off = désactivé · imposed = un seul, imposé · choice = l'invité choisit */
export const MODES = ["off", "imposed", "choice"];

export const DEFAULT_SETTINGS = {
  // super-admin
  maxPhotos: 300,
  retentionDays: 30,
  keepHd: false,
  // admin
  guestQuota: 20, // 0 = illimité (dans la limite de maxPhotos)
  moderation: false,
  framesMode: "choice",
  frames: ["none", "polaroid", "band", "film", "neon"],
  imposedFrame: "polaroid",
  filtersMode: "choice",
  filters: ["none", "nb", "vintage", "chaud", "froid", "contraste", "doux"],
  imposedFilter: "none",
  customFrame: null, // chemin Storage du cadre perso (PNG)
  stripEnabled: true,
  guestDownload: true,
};

export const SUPER_KEYS = ["maxPhotos", "retentionDays", "keepHd"];
export const ADMIN_KEYS = ["guestQuota", "moderation", "framesMode", "frames", "imposedFrame", "filtersMode", "filters", "imposedFilter", "stripEnabled", "guestDownload"];

const int = (v, d, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const pickIds = (list, all) => {
  const ids = all.map((x) => x.id);
  const out = Array.isArray(list) ? list.filter((x) => ids.includes(x)) : null;
  return out && out.length ? [...new Set(out)] : null;
};

export function normalizeSettings(raw) {
  const s = raw || {};
  const d = DEFAULT_SETTINGS;
  const frames = pickIds(s.frames, FRAMES) || d.frames;
  const filters = pickIds(s.filters, FILTERS) || d.filters;
  return {
    maxPhotos: int(s.maxPhotos, d.maxPhotos, 1, 5000),
    retentionDays: int(s.retentionDays, d.retentionDays, 1, 365),
    keepHd: typeof s.keepHd === "boolean" ? s.keepHd : d.keepHd,
    guestQuota: int(s.guestQuota, d.guestQuota, 0, 1000),
    moderation: typeof s.moderation === "boolean" ? s.moderation : d.moderation,
    framesMode: MODES.includes(s.framesMode) ? s.framesMode : d.framesMode,
    frames,
    imposedFrame: FRAMES.some((f) => f.id === s.imposedFrame) ? s.imposedFrame : d.imposedFrame,
    filtersMode: MODES.includes(s.filtersMode) ? s.filtersMode : d.filtersMode,
    filters,
    imposedFilter: FILTERS.some((f) => f.id === s.imposedFilter) ? s.imposedFilter : d.imposedFilter,
    customFrame: typeof s.customFrame === "string" && /^[\w/-]+\.png$/.test(s.customFrame) ? s.customFrame : null,
    stripEnabled: typeof s.stripEnabled === "boolean" ? s.stripEnabled : d.stripEnabled,
    guestDownload: typeof s.guestDownload === "boolean" ? s.guestDownload : d.guestDownload,
  };
}

/* Codes : alphabet sans caractères ambigus (0/O, 1/I/L). */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const isAlbumCode = (c) => new RegExp(`^[${CODE_ALPHABET}]{6}$`).test(String(c || ""));
export const normalizeCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export const MAX_NAME = 40;
export const MAX_CAPTION = 120;
