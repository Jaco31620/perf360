/*
 * Jukebox — helpers SERVEUR (à n'importer que depuis les route handlers).
 * Jeton régie : chaîne aléatoire remise au créateur ; seul son SHA-256 est
 * stocké. Accès YouTube Data API v3 : clé YOUTUBE_API_KEY (env) ou, à défaut,
 * ligne `youtube_api_key` de la table jukebox_config.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { adminAccess } from "@/lib/jukeboxAccess";
import { isValidCode, MAX_DURATION, MIN_SONG_DURATION, SEARCH_MODES, normalizeMode, normalizeFade, normalizeReveal, normalizeFeatures, normalizeTheme } from "@/lib/jukebox";
import { normalizeBlind } from "@/lib/jukeboxBlind";

export const newAdminToken = () => randomBytes(24).toString("hex");
export const hashToken = (t) => createHash("sha256").update(String(t)).digest("hex");

export function checkToken(token, hash) {
  if (!token || !hash) return false;
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* Droits régie : jeton d'un appareil autorisé (ou ancien jeton unique), ou
 * super-admin (lib/jukeboxAccess.js). */
export const isAdminReq = async (req, s) => (await adminAccess(req, s)).ok;

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
  searchMode: normalizeMode(s.options?.searchMode),
  // affichage de la file sur l'écran / chez les invités (oui par défaut)
  screenQueue: s.options?.screenQueue !== false,
  guestQueue: s.options?.guestQueue !== false,
  fade: normalizeFade(s.options?.fade),
  fairQueue: s.options?.fairQueue !== false,
  dedications: !!s.options?.dedications,
  authorReveal: normalizeReveal(s.options?.authorReveal),
  features: normalizeFeatures(s.options?.features),
  theme: normalizeFeatures(s.options?.features).theme ? normalizeTheme(s.options?.theme) : null,
  blindSettings: normalizeFeatures(s.options?.features).blindtest ? blindSettings(s.options?.blind) : null,
});
const blindSettings = (b) => { const { revealedId, revealedPos, ...rest } = normalizeBlind(b); return rest; };

/* Réglages de la régie reçus du client (action « options », création par le
 * super-admin) : seules les clés connues, normalisées, sont reprises. */
export function regieOptions(input, base = {}) {
  const options = { ...base };
  for (const k of ["screenQueue", "guestQueue", "fairQueue", "dedications"]) if (k in input) options[k] = !!input[k];
  if ("fade" in input) options.fade = normalizeFade(input.fade);
  if ("authorReveal" in input) options.authorReveal = normalizeReveal(input.authorReveal);
  if ("searchMode" in input) options.searchMode = normalizeMode(input.searchMode);
  return options;
}

