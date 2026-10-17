/*
 * Karaoké Laure 50 ans — stockage SERVEUR de l'état de lecture (une seule
 * ligne) et des téléphones vus récemment. Supabase (service_role) ; repli en
 * mémoire (globalThis) si les variables Supabase sont absentes, ou si
 * LAURE50_STORE=memory (tests locaux sans toucher la base).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const EMPTY = { playing: false, pos: 0, at: 0, shift: 0, rev: 0 };
const mem = (globalThis.__laure50 ??= { state: { ...EMPTY }, phones: new Map() });

function db() {
  if (process.env.LAURE50_STORE === "memory") return null;
  try { return getSupabaseAdmin(); } catch (e) { return null; }
}

export async function getState() {
  const sb = db();
  if (!sb) return mem.state;
  const { data, error } = await sb.from("laure50_state").select("playing,pos,at,shift,rev").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data ? { ...data, at: Number(data.at) } : { ...EMPTY };
}

export async function setState({ playing, pos, shift, at }) {
  const sb = db();
  if (!sb) {
    mem.state = { playing, pos, shift, at, rev: mem.state.rev + 1 };
    return mem.state;
  }
  const cur = await getState();
  const next = { id: 1, playing, pos, shift, at, rev: (cur.rev || 0) + 1 };
  const { error } = await sb.from("laure50_state").upsert(next);
  if (error) throw error;
  return next;
}

/* Clé régie : variable d'environnement REGIE_KEY, sinon colonne regie_key de
 * laure50_state (jamais renvoyée par getState), sinon « laure » hors production. */
export async function getRegieKey() {
  if (process.env.REGIE_KEY) return process.env.REGIE_KEY;
  const sb = db();
  if (sb) {
    const { data, error } = await sb.from("laure50_state").select("regie_key").eq("id", 1).maybeSingle();
    if (error) throw error;
    if (data?.regie_key) return data.regie_key;
  }
  return process.env.NODE_ENV !== "production" ? "laure" : null;
}

export async function seePhone(id) {
  const sb = db();
  if (!sb) { mem.phones.set(id, Date.now()); return; }
  const { error } = await sb.from("laure50_phones").upsert({ id, seen: new Date().toISOString() });
  if (error) throw error;
}

/* Nombre de téléphones vus dans les `windowMs` dernières millisecondes. */
export async function countPhones(windowMs = 5000) {
  const since = Date.now() - windowMs;
  const sb = db();
  if (!sb) return [...mem.phones.values()].filter((t) => t >= since).length;
  const { count, error } = await sb.from("laure50_phones")
    .select("id", { count: "exact", head: true })
    .gte("seen", new Date(since).toISOString());
  if (error) throw error;
  return count || 0;
}
