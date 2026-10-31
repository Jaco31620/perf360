/*
 * Route CRON — pré-remplissage de la mémoire des titres du jukebox (voir
 * lib/jukeboxPrefill.js). Déclenchée chaque jour à 5 h UTC (vercel.json),
 * avant la remise à zéro du quota YouTube : utilise le reste du quota du jour.
 * Puis, avec le temps restant, enrichissement de la mémoire (année, langue :
 * Deezer + MusicBrainz, sans quota YouTube ; lib/jukeboxEnrich.js).
 * Même protection que /api/keep-alive (CRON_SECRET si défini).
 */
import { runPrefill } from "@/lib/jukeboxPrefill";
import { enrichSongs } from "@/lib/jukeboxEnrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret && (request.headers.get("authorization") || "") !== `Bearer ${secret}`)
    return Response.json({ status: "error", reason: "unauthorized" }, { status: 401 });
  // sans secret : seulement dans le créneau du cron (ne pas vider le quota d'une soirée)
  const h = new Date().getUTCHours();
  if (!secret && (h < 5 || h > 6))
    return Response.json({ status: "error", reason: "outside window" }, { status: 403 });
  try {
    const start = Date.now();
    const prefill = await runPrefill(150e3);
    const enrich = await enrichSongs(Math.max(0, 280e3 - (Date.now() - start))).catch((e) => ({ error: String(e?.message || e) }));
    return Response.json({ status: "ok", ...prefill, enrich });
  } catch (e) {
    console.error("jukebox prefill:", e);
    return Response.json({ status: "error", reason: String(e?.message || e) }, { status: 500 });
  }
}
