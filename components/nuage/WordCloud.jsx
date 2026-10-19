"use client";
/*
 * Nuage de mots dynamique — placement maison en spirale (aucune dépendance).
 * Les mots les plus envoyés sont les plus gros et placés au centre. Les
 * collisions sont testées sur la FORME des lettres (grille de 4 px), pas sur un
 * rectangle : un petit mot peut se loger au-dessus de « pero » à côté du grand
 * « A » d'« Apero », sous un jambage, etc. Rendu en SVG (positionnement exact sur
 * la ligne de base) ; tailles et positions sont animées en CSS.
 */
import { useEffect, useMemo, useRef, useState } from "react";

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const DEFAULT_WEIGHT = 800;
const MAX_WORDS = 120;
const REF = 100; // taille de référence pour la mesure (les métriques sont proportionnelles)

/* Marge autour de chaque mot : de l'air entre les mots, sans gaspiller de place
 * autour des très gros mots. */
const marginFor = (size) => 4 + size * 0.07;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/* Boîte d'encre du mot à la taille REF : largeur, dépassement à gauche,
 * hauteur au-dessus (ascent) et en dessous (descent) de la ligne de base. */
let _ctx = null;
const _metrics = new Map();
function metrics(text, weight) {
  const key = `${weight}|${text}`;
  let m = _metrics.get(key);
  if (m) return m;
  if (!_ctx) _ctx = document.createElement("canvas").getContext("2d");
  _ctx.font = `${weight} ${REF}px ${FONT}`;
  const t = _ctx.measureText(text);
  const left = Number.isFinite(t.actualBoundingBoxLeft) ? t.actualBoundingBoxLeft : 0;
  const right = Number.isFinite(t.actualBoundingBoxRight) ? t.actualBoundingBoxRight : t.width;
  m = {
    left,
    w: left + right,
    asc: Number.isFinite(t.actualBoundingBoxAscent) ? t.actualBoundingBoxAscent : REF * 0.75,
    desc: Number.isFinite(t.actualBoundingBoxDescent) ? t.actualBoundingBoxDescent : REF * 0.22,
  };
  _metrics.set(key, m);
  return m;
}

/* ── Masques de lettres ────────────────────────────────────────────
 * Chaque mot est dessiné dans un canevas puis réduit en une grille de cases
 * de CELL px : case pleine = de l'encre. Le masque est ensuite « dilaté » de
 * la marge du mot, ce qui garantit l'espace minimal entre deux mots. */
const CELL = 4;
let _rctx = null;
const _masks = new Map();
function wordMask(text, size, weight, mt, m) {
  const key = `${weight}|${size.toFixed(2)}|${text}`;
  let mask = _masks.get(key);
  if (mask) return mask;
  const k = size / REF;
  const cw = Math.ceil((mt.w * k + 2 * m) / CELL), ch = Math.ceil(((mt.asc + mt.desc) * k + 2 * m) / CELL);
  const pw = cw * CELL, ph = ch * CELL;
  if (!_rctx) _rctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const cv = _rctx.canvas;
  if (cv.width < pw) cv.width = pw;
  if (cv.height < ph) cv.height = ph;
  _rctx.clearRect(0, 0, pw, ph);
  _rctx.font = `${weight} ${size}px ${FONT}`;
  _rctx.fillStyle = "#000";
  _rctx.textBaseline = "alphabetic";
  _rctx.fillText(text, m + mt.left * k, m + mt.asc * k);
  const data = _rctx.getImageData(0, 0, pw, ph).data;
  const ink = new Uint8Array(cw * ch);
  for (let y = 0; y < ph; y++) {
    const row = ((y / CELL) | 0) * cw;
    for (let x = 0; x < pw; x++) if (data[(y * pw + x) * 4 + 3] > 40) ink[row + ((x / CELL) | 0)] = 1;
  }
  // dilatation (séparable) de mc cases = la marge
  const mc = Math.max(1, Math.round(m / CELL));
  const tmp = new Uint8Array(cw * ch), dil = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (ink[y * cw + x])
    for (let d = Math.max(0, x - mc); d <= Math.min(cw - 1, x + mc); d++) tmp[y * cw + d] = 1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (tmp[y * cw + x])
    for (let d = Math.max(0, y - mc); d <= Math.min(ch - 1, y + mc); d++) dil[d * cw + x] = 1;
  // segments horizontaux du masque dilaté (test de collision rapide)
  const runs = [];
  for (let y = 0; y < ch; y++) {
    let x = 0;
    while (x < cw) {
      if (!dil[y * cw + x]) { x++; continue; }
      const x0 = x;
      while (x < cw && dil[y * cw + x]) x++;
      runs.push(y, x0, x - 1);
    }
  }
  mask = { cw, ch, ink, runs };
  if (_masks.size > 3000) _masks.clear();
  _masks.set(key, mask);
  return mask;
}

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/* Effet « nuage » : on interdit les alignements entre voisins.
 * - Côte à côte (même hauteur, proches horizontalement) : ligne de base ou
 *   centre vertical identiques → effet « lignes de texte ».
 * - Empilés (même zone horizontale, proches verticalement) : bord gauche, bord
 *   droit ou centre identiques → effet « colonne ».
 * Les bords sont ceux des lettres (marges exclues). */
