"use client";
/*
 * Nuage de mots dynamique — placement maison en spirale (aucune dépendance).
 * Les mots les plus envoyés sont les plus gros et placés au centre. Chaque mot
 * est positionné en absolu et ses changements (taille, position) sont animés en
 * CSS, ce qui donne un nuage qui « respire » au fil des envois.
 */
import { useEffect, useMemo, useRef, useState } from "react";

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const WEIGHT = 800;
const LINE = 1.15;
const PAD = 6;
const MAX_WORDS = 120;

const PALETTES = {
  dark: ["#f87171", "#fb923c", "#facc15", "#4ade80", "#22d3ee", "#818cf8", "#e879f9", "#f472b6"],
  light: ["#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#4f46e5", "#c026d3", "#db2777"],
};

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

let _ctx = null;
function measure(text, size) {
  if (!_ctx) _ctx = document.createElement("canvas").getContext("2d");
  _ctx.font = `${WEIGHT} ${size}px ${FONT}`;
  return _ctx.measureText(text).width;
}

const overlaps = (a, b) =>
  a.x < b.x + b.w + PAD && a.x + a.w + PAD > b.x && a.y < b.y + b.h + PAD && a.y + a.h + PAD > b.y;

/* Place les mots (triés par fréquence décroissante) ; renvoie null si l'un ne rentre pas. */
function tryLayout(words, W, H, maxFont, minFont, maxN, allowDrop) {
  const placed = [];
  const cx = W / 2, cy = H / 2;
  const sa = Math.sqrt(W / H);
  const rMax = (Math.hypot(W, H) / 2) * Math.max(sa, 1 / sa);
  for (const word of words) {
    const size = minFont + (maxFont - minFont) * (word.n / maxN);
    const w = measure(word.w, size);
    const h = size * LINE;
    if (w > W || h > H) { if (allowDrop) continue; return null; }

    const start = (hash(word.k) % 628) / 100;
    let spot = null;
    let last = null; // dernier obstacle rencontré : souvent le même au pas suivant
    for (let t = 0, r = 0; r < rMax; ) {
      const x = cx + r * Math.cos(t + start) * sa - w / 2;
      const y = cy + r * Math.sin(t + start) / sa - h / 2;
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
    placed.push({ ...spot, size, k: word.k, n: word.n, text: word.w });
  }
  return placed;
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

export default function WordCloud({ words, theme = "dark", onWordClick }) {
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
  const palette = PALETTES[theme] || PALETTES.dark;

  return (
    <div ref={ref} className="relative w-full h-full overflow-hidden select-none">
      <style>{`@keyframes nuage-pop{0%{opacity:0;transform:scale(.2)}70%{opacity:1;transform:scale(1.12)}100%{transform:scale(1)}}`}</style>
      {placed.map((p) => (
        <span
          key={p.k}
          onClick={onWordClick ? () => onWordClick(p) : undefined}
          title={onWordClick ? `${p.text} — ${p.n} envoi${p.n > 1 ? "s" : ""} (cliquer pour masquer)` : undefined}
          style={{
            position: "absolute", left: 0, top: 0,
            transform: `translate(${p.x}px, ${p.y}px)`,
            fontSize: p.size, lineHeight: LINE, fontWeight: WEIGHT, fontFamily: FONT,
            whiteSpace: "nowrap", color: palette[hash(p.k) % palette.length],
            transition: "transform .8s cubic-bezier(.2,.8,.2,1), font-size .8s cubic-bezier(.2,.8,.2,1)",
            cursor: onWordClick ? "pointer" : "default",
          }}
        >
          <span style={{ display: "inline-block", animation: "nuage-pop .6s ease-out" }}>{p.text}</span>
        </span>
      ))}
    </div>
  );
}
