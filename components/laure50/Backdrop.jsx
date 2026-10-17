"use client";
/*
 * Décor commun aux pages du karaoké : fond brun nuit, halo orange, skyline de
 * New York en silhouette (fenêtres jaunes, deux flèches type Empire State) et
 * cinq bandes diagonales seventies dans le coin supérieur droit.
 */
import { useMemo } from "react";

const STRIPES = ["#8b3f12", "#f0943a", "#c8921a", "#f2e26b", "#c8431a"];

/* Générateur pseudo-aléatoire stable (même skyline à chaque rendu). */
function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function buildSkyline() {
  const rand = rng(1976);
  const W = 2000, H = 260; // très large : peu haute sur écran 16:9, recadrée au centre sur téléphone
  const buildings = [], windows = [], spires = [];
  let x = -10;
  while (x < W) {
    const w = 38 + rand() * 60;
    const h = 60 + rand() * 120;
    buildings.push({ x, y: H - h, w, h });
    // fenêtres : grille, environ 1 sur 3 allumée
    for (let wy = H - h + 10; wy < H - 10; wy += 13)
      for (let wx = x + 7; wx < x + w - 8; wx += 11)
        if (rand() < 0.33) windows.push({ x: wx, y: wy });
    x += w + 3 + rand() * 6;
  }
  // deux tours à flèche (Empire State)
  // proches du centre pour rester visibles sur un téléphone (cadrage centré)
  for (const cx of [865, 1130]) {
    // corps + 2 gradins + flèche ; la pointe reste dans le cadre (y ≥ 0)
    const base = H - 150, bw = 70;
    buildings.push({ x: cx - bw / 2, y: base, w: bw, h: 150 });
    buildings.push({ x: cx - 24, y: base - 24, w: 48, h: 26 });
    buildings.push({ x: cx - 13, y: base - 44, w: 26, h: 22 });
    spires.push(`${cx - 5},${base - 44} ${cx},${base - 106} ${cx + 5},${base - 44}`);
    for (let wy = base + 10; wy < H - 10; wy += 13)
      for (let wx = cx - bw / 2 + 7; wx < cx + bw / 2 - 8; wx += 11)
        if (rand() < 0.4) windows.push({ x: wx, y: wy });
  }
  return { W, H, buildings, windows, spires };
}

export default function Backdrop({ children, showLogo = false }) {
  const sky = useMemo(buildSkyline, []);
  return (
    <div className="l50-root">
      <div className="l50-halo" />
      <svg className="l50-skyline" viewBox={`0 0 ${sky.W} ${sky.H}`} preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        {sky.spires.map((pts, i) => <polygon key={`s${i}`} points={pts} fill="#1a0d05" />)}
        {sky.buildings.map((b, i) => <rect key={`b${i}`} x={b.x} y={b.y} width={b.w} height={b.h} fill="#1a0d05" />)}
        {sky.windows.map((w, i) => <rect key={`w${i}`} x={w.x} y={w.y} width="4" height="6" fill="#f2e26b" opacity="0.85" />)}
      </svg>
      <svg className="l50-stripes" viewBox="0 0 300 200" aria-hidden="true">
        {STRIPES.map((c, i) => (
          <polygon key={c} points={`${90 + i * 34},0 ${118 + i * 34},0 ${228 + i * 34},200 ${200 + i * 34},200`} fill={c} />
        ))}
      </svg>
      {showLogo && <img className="l50-corner-logo" src="/laure50/logo.png" alt="Laure 1976" />}
      <div className="l50-content">{children}</div>
    </div>
  );
}