/* Intensité de l'« effet nuage » (réglage Style) :
 *   row / col   : décalage minimal (vertical / horizontal), en fraction de la plus petite taille
 *   rowReach / colReach : distance jusqu'à laquelle deux mots comptent comme voisins
 *   budget      : jusqu'où chercher une place décalée avant d'accepter une place alignée */
const EFFECTS = {
  low: { row: 0.2, rowReach: 0.8, col: 0.3, colReach: 0.8, budget: [1.1, 16] },
  medium: { row: 0.45, rowReach: 2, col: 0.6, colReach: 1.2, budget: [1.3, 40] },
  high: { row: 0.6, rowReach: 2.5, col: 0.8, colReach: 1.6, budget: [2, 120] },
};

/* Écart d'alignement avec le voisin le plus « aligné », en fraction du
 * décalage minimal exigé : ≥ 1 = bien décalé, 0 = parfaitement aligné. */
function alignment(box, by, size, others, fx) {
  const cy = box.y + box.h / 2;
  const mb = marginFor(size);
  const l = box.x + mb, r = box.x + box.w - mb;
  let worst = Infinity;
  for (const q of others) {
    const v = pairAlignment(q);
    if (v < worst) worst = v;
    if (worst === 0) break;
  }
  return worst;

  function pairAlignment(q) {
    const s = Math.min(size, q.size);
    const sameRow = !(box.y >= q.y + q.h || q.y >= box.y + box.h);
    const sameCol = !(box.x >= q.x + q.w || q.x >= box.x + box.w);
    if (sameRow) {
      const hg = Math.max(0, q.x - (box.x + box.w), box.x - (q.x + q.w));
      if (hg > s * fx.rowReach) return Infinity; // trop loin pour former une « ligne »
      const tol = s * fx.row;
      return Math.min(Math.abs(by - q.by), Math.abs(cy - (q.y + q.h / 2))) / tol;
    }
    if (sameCol) {
      const vg = Math.max(0, q.y - (box.y + box.h), box.y - (q.y + q.h));
      if (vg > s * fx.colReach) return Infinity; // trop loin pour former une « colonne »
      const mq = marginFor(q.size);
      const ql = q.x + mq, qr = q.x + q.w - mq;
      const tol = s * fx.col;
      return Math.min(Math.abs(l - ql), Math.abs(r - qr), Math.abs((l + r) - (ql + qr)) / 2) / tol;
    }
    return Infinity;
  }
}


/* Distance entre deux rectangles (0 s'ils se touchent). */
const gap = (a, b) => Math.hypot(
  Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)),
  Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)),
);

/* Place les mots (triés par fréquence décroissante) ; renvoie null si l'un ne rentre pas. */
/* Zone d'impression : ellipse centrée dont la taille suit le nombre de mots
 * (petite avec peu de mots → mots de taille raisonnable ; ≈ tout l'écran à
 * partir de ~35 mots). Légèrement plus grande que l'écran au maximum, pour que
 * les coins ne restent pas complètement vides. */
