/*
 * Route serveur RÉGIE d'une soirée jukebox (en-tête x-jukebox-admin requis).
 * Body : { action, ... }
 *   open | close           → ouvrir / fermer les propositions
 *   max { max }            → titres en attente par participant (0 = illimité)
 *   searchMode { mode }    → recherche normale | paroles | karaoke
 *   options { screenQueue?, guestQueue? } → file visible sur l'écran / chez les invités
 *   name { name }          → renommer la soirée
 *   next { from, skip }    → titre suivant. `from` = id du titre que la régie
 *                            croit en cours (null si aucun) : si ce n'est plus
 *                            le cas, rien ne bouge (double appel, 2e onglet…)
 *   playback { id, pos, playing } → position de lecture de la régie (pour
 *                            l'écran d'affichage), horodatée par le serveur
 *   move { id, dir }       → up | down | top dans la file
 *   remove { id }          → retirer un titre en attente
 *   reset                  → vider la file (et l'historique)
 *   delete                 → supprimer la soirée
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadSession, checkToken } from "@/lib/jukeboxServer";
import { MAX_NAME_LEN, normalizeMax, normalizeMode } from "@/lib/jukebox";

export const runtime = "nodejs";

export async function POST(req, { params }) {
  const { code } = await params;
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }

  try {
    const s = await loadSession(code);
    if (!s) return Response.json({ error: "Soirée introuvable." }, { status: 404 });
    if (!checkToken(req.headers.get("x-jukebox-admin"), s.admin_hash))
      return Response.json({ error: "Accès refusé." }, { status: 401 });

    const sb = getSupabaseAdmin();
    const update = (patch) => sb.from("jukebox_sessions").update(patch).eq("id", s.id);
    const tracks = () => sb.from("jukebox_tracks");
    const queued = async () => {
      const { data, error } = await tracks().select("id,position")
        .eq("session_id", s.id).eq("status", "queued").order("position");
      if (error) throw error;
      return data;
    };
    let res = { error: null };

    switch (body?.action) {
      case "open":
      case "close":
        res = await update({ status: body.action === "open" ? "open" : "closed" });
        break;
      case "max":
        res = await update({ max_per_participant: normalizeMax(body.max) });
        break;
      case "searchMode":
        res = await update({ options: { ...(s.options || {}), searchMode: normalizeMode(body.mode) }, karaoke: false });
        break;
      case "options": {
        const options = { ...(s.options || {}) };
        for (const k of ["screenQueue", "guestQueue"]) if (k in body) options[k] = !!body[k];
        res = await update({ options });
        break;
      }
      case "name": {
        const name = String(body.name || "").trim().slice(0, MAX_NAME_LEN);
        if (!name) return Response.json({ error: "Nom vide." }, { status: 400 });
        res = await update({ name });
        break;
      }
      case "next": {
        const { data: cur, error } = await tracks().select("id").eq("session_id", s.id).eq("status", "playing");
        if (error) throw error;
        if ((cur[0]?.id || null) !== (body.from || null)) break;
        if (cur.length) {
          res = await tracks().update({ status: body.skip ? "skipped" : "played" })
            .eq("session_id", s.id).eq("status", "playing");
          if (res.error) break;
        }
        const [nxt] = await queued();
        if (nxt) res = await tracks().update({ status: "playing", played_at: new Date().toISOString() }).eq("id", nxt.id);
        break;
      }
      case "playback": {
        const pos = Number(body.pos);
        if (typeof body.id !== "string" || !Number.isFinite(pos) || pos < 0 || pos > 86400)
          return Response.json({ error: "Position invalide." }, { status: 400 });
        res = await update({ playback: { id: body.id, pos, playing: !!body.playing, at: Date.now() } });
        break;
      }
      case "move": {
        const q = await queued();
        const i = q.findIndex((t) => t.id === body.id);
        if (i < 0) return Response.json({ error: "Titre introuvable." }, { status: 404 });
        if (body.dir === "top") {
          if (i > 0) res = await tracks().update({ position: q[0].position - 1 }).eq("id", q[i].id);
          break;
        }
        const j = body.dir === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= q.length) break;
        res = await tracks().update({ position: q[j].position }).eq("id", q[i].id);
        if (!res.error) res = await tracks().update({ position: q[i].position }).eq("id", q[j].id);
        break;
      }
      case "remove":
        res = await tracks().delete().eq("session_id", s.id).eq("id", String(body.id || "")).eq("status", "queued");
        break;
      case "reset":
        res = await tracks().delete().eq("session_id", s.id);
        break;
      case "delete":
        res = await sb.from("jukebox_sessions").delete().eq("id", s.id);
        break;
      default:
        return Response.json({ error: "Action inconnue." }, { status: 400 });
    }
    if (res.error) throw res.error;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("jukebox admin:", e);
    return Response.json({ error: "Action impossible." }, { status: 502 });
  }
}
