"use client";
/*
 * Clic-Clac — traitement d'image dans le navigateur (avant envoi) :
 * filtres (calcul pixel par pixel : fonctionne partout, y compris les anciens
 * Safari sans ctx.filter), cadres, bande « cabine », compression JPEG.
 * La photo envoyée est donc la photo finale, identique partout.
 */

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const HAND = '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Marker Felt", cursive';

/* ── Filtres ───────────────────────────────────────────────────── */
const FILTER_PARAMS = {
  none: null,
  nb: { gray: 1, contrast: 1.15 },
  vintage: { sepia: 0.45, sat: 0.85, contrast: 0.92, fade: 22, tint: [10, 2, -12] },
  chaud: { sat: 1.12, tint: [20, 6, -16] },
  froid: { sat: 1.05, tint: [-14, 2, 20] },
  contraste: { contrast: 1.32, sat: 1.22 },
  doux: { bright: 12, contrast: 0.88, sat: 0.9, fade: 10 },
};

export function applyFilter(canvas, id) {
  const f = FILTER_PARAMS[id];
  if (!f) return canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const { gray = 0, sepia = 0, sat = 1, contrast = 1, bright = 0, fade = 0, tint = [0, 0, 0] } = f;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    if (sat !== 1) { r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat; }
    if (gray) { r = r + (l - r) * gray; g = g + (l - g) * gray; b = b + (l - b) * gray; }
    if (sepia) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b, sg = 0.349 * r + 0.686 * g + 0.168 * b, sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r += (sr - r) * sepia; g += (sg - g) * sepia; b += (sb - b) * sepia;
    }
    if (contrast !== 1) { r = (r - 128) * contrast + 128; g = (g - 128) * contrast + 128; b = (b - 128) * contrast + 128; }
    r += bright + tint[0]; g += bright + tint[1]; b += bright + tint[2];
    if (fade) { const k = 1 - fade / 255; r = r * k + fade; g = g * k + fade; b = b * k + fade; }
    d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/* ── Utilitaires ───────────────────────────────────────────────── */
export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.round(w);
  c.height = Math.round(h);
  return c;
}

/* Copie redimensionnée (côté le plus long ≤ max). */
export function scaled(src, max) {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const c = makeCanvas(src.width * k, src.height * k);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export const toJpeg = (canvas, quality) => new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));

/* JPEG ≤ maxBytes (baisse la qualité si besoin). */
export async function jpegUnder(canvas, quality, maxBytes) {
  let q = quality, blob = await toJpeg(canvas, q);
  while (blob.size > maxBytes && q > 0.5) { q -= 0.08; blob = await toJpeg(canvas, q); }
  return blob;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/* Image (fichier ou élément) → canvas, rognée/limitée à maxSide. */
export function imageToCanvas(img, maxSide = 4096) {
  const w = img.naturalWidth || img.videoWidth || img.width, h = img.naturalHeight || img.videoHeight || img.height;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = makeCanvas(w * k, h * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}

const fmtDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "");

function fitText(ctx, text, maxW, size, family, weight = 700) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > 10) { s -= 2; ctx.font = `${weight} ${s}px ${family}`; }
  return s;
}