function ellipseFor(n, W, H) {
  const k = Math.min(1, 0.25 + 0.75 * Math.sqrt(n / 40)) * 1.1;
  return { cx: W / 2, cy: H / 2, rx: (W / 2) * k, ry: (H / 2) * k };
}
/* Taille maximale du plus gros mot : modeste avec peu de mots. */
const maxFontFor = (n, H) => H * (0.14 + 0.18 * Math.min(1, n / 12));
const ellNorm = (e, x, y) => Math.hypot((x - e.cx) / e.rx, (y - e.cy) / e.ry);
const insideEllipse = (e, b) =>
  ellNorm(e, b.x, b.y) <= 1 && ellNorm(e, b.x + b.w, b.y) <= 1 && ellNorm(e, b.x, b.y + b.h) <= 1 && ellNorm(e, b.x + b.w, b.y + b.h) <= 1;

function tryLayout(words, W, H, maxFont, minFont, maxN, allowDrop, { weight, stretch, spread, fx, obstacles = [], ellipse }) {
  const placed = [];
  const cx = W / 2, cy = H / 2;
  const sa = Math.sqrt((W / H) * stretch); // ellipse de la spirale
  const rMax = Math.max(W / sa, H * sa) * 1.05;
  let failed = false;
  // grille d'occupation de l'écran (encre des mots déjà placés)
  const GW = Math.floor(W / CELL), GH = Math.floor(H / CELL);
  const board = new Uint8Array(GW * GH);
  // zones interdites (image de titre, cadre QR…) : cases occupées d'emblée
  for (const o of obstacles) {
    const x0 = Math.max(0, Math.floor(o.x / CELL)), x1 = Math.min(GW, Math.ceil((o.x + o.w) / CELL));
    const y0 = Math.max(0, Math.floor(o.y / CELL)), y1 = Math.min(GH, Math.ceil((o.y + o.h) / CELL));
    for (let y = y0; y < y1; y++) board.fill(1, y * GW + x0, y * GW + x1);
  }
  // hors de l'ellipse : interdit
  if (ellipse) {
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++)
      if (ellNorm(ellipse, (x + 0.5) * CELL, (y + 0.5) * CELL) > 1) board[y * GW + x] = 1;
  }
  const collides = (mask, gx, gy) => {
    const r = mask.runs;
    for (let i = 0; i < r.length; i += 3) {
      const base = (gy + r[i]) * GW + gx;
      for (let x = r[i + 1]; x <= r[i + 2]; x++) if (board[base + x]) return true;
    }
    return false;
  };

  /* Point de départ de la spirale d'un mot.
   * - « centre » : tous autour du centre (léger décentrage stable) → les plus
   *   cités au milieu.
   * - « réparti » : les plus cités (jusqu'à 6) sont disposés en couronne
   *   (angle d'or), espacés entre eux ; tous les autres repartent du centre, si
   *   bien que les petits mots comblent les espaces entre les gros et que le
   *   nuage reste dense (pas de mots isolés). */
  function anchor(word, rank, hk) {
    const u = ((hk >>> 8) % 1000) / 1000, v = ((hk >>> 18) % 1000) / 1000;
    const center = [cx + (u - 0.5) * W * 0.06, cy + (v - 0.5) * H * 0.06];
    if (!spread || rank >= Math.min(6, Math.ceil(words.length / 5))) return center;
    const a = 0.6 + rank * 2.39996;
    const rad = rank === 0 ? 0.08 : 0.24;
    return [cx + Math.cos(a) * rad * W, cy + Math.sin(a) * rad * H];
  }
  words.forEach((word, rank) => tryPlace(word, rank));
  return failed ? null : placed;

  function tryPlace(word, rank) {
    if (failed) return;
    const mt = metrics(word.w, weight);
    // taille proportionnelle au nombre d'envois, mais aucun mot (une longue
    // phrase…) ne dépasse 70 % de la largeur : sinon il bloquerait à lui seul
    // l'agrandissement de tout le nuage
    const size = Math.min(minFont + (maxFont - minFont) * (word.n / maxN), (0.7 * W * REF) / mt.w);
    const m = marginFor(size);
    const k = size / REF;
    const mask = wordMask(word.w, size, weight, mt, m);
    const w = mask.cw * CELL, h = mask.ch * CELL;
    if (mask.cw > GW || mask.ch > GH) { if (!allowDrop) failed = true; return; }

    // Spirale propre à chaque mot (stable) : angle de départ, sens de rotation et
    // léger décentrage → placement moins « en lignes », plus organique.
    const hk = hash(word.k);
    const start = (hk % 628) / 100;
    const dir = hk & 1 ? 1 : -1;
    const [ax, ay] = anchor(word, rank, hk);
    let spot = null;
    // Places libres mais « alignées » sur un voisin : on garde la MOINS alignée
    // en secours, si aucune place bien décalée n'est trouvée un peu plus loin.
    let fallback = null, fallbackR = 0, fallbackScore = -1;
    const test = (x, y, r) => {
      const gx = Math.round(x / CELL), gy = Math.round(y / CELL);
      if (gx < 0 || gy < 0 || gx + mask.cw > GW || gy + mask.ch > GH) return false;
      const box = { x: gx * CELL, y: gy * CELL, w, h };
      // rectangle libre → pas besoin du masque ; sinon test lettre à lettre
      const maybe = placed.some((p) => overlaps(box, p)) || obstacles.some((o) => overlaps(box, o)) || (ellipse && !insideEllipse(ellipse, box));
      if (maybe && collides(mask, gx, gy)) return false;
      const score = alignment(box, box.y + m + mt.asc * k, size, placed, fx);
      if (score >= 1) { spot = box; return true; }
      if (!fallback) fallbackR = r;
      if (score > fallbackScore) { fallback = box; fallbackScore = score; }
      return false;
    };
    // Spirale RECTANGULAIRE aux proportions de l'écran : anneaux rectangulaires
    // de plus en plus grands, parcourus à partir d'un point propre au mot. Le
    // nuage prend ainsi la forme de l'écran (coins compris) au lieu d'une ellipse.
    const phase = start / 6.28;
    search: for (let r = 0; r < rMax; r += 2 * CELL) {
      if (fallback && r > fallbackR * fx.budget[0] + fx.budget[1]) break;
      const hw = r * sa, hh = r / sa;
      const per = 4 * (hw + hh);
      const n = Math.max(1, Math.floor(per / (2 * CELL)));
      for (let i = 0; i < n; i++) {
        let d = ((i / n + phase) % 1) * per;
        let px, py;
        if (d < 2 * hw) { px = -hw + d; py = -hh; }
        else if ((d -= 2 * hw) < 2 * hh) { px = hw; py = -hh + d; }
        else if ((d -= 2 * hh) < 2 * hw) { px = hw - d; py = hh; }
        else { d -= 2 * hw; px = -hw; py = hh - d; }
        if (test(ax + dir * px - w / 2, ay + py - h / 2, r)) break search;
      }
    }
    if (!spot) spot = fallback;
    if (!spot) { if (!allowDrop) failed = true; return; }
    // inscrit l'encre (non dilatée) du mot dans la grille
    const gx = spot.x / CELL, gy = spot.y / CELL;
    for (let y = 0; y < mask.ch; y++) {
      const base = (gy + y) * GW + gx;
      for (let x = 0; x < mask.cw; x++) if (mask.ink[y * mask.cw + x]) board[base + x] = 1;
    }
    // point d'ancrage SVG = ligne de base, début du texte
    placed.push({
      ...spot, size,
      bx: spot.x + m + mt.left * k, by: spot.y + m + mt.asc * k,
      k: word.k, n: word.n, text: word.w,
    });
  }
}


