/*
 * Route serveur PRÉSENTATEUR d'un nuage de mots (en-tête x-nuage-admin requis).
 * Body : { action, ... }
 *   open | close            → ouvrir / fermer les envois
 *   question { question }   → modifier la question
 *   max { max }             → nombre de mots par participant (0 = illimité)
 *   style { style }         → palette de couleurs + fond { palette, bg }
 *   hide | unhide { key }   → masquer / ré-afficher un mot
 *   remove { key }          → supprimer toutes les occurrences d'un mot
 *   rename { key, word }    → corriger un mot (fusionne s'il existe déjà)
 *   count { key, n }        → fixer le nombre d'occurrences d'un mot (0 → supprimé) :
 *                             ajout d'envois « admin », retrait des envois admin
 *                             puis des plus récents
 *   reset                   → effacer tous les mots
 *   delete                  → supprimer le nuage
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadSession, checkToken } from "@/lib/nuageServer";
import { MAX_QUESTION_LEN, normalizeMax, cleanWord, wordKey } from "@/lib/nuage";
import { normalizeStyle } from "@/lib/nuageThemes";

export const runtime = "nodejs";

export async function POST(req, { params }) {
  const { code } = await params;
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }

  try {
    const s = await loadSession(code);
    if (!s) return Response.json({ error: "Nuage introuvable." }, { status: 404 });
    if (!checkToken(req.headers.get("x-nuage-admin"), s.admin_hash))
      return Response.json({ error: "Accès refusé." }, { status: 401 });

    const sb = getSupabaseAdmin();
    const update = (patch) => sb.from("nuage_sessions").update(patch).eq("id", s.id);
    let res;

    switch (body?.action) {
      case "open":
      case "close":
        res = await update({ status: body.action === "open" ? "open" : "closed" });
        break;
      case "question": {
        const q = String(body.question || "").trim().slice(0, MAX_QUESTION_LEN);
        if (!q) return Response.json({ error: "Question vide." }, { status: 400 });
        res = await update({ question: q });
        break;
      }
      case "max":
        res = await update({ max_per_participant: normalizeMax(body.max) });
        break;
      case "style":
        // l'image de titre ne se change que via /image (jamais écrasée ici)
        res = await update({ style: { ...normalizeStyle(body.style), image: normalizeStyle(s.style).image } });
        break;
      case "hide":
      case "unhide": {
        const key = String(body.key || "");
        const set = new Set(s.hidden || []);
        body.action === "hide" ? set.add(key) : set.delete(key);
        res = await update({ hidden: [...set] });
        break;
      }
      case "count": {
        const key = String(body.key || "");
        const target = parseInt(body.n, 10);
        if (!Number.isFinite(target) || target < 0 || target > 999)
          return Response.json({ error: "Nombre invalide (0 à 999)." }, { status: 400 });
        const { data: rows, error } = await sb.from("nuage_words")
          .select("id,word,participant_id,created_at").eq("session_id", s.id).eq("word_key", key);
        if (error) throw error;
        const cur = rows.length;
        if (!cur) return Response.json({ error: "Mot introuvable." }, { status: 404 });
        if (target > cur) {
          // même graphie que la forme la plus fréquente (l'affichage ne change pas)
          const freq = {};
          for (const r of rows) freq[r.word] = (freq[r.word] || 0) + 1;
          const word = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
          res = await sb.from("nuage_words").insert(
            Array.from({ length: target - cur }, () => ({ session_id: s.id, word_key: key, word, participant_id: "admin" }))
          );
        } else if (target < cur) {
          const order = [...rows].sort((a, b) =>
            (b.participant_id === "admin") - (a.participant_id === "admin") || new Date(b.created_at) - new Date(a.created_at));
          res = await sb.from("nuage_words").delete().in("id", order.slice(0, cur - target).map((r) => r.id));
        } else {
          res = { error: null };
        }
        break;
      }
      case "remove":
        res = await sb.from("nuage_words").delete().eq("session_id", s.id).eq("word_key", String(body.key || ""));
        break;
      case "rename": {
        const key = String(body.key || "");
        const word = cleanWord(body.word);
        const newKey = wordKey(word);
        if (!newKey) return Response.json({ error: "Mot vide." }, { status: 400 });
        res = await sb.from("nuage_words").update({ word, word_key: newKey })
          .eq("session_id", s.id).eq("word_key", key);
        // un mot corrigé redevient visible
        if (!res.error && (s.hidden || []).includes(key))
          res = await update({ hidden: (s.hidden || []).filter((k) => k !== key) });
        break;
      }
      case "reset":
        res = await sb.from("nuage_words").delete().eq("session_id", s.id);
        if (!res.error) res = await update({ hidden: [] });
        break;
      case "delete": {
        res = await sb.from("nuage_sessions").delete().eq("id", s.id);
        // images de titre du nuage
        const { data: files } = await sb.storage.from("nuage-assets").list(s.code);
        if (files?.length) await sb.storage.from("nuage-assets").remove(files.map((f) => `${s.code}/${f.name}`));
        break;
      }
      default:
        return Response.json({ error: "Action inconnue." }, { status: 400 });
    }
    if (res.error) throw res.error;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("nuage admin:", e);
    return Response.json({ error: "Action impossible." }, { status: 502 });
  }
}