/* ── Cadres ────────────────────────────────────────────────────── */
/* photo (canvas filtré) + cadre → nouveau canvas. info = { title, date, customImg } */
export function applyFrame(photo, frame, info = {}) {
  const W = photo.width, H = photo.height, title = info.title || "", date = fmtDate(info.date);
  if (PAINTING_FRAMES[frame]) return paintingFrame(photo, frame, title, date);
  if (frame === "polaroid") {
    const m = Math.round(Math.min(W, H) * 0.05), bottom = Math.round(Math.min(W, H) * 0.2);
    const c = makeCanvas(W + 2 * m, H + m + bottom), ctx = c.getContext("2d");
    ctx.fillStyle = "#fbfaf5"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(photo, m, m);
    ctx.fillStyle = "#2b2b2b"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const s = fitText(ctx, title, c.width - 2 * m, bottom * 0.36, HAND, 700);
    ctx.fillText(title, c.width / 2, H + m + bottom * (date ? 0.4 : 0.5));
    if (date) { ctx.fillStyle = "#777"; ctx.font = `400 ${Math.round(s * 0.55)}px ${HAND}`; ctx.fillText(date, c.width / 2, H + m + bottom * 0.74); }
    return c;
  }
  const c = makeCanvas(W, H), ctx = c.getContext("2d");
  ctx.drawImage(photo, 0, 0);
  if (frame === "band") {
    const bh = Math.round(H * 0.12);
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(0, H - bh, W, bh);
    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle";
    const pad = W * 0.04;
    ctx.textAlign = "left"; fitText(ctx, title, W * 0.6, bh * 0.42, FONT, 800); ctx.fillText(title, pad, H - bh / 2);
    if (date) { ctx.textAlign = "right"; ctx.font = `500 ${Math.round(bh * 0.3)}px ${FONT}`; ctx.fillText(date, W - pad, H - bh / 2); }
  } else if (frame === "film") {
    const side = Math.round(W * 0.07);
    ctx.fillStyle = "#111"; ctx.fillRect(0, 0, side, H); ctx.fillRect(W - side, 0, side, H);
    const hole = side * 0.45, gap = hole * 1.6;
    ctx.fillStyle = "#f5f1e6";
    for (let y = gap / 2; y < H; y += gap) {
      for (const x of [side / 2 - hole / 2, W - side / 2 - hole / 2]) roundRect(ctx, x, y, hole, hole * 0.75, hole * 0.15);
    }
    ctx.fillStyle = "#f2c94c"; ctx.font = `700 ${Math.round(side * 0.32)}px ${FONT}`; ctx.save();
    ctx.translate(W - side * 0.2, H * 0.5); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center";
    ctx.fillText(`${title}${date ? "  ·  " + date : ""}`.toUpperCase(), 0, 0); ctx.restore();
  } else if (frame === "neon") {
    const t = Math.max(4, Math.round(Math.min(W, H) * 0.012)), inset = t * 3;
    for (const [color, off] of [["#ff2bd6", 0], ["#00e5ff", t * 1.6]]) {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = t; ctx.shadowColor = color; ctx.shadowBlur = t * 4;
      ctx.strokeRect(inset + off, inset + off, W - 2 * (inset + off), H - 2 * (inset + off)); ctx.restore();
    }
    if (title) {
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      fitText(ctx, title, W * 0.8, H * 0.07, FONT, 800);
      ctx.fillStyle = "#fff"; ctx.shadowColor = "#ff2bd6"; ctx.shadowBlur = t * 5;
      ctx.fillText(title, W / 2, H - inset * 3); ctx.restore();
    }
  } else if (frame === "custom" && info.customImg) {
    // cadre perso : posé par-dessus, étiré à la taille de la photo
    ctx.drawImage(info.customImg, 0, 0, W, H);
  }
  return c;
}

/* ── Cadres « tableau » : moulure à onglets (dégradé = profil en relief) ── */
const PROFILES = {
  gold: ["#4a300a", "#a87a24", "#f7dc8a", "#c8962f", "#6f4a12", "#e9c463", "#fff1b8", "#b07e22", "#5a3b0c"],
  silver: ["#3c4146", "#9aa1a8", "#eef1f4", "#b3bac1", "#5f666d", "#d7dce1", "#ffffff", "#9198a0", "#454b51"],
  wood: ["#3b2010", "#6e3f1f", "#8f5a30", "#a86d3c", "#7a4724", "#94603a", "#5b331a", "#7d4a27", "#3e2312"],
};
const PAINTING_FRAMES = {
  gold: { profile: "gold", width: 0.1 },
  baroque: { profile: "gold", width: 0.14, ornate: true },
  wood: { profile: "wood", width: 0.09, grain: true },
  silver: { profile: "silver", width: 0.08 },
  gallery: { gallery: true },
};