/* Attribue les couleurs : chaque mot garde sa couleur « naturelle » (stable)
 * sauf si un voisin proche l'a déjà ; on prend alors la première couleur libre,
 * ou à défaut la moins présente autour de lui. */
function colorize(placed, nColors) {
  const out = [];
  for (const p of placed) {
    const near = out.filter((q) => gap(p, q) < Math.min(p.size, q.size) * 0.6);
    const used = near.map((q) => q.color);
    const pref = hash(p.k) % nColors;
    let color = -1;
    for (let i = 0; i < nColors; i++) {
      const c = (pref + i) % nColors;
      if (!used.includes(c)) { color = c; break; }
    }
    if (color < 0) {
      const freq = Array.from({ length: nColors }, (_, c) => used.filter((u) => u === c).length);
      color = freq.indexOf(Math.min(...freq));
    }
    out.push({ ...p, color });
  }
  return out;
}

function placeAll(list, W, H, opts) {
  const maxN = Math.max(...list.map((w) => w.n));
  // Taille de départ estimée d'après la surface totale des mots (≈ 45 % de
  // l'écran) : le 1er essai réussit presque toujours, et l'agrandissement final
  // (fit) ramène de toute façon le nuage aux dimensions de l'écran.
  const area = list.reduce((sum, w) => {
    const f = 0.2 + 0.8 * (w.n / maxN), mt = metrics(w.w, opts.weight);
    return sum + f * f * ((mt.w + 10) * (mt.asc + mt.desc + 10)) / (REF * REF);
  }, 0);
  // Taille plancher : en dessous, on préfère laisser de côté les mots les moins
  // cités plutôt que de rendre tout le nuage illisible.
  const floor = Math.max(24, Math.min(W, H) * 0.09);
  const e = opts.ellipse;
  const free = (e ? Math.min(W * H, Math.PI * e.rx * e.ry) : W * H) - (opts.obstacles || []).reduce((sum, o) => sum + o.w * o.h, 0);
  let maxFont = Math.max(floor, Math.min(H * 0.3, W * 0.18, 160, Math.sqrt((0.45 * free) / area)));
  for (let i = 0; i < 10; i++) {
    const atFloor = maxFont <= floor || i === 9;
    if (atFloor) maxFont = Math.max(maxFont, floor);
    const minFont = Math.max(12, maxFont * 0.2);
    const res = tryLayout(list, W, H, maxFont, minFont, maxN, atFloor, opts);
    if (res) {
      if (!opts.grow || atFloor) return res;
      // Avec obstacles, pas d'agrandissement final (il les chevaucherait) : on
      // agrandit plutôt la police tant que tous les mots trouvent leur place.
      let best = res;
      const cap = Math.min(maxFontFor(list.length, H), W * 0.25, 300);
      for (let g = 0; g < 10 && maxFont * 1.18 <= cap; g++) {
        maxFont *= 1.18;
        const next = tryLayout(list, W, H, maxFont, Math.max(12, maxFont * 0.2), maxN, false, opts);
        if (!next) break;
        best = next;
      }
      return best;
    }
    maxFont *= 0.86;
  }
  return [];
}

