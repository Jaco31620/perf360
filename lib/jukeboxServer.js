/*
 * Jukebox — helpers SERVEUR (à n'importer que depuis les route handlers).
 * Jeton régie : chaîne aléatoire remise au créateur ; seul son SHA-256 est
 * stocké. Accès YouTube Data API v3 : clé YOUTUBE_API_KEY (env) ou, à défaut,
 * ligne `youtube_api_key` de la table jukebox_config.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isJukeboxSuper } from "@/lib/jukeboxAdmin";
import { isValidCode, MAX_DURATION, SEARCH_MODES, normalizeMode, normalizeFade, normalizeReveal } from "@/lib/jukebox";

export const newAdminToken = () => randomBytes(24).toString("hex");
export const hashToken = (t) => createHash("sha256").update(String(t)).digest("hex");

export function checkToken(token, hash) {
  if (!token || !hash) return false;
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* Droits régie : jeton de la soirée, ou super-admin. */
export const isAdminReq = (req, s) => checkToken(req.headers.get("x-jukebox-admin"), s.admin_hash) || isJukeboxSuper(req);

export async function loadSession(code) {
  if (!isValidCode(code)) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("jukebox_sessions").select("*").eq("code", code).maybeSingle();
  if (error) throw error;
  return data;
}

export const publicSession = (s) => ({
  code: s.code,
  name: s.name,
  status: s.status,
  maxPerParticipant: s.max_per_participant,
  // ancienne colonne `karaoke` reprise si aucun mode n'a été choisi
  searchMode: normalizeMode(s.options?.searchMode || (s.karaoke ? "karaoke" : "normal")),
  // affichage de la file sur l'écran / chez les invités (oui par défaut)
  screenQueue: s.options?.screenQueue !== false,
  guestQueue: s.options?.guestQueue !== false,
  fade: normalizeFade(s.options?.fade),
  fairQueue: s.options?.fairQueue !== false,
  dedications: !!s.options?.dedications,
  authorReveal: normalizeReveal(s.options?.authorReveal),
});

export const trackOut = (r, pid) => ({
  id: r.id,
  videoId: r.video_id,
  title: r.title,
  channel: r.channel,
  thumb: r.thumb,
  duration: r.duration,
  author: r.author,
  dedication: r.dedication || null,
  mine: !!pid && r.participant_id === pid,
});

/* Masque le nom de l'invité pour le public selon le réglage de la régie.
 * Titre en cours : nom révélé `reveal` secondes après son lancement
 * (`revealIn` = secondes restantes). File : nom visible seulement en mode
 * « tout de suite ». Le participant voit toujours ses propres titres. */
export function hideAuthors(now, queue, nowRow, reveal) {
  if (reveal === 0) return;
  for (const t of queue) if (!t.mine) t.author = null;
  if (!now || now.mine) return;
  if (reveal < 0) { now.author = null; return; }
  const left = (Date.parse(nowRow.played_at) || 0) + reveal * 1000 - Date.now();
  if (left > 0) { now.author = null; now.revealIn = Math.ceil(left / 1000); }
}

/* File équitable : le nouveau titre d'un participant se place à la fin de
 * son « tour » (son 1er titre en attente = tour 0, le 2e = tour 1…), donc
 * les invités alternent au lieu de passer dans l'ordre d'arrivée. Les tours
 * sont recalculés sur l'ordre actuel : un déplacement fait en régie est
 * respecté. `queued` : titres en attente triés par position. */
export function fairPosition(queued, pid) {
  if (!queued.length) return Date.now();
  const seen = {};
  const rounds = queued.map((t) => (seen[t.participant_id] = (seen[t.participant_id] ?? -1) + 1));
  const round = queued.filter((t) => t.participant_id === pid).length;
  let after = -1;
  rounds.forEach((r, i) => { if (r <= round) after = i; });
  if (after === queued.length - 1) return Math.max(Date.now(), queued[after].position + 1);
  if (after < 0) return queued[0].position - 1000;
  return (queued[after].position + queued[after + 1].position) / 2;
}

/* ---------- YouTube ---------- */

export class YoutubeError extends Error {}

let _key = null;
async function youtubeKey() {
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY;
  if (_key) return _key;
  const { data } = await getSupabaseAdmin()
    .from("jukebox_config").select("value").eq("key", "youtube_api_key").maybeSingle();
  if (!data?.value) throw new YoutubeError("Recherche non configurée (clé YouTube manquante).");
  _key = data.value;
  return _key;
}

async function yt(path, params) {
  const qs = new URLSearchParams({ ...params, key: await youtubeKey() });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${qs}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data?.error?.errors?.[0]?.reason;
    console.error("youtube:", res.status, reason, data?.error?.message);
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded")
      throw new YoutubeError("Recherche indisponible pour aujourd'hui (quota YouTube atteint). Collez plutôt un lien YouTube.");
    throw new YoutubeError("Recherche YouTube indisponible.");
  }
  return data;
}

/* « PT1H2M3S » → secondes */
function isoDuration(s) {
  const m = String(s || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

/* Détails de vidéos (1 unité de quota) — ne garde que celles jouables en régie. */
export async function ytVideos(ids) {
  if (!ids.length) return [];
  const data = await yt("videos", { part: "snippet,contentDetails,status", id: ids.join(","), maxResults: "50" });
  return (data.items || [])
    .filter((v) => {
      const blocked = v.contentDetails?.regionRestriction?.blocked || [];
      const allowed = v.contentDetails?.regionRestriction?.allowed;
      return v.status?.embeddable !== false
        && v.snippet?.liveBroadcastContent === "none"
        && !blocked.includes("FR")
        && (!allowed || allowed.includes("FR"));
    })
    .map((v) => ({
      id: v.id,
      title: v.snippet.title,
      channel: (v.snippet.channelTitle || "").replace(/ - Topic$/, ""),
      thumb: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || null,
      duration: isoDuration(v.contentDetails?.duration),
    }))
    .filter((v) => v.duration && v.duration <= MAX_DURATION);
}

/* Recherche musicale (100 unités de quota) — résultats gardés 7 jours en cache.
 * mode paroles / karaoké : mot ajouté à la recherche, sans filtre de catégorie
 * (beaucoup de chaînes de paroles ou de karaoké ne sont pas en Musique). */
const CACHE_DAYS = 7;

export async function ytSearch(raw, mode = "normal") {
  const suffix = SEARCH_MODES.find((m) => m.id === mode)?.suffix;
  const query = suffix ? `${raw} ${suffix}` : raw;
  const key = query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const sb = getSupabaseAdmin();
  const { data: cached } = await sb.from("jukebox_cache").select("results,created_at").eq("q", key).maybeSingle();
  if (cached && Date.now() - new Date(cached.created_at) < CACHE_DAYS * 86400e3) return cached.results;

  const found = await yt("search", {
    part: "snippet", type: "video", videoEmbeddable: "true",
    ...(suffix ? {} : { videoCategoryId: "10" }),
    maxResults: "15", regionCode: "FR", q: query,
  });
  const ids = (found.items || []).map((i) => i.id?.videoId).filter(Boolean);
  const results = await ytVideos(ids);
  // garder l'ordre de pertinence de la recherche
  results.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  await sb.from("jukebox_cache").upsert({ q: key, results, created_at: new Date().toISOString() });
  return results;
}
