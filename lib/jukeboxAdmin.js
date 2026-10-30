/*
 * Jukebox — super-admin et fin de vie des soirées (SERVEUR uniquement).
 *  - Connexion avec le mot de passe super-admin de Clic-Clac → jeton signé de
 *    portée « jukebox:super » (en-tête x-jukebox-super), valable 3 jours.
 *  - Réglages dans jukebox_config : durée de conservation, mode de création
 *    (open = tout le monde, code = code de création, super = super-admin seul),
 *    moteur de recherche des invités (deezer = sans quota, ou youtube).
 *  - Purge : soirées sans activité depuis plus de N jours (via /api/keep-alive).
 */
import { checkMasterPassword, signToken, verifyToken } from "@/lib/clicclac/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeFeatures } from "@/lib/jukebox";

const SCOPE = "jukebox:super";
const DAY = 24 * 3600 * 1000;

export const checkSuperPassword = checkMasterPassword;
export const superToken = () => signToken(SCOPE, 3 * DAY);
export const isJukeboxSuper = (req) => verifyToken(req.headers.get("x-jukebox-super"))?.scope === SCOPE;

/* ---------- Réglages ---------- */

export const RETENTION_CHOICES = [1, 2, 3, 7, 14, 30];
export const CREATION_MODES = ["open", "code", "super"];
export const SEARCH_ENGINES = ["deezer", "youtube"];
const DEFAULTS = { retentionDays: 7, creationMode: "open", creationCode: "", searchEngine: "deezer" };
const KEYS = { retentionDays: "retention_days", creationMode: "creation_mode", creationCode: "creation_code", searchEngine: "search_engine", defaultFeatures: "default_features" };

const parseJson = (v) => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };

export async function loadConfig() {
  const { data, error } = await getSupabaseAdmin()
    .from("jukebox_config").select("key,value").in("key", Object.values(KEYS));
  if (error) throw error;
  const raw = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  const days = parseInt(raw.retention_days, 10);
  return {
    retentionDays: RETENTION_CHOICES.includes(days) ? days : DEFAULTS.retentionDays,
    creationMode: CREATION_MODES.includes(raw.creation_mode) ? raw.creation_mode : DEFAULTS.creationMode,
    creationCode: raw.creation_code || DEFAULTS.creationCode,
    searchEngine: SEARCH_ENGINES.includes(raw.search_engine) ? raw.search_engine : DEFAULTS.searchEngine,
    defaultFeatures: normalizeFeatures(parseJson(raw.default_features)), // soirées créées par d'autres
  };
}

export async function saveConfig(patch) {
  const rows = [];
  if (RETENTION_CHOICES.includes(Number(patch.retentionDays))) rows.push({ key: KEYS.retentionDays, value: String(patch.retentionDays) });
  if (CREATION_MODES.includes(patch.creationMode)) rows.push({ key: KEYS.creationMode, value: patch.creationMode });
  if (SEARCH_ENGINES.includes(patch.searchEngine)) rows.push({ key: KEYS.searchEngine, value: patch.searchEngine });
  if (patch.defaultFeatures && typeof patch.defaultFeatures === "object") {
    const current = (await loadConfig()).defaultFeatures;
    rows.push({ key: KEYS.defaultFeatures, value: JSON.stringify(normalizeFeatures(patch.defaultFeatures, current)) });
  }
  if (typeof patch.creationCode === "string")
    rows.push({ key: KEYS.creationCode, value: patch.creationCode.trim().toUpperCase().slice(0, 20) });
  if (!rows.length) return;
  const { error } = await getSupabaseAdmin().from("jukebox_config").upsert(rows);
  if (error) throw error;
}

export const sameCode = (a, b) => !!b && String(a || "").trim().toUpperCase() === String(b).trim().toUpperCase();

/* ---------- Soirées et activité ---------- */

/* Toutes les soirées avec leur dernière activité (création, ajout, titre
 * lancé, position envoyée par la régie) et leurs compteurs. */
export async function sessionsWithActivity() {
  const sb = getSupabaseAdmin();
  const { data: sessions, error } = await sb.from("jukebox_sessions")
    .select("id,code,name,status,created_at,playback,options").order("created_at", { ascending: false });
  if (error) throw error;
  const { data: tracks, error: e2 } = await sb.from("jukebox_tracks").select("session_id,status,created_at,played_at");
  if (e2) throw e2;
  const stats = {};
  for (const t of tracks || []) {
    const st = (stats[t.session_id] ||= { played: 0, queued: 0, last: 0 });
    if (t.status === "queued") st.queued++;
    else st.played++;
    st.last = Math.max(st.last, Date.parse(t.created_at) || 0, Date.parse(t.played_at) || 0);
  }
  return sessions.map((s) => {
    const st = stats[s.id] || { played: 0, queued: 0, last: 0 };
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      status: s.status,
      createdAt: s.created_at,
      features: normalizeFeatures(s.options?.features),
      played: st.played,
      queued: st.queued,
      lastActivity: Math.max(Date.parse(s.created_at) || 0, st.last, Number(s.playback?.at) || 0),
    };
  });
}

/* Recherches YouTube depuis la remise à zéro du quota (minuit, heure du
 * Pacifique) : chaque recherche non servie par le cache écrit une ligne. */
export async function searchesToday() {
  const pt = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const since = Date.now() - ((pt.getHours() * 60 + pt.getMinutes()) * 60 + pt.getSeconds()) * 1000;
  const { count, error } = await getSupabaseAdmin().from("jukebox_cache")
    .select("q", { count: "exact", head: true }).gte("created_at", new Date(since).toISOString());
  if (error) throw error;
  return count || 0;
}

/* ---------- Purge (appelée par /api/keep-alive) ---------- */

export async function purgeJukebox() {
  const sb = getSupabaseAdmin();
  const { retentionDays } = await loadConfig();
  const limit = Date.now() - retentionDays * DAY;
  const old = (await sessionsWithActivity()).filter((s) => s.lastActivity < limit);
  if (old.length) {
    const { error } = await sb.from("jukebox_sessions").delete().in("id", old.map((s) => s.id));
    if (error) throw error;
  }
  // logos des soirées supprimées (jukebox_config « logo:<id de la soirée> »)
  const { data: logos } = await sb.from("jukebox_config").select("key").like("key", "logo:%");
  if (logos?.length) {
    const { data: alive } = await sb.from("jukebox_sessions").select("id");
    const ids = new Set((alive || []).map((r) => r.id));
    const orphans = logos.map((r) => r.key).filter((k) => !ids.has(k.slice(5)));
    if (orphans.length) await sb.from("jukebox_config").delete().in("key", orphans);
  }
  // cache des recherches YouTube : 30 jours maximum
  await sb.from("jukebox_cache").delete().lt("created_at", new Date(Date.now() - 30 * DAY).toISOString());
  return { deleted: old.length };
}