const bounds = (placed) => {
  const x0 = Math.min(...placed.map((p) => p.x)), y0 = Math.min(...placed.map((p) => p.y));
  const x1 = Math.max(...placed.map((p) => p.x + p.w)), y1 = Math.max(...placed.map((p) => p.y + p.h));
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
};

/* Agrandit uniformément le nuage pour qu'il remplisse l'écran (les proportions
 * et les écarts sont conservés, donc aucun chevauchement). Le plus gros mot ne
 * dépasse pas 45 % de la hauteur, pour ne pas écraser un nuage de 1–2 mots. */
function fit(placed, W, H, e) {
  if (!placed.length) return { placed, scale: 1 };
  const biggest = Math.max(...placed.map((p) => p.size));
  // agrandissement autour du centre de l'ellipse, jusqu'à ce qu'un coin de mot
  // touche l'ellipse ou le bord de l'écran
  let s = maxFontFor(placed.length, H) / biggest;
  for (const p of placed) {
    for (const [x, y] of [[p.x, p.y], [p.x + p.w, p.y], [p.x, p.y + p.h], [p.x + p.w, p.y + p.h]]) {
      const n = ellNorm(e, x, y);
      if (n > 0) s = Math.min(s, 1 / n);
      if (x < e.cx) s = Math.min(s, e.cx / (e.cx - x)); else if (x > e.cx) s = Math.min(s, (W - e.cx) / (x - e.cx));
      if (y < e.cy) s = Math.min(s, e.cy / (e.cy - y)); else if (y > e.cy) s = Math.min(s, (H - e.cy) / (y - e.cy));
    }
  }
  s = Math.max(1, s);
  const tx = (v) => e.cx + (v - e.cx) * s, ty = (v) => e.cy + (v - e.cy) * s;
  return {
    scale: s * biggest,
    placed: placed.map((p) => ({
      ...p, x: tx(p.x), y: ty(p.y), w: p.w * s, h: p.h * s, size: p.size * s, bx: tx(p.bx), by: ty(p.by),
    })),
  };
}

