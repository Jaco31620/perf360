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
