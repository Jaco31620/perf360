"use client";
/*
 * Nuage de mots dynamique — placement maison en spirale (aucune dépendance).
 * Les mots les plus envoyés sont les plus gros et placés au centre. Chaque mot
 * occupe la boîte RÉELLE de ses lettres (pas la hauteur de ligne), ce qui évite
 * les grands vides autour des gros mots. Rendu en SVG (positionnement exact sur
 * la ligne de base) ; tailles et positions sont animées en CSS.
 */
import { useEffect, useMemo, useRef, useState } from "react";

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const DEFAULT_WEIGHT = 800;
const MAX_WORDS = 120;
const REF = 100; // taille de référence pour la mesure (les métriques sont proportionnelles)

/* Marge autour de chaque mot : de l'air entre les mots, sans gaspiller de place
 * autour des très gros mots. */
const marginFor = (size) => 4 + size * 0.05;

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

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/* Distance entre deux rectangles (0 s'ils se touchent). */
const gap = (a, b) => Math.hypot(
  Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)),
  Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)),
);

/* Place les mots (triés par fréquence décroissante) ; renvoie null si l'un ne rentre pas. */
function tryLayout(words, W, H, maxFont, minFont, maxN, allowDrop, { weight, stretch, spread }) {
  const placed = [];
  const cx = W / 2, cy = H / 2;
  const sa = Math.sqrt((W / H) * stretch); // ellipse de la spirale
  const rMax = Math.hypot(W, H) * Math.max(sa, 1 / sa);
  let failed = false;

  /* Point de départ de la spirale d'un mot.
   * - « centre » : tous autour du centre (léger décentrage stable) → les plus
   *   cités au milieu.
   * - « réparti » : les 6 plus cités sont disposés en couronne (angle d'or) loin
   *   les uns des autres, les autres partent d'un point stable au hasard ; les
   *   petits mots viennent combler les espaces entre les gros. */
  function anchor(word, rank, hk) {
    const u = ((hk >>> 8) % 1000) / 1000, v = ((hk >>> 18) % 1000) / 1000;
    if (!spread) return [cx + (u - 0.5) * W * 0.06, cy + (v - 0.5) * H * 0.06];
    if (rank < 6) {
      const a = 0.6 + rank * 2.39996;
      const rad = rank === 0 ? 0.18 : 0.3;
      return [cx + Math.cos(a) * rad * W, cy + Math.sin(a) * rad * H];
    }
    return [W * (0.08 + 0.84 * u), H * (0.1 + 0.8 * v)];
  }
  words.forEach((word, rank) => tryPlace(word, rank));
  return failed ? null : placed;

  function tryPlace(word, rank) {
    if (failed) return;
    const size = minFont + (maxFont - minFont) * (word.n / maxN);
    const m = marginFor(size);
    const k = size / REF;
    const mt = metrics(word.w, weight);
    const w = mt.w * k + 2 * m, h = (mt.asc + mt.desc) * k + 2 * m;
    if (w > W || h > H) { if (!allowDrop) failed = true; return; }

    // Spirale propre à chaque mot (stable) : angle de départ, sens de rotation et
    // léger décentrage → placement moins « en lignes », plus organique.
    const hk = hash(word.k);
    const start = (hk % 628) / 100;
    const dir = hk & 1 ? 1 : -1;
    const [ax, ay] = anchor(word, rank, hk);
    let spot = null;
    let last = null; // dernier obstacle rencontré : souvent le même au pas suivant
    for (let t = 0, r = 0; r < rMax; ) {
      const x = ax + r * Math.cos(dir * t + start) * sa - w / 2;
      const y = ay + r * Math.sin(dir * t + start) / sa - h / 2;
      if (x >= 0 && y >= 0 && x + w <= W && y + h <= H) {
        const box = { x, y, w, h };
        if (!(last && overlaps(box, last))) {
          last = placed.find((p) => overlaps(box, p)) || null;
          if (!last) { spot = box; break; }
        }
      }
      // pas angulaire ≈ 5 px d'arc, spirale d'Archimède r = 2.2·t
      t += 5 / Math.max(r, 8);
      r = 2.2 * t;
    }
    if (!spot) { if (!allowDrop) failed = true; return; }
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
  let maxFont = Math.min(H * 0.3, W * 0.18, 160);
  // Taille plancher : en dessous, on préfère laisser de côté les mots les moins
  // cités plutôt que de rendre tout le nuage illisible.
  const floor = Math.max(24, Math.min(W, H) * 0.09);
  for (let i = 0; i < 10; i++) {
    const atFloor = maxFont <= floor || i === 9;
    if (atFloor) maxFont = Math.max(maxFont, floor);
    const minFont = Math.max(12, maxFont * 0.2);
    const res = tryLayout(list, W, H, maxFont, minFont, maxN, atFloor, opts);
    if (res) return res;
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
function fit(placed, W, H) {
  if (!placed.length) return { placed, scale: 1 };
  const b = bounds(placed);
  const biggest = Math.max(...placed.map((p) => p.size));
  const s = Math.max(1, Math.min(W / b.w, H / b.h, (H * 0.45) / biggest));
  const dx = (W - b.w * s) / 2 - b.x0 * s, dy = (H - b.h * s) / 2 - b.y0 * s;
  return {
    scale: s * biggest,
    placed: placed.map((p) => ({
      ...p, x: p.x * s + dx, y: p.y * s + dy, w: p.w * s, h: p.h * s, size: p.size * s,
      bx: p.bx * s + dx, by: p.by * s + dy,
    })),
  };
}

function layout(words, W, H, weight, spread) {
  if (!words.length || W < 50 || H < 50) return [];
  const list = words.slice(0, MAX_WORDS);
  // 1er essai : spirale aux proportions de l'écran. Puis on corrige l'ellipse
  // d'après la forme obtenue (trop large / trop haute) et on garde le meilleur
  // remplissage (= le plus gros mot après agrandissement).
  const a = placeAll(list, W, H, { weight, stretch: 1, spread });
  if (!a.length) return [];
  const b0 = bounds(a);
  const stretch = Math.min(3, Math.max(0.4, (W / H) / (b0.w / b0.h)));
  const fa = fit(a, W, H);
  if (Math.abs(stretch - 1) < 0.05) return fa.placed;
  const fb = fit(placeAll(list, W, H, { weight, stretch, spread }), W, H);
  return fb.placed.length >= fa.placed.length && fb.scale > fa.scale ? fb.placed : fa.placed;
}

const DEFAULT_COLORS = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#22d3ee", "#818cf8", "#e879f9", "#f472b6"];

export default function WordCloud({ words, colors = DEFAULT_COLORS, weight = DEFAULT_WEIGHT, arrangement = "center", onWordClick }) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const placed = useMemo(() => layout(words, size.w, size.h, weight, spread), [signature, size.w, size.h, weight, spread]);
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
