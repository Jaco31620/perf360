/*
 * Jukebox — journal d'événements d'une soirée (SERVEUR, table jukebox_events,
 * SQL v27) : qui a fait quoi et quand (ajouts, sauts, pause, son pris sur un
 * appareil, blind test, erreurs du lecteur…). Sert au diagnostic d'une soirée
 * (fiche super-admin) et aux stats. Jamais bloquant : table absente ou erreur
 * = événement perdu, l'action continue.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const FROM = { regie: "Régie", telecommande: "Télécommande", ecran: "Télé" };

/* Auteur d'une action de régie : écran d'origine (en-tête posé par le
 * client), super-admin, sinon « Régie ». */
export function actorOf(req, { isSuper = false } = {}) {
  const from = FROM[req?.headers?.get?.("x-jukebox-from")] || null;
  if (isSuper && !req?.headers?.get?.("x-jukebox-admin")) return "Super-admin";
  return from || (isSuper ? "Super-admin" : "Régie");
}

const clip = (v, n = 200) => (typeof v === "string" ? v.slice(0, n) : v);

export async function logEvent(sessionId, kind, actor = null, data = null) {
  if (!sessionId || !kind) return;
  try {
    const clean = data && typeof data === "object"
      ? Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, clip(v)]))
      : null;
    const { error } = await getSupabaseAdmin().from("jukebox_events").insert({
      session_id: sessionId, kind: String(kind).slice(0, 40), actor: actor ? String(actor).slice(0, 80) : null,
      data: clean && Object.keys(clean).length ? clean : null,
    });
    if (error && error.code !== "42P01" && error.code !== "PGRST205") console.warn("jukebox event:", error.message);
  } catch (e) { /* journal facultatif */ }
}

/* Journal d'une soirée, du plus récent au plus ancien. null : table absente. */
export async function listEvents(sessionId, limit = 500) {
  const { data, error } = await getSupabaseAdmin().from("jukebox_events")
    .select("id,at,kind,actor,data").eq("session_id", sessionId).order("at", { ascending: false }).limit(limit);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return null;
    throw error;
  }
  // incidents du lecteur : titre concerné (identifiant du titre → « interprète – titre »)
  const ids = [...new Set((data || []).map((e) => e.data?.track).filter((t) => /^[0-9a-f-]{36}$/i.test(String(t || ""))))];
  if (ids.length) {
    const { data: tracks } = await getSupabaseAdmin().from("jukebox_tracks").select("id,title,channel").in("id", ids);
    const name = new Map((tracks || []).map((t) => [t.id, `${t.channel} – ${t.title}`]));
    for (const e of data) if (e.data?.track && name.has(e.data.track) && !e.data.title) e.data = { title: name.get(e.data.track), ...e.data };
  }
  return data || [];
}
