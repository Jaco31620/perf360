/*
 * Route SUPER-ADMIN du jukebox (en-tête x-jukebox-super requis).
 * - GET  : toutes les soirées (activité, compteurs, date de suppression),
 *          réglages, recherches YouTube du jour.
 * - POST : { action, ... }
 *     settings { retentionDays?, creationMode?, creationCode? }
 *     regie { code }   → nouveau lien régie (l'ancien ne fonctionne plus)
 *     delete { code }  → supprimer une soirée
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isJukeboxSuper, loadConfig, saveConfig, sessionsWithActivity, searchesToday } from "@/lib/jukeboxAdmin";
import { loadSession, newAdminToken, hashToken } from "@/lib/jukeboxServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 3600 * 1000;

export async function GET(req) {
  if (!isJukeboxSuper(req)) return Response.json({ error: "Accès refusé." }, { status: 401 });
  try {
    const [config, sessions, searches] = await Promise.all([loadConfig(), sessionsWithActivity(), searchesToday()]);
    return Response.json({
      config,
      searches,
      sessions: sessions.map(({ id, ...s }) => ({ ...s, expiresAt: s.lastActivity + config.retentionDays * DAY })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("jukebox super GET:", e);
    return Response.json({ error: "Chargement impossible." }, { status: 502 });
  }
}

export async function POST(req) {
  if (!isJukeboxSuper(req)) return Response.json({ error: "Accès refusé." }, { status: 401 });
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  try {
    switch (body?.action) {
      case "settings":
        await saveConfig(body);
        return Response.json({ ok: true });
      case "regie":
      case "delete": {
        const s = await loadSession(body.code);
        if (!s) return Response.json({ error: "Soirée introuvable." }, { status: 404 });
        const sb = getSupabaseAdmin();
        if (body.action === "delete") {
          const { error } = await sb.from("jukebox_sessions").delete().eq("id", s.id);
          if (error) throw error;
          return Response.json({ ok: true });
        }
        const token = newAdminToken();
        const { error } = await sb.from("jukebox_sessions").update({ admin_hash: hashToken(token) }).eq("id", s.id);
        if (error) throw error;
        return Response.json({ ok: true, adminToken: token });
      }
      default:
        return Response.json({ error: "Action inconnue." }, { status: 400 });
    }
  } catch (e) {
    console.error("jukebox super POST:", e);
    return Response.json({ error: "Action impossible." }, { status: 502 });
  }
}
