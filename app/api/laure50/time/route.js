/* Heure serveur, pour la synchronisation d'horloge façon NTP (téléphones et régie). */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ t: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
