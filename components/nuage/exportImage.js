"use client";
/*
 * Export du nuage en image PNG (téléchargement ou envoi par e-mail) : 1920×1080, fond et couleurs du
 * style choisi, question en titre — sans QR code ni boutons. Le nuage est
 * recalculé pour ce format (et non copié de l'écran).
 */
import { computeCloud, CLOUD_FONT } from "./WordCloud";

const WIDTH = 1920, HEIGHT = 1080, PAD = 60;

/* Charge une image distante utilisable dans le canevas (CORS), ou null. */
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* Coupe la question en 2 lignes max à la largeur donnée. */
function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > 2) lines.splice(1, lines.length - 1, lines.slice(1).join(" ").slice(0, 80) + "…");
  return lines;
}

/* Dessine le nuage dans un PNG (Blob). */
export async function renderCloudBlob({ words, theme, question }) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Titre en haut à gauche : image (logo) si définie, sinon la question.
  // Comme à l'écran, le nuage occupe toute l'image et contourne ce titre.
  let title = null; // rectangle occupé, en coordonnées de la zone du nuage
  const logo = theme.image ? await loadImage(theme.image) : null;
  if (logo) {
    const maxH = { s: 130, m: 170, l: 220 }[theme.imageSize] || 170; // suit le réglage « Taille »
    const h = Math.min(maxH, logo.height * ((WIDTH * 0.45) / logo.width));
    const w = (logo.width * h) / logo.height;
    ctx.drawImage(logo, PAD, PAD, w, h);
    title = { w, h };
  } else if (question) {
    ctx.font = `800 52px ${CLOUD_FONT}`;
    ctx.fillStyle = theme.fg;
    ctx.textBaseline = "top";
    const lines = wrap(ctx, question, WIDTH * 0.6);
    lines.forEach((l, i) => ctx.fillText(l, PAD, PAD + i * 64));
    title = { w: Math.max(...lines.map((l) => ctx.measureText(l).width)), h: lines.length * 64 - 6 };
  }

  // Nuage
  const M = 18; // marge autour du titre
  const placed = computeCloud(words, WIDTH - 2 * PAD, HEIGHT - 2 * PAD, {
    weight: theme.weight, arrangement: theme.arrangement, effect: theme.effect, nColors: theme.colors.length,
    obstacles: title ? [{ x: -M, y: -M, w: title.w + 2 * M, h: title.h + 2 * M }] : [],
  });
  ctx.textBaseline = "alphabetic";
  for (const p of placed) {
    ctx.font = `${theme.weight} ${p.size}px ${CLOUD_FONT}`;
    ctx.fillStyle = theme.colors[p.color];
    ctx.fillText(p.text, PAD + p.bx, PAD + p.by);
  }

  return new Promise((res) => canvas.toBlob(res, "image/png"));
}

/* Télécharge le PNG. */
export async function exportCloudImage({ words, theme, question, filename }) {
  const blob = await renderCloudBlob({ words, theme, question });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* PNG → base64 (sans l'en-tête data:), pour l'envoi par e-mail. */
export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
