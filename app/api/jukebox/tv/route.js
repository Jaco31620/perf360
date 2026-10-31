/*
 * Jumelage d'une télé (perf360.fr/tv) : la télé affiche un QR code portant
 * son identifiant de jumelage ; le téléphone qui le scanne choisit la soirée
 * (POST { id, code }) ; la télé interroge (GET ?id=…) et ouvre l'écran
 * d'affichage de la soirée. Rangé dans jukebox_config (« tv:<id> »), effacé
 * dès que la télé l'a lu ; ignoré après 10 minutes.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadSession } from "@/lib/jukeboxServer";
import { isValidCode } from "@/lib/jukebox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL = 10 * 60e3;
const validId = (id) => /^[a-z0-9]{8,16}$/.test(String(id || ""));

export async function GET(req) {
  const id = new URL(req.url).searchParams.get("id");
  if (!validId(id)) return Response.json({ error: "Identifiant invalide." }, { status: 400 });
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("jukebox_config").select("value").eq("key", `tv:${id}`).maybeSingle();
  if (!data) return Response.json({ code: null });
  await sb.from("jukebox_config").delete().eq("key", `tv:${id}`);
  let v = null;
  try { v = JSON.parse(data.value); } catch (e) { /* valeur illisible */ }
  return Response.json({ code: v && Date.now() - v.at < TTL ? v.code : null });
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  const { id, code } = body || {};
  if (!validId(id) || !isValidCode(code)) return Response.json({ error: "Requête invalide." }, { status: 400 });
  try {
    if (!(await loadSession(code))) return Response.json({ error: "Soirée introuvable." }, { status: 404 });
    const { error } = await getSupabaseAdmin().from("jukebox_config")
      .upsert({ key: `tv:${id}`, value: JSON.stringify({ code, at: Date.now() }) });
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("jukebox tv:", e);
    return Response.json({ error: "Jumelage impossible." }, { status: 502 });
  }
}