/* Dessine une moulure d'épaisseur b autour du rectangle (x, y, w, h) extérieur. */
function moulding(ctx, x, y, w, h, b, stops, { grain = false } = {}) {
  const sides = [
    { poly: [[x, y], [x + w, y], [x + w - b, y + b], [x + b, y + b]], g: [x, y, x, y + b], along: "h" },
    { poly: [[x + w, y], [x + w, y + h], [x + w - b, y + h - b], [x + w - b, y + b]], g: [x + w, y, x + w - b, y], along: "v" },
    { poly: [[x + w, y + h], [x, y + h], [x + b, y + h - b], [x + w - b, y + h - b]], g: [x, y + h, x, y + h - b], along: "h" },
    { poly: [[x, y + h], [x, y], [x + b, y + b], [x + b, y + h - b]], g: [x, y, x + b, y], along: "v" },
  ];
  sides.forEach((sd, i) => {
    ctx.save();
    ctx.beginPath();
    sd.poly.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    const gr = ctx.createLinearGradient(...sd.g);
    stops.forEach((c, k) => gr.addColorStop(k / (stops.length - 1), c));
    ctx.fillStyle = gr;
    ctx.fill();
    ctx.clip();
    // éclairage : côtés haut/gauche plus clairs, bas/droite plus sombres
    ctx.fillStyle = i < 1 || i === 3 ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.18)";
    ctx.fill();
    if (grain) {
      // veinage du bois : lignes fines ondulées dans le sens de la moulure
      let seed = 7 + i * 13;
      const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
      ctx.lineWidth = Math.max(1, b / 90);
      for (let n = 0; n < 46; n++) {
        const off = rnd() * b, amp = b * (0.02 + rnd() * 0.05), per = 60 + rnd() * 220;
        ctx.strokeStyle = `rgba(${rnd() < 0.5 ? "30,14,4" : "200,140,80"},${0.12 + rnd() * 0.18})`;
        ctx.beginPath();
        const len = sd.along === "h" ? w : h;
        for (let t = 0; t <= len; t += 8) {
          const wob = Math.sin(t / per + n) * amp;
          const [px, py] = sd.along === "h"
            ? [x + t, (i === 0 ? y : y + h - b) + off + wob]
            : [(i === 3 ? x : x + w - b) + off + wob, y + t];
          t ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  });
  // arêtes des onglets
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,.35)";
  ctx.lineWidth = Math.max(1, b / 60);
  for (const [ax, ay, bx2, by2] of [[x, y, x + b, y + b], [x + w, y, x + w - b, y + b], [x + w, y + h, x + w - b, y + h - b], [x, y + h, x + b, y + h - b]]) {
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx2, by2); ctx.stroke();
  }
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.strokeRect(x + b, y + b, w - 2 * b, h - 2 * b);
  ctx.restore();
}

/* Ombre portée de la moulure sur la photo (effet de profondeur). */
function innerShadow(ctx, x, y, w, h, d) {
  const edges = [
    [x, y, x, y + d, [x, y, w, d]], [x, y + h, x, y + h - d, [x, y + h - d, w, d]],
    [x, y, x + d, y, [x, y, d, h]], [x + w, y, x + w - d, y, [x + w - d, y, d, h]],
  ];
  for (const [x0, y0, x1, y1, r] of edges) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, "rgba(0,0,0,.45)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(...r);
  }
}

/* Ornements baroques : rang de perles sur la moulure + rosaces aux angles. */
function baroqueOrnaments(ctx, x, y, w, h, b) {
  const r = b * 0.07, inset = b * 0.68, step = r * 3.2;
  const pearl = (px, py, rr) => {
    const g = ctx.createRadialGradient(px - rr * 0.35, py - rr * 0.35, rr * 0.1, px, py, rr);
    g.addColorStop(0, "#fff6cf"); g.addColorStop(0.45, "#e2b54e"); g.addColorStop(1, "#6d470f");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill();
  };
  for (let t = x + b; t <= x + w - b; t += step) { pearl(t, y + inset, r); pearl(t, y + h - inset, r); }
  for (let t = y + b; t <= y + h - b; t += step) { pearl(x + inset, t, r); pearl(x + w - inset, t, r); }
  // rosaces : pétales autour d'un cœur
  for (const [cx, cy] of [[x + b * 0.5, y + b * 0.5], [x + w - b * 0.5, y + b * 0.5], [x + b * 0.5, y + h - b * 0.5], [x + w - b * 0.5, y + h - b * 0.5]]) {
    const R = b * 0.36;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.save(); ctx.translate(cx + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.55); ctx.rotate(a);
      const g = ctx.createLinearGradient(-R * 0.4, 0, R * 0.4, 0);
      g.addColorStop(0, "#7a5214"); g.addColorStop(0.5, "#f7dc8a"); g.addColorStop(1, "#8a5e18");
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, R * 0.42, R * 0.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    pearl(cx, cy, R * 0.3);
  }
  // volutes au milieu de chaque côté
  for (const [cx, cy, rot] of [[x + w / 2, y + b * 0.42, 0], [x + w / 2, y + h - b * 0.42, Math.PI], [x + b * 0.42, y + h / 2, -Math.PI / 2], [x + w - b * 0.42, y + h / 2, Math.PI / 2]]) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.strokeStyle = "#fff0b0"; ctx.lineWidth = b * 0.05; ctx.lineCap = "round";
    for (const sgn of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.bezierCurveTo(sgn * b * 0.5, -b * 0.25, sgn * b * 0.9, b * 0.15, sgn * b * 0.55, b * 0.12);
      ctx.stroke();
    }
    pearl(0, 0, b * 0.09);
    ctx.restore();
  }
}

