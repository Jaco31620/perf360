/*
 * État de lecture du karaoké.
 * - GET  : { playing, pos, at, shift, rev, now } — pos (s) est la position dans
 *          la chanson à l'instant `at` (ms, horloge serveur). ?id=<téléphone>
 *          le compte comme « vu » ; ?phones=1 ajoute le nombre de téléphones vus
 *          dans les 5 dernières secondes (affiché par la régie).
 * - POST : { key, playing, pos, shift, at } — réservé à la régie (REGIE_KEY).
 *          `at` = heure (déjà corrigée vers l'horloge serveur) à laquelle la
 *          régie a lu la position de la vidéo : le délai réseau ne fausse pas la
 *          synchro. Ignoré s'il s'écarte de plus de 10 s de l'heure serveur.
 */
import { getState, setState, seePhone, countPhones } from "@/lib/laure50Store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const regieKey = () => process.env.REGIE_KEY || (process.env.NODE_ENV !== "production" ? "laure" : null);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export async function GET(req) {
  const url = new URL(req.url);
  try {
    const id = url.searchParams.get("id");
    if (id && /^[a-z0-9-]{8,64}$/i.test(id)) await seePhone(id);
    const state = await getState();
    const out = { ...state, now: Date.now() };
    if (url.searchParams.get("phones")) out.phones = await countPhones(5000);
    return Response.json(out, { headers: NO_STORE });
  } catch (e) {
    console.error("laure50 state GET:", e);
    return Response.json({ error: "Indisponible." }, { status: 502, headers: NO_STORE });
  }
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400, headers: NO_STORE }); }

  const key = regieKey();
  if (!key) return Response.json({ error: "REGIE_KEY non configurée." }, { status: 503, headers: NO_STORE });
  if (body?.key !== key) return Response.json({ error: "Clé régie incorrecte." }, { status: 403, headers: NO_STORE });

  const now = Date.now();
  const at = Math.abs(num(body.at, now) - now) < 10000 ? num(body.at, now) : now;
  try {
    const state = await setState({
      playing: !!body.playing,
      pos: Math.max(0, num(body.pos)),
      shift: Math.max(-2, Math.min(2, num(body.shift))),
      at: Math.round(at),
    });
    return Response.json({ ...state, now }, { headers: NO_STORE });
  } catch (e) {
    console.error("laure50 state POST:", e);
    return Response.json({ error: "Écriture impossible." }, { status: 502, headers: NO_STORE });
  }
}
