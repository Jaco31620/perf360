/*
 * Jukebox — helpers SERVEUR (à n'importer que depuis les route handlers).
 * Jeton régie : chaîne aléatoire remise au créateur ; seul son SHA-256 est
 * stocké. Accès YouTube Data API v3 : clé YOUTUBE_API_KEY (env) ou, à défaut,
 * ligne `youtube_api_key` de la table jukebox_config.
 */
import { createHash, randomBytes } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { adminAccess } from "@/lib/jukeboxAccess";
import { isValidCode, MAX_DURATION, MIN_SONG_DURATION, SEARCH_MODES, normalizeMode, normalizeFade, normalizeReveal, normalizeFeatures, normalizeTheme, tidyTitle, tidyArtist, songText, sessionEndsAt } from "@/lib/jukebox";
import { songOut, findDuplicates } from "@/lib/jukeboxLibrary";
import { normalizeBlind, rerankReason, HARD } from "@/lib/jukeboxBlind";
import { blindStats } from "@/lib/jukeboxBlindServer";
import { catalog, allVersions, getVersion, updateVersion, updateWork, upsertVersion, deleteVersion, workOfDeezer, worksOfDeezer, createWork, addAlias, versionKey, parseKey, countPlay as catalogCountPlay } from "@/lib/jukeboxCatalog";

export const newAdminToken = () => randomBytes(24).toString("hex");
export const hashToken = (t) => createHash("sha256").update(String(t)).digest("hex");

/* Droits régie : jeton d'un appareil autorisé (ou ancien jeton unique), ou
 * super-admin (lib/jukeboxAccess.js). */
export const isAdminReq = async (req, s) => (await adminAccess(req, s)).ok;

/* Soirée par son code ; null aussi quand sa durée d'utilisation est
 * dépassée (soirée terminée), sauf { any: true } (super-admin). */
export async function loadSession(code, { any = false } = {}) {
  if (!isValidCode(code)) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("jukebox_sessions").select("*").eq("code", code).maybeSingle();
  if (error) throw error;
  if (data && !any && (sessionEndsAt(data) ?? Infinity) <= Date.now()) return null;
  return data;
}