function paintingFrame(photo, id, title, date) {
  const W = photo.width, H = photo.height, m = Math.min(W, H);
  const spec = PAINTING_FRAMES[id];
  if (spec.gallery) {
    // galerie : fin cadre noir, large passe-partout, biseau, cartel
    const f = Math.round(m * 0.03), mat = Math.round(m * 0.12), lab = Math.round(m * 0.13);
    const c = makeCanvas(W + 2 * (f + mat), H + 2 * (f + mat) + lab), ctx = c.getContext("2d");
    moulding(ctx, 0, 0, c.width, c.height, f, ["#000", "#2a2a2a", "#111", "#3a3a3a", "#000"]);
    ctx.fillStyle = "#f7f5ef"; ctx.fillRect(f, f, c.width - 2 * f, c.height - 2 * f);
    const px = f + mat, py = f + mat;
    ctx.fillStyle = "#e4e0d4"; ctx.fillRect(px - m * 0.008, py - m * 0.008, W + m * 0.016, H + m * 0.016); // biseau
    ctx.drawImage(photo, px, py);
    innerShadow(ctx, px, py, W, H, m * 0.012);
    if (title || date) {
      const lw = Math.min(W * 0.6, m * 0.7), lh = lab * 0.66, lx = c.width / 2 - lw / 2, ly = py + H + (mat + lab - lh) / 2;
      const g = ctx.createLinearGradient(lx, ly, lx, ly + lh);
      g.addColorStop(0, "#efe4c4"); g.addColorStop(1, "#cbb98a");
      ctx.fillStyle = g; ctx.fillRect(lx, ly, lw, lh);
      ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = 1; ctx.strokeRect(lx + 0.5, ly + 0.5, lw - 1, lh - 1);
      ctx.fillStyle = "#3b3324"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      fitText(ctx, title, lw * 0.9, lh * 0.36, 'Georgia, "Times New Roman", serif', 700);
      ctx.fillText(title, c.width / 2, ly + lh * (date ? 0.38 : 0.5));
      if (date) { ctx.font = `italic 400 ${Math.round(lh * 0.24)}px Georgia, serif`; ctx.fillText(date, c.width / 2, ly + lh * 0.74); }
    }
    return c;
  }
  const b = Math.round(m * spec.width), lip = Math.round(m * 0.012);
  const c = makeCanvas(W + 2 * (b + lip), H + 2 * (b + lip)), ctx = c.getContext("2d");
  moulding(ctx, 0, 0, c.width, c.height, b, PROFILES[spec.profile], { grain: spec.grain });
  // filet intérieur (marie-louise fine)
  ctx.fillStyle = spec.profile === "wood" ? "#e8dcc2" : spec.profile === "silver" ? "#2b2f33" : "#3a2a10";
  ctx.fillRect(b, b, W + 2 * lip, H + 2 * lip);
  ctx.drawImage(photo, b + lip, b + lip);
  innerShadow(ctx, b + lip, b + lip, W, H, m * 0.02);
  if (spec.ornate) baroqueOrnaments(ctx, 0, 0, c.width, c.height, b);
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
}

/* ── Bande « cabine » : 4 photos (filtrées) → bande verticale ─────── */
export function composeStrip(shots, info = {}) {
  const cw = 900, ch = 675, gap = 22, pad = 34, band = 170;
  const c = makeCanvas(cw + 2 * pad, pad + shots.length * ch + (shots.length - 1) * gap + band), ctx = c.getContext("2d");
  ctx.fillStyle = "#fbfaf5"; ctx.fillRect(0, 0, c.width, c.height);
  shots.forEach((s, i) => {
    // recadrage centré au format 4:3
    const k = Math.max(cw / s.width, ch / s.height), sw = cw / k, sh = ch / k;
    ctx.drawImage(s, (s.width - sw) / 2, (s.height - sh) / 2, sw, sh, pad, pad + i * (ch + gap), cw, ch);
  });
  ctx.fillStyle = "#2b2b2b"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const y0 = c.height - band;
  const s = fitText(ctx, info.title || "", cw, 64, HAND, 700);
  ctx.fillText(info.title || "", c.width / 2, y0 + band * (info.date ? 0.42 : 0.5));
  if (info.date) { ctx.fillStyle = "#777"; ctx.font = `400 ${Math.round(s * 0.55)}px ${HAND}`; ctx.fillText(fmtDate(info.date), c.width / 2, y0 + band * 0.75); }
  return c;
}

/* Prépare les fichiers à envoyer : standard (1600), miniature (480), HD (3200, option). */
export async function exportForUpload(canvas, { keepHd }) {
  const full = await jpegUnder(scaled(canvas, 1600), 0.85, 2.2 * 1024 * 1024);
  const thumb = await jpegUnder(scaled(canvas, 480), 0.72, 350 * 1024);
  const hd = keepHd ? await jpegUnder(scaled(canvas, 3200), 0.92, 3.6 * 1024 * 1024) : null;
  return { full, thumb, hd };
}