function layout(words, W, H, weight, spread, effect, obstacles = []) {
  const fx = EFFECTS[effect] || EFFECTS.medium;
  if (!words.length || W < 50 || H < 50) return [];
  const list = words.slice(0, MAX_WORDS);
  const ellipse = ellipseFor(list.length, W, H);
  if (obstacles.length) return placeAll(list, W, H, { weight, stretch: 1, spread, fx, obstacles, ellipse, grow: true });
  // 1er essai : spirale aux proportions de l'écran. Puis on corrige l'ellipse
  // d'après la forme obtenue (trop large / trop haute) et on garde le meilleur
  // remplissage (= le plus gros mot après agrandissement).
  const a = placeAll(list, W, H, { weight, stretch: 1, spread, fx, ellipse });
  if (!a.length) return [];
  const b0 = bounds(a);
  const stretch = Math.min(3, Math.max(0.4, (W / H) / (b0.w / b0.h)));
  const fa = fit(a, W, H, ellipse);
  if (Math.abs(stretch - 1) < 0.25) return fa.placed; // forme déjà adaptée : pas de 2e passe
  const fb = fit(placeAll(list, W, H, { weight, stretch, spread, fx, ellipse }), W, H, ellipse);
  return fb.placed.length >= fa.placed.length && fb.scale > fa.scale ? fb.placed : fa.placed;
}

/* Calcul complet (placement + couleurs), réutilisé pour l'export en image. */
export function computeCloud(words, W, H, { weight = DEFAULT_WEIGHT, arrangement = "center", effect = "medium", nColors, obstacles = [] }) {
  return colorize(layout(words, W, H, weight, arrangement === "spread", effect, obstacles), nColors);
}

export const CLOUD_FONT = FONT;

const DEFAULT_COLORS = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#22d3ee", "#818cf8", "#e879f9", "#f472b6"];

export default function WordCloud({ words, colors = DEFAULT_COLORS, weight = DEFAULT_WEIGHT, arrangement = "center", effect = "medium", obstacles = [], onWordClick }) {
  const spread = arrangement === "spread";
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize((s) => (Math.abs(s.w - width) < 2 && Math.abs(s.h - height) < 2 ? s : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const signature = words.map((w) => `${w.k}:${w.n}:${w.w}`).join("|");
  const obsKey = obstacles.map((o) => `${o.x},${o.y},${o.w},${o.h}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const placed = useMemo(() => layout(words, size.w, size.h, weight, spread, effect, obstacles), [signature, size.w, size.h, weight, spread, effect, obsKey]);
  const colored = useMemo(() => colorize(placed, colors.length), [placed, colors.length]);

  return (
    <div ref={ref} className="relative w-full h-full overflow-hidden select-none">
      <style>{`@keyframes nuage-pop{0%{opacity:0;transform:scale(.2)}70%{opacity:1;transform:scale(1.12)}100%{transform:scale(1)}}`}</style>
      <svg width={size.w} height={size.h} className="absolute inset-0" style={{ overflow: "visible" }}>
        {colored.map((p) => (
          <g
            key={p.k}
            onClick={onWordClick ? () => onWordClick(p) : undefined}
            style={{
              transform: `translate(${p.bx}px, ${p.by}px)`,
              transition: "transform .8s cubic-bezier(.2,.8,.2,1)",
              cursor: onWordClick ? "pointer" : "default",
            }}
          >
            {onWordClick && <title>{`${p.text} — ${p.n} envoi${p.n > 1 ? "s" : ""} (cliquer pour masquer)`}</title>}
            <g style={{ animation: "nuage-pop .6s ease-out", transformBox: "fill-box", transformOrigin: "center" }}>
              <text
                style={{
                  fontSize: p.size, fontWeight: weight, fontFamily: FONT, fill: colors[p.color],
                  transition: "font-size .8s cubic-bezier(.2,.8,.2,1), fill .6s",
                }}
              >
                {p.text}
              </text>
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}
