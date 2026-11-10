/*
 * Route CRON — pré-remplissage de la mémoire des titres du jukebox (voir
 * lib/jukeboxPrefill.js). Déclenchée chaque jour à 5 h UTC (vercel.json),
 * avant la remise à zéro du quota YouTube : utilise le reste du quota du jour,
 * puis la recherche des versions manquantes (paroles, clips : lib/jukeboxClip.js).
 * Puis lance l'enrichissement de la mémoire, sur ses propres fonctions
 * (/api/jukebox/enrich), quoi qu'il soit arrivé ici.
 * Même protection que /api/keep-alive (CRON_SECRET si défini).
 */
import { tooMany } from "@/lib/jukeboxRate";
import { runPrefill } from "@/lib/jukeboxPrefill";
import { launchEnrichRound } from "@/lib/jukeboxEnrich";
import { scanVersions } from "@/lib/jukeboxClip";

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
  if (!secret && await tooMany("prefill", 2, 7200)) // sans secret : pas d'appels répétés dans le créneau
    return Response.json({ status: "error", reason: "too many" }, { status: 429 });
  try {
    const start = Date.now();
    const prefill = await runPrefill(150e3);
    // versions manquantes : après le pré-remplissage (prioritaire), avec le reste du quota
    const scan = prefill.stop === "quota" ? { stop: "quota", skipped: true }
      : await scanVersions(Math.max(0, 270e3 - (Date.now() - start))).catch((e) => ({ error: String(e?.message || e) }));
    return Response.json({ status: "ok", ...prefill, scan });
  } catch (e) {
    console.error("jukebox prefill:", e);
    return Response.json({ status: "error", reason: String(e?.message || e) }, { status: 500 });
  } finally {
    await launchEnrichRound(new URL(request.url).origin, 1);
  }
}
