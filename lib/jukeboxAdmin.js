/*
 * Jukebox — super-admin et fin de vie des soirées (SERVEUR uniquement).
 *  - Connexion avec le mot de passe super-admin de Clic-Clac → jeton signé de
 *    portée « jukebox:super » (en-tête x-jukebox-super), valable 3 jours.
 *  - Réglages dans jukebox_config : durée de conservation, mode de création
 *    (open = tout le monde, code = code d'activation individuel —
 *    lib/jukeboxActivation.js —, super = super-admin seul),
 *    moteur de recherche des invités (deezer = sans quota, ou youtube).
 *  - Purge : soirées sans activité depuis plus de N jours (via /api/keep-alive) ;
 *    N = conservation propre à la soirée (options.retentionDays), sinon globale.
 */
import { purgeRate } from "@/lib/jukeboxRate";
import { checkMasterPassword, signToken, verifyToken } from "@/lib/clicclac/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeFeatures, normalizeDefaults, RETENTION_CHOICES, cleanRetention } from "@/lib/jukebox";

const SCOPE = "jukebox:super";
const DAY = 24 * 3600 * 1000;

export const checkSuperPassword = checkMasterPassword;
export const superToken = () => signToken(SCOPE, 3 * DAY);
export const isJukeboxSuper = (req) => verifyToken(req.headers.get("x-jukebox-super"))?.scope === SCOPE;

/* ---------- Réglages ---------- */

export { RETENTION_CHOICES };
export const CREATION_MODES = ["open", "code", "super"];
const DEFAULTS = { retentionDays: 7, creationMode: "open" };
const KEYS = { retentionDays: "retention_days", creationMode: "creation_mode", defaultFeatures: "default_features", defaultOptions: "default_options" };

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
    defaultFeatures: normalizeFeatures(parseJson(raw.default_features)), // soirées créées par d'autres
    defaultOptions: normalizeDefaults(parseJson(raw.default_options)), // réglages de départ des nouvelles soirées
  };
}

export async function saveConfig(patch) {
  const rows = [];
  if (RETENTION_CHOICES.includes(Number(patch.retentionDays))) rows.push({ key: KEYS.retentionDays, value: String(patch.retentionDays) });
  if (CREATION_MODES.includes(patch.creationMode)) rows.push({ key: KEYS.creationMode, value: patch.creationMode });
  if (patch.defaultFeatures && typeof patch.defaultFeatures === "object") {
    const current = (await loadConfig()).defaultFeatures;
    rows.push({ key: KEYS.defaultFeatures, value: JSON.stringify(normalizeFeatures(patch.defaultFeatures, current)) });
  }
  if (patch.defaultOptions && typeof patch.defaultOptions === "object") {
    const current = (await loadConfig()).defaultOptions;
    rows.push({ key: KEYS.defaultOptions, value: JSON.stringify(normalizeDefaults(patch.defaultOptions, current)) });
  }
  if (!rows.length) return;
  const { error } = await getSupabaseAdmin().from("jukebox_config").upsert(rows);
  if (error) throw error;
}

/* ---------- Soirées et activité ---------- */

/* Toutes les soirées avec leur dernière activité (création, ajout, titre
 * lancé, position envoyée par la régie) et leurs compteurs. */
export async function sessionsWithActivity() {
  const sb = getSupabaseAdmin();
  const { data: sessions, error } = await sb.from("jukebox_sessions")
    .select("id,code,name,status,created_at,playback,options,regie_code").order("created_at", { ascending: false });
  if (error) throw error;
  const [{ data: tracks, error: e2 }, { data: devices }] = await Promise.all([
    sb.from("jukebox_tracks").select("session_id,status,created_at,played_at"),
    sb.from("jukebox_devices").select("session_id,label,created_at,last_seen"),
  ]);
  if (e2) throw e2;
  // appareils autorisés (liens régie / télécommande ouverts, télés en mode son)
  const devs = {};
  for (const d of devices || []) (devs[d.session_id] ||= []).push({ label: d.label || "Appareil", createdAt: d.created_at, lastSeen: d.last_seen });
  const stats = {};
  for (const t of tracks || []) {
    const st = (stats[t.session_id] ||= { played: 0, queued: 0, last: 0 });
    if (t.status === "queued") st.queued++;
    else if (t.status !== "removed") st.played++; // removed : écarté du blind test
    st.last = Math.max(st.last, Date.parse(t.created_at) || 0, Date.parse(t.played_at) || 0);
  }
  return sessions.map((s) => {
    const st = stats[s.id] || { played: 0, queued: 0, last: 0 };
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      status: s.status,
      regieCode: s.regie_code || null,
      createdAt: s.created_at,
      features: normalizeFeatures(s.options?.features),
      organizer: s.options?.organizer || null, // code d'activation utilisé
      activationId: s.options?.activationId || null,
      retentionDays: cleanRetention(s.options?.retentionDays), // null : réglage global
      played: st.played,
      queued: st.queued,
      lastActivity: Math.max(Date.parse(s.created_at) || 0, st.last, Number(s.playback?.at) || 0),
      devices: (devs[s.id] || []).sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen)),
      // lecteur qui joue le son : { kind: "tv" | "pc", at, playing }
      player: s.playback?.at ? { kind: s.playback.player?.kind || "pc", at: Number(s.playback.at), playing: !!s.playback.playing } : null,
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
  const old = (await sessionsWithActivity()).filter((s) => s.lastActivity < (s.retentionDays ? Date.now() - s.retentionDays * DAY : limit));
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
  await purgeRate(); // compteurs anti-abus expirés
  // cache des recherches YouTube : 30 jours maximum
  await sb.from("jukebox_cache").delete().lt("created_at", new Date(Date.now() - 30 * DAY).toISOString());
  return { deleted: old.length };
}
