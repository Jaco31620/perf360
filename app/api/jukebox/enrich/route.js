/*
 * Route de nuit — enrichissement de la mémoire des titres (année, langue, ISRC,
 * vérification des années ; lib/jukeboxEnrich.js). Lancée par
 * /api/jukebox/prefill, puis par elle-même tant qu'il reste du travail, dans la
 * limite de MAX_ROUNDS tours. Sans quota YouTube.
 * Même protection que /api/jukebox/prefill (CRON_SECRET si défini).
 */
import { tooMany } from "@/lib/jukeboxRate";
import { enrichRound, launchEnrichRound, MAX_ROUNDS } from "@/lib/jukeboxEnrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret && (request.headers.get("authorization") || "") !== `Bearer ${secret}`)
    return Response.json({ status: "error", reason: "unauthorized" }, { status: 401 });
  const h = new Date().getUTCHours();
  if (!secret && (h < 5 || h > 6))
    return Response.json({ status: "error", reason: "outside window" }, { status: 403 });
  if (!secret && await tooMany("enrich", MAX_ROUNDS + 2, 7200))
    return Response.json({ status: "error", reason: "too many" }, { status: 429 });
  const url = new URL(request.url);
  const round = Math.min(MAX_ROUNDS, Math.max(1, parseInt(url.searchParams.get("round"), 10) || 1));
  try {
    const res = await enrichRound(round);
    if (!res.stop) await launchEnrichRound(url.origin, round + 1);
    return Response.json({ status: "ok", ...res });
  } catch (e) {
    console.error("jukebox enrich:", e);
    return Response.json({ status: "error", reason: String(e?.message || e) }, { status: 500 });
  }
}
