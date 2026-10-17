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
const WEIGHT = 800;
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
function metrics(text) {
  let m = _metrics.get(text);
  if (m) return m;
  if (!_ctx) _ctx = document.createElement("canvas").getContext("2d");
  _ctx.font = `${WEIGHT} ${REF}px ${FONT}`;
  const t = _ctx.measureText(text);
  const left = Number.isFinite(t.actualBoundingBoxLeft) ? t.actualBoundingBoxLeft : 0;
  const right = Number.isFinite(t.actualBoundingBoxRight) ? t.actualBoundingBoxRight : t.width;
  m = {
    left,
    w: left + right,
    asc: Number.isFinite(t.actualBoundingBoxAscent) ? t.actualBoundingBoxAscent : REF * 0.75,
    desc: Number.isFinite(t.actualBoundingBoxDescent) ? t.actualBoundingBoxDescent : REF * 0.22,
  };
  _metrics.set(text, m);
  return m;
}

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/* Distance entre deux rectangles (0 s'ils se touchent). */
const gap = (a, b) => Math.hypot(
  Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)),
  Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)),
);

/* Place les mots (triés par fréquence décroissante) ; renvoie null si l'un ne rentre pas. */
function tryLayout(words, W, H, maxFont, minFont, maxN, allowDrop) {
  const placed = [];
  const cx = W / 2, cy = H / 2;
  const sa = Math.sqrt(W / H);
  const rMax = (Math.hypot(W, H) / 2) * Math.max(sa, 1 / sa);
  for (const word of words) {
    const size = minFont + (maxFont - minFont) * (word.n / maxN);
    const m = marginFor(size);
    const k = size / REF;
    const mt = metrics(word.w);
    const w = mt.w * k + 2 * m, h = (mt.asc + mt.desc) * k + 2 * m;
    if (w > W || h > H) { if (allowDrop) continue; return null; }

    // Spirale propre à chaque mot (stable) : angle de départ, sens de rotation et
    // léger décentrage → placement moins « en lignes », plus organique.
    const hk = hash(word.k);
    const start = (hk % 628) / 100;
    const dir = hk & 1 ? 1 : -1;
    const ox = (((hk >>> 8) % 1000) / 1000 - 0.5) * W * 0.06;
    const oy = (((hk >>> 18) % 1000) / 1000 - 0.5) * H * 0.06;
    let spot = null;
    let last = null; // dernier obstacle rencontré : souvent le même au pas suivant
    for (let t = 0, r = 0; r < rMax; ) {
      const x = cx + ox + r * Math.cos(dir * t + start) * sa - w / 2;
      const y = cy + oy + r * Math.sin(dir * t + start) / sa - h / 2;
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
    if (!spot) { if (allowDrop) continue; return null; }
    // point d'ancrage SVG = ligne de base, début du texte
    placed.push({
      ...spot, size,
      bx: spot.x + m + mt.left * k, by: spot.y + m + mt.asc * k,
      k: word.k, n: word.n, text: word.w,
    });
  }
  return placed;
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

function layout(words, W, H) {
  if (!words.length || W < 50 || H < 50) return [];
  const list = words.slice(0, MAX_WORDS);
  const maxN = Math.max(...list.map((w) => w.n));
  let maxFont = Math.min(H * 0.3, W * 0.18, 160);
  // Taille plancher : en dessous, on préfère laisser de côté les mots les moins
  // cités plutôt que de rendre tout le nuage illisible.
  const floor = Math.max(24, Math.min(W, H) * 0.09);
  for (let i = 0; i < 10; i++) {
    const atFloor = maxFont <= floor || i === 9;
    if (atFloor) maxFont = Math.max(maxFont, floor);
    const minFont = Math.max(12, maxFont * 0.2);
    const res = tryLayout(list, W, H, maxFont, minFont, maxN, atFloor);
    if (res) return res;
    maxFont *= 0.86;
  }
  return [];
}

const DEFAULT_COLORS = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#22d3ee", "#818cf8", "#e879f9", "#f472b6"];

export default function WordCloud({ words, colors = DEFAULT_COLORS, onWordClick }) {
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
  const placed = useMemo(() => layout(words, size.w, size.h), [signature, size.w, size.h]);
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
                  fontSize: p.size, fontWeight: WEIGHT, fontFamily: FONT, fill: colors[p.color],
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
