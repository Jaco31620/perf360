"use client";
/*
 * Paroles minutées (public/laure50/lyrics.json) :
 * { duration, titleUntil, outroFrom, items: [{ text, appear, gone, y, curve: [[t, f], …] }] }
 */

let _lyrics = null;
export async function loadLyrics() {
  if (_lyrics) return _lyrics;
  const res = await fetch("/laure50/lyrics.json");
  _lyrics = await res.json();
  return _lyrics;
}

/* Fraction chantée (0 → 1) d'une ligne à l'instant t, interpolée sur `curve`. */
export function sungFraction(curve, t) {
  if (!curve?.length) return 0;
  if (t <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [t1, f1] = curve[i];
    if (t <= t1) {
      const [t0, f0] = curve[i - 1];
      return t1 === t0 ? f1 : f0 + ((f1 - f0) * (t - t0)) / (t1 - t0);
    }
  }
  return curve[curve.length - 1][1];
}

/* Lignes visibles à l'instant t, ordonnées de haut en bas. */
export function visibleLines(lyrics, t) {
  return lyrics.items
    .map((it, i) => ({ ...it, i }))
    .filter((it) => it.appear <= t && t < it.gone)
    .sort((a, b) => a.y - b.y);
}