export const trackOut = (r, pid) => ({
  id: r.id,
  videoId: r.video_id,
  title: r.title,
  channel: r.channel,
  thumb: r.thumb,
  duration: r.duration,
  videoTitle: r.video_title && r.video_title !== r.title ? r.video_title : null, // titre d'origine de la vidéo YouTube
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
    // quota épuisé : selon les cas quotaExceeded, dailyLimitExceeded, rateLimitExceeded,
    // ou seulement le statut RESOURCE_EXHAUSTED / HTTP 429
    if (/quota|limit/i.test(reason || "") || data?.error?.status === "RESOURCE_EXHAUSTED" || res.status === 429) {
      const err = new YoutubeError("Recherche indisponible pour aujourd'hui (quota YouTube atteint). Collez plutôt un lien YouTube.");
      err.quota = true;
      throw err;
    }
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

/* Est-ce une chanson ? Catégorie YouTube « Musique » (10), ou thème musical
 * (topicDetails : pages Wikipédia Music, Pop_music, Rock_music, Jazz…) — utile
 * pour les vidéos de paroles / karaoké, souvent classées ailleurs. */
const MUSIC_TOPIC = /music|\/(Jazz|Reggae|Rhythm_and_blues|Blues|Opera|Hip_hop)$/i;
const isMusic = (v) => v.snippet?.categoryId === "10"
  || (v.topicDetails?.topicCategories || []).some((u) => MUSIC_TOPIC.test(u));

/* Raison du refus d'une vidéo, ou null si elle est jouable en régie.
 * musicOnly : chansons uniquement (invités), avec une durée minimale. */
function rejectReason(v, musicOnly) {
  const blocked = v.contentDetails?.regionRestriction?.blocked || [];
  const allowed = v.contentDetails?.regionRestriction?.allowed;
  if (v.status?.embeddable === false || blocked.includes("FR") || (allowed && !allowed.includes("FR"))) return "blocked";
  if (v.snippet?.liveBroadcastContent !== "none") return "live";
  const d = isoDuration(v.contentDetails?.duration);
  if (!d || d > MAX_DURATION) return "long";
  if (musicOnly && d < MIN_SONG_DURATION) return "short";
  if (musicOnly && !isMusic(v)) return "notMusic";
  return null;
}

export const REJECT_MESSAGES = {
  missing: "Vidéo introuvable.",
  blocked: "Ce titre ne peut pas être joué ici (lecture bloquée hors de YouTube).",
  live: "Les directs ne peuvent pas être ajoutés.",
  long: "Ce titre est trop long (15 min maximum).",
  short: "Cette vidéo est trop courte pour être une chanson.",
  notMusic: "Cette vidéo ne semble pas être une chanson : seuls les titres musicaux peuvent être ajoutés.",
};

const toTrack = (v) => ({
  id: v.id,
  title: v.snippet.title,
  channel: (v.snippet.channelTitle || "").replace(/ - Topic$/, ""),
  thumb: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || null,
  duration: isoDuration(v.contentDetails?.duration),
});

async function fetchVideos(ids) {
  if (!ids.length) return [];
  const data = await yt("videos", { part: "snippet,contentDetails,status,topicDetails", id: ids.join(","), maxResults: "50" });
  return data.items || [];
}

/* Détails de vidéos (1 unité de quota) — ne garde que celles acceptées. */
export async function ytVideos(ids, { musicOnly = true } = {}) {
  return (await fetchVideos(ids)).filter((v) => !rejectReason(v, musicOnly)).map(toTrack);
}

/* Une vidéo précise (lien collé, ajout) : { video } ou { reason }. */
export async function ytVideo(id, { musicOnly = true } = {}) {
  const [v] = await fetchVideos([id]);
  if (!v) return { reason: "missing" };
  const reason = rejectReason(v, musicOnly);
  return reason ? { reason } : { video: toTrack(v) };
}

/* Recherche musicale (100 unités de quota) — résultats gardés 30 jours en cache.
 * mode paroles / karaoké : mot ajouté à la recherche, sans filtre de catégorie
 * (beaucoup de chaînes de paroles ou de karaoké ne sont pas en Musique). */
const CACHE_DAYS = 30; // durée max de conservation des données YouTube

export async function ytSearch(raw, mode = "normal") {
  mode = normalizeMode(mode); // ancien mode « paroles »
  const suffix = SEARCH_MODES.find((m) => m.id === mode)?.suffix;
  const query = suffix ? `${raw} ${suffix}` : raw;
  const key = "v2:" + query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
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

/* ---------- Deezer (recherche sans quota) ----------
 * Moteur « deezer » : l'invité cherche dans le catalogue Deezer (API publique,
 * sans clé ni quota journalier) ; à l'ajout seulement, on cherche la vidéo
 * YouTube du titre choisi (1 recherche YouTube, gardée 30 jours en cache et
 * partagée par toutes les soirées). */

const deezerOut = (t) => ({
  id: `dz${t.id}`,
  deezerId: t.id,
  title: t.title,
  channel: t.artist?.name || "",
  thumb: t.album?.cover_medium || null,
  duration: t.duration,
});

async function deezer(path, params = {}) {
  const res = await fetch(`https://api.deezer.com/${path}?${new URLSearchParams(params)}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    console.error("deezer:", res.status, data.error);
    throw new YoutubeError("Recherche indisponible pour le moment, réessayez dans quelques secondes.");
  }
  return data;
}

/* Reprises : un même titre chanté par plusieurs artistes (compilations,
 * « version », karaoké…). Pour chaque titre, la version la plus écoutée
 * (rank Deezer, en général l'originale) passe devant les autres, et les
 * versions annoncées (karaoké, reprise…) derrière, sauf si on les cherche. */
const titleKey = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const COVER_WORDS = /karaok|version|cover|reprise|instrumental|playback|tribute|hommage|rendu c[ée]l[èe]bre/i;
function preferOriginals(tracks, q) {
  const wantCover = COVER_WORDS.test(q);
  const isCover = (t) => !wantCover && COVER_WORDS.test(`${t.title} ${t.artist?.name}`);
  const best = new Map(), first = new Map();
  tracks.forEach((t, i) => {
    const k = titleKey(t.title_short || t.title);
    if (!first.has(k)) first.set(k, i);
    best.set(k, Math.max(best.get(k) || 0, isCover(t) ? 0 : t.rank || 0));
  });
  const groupOf = (t) => titleKey(t.title_short || t.title);
  return [...tracks].sort((a, b) => {
    const ga = groupOf(a), gb = groupOf(b);
    if (ga !== gb) return first.get(ga) - first.get(gb); // ordre de pertinence de Deezer entre titres différents
    if (isCover(a) !== isCover(b)) return isCover(a) ? 1 : -1;
    return (b.rank || 0) - (a.rank || 0);
  });
}

export async function deezerSearch(q) {
  const data = await deezer("search", { q, limit: "25" });
  const seen = new Set();
  const out = [];
  for (const t of preferOriginals(data.data || [], q)) {
    if (t.duration < MIN_SONG_DURATION || t.duration > MAX_DURATION) continue;
    const k = `${t.artist?.name}|${t.title_short}`.toLowerCase(); // versions identiques
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(deezerOut(t));
    if (out.length >= 15) break;
  }
  return out;
}

/* Recherche des invités : les titres déjà en mémoire dans le mode de la
 * soirée (vidéo connue : pas de quota YouTube à l'ajout) passent en tête,
 * validés d'abord, avec ceux de la mémoire dont le libellé contient tous les
 * mots cherchés et que Deezer n'a pas renvoyés. `known` : 2 validé, 1 connu. */
export async function preferKnown(results, mode, q) {
  mode = normalizeMode(mode);
  const sb = getSupabaseAdmin();
  const words = String(q || "").replace(/[%_,()]/g, " ").split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);
  let byKey = sb.from("jukebox_songs").select("key,video_id,label,duration,validated").eq("missing", false)
    .in("key", results.map((r) => songKey(r.deezerId, mode)));
  let byLabel = sb.from("jukebox_songs").select("key,video_id,label,duration,validated").eq("missing", false)
    .like("key", `%:${mode}`).not("label", "is", null).limit(10);
  for (const w of words) byLabel = byLabel.ilike("label", `%${w}%`);
  const [a, b] = await Promise.all([byKey, words.length ? byLabel : { data: [] }]);
  if (a.error || b.error) return results; // mémoire indisponible : résultats Deezer tels quels
  const known = new Map([...(a.data || []), ...(b.data || [])].map((r) => [r.key.split(":")[1], r]));
  const out = results.map((r) => (known.has(String(r.deezerId)) ? { ...r, known: known.get(String(r.deezerId)).validated ? 2 : 1 } : r));
  const seen = new Set(out.map((r) => String(r.deezerId)));
  for (const [id, r] of known) {
    if (seen.has(id)) continue;
    const [artist, ...rest] = r.label.split(" – ");
    out.push({
      id: `dz${id}`, deezerId: Number(id), title: rest.join(" – ") || r.label, channel: artist,
      thumb: `https://i.ytimg.com/vi/${r.video_id}/mqdefault.jpg`, duration: r.duration, known: r.validated ? 2 : 1,
    });
  }
  // tri stable : validés, puis connus, puis le reste dans l'ordre de Deezer
  return out.map((r, i) => [r, i]).sort((x, y) => (y[0].known || 0) - (x[0].known || 0) || x[1] - y[1]).map(([r]) => r);
}

export async function deezerTrack(id) {
  try {
    const t = await deezer(`track/${id}`);
    return t?.id ? deezerOut(t) : null;
  } catch (e) {
    return null;
  }
}

/* Premier titre Deezer correspondant à « Artiste - Titre » (pré-remplissage). */
export async function deezerFirst(q) {
  return (await deezerSearch(q))[0] || null;
}

/* Playlists Deezer publiques (pré-remplissage) : recherche, lien collé. */
export async function deezerPlaylistSearch(q) {
  const data = await deezer("search/playlist", { q, limit: "20" });
  return (data.data || []).map((p) => ({
    id: p.id, title: p.title, tracks: p.nb_tracks, cover: p.picture_medium, by: p.user?.name || "",
  }));
}

/* Identifiant d'une playlist : nombre, lien deezer.com/…/playlist/123, ou
 * lien court de partage (link.deezer.com, deezer.page.link) suivi jusqu'au bout. */
export async function deezerPlaylistId(input) {
  const s = String(input || "").trim();
  if (/^\d{3,15}$/.test(s)) return s;
  let m = s.match(/playlist\/(\d+)/);
  if (m) return m[1];
  if (/^https?:\/\/(link\.deezer\.com|deezer\.page\.link)\//i.test(s)) {
    try {
      const res = await fetch(s, { redirect: "follow", cache: "no-store" });
      m = (res.url + " " + (await res.text()).slice(0, 20000)).match(/playlist\/(\d+)/);
      if (m) return m[1];
    } catch (e) { /* lien invalide */ }
  }
  return null;
}

export async function deezerPlaylistTracks(id, max = 500) {
  const out = [];
  for (let index = 0; index < max; index += 100) {
    let data;
    try { data = await deezer(`playlist/${id}/tracks`, { index: String(index), limit: "100" }); } catch (e) { return out.length ? out : null; }
    const page = data.data || [];
    for (const t of page) if (t.readable !== false && t.duration >= MIN_SONG_DURATION && t.duration <= MAX_DURATION) out.push(deezerOut(t));
    if (page.length < 100) break;
  }
  return out;
}

/* ---------- Mémoire des titres (table jukebox_songs) ----------
 * « titre Deezer + mode → vidéo YouTube », partagée par toutes les soirées.
 * Les règles YouTube interdisent de garder ses données plus de 30 jours sans
 * les rafraîchir : chaque lien est revérifié (videos.list, 1 unité pour 50
 * titres) chaque nuit par refreshSongs, et à l'usage s'il a plus de 30 jours.
 * Une vidéo supprimée ou devenue illisible est oubliée (nouvelle recherche). */
const SONG_TTL = 30 * 24 * 3600 * 1000;
export const songKey = (deezerId, mode) => `dz:${deezerId}:${normalizeMode(mode)}`;

async function recallSong(key) {
  const { data, error } = await getSupabaseAdmin().from("jukebox_songs").select("*").eq("key", key).maybeSingle();
  if (error) console.error("jukebox recallSong:", error.message); // mémoire indisponible : nouvelle recherche
  return data || null;
}

/* validated : true / false pour fixer le statut « validé » (confirmé après
 * test dans le super-admin) ; absent = statut inchangé. */
/* Titre et chaîne de la vidéo YouTube, tels quels (affichés en petit dans le
 * super-admin, à côté du libellé Deezer). */
const videoInfo = (v) => (v?.title ? { video_title: v.title, video_channel: v.channel || null } : {});

export async function rememberSong(key, video, label, validated, { keepLyrics = false } = {}) {
  const row = { key, video_id: video.id, duration: video.duration, checked_at: new Date().toISOString(), ...videoInfo(video) };
  if (label) row.label = label;
  if (typeof validated === "boolean") row.validated = validated;
  row.missing = false; // nouvelle vidéo : plus « à remplacer »
  if (!keepLyrics && hasLyrics(video) !== undefined) row.lyrics = hasLyrics(video);
  // un échec ne bloque pas l'ajout du titre (il sera cherché à nouveau la prochaine fois)
  const { error } = await getSupabaseAdmin().from("jukebox_songs").upsert(row);
  if (error) console.error("jukebox rememberSong:", error.message);
}

const songLabel = (song) => `${song.channel} – ${song.title}`;

/* Clé mémoire d'une vidéo jouée (titre Deezer), de préférence dans le mode
 * de la soirée. null : titre ajouté par lien ou par la recherche YouTube. */
export async function findSongKey(videoId, mode) {
  try {
    const { data } = await getSupabaseAdmin().from("jukebox_songs").select("key").eq("video_id", videoId);
    const keys = (data || []).map((r) => r.key);
    return keys.find((k) => k.endsWith(`:${mode}`)) || keys[0] || null;
  } catch (e) {
    return null;
  }
}

/* Autres vidéos possibles pour un titre de la file (bouton « Mauvaise
 * vidéo ? ») : recherche du titre dans le mode voulu, servie par le cache
 * si elle a déjà été faite. */
export async function songAlternatives(track, mode) {
  const key = await findSongKey(track.video_id, mode);
  let query = `${track.channel} ${track.title}`;
  let m = mode;
  if (key) {
    const [, dz, keyMode] = key.split(":");
    const song = await deezerTrack(dz);
    if (song) query = `${song.channel} ${song.title}`;
    m = keyMode;
  }
  return { key, candidates: await ytSearch(query, m) };
}

/* Vidéo YouTube d'un titre (mode normal / karaoké). Recherche :
 * parmi les premiers résultats (ceux qui annoncent la version voulue en
 * priorité), celle dont la durée est proche du titre (évite les versions live
 * ou rallongées), sinon la première. */
const LYRICS_WORDS = /lyric|paroles|letra/i;
const MODE_WORDS = {
  karaoke: /karaok|instrumental|sing ?along/i,
  normal: LYRICS_WORDS,
};
/* Étiquette « avec paroles » devinée d'après le titre de la vidéo (corrigeable
 * dans le super-admin). */
export const hasLyrics = (v) => (v?.title ? LYRICS_WORDS.test(v.title) : undefined);
export async function youtubeForSong(song, mode) {
  mode = normalizeMode(mode); // ancien mode « paroles »
  const key = songKey(song.deezerId, mode);
  const known = await recallSong(key);
  if (known && !known.missing) { // « à remplacer » : vidéo disparue, nouvelle recherche
    if (Date.now() - Date.parse(known.checked_at) < SONG_TTL) return { id: known.video_id, duration: known.duration, title: known.video_title || null };
    const { video } = await ytVideo(known.video_id); // revérification : 1 unité
    if (video) { await rememberSong(key, video, songLabel(song), undefined, { keepLyrics: true }); return video; } // même vidéo : étiquette paroles inchangée
  }
  const results = await ytSearch(`${song.channel} ${song.title}`, mode);
  if (!results.length) return null;
  // mode paroles / karaoké : d'abord les vidéos qui l'annoncent dans leur titre
  const want = MODE_WORDS[mode];
  const top = results.slice(0, 8);
  const pool = want ? top.filter((v) => want.test(v.title)) : [];
  const candidates = pool.length ? pool : top;
  const tol = Math.max(20, song.duration * 0.25);
  const best = candidates.find((v) => Math.abs(v.duration - song.duration) <= tol) || candidates[0];
  await rememberSong(key, best, songLabel(song));
  return best;
}

/* Revérification nocturne (appelée par /api/keep-alive) des liens de plus de
 * 25 jours, et de ceux dont on n'a pas encore le titre YouTube : 50 vidéos
 * par appel YouTube (1 unité). */
export async function refreshSongs(max = 2000) {
  const sb = getSupabaseAdmin();
  const { data: old, error } = await sb.from("jukebox_songs").select("*")
    .or(`checked_at.lt.${new Date(Date.now() - 25 * 24 * 3600 * 1000).toISOString()},and(video_title.is.null,missing.eq.false)`).limit(max);
  if (error) throw error;
  const report = { checked: 0, forgotten: 0 };
  for (let i = 0; i < old.length; i += 50) {
    const batch = old.slice(i, i + 50);
    const ok = new Map((await fetchVideos([...new Set(batch.map((r) => r.video_id))]))
      // seulement « encore lisible ici » : pas le filtre chanson (vidéos karaoké / paroles hors
      // catégorie Musique, vidéos choisies à la main en régie ou dans le super-admin)
      .filter((v) => !rejectReason(v, false)).map((v) => [v.id, toTrack(v)]));
    const now = new Date().toISOString();
    for (const r of batch) {
      if (ok.has(r.video_id)) {
        const v = ok.get(r.video_id);
        await sb.from("jukebox_songs").update({ checked_at: now, duration: v.duration, ...videoInfo(v) }).eq("key", r.key);
        report.checked++;
      } else if (r.validated || r.missing || r.blind || (r.enriched_at && (r.fr !== null || r.year))) {
        // travail fait (validation, blind test, année / langue) : gardé « à remplacer » plutôt qu'oublié
        await sb.from("jukebox_songs").update({ missing: true, validated: false, checked_at: now }).eq("key", r.key);
        report.missing = (report.missing || 0) + 1;
      } else {
        await sb.from("jukebox_songs").delete().eq("key", r.key);
        report.forgotten++;
      }
      if (ok.has(r.video_id) && r.missing) await sb.from("jukebox_songs").update({ missing: false }).eq("key", r.key); // revenue
    }
  }
  return report;
}

/* Mémoire des titres pour le super-admin : recherche dans les libellés. */
/* status : all | todo (à vérifier) | ok (validés) | missing | blind | lyrics ;
 * mode : normal | karaoke ; lang : fr | intl | unknown ; decade : 1980… | unknown */
export async function listSongs({ q, status, mode, lang, decade } = {}, limit = 200) {
  let req = getSupabaseAdmin().from("jukebox_songs").select("*").limit(limit);
  // à vérifier : d'abord les plus joués en soirée, puis les plus connus (Deezer)
  if (status === "todo") req = req.order("plays", { ascending: false }).order("rank", { ascending: false, nullsFirst: false });
  req = req.order("checked_at", { ascending: false });
  const term = String(q || "").trim().replace(/[%_,()]/g, " ");
  if (term) req = req.ilike("label", `%${term}%`);
  if (status === "ok") req = req.eq("validated", true);
  if (status === "todo") req = req.eq("validated", false);
  if (status === "blind") req = req.eq("blind", true);
  if (status === "lyrics") req = req.eq("lyrics", true);
  if (lang === "fr") req = req.eq("fr", true);
  if (lang === "intl") req = req.eq("fr", false);
  if (lang === "unknown") req = req.is("fr", null);
  const dec = parseInt(decade, 10);
  if (dec >= 1900 && dec <= 2100) req = req.gte("year", dec).lte("year", dec + 9);
  if (decade === "unknown") req = req.is("year", null).not("enriched_at", "is", null); // enrichis sans année trouvée : à compléter à la main
  if (status === "missing") req = req.eq("missing", true);
  if (SEARCH_MODES.some((m) => m.id === mode)) req = req.like("key", `%:${mode}`);
  const { data, error } = await req;
  if (error) throw error;
  return data.map((r) => ({
    key: r.key, mode: r.key.split(":")[2], label: r.label || null, videoId: r.video_id,
    duration: r.duration, checkedAt: r.checked_at, validated: !!r.validated, blind: !!r.blind, lyrics: !!r.lyrics, missing: !!r.missing, plays: r.plays || 0, rank: r.rank ?? null,
    year: r.year ?? null, fr: r.fr ?? null, enriched: !!r.enriched_at,
    videoTitle: r.video_title || null, videoChannel: r.video_channel || null,
  }));
}

/* Titre utilisable (ou non) par le blind test (étiquette du super-admin). */
export async function blindSong(key, blind) {
  const { error } = await getSupabaseAdmin().from("jukebox_songs").update({ blind: !!blind }).eq("key", String(key || ""));
  if (error) throw error;
}

/* Étiquette « avec paroles » : la vidéo affiche les paroles (super-admin). */
export async function lyricsSong(key, lyrics) {
  const { error } = await getSupabaseAdmin().from("jukebox_songs").update({ lyrics: !!lyrics }).eq("key", String(key || ""));
  if (error) throw error;
}

export async function validateSong(key, validated) {
  const { error } = await getSupabaseAdmin().from("jukebox_songs").update({ validated: !!validated }).eq("key", String(key || ""));
  if (error) throw error;
}

/* Super-admin : autres vidéos possibles pour un titre mémorisé, et
 * remplacement de la vidéo retenue. */
export async function songCandidates(key) {
  const { data: row } = await getSupabaseAdmin().from("jukebox_songs").select("*").eq("key", String(key || "")).maybeSingle();
  if (!row) return null;
  const [, dz, mode] = row.key.split(":");
  const song = await deezerTrack(dz);
  const query = song ? `${song.channel} ${song.title}` : row.label?.replace(" – ", " ");
  return { current: row.video_id, candidates: query ? await ytSearch(query, mode) : [] };
}

export async function replaceSongVideo(key, videoId) {
  const { video, reason } = await ytVideo(String(videoId || ""), { musicOnly: false });
  if (!video) return REJECT_MESSAGES[reason];
  const { error } = await getSupabaseAdmin().from("jukebox_songs").update({
    video_id: video.id, duration: video.duration, checked_at: new Date().toISOString(),
    validated: false, missing: false, lyrics: hasLyrics(video), ...videoInfo(video), // à tester puis valider
  }).eq("key", String(key || ""));
  if (error) throw error;
  return null;
}

/* Super-admin : mauvais titre Deezer (reprise, compilation…) : la ligne est
 * rattachée au bon titre, vidéo et étiquettes conservées ; année et langue
 * seront cherchées à nouveau. */
export async function retargetSong(key, deezerId) {
  const [, , mode] = String(key || "").split(":");
  const song = await deezerTrack(String(deezerId || ""));
  if (!song || !mode) return "Titre introuvable.";
  const next = songKey(song.deezerId, mode);
  if (next === key) return { key };
  const sb = getSupabaseAdmin();
  const { data: dup } = await sb.from("jukebox_songs").select("key").eq("key", next).maybeSingle();
  if (dup) return "Ce titre est déjà en mémoire dans ce mode : oubliez plutôt cette ligne.";
  const { error } = await sb.from("jukebox_songs").update({
    key: next, label: songLabel(song), year: null, lang: null, country: null, fr: null, enriched_at: null,
  }).eq("key", key);
  if (error) throw error;
  return { key: next };
}

/* Un titre joué jusqu'au bout en soirée (pas passé) : +1 pour toutes les
 * lignes de cette vidéo (priorité de la revue dans le super-admin). */
export async function countPlay(videoId) {
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("jukebox_songs").select("key,plays").eq("video_id", String(videoId || ""));
  await Promise.all((data || []).map((r) => sb.from("jukebox_songs").update({ plays: (r.plays || 0) + 1 }).eq("key", r.key)));
}

export async function forgetSong(key) {
  const { error } = await getSupabaseAdmin().from("jukebox_songs").delete().eq("key", String(key || ""));
  if (error) throw error;
}

export async function songsCount() {
  try {
    const { count } = await getSupabaseAdmin().from("jukebox_songs").select("key", { count: "exact", head: true });
    return count || 0;
  } catch (e) {
    return 0;
  }
}
