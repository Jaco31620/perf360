/*
 * Album (public, réservé aux détenteurs du code) : nom, date, réglages utiles
 * aux invités. ?guest=<id> ajoute le nombre de photos déjà prises par l'invité.
 * Avec un jeton admin/super/borne : ajoute le rôle et l'utilisation.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAlbum, publicAlbum, roleFor, canAdmin, albumUsage } from "@/lib/clicclac/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const validGuest = (g) => /^[a-z0-9-]{8,64}$/i.test(String(g || ""));

export async function GET(req, { params }) {
  const { code } = await params;
  try {
    const a = await loadAlbum(code);
    if (!a) return Response.json({ error: "Album introuvable." }, { status: 404 });
    const out = { album: await publicAlbum(a) };
    const guest = new URL(req.url).searchParams.get("guest");
    if (validGuest(guest)) {
      const { count } = await getSupabaseAdmin().from("clicclac_photos").select("id", { count: "exact", head: true })
        .eq("album_id", a.id).eq("guest_id", guest);
      out.taken = count || 0;
    }
    const role = roleFor(req, a);
    if (role) out.role = role;
    if (canAdmin(role) || role === "booth") out.usage = await albumUsage(a.id);
    if (canAdmin(role)) out.admin = { settings: a.settings, adminEmail: a.admin_email };
    return Response.json(out, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("clicclac album GET:", e);
    return Response.json({ error: "Chargement impossible." }, { status: 502 });
  }
}