export const publicSession = (s) => ({
  code: s.code,
  name: s.name,
  status: s.status,
  maxPerParticipant: s.max_per_participant,
  endsAt: sessionEndsAt(s), // fin de la durée d'utilisation (ms) ou null
  searchMode: normalizeMode(s.options?.searchMode),
  // affichage de la file sur l'écran / chez les invités (oui par défaut)
  screenQueue: s.options?.screenQueue !== false,
  guestQueue: s.options?.guestQueue !== false,
  fade: normalizeFade(s.options?.fade),
  fairQueue: s.options?.fairQueue !== false,
  dedications: !!s.options?.dedications,
  catalog: s.options?.catalog !== false, // invités : « Parcourir le catalogue » des titres vérifiés (oui par défaut)
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
  for (const k of ["screenQueue", "guestQueue", "fairQueue", "dedications", "catalog"]) if (k in input) options[k] = !!input[k];
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
  licensed: !!v.contentDetails?.licensedContent, // contenu sous licence (label) : indice de clip officiel
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

export async function ytSearch(raw, mode = "normal", { beforeSearch } = {}) {
  mode = normalizeMode(mode); // ancien mode « paroles »
  const m0 = SEARCH_MODES.find((m) => m.id === mode);
  const suffix = m0?.suffix;
  const query = suffix ? `${raw} ${suffix}` : raw;
  const key = "v2:" + query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const sb = getSupabaseAdmin();
  const { data: cached } = await sb.from("jukebox_cache").select("results,created_at").eq("q", key).maybeSingle();
  if (cached && Date.now() - new Date(cached.created_at) < CACHE_DAYS * 86400e3) return cached.results;
  if (beforeSearch) await beforeSearch(); // vraie recherche (100 unités) : limite d'ajouts des invités

  const found = await yt("search", {
    part: "snippet", type: "video", videoEmbeddable: "true",
    ...(suffix && !m0?.music ? {} : { videoCategoryId: "10" }), // clip : catégorie Musique (clips officiels)
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
  title: tidyTitle(t.title), // libellé propre (sans « Radio Edit »…)
  channel: tidyArtist(t.artist?.name || ""),
  rawTitle: t.title, rawArtist: t.artist?.name || "", // libellé Deezer d'origine (mémoire)
  thumb: t.album?.cover_medium || null,
  duration: t.duration,
  isrc: t.isrc || null, // identifiant de l'enregistrement (track/<id> seulement, pas la recherche)
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
    // versions identiques ; une recherche « live » garde les versions live (titre complet dans la clé)
    const k = `${t.artist?.name}|${/\blive\b/i.test(q) ? t.title : t.title_short}`.toLowerCase();
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
  const words = String(q || "").replace(/[%_,()]/g, " ").split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);
  const cols = "key,work_id,deezer_id,video_id,label,duration,validated,artist_fix,title_fix";
  let known;
  try {
    // fiches Deezer des résultats → chanson → sa version dans le mode de la soirée
    const workOf = await worksOfDeezer(results.map((r) => r.deezerId));
    const workIds = [...new Set(workOf.values())];
    let byLabel = catalog(cols).eq("missing", false).eq("mode", mode).not("label", "is", null).limit(10);
    for (const w of words) byLabel = byLabel.ilike("label", `%${w}%`);
    const [a, b] = await Promise.all([
      workIds.length ? catalog(cols).in("work_id", workIds).eq("mode", mode).eq("missing", false) : { data: [] },
      words.length ? byLabel : { data: [] },
    ]);
    if (a.error || b.error) return results; // mémoire indisponible : résultats Deezer tels quels
    const byWork = new Map((a.data || []).map((r) => [r.work_id, r]));
    known = new Map();
    for (const [dz, w] of workOf) if (byWork.has(w)) known.set(dz, byWork.get(w));
    // titres de la mémoire dont le libellé contient les mots cherchés (pas renvoyés par Deezer)
    for (const r of b.data || []) if (r.deezer_id && ![...known.values()].some((k) => k.work_id === r.work_id)) known.set(String(r.deezer_id), r);
  } catch (e) {
    return results;
  }
  const fixed = (k) => (k.artist_fix || k.title_fix ? { channel: songText(k).artist, title: songText(k).title } : {}); // texte corrigé à la main
  const out = results.map((r) => {
    const k = known.get(String(r.deezerId));
    return k ? { ...r, ...fixed(k), known: k.validated ? 2 : 1, vid: k.video_id } : r;
  });
  const seen = new Set(out.map((r) => String(r.deezerId)));
  for (const [id, r] of known) {
    if (seen.has(id)) continue;
    const text = songText(r);
    out.push({
      id: `dz${id}`, deezerId: Number(id), title: text.title, channel: text.artist,
      thumb: `https://i.ytimg.com/vi/${r.video_id}/mqdefault.jpg`, duration: r.duration, known: r.validated ? 2 : 1, vid: r.video_id,
    });
  }
  // tri stable : validés, puis connus, puis le reste dans l'ordre de Deezer
  const sorted = out.map((r, i) => [r, i]).sort((x, y) => (y[0].known || 0) - (x[0].known || 0) || x[1] - y[1]).map(([r]) => r);
  // même chanson sous plusieurs fiches Deezer (album, single, best-of…) : une seule ligne, la mieux
  // connue (validée d'abord) — même vidéo, ou même interprète + titre à la ponctuation près
  const seenVid = new Set(), seenText = new Set();
  const kept = [];
  for (const r of sorted) {
    const t = textKey(r.channel, r.title);
    if ((r.vid && seenVid.has(r.vid)) || seenText.has(t)) continue;
    if (r.vid) seenVid.add(r.vid);
    seenText.add(t);
    const { vid, ...rest } = r;
    kept.push(rest);
  }
  return kept;
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

/* ---------- Mémoire des titres (catalogue v28, lib/jukeboxCatalog.js) ----------
 * chanson (fiches Deezer) + version (normal = paroles, clip, karaoké) → vidéo
 * YouTube, partagée par toutes les soirées.
 * Les règles YouTube interdisent de garder ses données plus de 30 jours sans
 * les rafraîchir : chaque lien est revérifié (videos.list, 1 unité pour 50
 * titres) chaque nuit par refreshSongs, et à l'usage s'il a plus de 30 jours.
 * Une vidéo supprimée ou devenue illisible est oubliée (nouvelle recherche). */
const SONG_TTL = 30 * 24 * 3600 * 1000;
/* Identité « fiche Deezer + mode » (file de pré-remplissage) : pas une clé du catalogue. */
export const songKey = (deezerId, mode) => `dz:${deezerId}:${normalizeMode(mode)}`;

/* Version connue d'une fiche Deezer dans un mode : { workId, version } (version null
 * si la chanson est connue mais pas encore dans ce mode). */
async function recallSong(deezerId, mode) {
  try {
    const workId = await workOfDeezer(deezerId);
    if (!workId) return { workId: null, version: null };
    return { workId, version: await getVersion(versionKey(workId, mode)) };
  } catch (e) {
    console.error("jukebox recallSong:", e.message); // mémoire indisponible : nouvelle recherche
    return { workId: null, version: null };
  }
}

/* validated : true / false pour fixer le statut « validé » (confirmé après
 * test dans le super-admin) ; absent = statut inchangé. */
/* Titre et chaîne de la vidéo YouTube, tels quels (affichés en petit dans le
 * super-admin, à côté du libellé Deezer). */
const videoInfo = (v) => (v?.title ? { video_title: v.title, video_channel: v.channel || null } : {});

/* Colonne isrc (SQL v26) absente : écriture refaite sans elle. */
export const noIsrcColumn = (e) => !!e && (e.code === "42703" || e.code === "PGRST204") && /isrc/i.test(e.message || "");

/* Vidéo retenue pour une version (clé « w:<chanson>:<version> »). validated :
 * true / false pour fixer le statut, absent = inchangé (nouvelle version : à vérifier). */
export async function rememberSong(key, video, label, validated, { keepLyrics = false, confidence, source } = {}) {
  const p = parseKey(key);
  if (!p) return;
  const row = { video_id: video.id, duration: video.duration, checked_at: new Date().toISOString(), missing: false, ...videoInfo(video) };
  if (confidence !== undefined) row.confidence = confidence; // indice de confiance (revue : les plus sûrs d'abord)
  if (source) row.source = source;
  if (typeof validated === "boolean") row.validated = validated;
  if (!keepLyrics && hasLyrics(video) !== undefined) row.lyrics = hasLyrics(video);
  // un échec ne bloque pas l'ajout du titre (il sera cherché à nouveau la prochaine fois)
  try { await upsertVersion(p.workId, p.kind, row); } catch (e) { console.error("jukebox rememberSong:", e.message); }
}

const songLabel = (song) => `${song.rawArtist ?? song.channel} – ${song.rawTitle ?? song.title}`;

/* Clé mémoire d'une vidéo jouée (titre Deezer), de préférence dans le mode
 * de la soirée. null : titre ajouté par lien ou par la recherche YouTube. */
export async function findSongKey(videoId, mode) {
  try {
    const { data } = await catalog("key,mode").eq("video_id", videoId);
    const rows = data || [];
    // jamais une clé d'un autre mode : une soirée karaoké ne touche pas à la version normale
    return mode ? rows.find((r) => r.mode === normalizeMode(mode))?.key || null : rows[0]?.key || null;
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
    const row = await getVersion(key).catch(() => null);
    const song = row?.deezer_id ? await deezerTrack(row.deezer_id) : null;
    if (song) query = `${song.channel} ${song.title}`;
    m = parseKey(key).kind;
  }
  return { key, candidates: await ytSearch(query, m) };
}

/* Vidéo YouTube d'un titre (paroles / karaoké). Recherche :
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
/* Même chanson déjà au catalogue sous une autre fiche Deezer (album, single,
 * best-of…) : même interprète + titre à la ponctuation près, même mode, durée
 * proche ; la validée d'abord. Évite une recherche YouTube (100 unités) et
 * reprend la vidéo vérifiée. */
const textKey = (artist, title) => `${artist}|${title}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9|]+/g, "");
/* Chanson déjà au catalogue sous une autre fiche Deezer : même ISRC, sinon
 * même interprète + titre à la ponctuation près et durée proche (±30 s) ; la
 * plus sûre d'abord (une version validée, puis la plus jouée). → ligne de la vue ou null. */
export async function findSibling(song) {
  const cols = "work_id,label,artist_fix,title_fix,song_duration,isrc,validated,plays,missing";
  const best = (rows) => {
    const byWork = new Map();
    for (const r of rows || []) {
      const cur = byWork.get(r.work_id);
      if (!cur || (r.validated && !r.missing && !cur.validated)) byWork.set(r.work_id, r);
    }
    return [...byWork.values()].sort((x, y) => (y.validated ? 1 : 0) - (x.validated ? 1 : 0) || (y.plays || 0) - (x.plays || 0))[0] || null;
  };
  if (song.isrc) { // même enregistrement (ISRC) : le plus sûr
    const { data, error } = await catalog(cols).eq("isrc", song.isrc).limit(20);
    if (error) console.error("jukebox findSibling isrc:", error.message);
    const hit = best(data);
    if (hit) return hit;
  }
  const words = String(song.rawTitle ?? song.title ?? "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
  const word = words.sort((x, y) => y.length - x.length)[0];
  if (!word) return null;
  const { data, error } = await catalog(cols).or(`label.ilike.%${word}%,title_fix.ilike.%${word}%`).limit(60);
  if (error) { console.error("jukebox findSibling:", error.message); return null; }
  const want = new Set([textKey(song.channel, song.title), textKey(song.rawArtist ?? song.channel, song.rawTitle ?? song.title)]);
  return best((data || []).filter((r) => {
    if (r.song_duration && song.duration && Math.abs(r.song_duration - song.duration) > 30) return false;
    const t = songText(r);
    const [ra, ...rt] = String(r.label || "").split(" – ");
    return want.has(textKey(t.artist, t.title)) || (rt.length && want.has(textKey(ra, rt.join(" – "))));
  }));
}

/* Choix de la vidéo parmi les résultats de recherche → { video, confidence }.
 *  - paroles / karaoké : d'abord celles qui annoncent la version dans leur titre,
 *    puis la durée proche du titre (évite les lives et versions rallongées) ;
 *  - clip : score « clip officiel » (mots « official video / clip officiel »,
 *    chaîne de l'artiste ou VEVO, contenu sous licence, durée plausible — un
 *    clip a souvent une intro), vidéos de paroles, lives et reprises pénalisées ;
 *    à défaut de clip, la meilleure vidéo trouvée (une chanson a toujours une
 *    version clip, éventuellement la même vidéo que la version paroles).
 * confidence : 3 sûr, 2 probable, 1 incertain (ordre de la revue). */
const CLIP_WORDS = /official\s*(music\s*)?video|clip\s*officiel|vid[ée]o\s*officielle|official\s*clip|videoclip/i;
const NOT_CLIP = /\b(live|concert|cover|reprise|karaok|instrumental|remix|slowed|sped up|8d|reaction)\b/i;
const flat = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
export function pickVideo(results, song, mode) {
  const top = results.slice(0, 10);
  if (mode === "clip") {
    const artist = flat(song.channel);
    const scored = top.map((v, i) => {
      const ch = flat(v.channel);
      const own = !!artist && (ch.includes(artist) || artist.includes(ch.replace(/vevo$/, "")) && ch.length > 2);
      const near = song.duration ? Math.abs(v.duration - song.duration) <= Math.max(40, song.duration * 0.35) : true;
      let score = 0;
      if (CLIP_WORDS.test(v.title)) score += 2;
      if (own) score += 2;
      if (/vevo$/i.test(v.channel || "")) score += 1;
      if (v.licensed) score += 1;
      if (near) score += 1; else score -= 2;
      if (LYRICS_WORDS.test(v.title)) score -= 2;
      if (NOT_CLIP.test(v.title) && !NOT_CLIP.test(song.title || "")) score -= 3;
      return { v, score, i };
    }).sort((a, b) => b.score - a.score || a.i - b.i);
    const best = scored[0];
    return { video: best.v, confidence: best.score >= 6 ? 3 : best.score >= 4 ? 2 : 1 };
  }
  const want = MODE_WORDS[mode];
  const top8 = top.slice(0, 8);
  const pool = want ? top8.filter((v) => want.test(v.title)) : [];
  const candidates = pool.length ? pool : top8;
  const tol = Math.max(20, song.duration * 0.25);
  const near = candidates.find((v) => Math.abs(v.duration - song.duration) <= tol);
  return { video: near || candidates[0], confidence: near && pool.length ? 2 : 1 };
}

export async function youtubeForSong(song, mode, { beforeSearch, source = "search" } = {}) {
  mode = normalizeMode(mode); // ancien mode « paroles »
  let { workId, version: known } = await recallSong(song.deezerId, mode);
  if (!workId) {
    // titre venu sans ISRC (import de playlist, pré-remplissage) : fiche Deezer complète
    // (gratuite, sans quota) pour reconnaître le même enregistrement déjà au catalogue
    if (!song.isrc && song.deezerId) {
      const full = await deezerTrack(song.deezerId);
      if (full) song = { ...song, isrc: full.isrc, rawTitle: song.rawTitle ?? full.rawTitle, rawArtist: song.rawArtist ?? full.rawArtist, duration: song.duration || full.duration };
    }
    const sib = await findSibling(song);
    if (sib) { // nouvelle fiche Deezer de cette chanson (comme « Garder celui-ci »)
      try {
        await addAlias(song.deezerId, sib.work_id, { label: songLabel(song), songDuration: song.duration, isrc: song.isrc });
        workId = sib.work_id;
        known = await getVersion(versionKey(workId, mode));
      } catch (e) { console.error("jukebox alias:", e.message); }
    }
  }
  if (known && !known.missing) { // « à remplacer » : vidéo disparue, nouvelle recherche
    const text = songText(known); // texte corrigé à la main, s'il y en a un
    if (Date.now() - Date.parse(known.checked_at) < SONG_TTL) return { id: known.video_id, duration: known.duration, title: known.video_title || null, text };
    const { video } = await ytVideo(known.video_id); // revérification : 1 unité
    if (video) { // même vidéo : étiquette paroles inchangée
      await rememberSong(known.key, video, null, undefined, { keepLyrics: true });
      return { ...video, text };
    }
  }
  const results = await ytSearch(`${song.channel} ${song.title}`, mode, { beforeSearch });
  if (!results.length) return null;
  const { video: best, confidence } = pickVideo(results, song, mode);
  try {
    if (!workId) workId = await createWork({ deezerId: song.deezerId, label: songLabel(song), songDuration: song.duration, isrc: song.isrc });
    await rememberSong(versionKey(workId, mode), best, null, undefined, { confidence, source });
  } catch (e) { console.error("jukebox rememberSong:", e.message); } // titre ajouté quand même, cherché à nouveau la prochaine fois
  return best;
}

/* Revérification nocturne (appelée par /api/keep-alive) des liens de plus de
 * 25 jours, et de ceux dont on n'a pas encore le titre YouTube : 50 vidéos
 * par appel YouTube (1 unité). */
export async function refreshSongs(max = 2000) {
  const { data: old, error } = await catalog()
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
        await updateVersion(r.key, { checked_at: now, duration: v.duration, ...videoInfo(v), ...(r.missing ? { missing: false } : {}) }); // revenue
        report.checked++;
      } else if (r.validated || r.missing || r.blind || (r.enriched_at && (r.fr !== null || r.year))) {
        // travail fait (validation, blind test, année / langue) : gardé « à remplacer » plutôt qu'oublié
        await updateVersion(r.key, { missing: true, validated: false, checked_at: now });
        report.missing = (report.missing || 0) + 1;
      } else {
        await deleteVersion(r.key);
        report.forgotten++;
      }
    }
  }
  return report;
}

/* Mémoire des titres pour le super-admin.
 * status : all | todo (à vérifier) | ok (validés) | missing | blind | lyrics | suspect | dups
 *   | blindq (blind test à décider) | rerank (blind à reclasser) | meta (année ou langue manquante) ;
 * blind (catalogue) : undecided | no | yes | hard ;
 * mode : normal | karaoke ; lang : fr | intl | unknown ; decade : 1980… | unknown ;
 * sort : added | plays | rank | year | alpha (rev = 1 : sens inversé) ; q : interprète, titre (libellé ou texte corrigé). */
const SONG_SORTS = {
  added: [["created_at", false], ["checked_at", false]],
  plays: [["plays", false], ["rank", false]],
  rank: [["rank", false]],
  year: [["year", true]],
  alpha: [["label", true]],
  alphaDesc: [["label", false]],
};
export async function listSongs({ q, status, mode, lang, decade, sort, rev, keys, blind } = {}, limit = 200) {
  if (status === "dups") return findDuplicates();
  if (status === "links") return []; // vidéos hors mémoire : liste à part (lib/jukeboxLinks)
  const build = (req) => {
    if (Array.isArray(keys)) req = req.in("key", keys.length ? keys : ["-"]); // liste imposée (changements proposés)
    const term = String(q || "").trim().replace(/[%_,()*.:"\\]/g, " ").replace(/\s+/g, " ");
    if (term) req = req.or(["label", "artist_fix", "title_fix"].map((c) => `${c}.ilike.*${term}*`).join(","));
    if (status === "ok") req = req.eq("validated", true);
    if (status === "todo" || status === "suspect") req = req.eq("validated", false);
    if (status === "suspect") req = req.eq("missing", false);
    if (status === "blind") req = req.eq("blind", true);
    if (status === "rerank") req = req.eq("blind", true).in("mode", ["normal", "clip"]);
    if (status === "blindq") req = req.is("blind_decided_at", null).eq("missing", false).in("mode", ["normal", "clip"]);
    if (status === "meta") req = req.not("enriched_at", "is", null).or("year.is.null,fr.is.null");
    if (status === "yearq") req = req.not("year_suggest", "is", null);
    if (blind === "undecided") req = req.is("blind_decided_at", null);
    if (blind === "no") req = req.eq("blind", false).not("blind_decided_at", "is", null);
    if (blind === "yes") req = req.eq("blind", true).lt("difficulty", HARD);
    if (blind === "hard") req = req.eq("blind", true).gte("difficulty", HARD);
    if (status === "lyrics") req = req.eq("lyrics", true);
    if (status === "missing") req = req.eq("missing", true);
    if (lang === "fr") req = req.eq("fr", true);
    if (lang === "intl") req = req.eq("fr", false);
    if (lang === "unknown") req = req.is("fr", null);
    const dec = parseInt(decade, 10);
    if (dec >= 1900 && dec <= 2100) req = req.gte("year", dec).lte("year", dec + 9);
    if (decade === "unknown") req = req.is("year", null).not("enriched_at", "is", null); // enrichis sans année trouvée : à compléter à la main
    if (SEARCH_MODES.some((m) => m.id === mode)) req = req.eq("mode", mode);
    const flip = rev === "1" || rev === true; // sens inversé (bouton du super-admin)
    for (const [col, asc] of SONG_SORTS[sort] || SONG_SORTS.added) req = req.order(col, { ascending: flip ? !asc : asc, nullsFirst: false });
    return req;
  };
  if (status === "blindq") { // une ligne par chanson : les « oui » d'avant (déjà joués) d'abord, puis l'ordre du tri
    const rows = onePerWork(await allVersions(build, 10000), sort, rev);
    return [...rows.filter((r) => r.blind), ...rows.filter((r) => !r.blind)].map(songOut).slice(0, limit);
  }
  if (status === "meta" || status === "yearq") return onePerWork(await allVersions(build, 10000), sort, rev).map(songOut).slice(0, limit);
  if (status === "rerank") { // calculé : stats des réponses au blind test
    const [rows, stats] = await Promise.all([allVersions(build, 10000), blindStats()]);
    return rerankRows(rows, stats).map(songOut).slice(0, limit);
  }
  if (status === "suspect") { // calculé : on parcourt tous les titres non validés
    const rows = await allVersions(build, 10000);
    return rows.map(songOut).filter((s) => s.suspect.length).slice(0, limit);
  }
  const { data, error } = await build(catalog()).limit(limit);
  if (error) throw error;
  return data.map(songOut);
}

/* Vue par chanson (super-admin) : après chaque ligne trouvée, les autres
 * versions de sa chanson (marquées `sibling`), dans l'ordre Paroles, Clip,
 * Karaoké ; les chansons gardent l'ordre de la liste. */
const KIND_ORDER = { normal: 0, clip: 1, karaoke: 2 };
export async function withSiblings(songs) {
  const ids = [...new Set(songs.map((s) => s.workId).filter(Boolean))];
  if (!ids.length) return songs;
  const have = new Set(songs.map((s) => s.key));
  const extra = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await catalog().in("work_id", ids.slice(i, i + 100));
    if (error) throw error;
    for (const r of data || []) if (!have.has(r.key)) extra.push({ ...songOut(r), sibling: true });
  }
  const byWork = new Map();
  for (const s of [...songs, ...extra]) (byWork.get(s.workId) || byWork.set(s.workId, []).get(s.workId)).push(s);
  const out = [];
  for (const id of new Set(songs.map((s) => s.workId))) {
    out.push(...byWork.get(id).sort((a, b) => (KIND_ORDER[a.mode] ?? 9) - (KIND_ORDER[b.mode] ?? 9)));
  }
  return out;
}

/* Une autre version d'une chanson, cherchée tout de suite (super-admin, 1
 * recherche YouTube), ou reprise de la vidéo d'une autre version (pas de clip
 * officiel : même vidéo que la version paroles), validée puisque choisie. */
export async function searchVersion(key, kind) {
  const row = await getVersion(String(key || ""));
  if (!row || !SEARCH_MODES.some((m) => m.id === kind)) return "Titre introuvable.";
  const song = row.deezer_id ? await deezerTrack(row.deezer_id) : null;
  if (!song) return "Fiche Deezer introuvable.";
  const video = await youtubeForSong(song, kind, { source: "manual" });
  return video ? null : "Aucune vidéo trouvée.";
}
export async function copyVersion(key, kind) {
  const row = await getVersion(String(key || ""));
  if (!row || !SEARCH_MODES.some((m) => m.id === kind)) return "Titre introuvable.";
  await upsertVersion(row.work_id, kind, {
    video_id: row.video_id, duration: row.duration, video_title: row.video_title, video_channel: row.video_channel,
    lyrics: !!row.lyrics, validated: true, missing: false, source: "copy", confidence: null, checked_at: new Date().toISOString(),
  });
  return null;
}

/* Compteurs des filtres du super-admin (catalogue entier, sans les autres
 * filtres) : à vérifier, suspects, groupes de doublons, à remplacer. */
export async function songStatusCounts() {
  const head = () => getSupabaseAdmin().from("jukebox_catalog").select("key", { count: "exact", head: true });
  const [todo, missing, unchecked, dups, rerank, blindq, meta, yearq] = await Promise.all([
    head().eq("validated", false).eq("missing", false),
    head().eq("missing", true),
    allVersions((q) => q.eq("validated", false).eq("missing", false), 10000),
    findDuplicates(),
    Promise.all([allVersions((q) => q.eq("blind", true).in("mode", ["normal", "clip"]), 10000), blindStats()])
      .then(([rows, stats]) => rerankRows(rows, stats).length).catch(() => 0),
    allVersions((q) => q.select("work_id").is("blind_decided_at", null).eq("missing", false).in("mode", ["normal", "clip"]), 10000)
      .then((rows) => new Set(rows.map((r) => r.work_id)).size).catch(() => 0),
    allVersions((q) => q.select("work_id").not("enriched_at", "is", null).or("year.is.null,fr.is.null"), 10000)
      .then((rows) => new Set(rows.map((r) => r.work_id)).size).catch(() => 0),
    getSupabaseAdmin().from("jukebox_works").select("id", { count: "exact", head: true }).not("year_suggest", "is", null)
      .then((r) => r.count || 0, () => 0),
  ]);
  return {
    todo: todo.count || 0,
    missing: missing.count || 0,
    suspect: unchecked.map(songOut).filter((s) => s.suspect.length).length,
    dups: new Set(dups.map((r) => r.group)).size,
    rerank,
    blindq,
    meta,
    yearq,
  };
}

/* Une ligne par chanson (version paroles de préférence), dans l'ordre du tri. */
function onePerWork(rows, sort, rev) {
  const byWork = new Map();
  for (const r of rows) {
    const cur = byWork.get(r.work_id);
    if (!cur || (cur.mode !== "normal" && r.mode === "normal")) byWork.set(r.work_id, r);
  }
  const list = [...byWork.values()];
  const flip = rev === "1" || rev === true;
  const cmp = (a, b) => {
    for (const [col, asc] of SONG_SORTS[sort] || SONG_SORTS.added) {
      const x = a[col], y = b[col];
      if (x == null && y == null) continue;
      if (x == null) return 1; // vides à la fin
      if (y == null) return -1;
      if (x !== y) return (x < y ? -1 : 1) * (asc !== flip ? 1 : -1);
    }
    return 0;
  };
  return list.sort(cmp);
}

/* Réponses reçues depuis la décision blind test (toutes si jamais décidé). */
const sinceDecision = (stat, r) => stat && {
  n: stat.n - (r.blind_seen || 0),
  found: stat.found - (r.blind_seen_found || 0),
};

/* Blind test à reclasser d'après les réponses (une ligne par chanson, version
 * paroles de préférence) : normal peu trouvé, très difficile presque toujours
 * trouvé ; sauf si déjà passé en revue (« Garder ainsi »). */
function rerankRows(rows, stats) {
  const byWork = new Map();
  for (const r of rows) {
    if (!rerankReason(sinceDecision(stats[r.work_id], r), r.difficulty || 0)) continue;
    const cur = byWork.get(r.work_id);
    if (!cur || (cur.mode !== "normal" && r.mode === "normal")) byWork.set(r.work_id, r);
  }
  // les moins trouvés d'abord
  const rate = (r) => { const d = sinceDecision(stats[r.work_id], r); return d.found / d.n; };
  return [...byWork.values()].sort((a, b) => rate(a) - rate(b));
}

/* Stats des réponses ajoutées aux titres du blind test (super-admin). */
export async function withBlindStats(songs) {
  if (!songs.some((s) => s.blind)) return songs;
  const stats = await blindStats().catch(() => ({}));
  for (const s of songs) if (s.blind && stats[s.workId]) {
    s.blindStat = stats[s.workId];
    const since = s.blindSeen ? { n: s.blindStat.n - s.blindSeen.n, found: s.blindStat.found - s.blindSeen.found } : s.blindStat;
    s.rerank = rerankReason(since, s.difficulty);
  }
  return songs;
}

/* Décision blind test pour la chanson (toutes ses versions) : 0 pas au blind,
 * 1 oui, 2 oui très difficile. Datée ; les réponses déjà reçues sont notées
 * pour que « À reclasser » ne regarde que les suivantes. */
export async function blindDecide(key, level) {
  const row = await getVersion(String(key || ""));
  if (!row) return;
  const lv = [0, 1, 2].includes(Number(level)) ? Number(level) : 0;
  const st = (await blindStats().catch(() => ({})))[row.work_id];
  await updateWork(row.work_id, {
    blind: lv > 0, difficulty: lv === 2 ? HARD : 0,
    blind_decided_at: new Date().toISOString(), blind_seen: st?.n || 0, blind_seen_found: st?.found || 0,
  });
}

/* Titre utilisable (ou non) par le blind test (étiquette du super-admin). */
export async function blindSong(key, blind) {
  await updateVersion(String(key || ""), { blind: !!blind }); // étiquette de la chanson (toutes ses versions)
}

/* Étiquette « avec paroles » : la vidéo affiche les paroles (super-admin). */
export async function lyricsSong(key, lyrics) {
  await updateVersion(String(key || ""), { lyrics: !!lyrics });
}

export async function validateSong(key, validated) {
  await updateVersion(String(key || ""), { validated: !!validated });
}

/* Super-admin : autres vidéos possibles pour un titre mémorisé, et
 * remplacement de la vidéo retenue. */
export async function songCandidates(key) {
  const row = await getVersion(String(key || ""));
  if (!row) return null;
  const song = row.deezer_id ? await deezerTrack(row.deezer_id) : null;
  const query = song ? `${song.channel} ${song.title}` : row.label?.replace(" – ", " ");
  return { current: row.video_id, candidates: query ? await ytSearch(query, row.mode) : [] };
}

export async function replaceSongVideo(key, videoId) {
  const { video, reason } = await ytVideo(String(videoId || ""), { musicOnly: false });
  if (!video) return REJECT_MESSAGES[reason];
  await updateVersion(String(key || ""), {
    video_id: video.id, duration: video.duration, checked_at: new Date().toISOString(),
    validated: false, missing: false, source: "manual", ...(hasLyrics(video) !== undefined ? { lyrics: hasLyrics(video) } : {}), ...videoInfo(video), // à tester puis valider
  });
  return null;
}

/* Super-admin : mauvais titre Deezer (reprise, compilation…) : la ligne est
 * rattachée au bon titre, vidéo et étiquettes conservées ; année et langue
 * seront cherchées à nouveau. */
export async function retargetSong(key, deezerId) {
  const p = parseKey(key);
  const song = await deezerTrack(String(deezerId || ""));
  if (!song || !p) return "Titre introuvable.";
  const other = await workOfDeezer(song.deezerId);
  if (other === p.workId) return { key };
  if (other) return "Ce titre Deezer est déjà une autre chanson du catalogue : fusionnez-les plutôt (Doublons).";
  // la chanson change d'identité : nouvelle fiche Deezer principale, les anciennes fiches
  // (mauvais titre) sont retirées et seront cherchées à nouveau si on les rajoute
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("jukebox_work_aliases").delete().eq("work_id", p.workId);
  if (error) throw error;
  await addAlias(song.deezerId, p.workId, { label: songLabel(song), songDuration: song.duration, isrc: song.isrc });
  await updateWork(p.workId, {
    label: songLabel(song), year: null, lang: null, country: null, fr: null, enriched_at: null,
    artist_fix: null, title_fix: null, song_duration: song.duration || null, isrc: song.isrc || null,
  });
  return { key };
}

/* Un titre joué jusqu'au bout en soirée (pas passé) : +1 pour toutes les
 * lignes de cette vidéo (priorité de la revue dans le super-admin). */
export async function countPlay(videoId) {
  await catalogCountPlay(String(videoId || ""));
}

export async function forgetSong(key) {
  await deleteVersion(String(key || ""));
}

export async function songsCount() {
  try {
    const { count } = await getSupabaseAdmin().from("jukebox_versions").select("work_id", { count: "exact", head: true });
    return count || 0;
  } catch (e) {
    return 0;
  }
}

/* Super-admin : total des titres correspondant aux filtres choisis (versions,
 * chansons). Mêmes règles que listSongs. */
export async function songFacets({ q, status, mode, lang, decade, keys, blind } = {}) {
  if (status === "links") return {};
  if (["rerank", "blindq", "meta", "yearq"].includes(status)) { // calculé, une ligne par chanson
    const rows = (await listSongs({ q, status, mode, lang, decade, blind }, 10000));
    return { total: { versions: rows.length, songs: rows.length } };
  }
  const term = String(q || "").trim().toLowerCase().replace(/[%_,()*.:"\\]/g, " ").replace(/\s+/g, " ");
  const keySet = Array.isArray(keys) ? new Set(keys) : null;
  const n = parseInt(decade, 10);
  const all = (await allVersions()).filter((r) => {
    if (keySet && !keySet.has(r.key)) return false;
    if (term && ![r.label, r.artist_fix, r.title_fix].some((x) => String(x || "").toLowerCase().includes(term))) return false;
    if (mode && r.mode !== mode) return false;
    if (lang === "fr" ? r.fr !== true : lang === "intl" ? r.fr !== false : lang === "unknown" ? r.fr != null : false) return false;
    if (decade === "unknown" ? !(r.year == null && r.enriched_at) : n >= 1900 ? !(r.year >= n && r.year <= n + 9) : false) return false;
    if (blind === "undecided" ? !!r.blind_decided_at : blind === "no" ? (r.blind || !r.blind_decided_at)
      : blind === "yes" ? !(r.blind && (r.difficulty || 0) < HARD) : blind === "hard" ? !(r.blind && (r.difficulty || 0) >= HARD) : false) return false;
    switch (status) {
      case "ok": return !!r.validated;
      case "todo": return !r.validated;
      case "suspect": return !r.validated && !r.missing && songOut(r).suspect.length > 0;
      case "blind": return !!r.blind;
      case "lyrics": return !!r.lyrics;
      case "missing": return !!r.missing;
      default: return true;
    }
  });
  return { total: { versions: all.length, songs: new Set(all.map((r) => r.work_id)).size } };
}
