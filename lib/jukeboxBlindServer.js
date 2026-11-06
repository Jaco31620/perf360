/*
 * Jukebox — blind test, côté serveur (fonction « blindtest » activée par le
 * super-admin ; la régie l'allume et le règle dans options.blind).
 *  - Tant que la réponse n'est pas dévoilée (par la régie, ou au bout du délai
 *    choisi), le public ne voit ni le titre en cours ni la file.
 *  - Mode « phone » : les invités répondent (table jukebox_answers), points
 *    = 50 par élément trouvé (artiste, titre) + bonus de rapidité.
 *  - Les titres sont piochés au hasard parmi ceux de la mémoire marqués
 *    « blind test » dans le super-admin, selon les filtres de la régie
 *    (langue, décennies, vidéos validées, difficiles), jamais deux fois le
 *    même, ni le même artiste que dans les 5 derniers titres (pickIndex) ;
 *    difficiles (🎓) : exclus, ou au plus 1 titre sur N (blind.hard).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeFeatures, songText } from "@/lib/jukebox";
import { normalizeBlind, splitVideoTitle, hardAllowed, HARD, POINTS_BASE } from "@/lib/jukeboxBlind";

export const AUTO_PID = "blind-auto";
const AUTO_AHEAD = 2; // titres d'avance dans la file (préchargement, fondu)

/* Réglages du blind test de la soirée, ou null si la fonction est coupée. */
export function sessionBlind(s) {
  return normalizeFeatures(s.options?.features).blindtest ? normalizeBlind(s.options?.blind) : null;
}

/* Artiste et titre attendus : propres pour un titre Deezer (pochette Deezer)
 * ou pioché dans la mémoire, à extraire du titre de la vidéo sinon. */
export function expectedParts(t) {
  if (t.participant_id === AUTO_PID || String(t.thumb || "").includes("dzcdn")) return { artist: t.channel, title: t.title };
  return splitVideoTitle(t.title, t.channel);
}

/* Position de lecture (s) du titre en cours, d'après la régie (`playback`) :
 * les délais du blind test s'arrêtent quand la musique est en pause.
 * 0 tant que la régie n'a pas commencé à jouer ce titre. */
export function playPos(s, now) {
  const pb = s.playback;
  if (!now || !pb || pb.id !== now.id) return 0;
  return pb.pos + (pb.playing ? (Date.now() - pb.at) / 1000 : 0);
}
const isPlaying = (s, now) => !!(now && s.playback?.id === now.id && s.playback.playing);

/* Secondes de lecture depuis que la réponse est dévoilée (null : pas encore). */
export function revealedFor(s, blind, now) {
  if (!now) return null;
  const pos = playPos(s, now);
  if (blind.revealedId === now.id) return Math.max(0, pos - (blind.revealedPos ?? pos));
  if (blind.reveal > 0 && pos >= blind.reveal) return pos - blind.reveal;
  return null;
}

/* Partie « blind » de l'état d'une soirée (GET). */
export async function blindView(s, blind, now, { admin, pid }) {
  const sb = getSupabaseAdmin();
  const since = revealedFor(s, blind, now);
  const out = {
    on: true, mode: blind.mode, reveal: blind.reveal, after: blind.after,
    revealed: since !== null,
    revealedFor: since,
    revealIn: now && since === null && blind.reveal > 0 ? Math.max(0, Math.ceil(blind.reveal - playPos(s, now))) : null,
    playing: isPlaying(s, now), // compte à rebours de l'écran figé pendant une pause
    hold: !!now && blind.holdId === now.id, // titre prolongé par la régie
  };
  if (blind.mode === "phone") {
    // interrogé toutes les 1,5 s par chaque invité : colonnes légères seulement
    // (le détail des essais n'est lu que pour la régie, et pour le titre en cours)
    const { data } = await sb.from("jukebox_answers")
      .select("participant_id,author,points,track_id,artist_ok,title_ok,attempts").eq("session_id", s.id);
    const rows = data || [];
    const totals = {};
    for (const r of rows) {
      const t = (totals[r.participant_id] ||= { pid: r.participant_id, name: r.author, points: 0 });
      t.points += r.points;
      t.name = r.author;
    }
    const board = Object.values(totals).filter((t) => t.points > 0).sort((a, b) => b.points - a.points);
    // rang avec égalités : deux joueurs à 30 pts sont tous les deux 1ers (le suivant est 3e)
    const rankOf = (points) => 1 + board.filter((t) => t.points > points).length;
    out.top = board.slice(0, 5).map(({ name, points }) => ({ name, points, rank: rankOf(points) }));
    out.players = Object.keys(totals).length;
    if (pid) {
      const i = board.findIndex((t) => t.pid === pid);
      const mine = now ? rows.find((r) => r.track_id === now.id && r.participant_id === pid) : null;
      out.me = {
        points: totals[pid]?.points || 0,
        rank: i >= 0 ? rankOf(board[i].points) : null,
        round: mine ? { artist: mine.artist_ok, title: mine.title_ok, points: mine.points, attempts: mine.attempts } : null,
      };
    }
    const round = now ? rows.filter((r) => r.track_id === now.id) : [];
    if (out.revealed || admin)
      out.found = round.filter((r) => r.artist_ok || r.title_ok).sort((a, b) => b.points - a.points)
        .map((r) => ({ name: r.author, artist: r.artist_ok, title: r.title_ok, points: r.points }));
    if (admin && now) {
      const { data: detail } = await sb.from("jukebox_answers").select("participant_id,last_answer,tries")
        .eq("session_id", s.id).eq("track_id", now.id);
      const byPid = new Map((detail || []).map((d) => [d.participant_id, d]));
      for (const r of round) Object.assign(r, byPid.get(r.participant_id) || {});
    }
    if (admin) {
      // titre précédent : ses réponses refusées restent acceptables (la régie n'a pas toujours eu le temps)
      const { data: prev } = await sb.from("jukebox_tracks").select("id,title,channel")
        .eq("session_id", s.id).eq("status", "played").order("played_at", { ascending: false }).limit(1).maybeSingle();
      if (prev && prev.id !== now?.id) {
        const { data: pd } = await sb.from("jukebox_answers").select("participant_id,author,points,artist_ok,title_ok,last_answer")
          .eq("session_id", s.id).eq("track_id", prev.id);
        const open = (pd || []).filter((r) => !(r.artist_ok && r.title_ok) && r.last_answer);
        if (open.length) out.prev = { id: prev.id, title: prev.title, channel: prev.channel, answers: open.map((r) => ({
          participantId: r.participant_id, name: r.author, last: r.last_answer, artist: r.artist_ok, title: r.title_ok, points: r.points })) };
      }
    }
    if (admin)
      out.answers = round.map((r) => ({
        participantId: r.participant_id, name: r.author, last: r.last_answer, artist: r.artist_ok,
        title: r.title_ok, points: r.points, attempts: r.attempts,
        tries: Array.isArray(r.tries) && r.tries.length ? r.tries : r.last_answer ? [{ a: r.last_answer }] : [],
      }));
  }
  if (admin) out.facets = await blindFacets(s); // [décennie, fr, validé, déjà passé, nombre]
  return out;
}

/* Tous les titres « blind test » de la mémoire, un par chanson : version
 * paroles (normal) de préférence — les invités chantent une fois le titre
 * trouvé —, sinon clip ; jamais la version karaoké (pas de voix : on ne
 * reconnaît pas le titre). Gardé 30 s : la régie interroge toutes les 1,5 s. */
let tagged = null;
async function taggedSongs() {
  if (tagged && Date.now() - tagged.at < 30e3) return tagged.rows;
  const cols = "key,work_id,mode,video_id,label,duration,year,fr,validated,video_title,artist_fix,title_fix";
  const read = (c) => getSupabaseAdmin().from("jukebox_catalog").select(c)
    .eq("blind", true).eq("missing", false).in("mode", ["normal", "clip"]).not("label", "is", null).limit(5000);
  let { data, error } = await read(`${cols},difficulty`);
  if (error) ({ data, error } = await read(cols)); // colonne difficulty absente (SQL v30) : aucun titre difficile
  if (error) throw error;
  const PREF = { normal: 0, clip: 1 };
  const byId = new Map();
  for (const r of data || []) {
    const cur = byId.get(r.work_id);
    if (!(r.mode in PREF)) continue; // karaoké : jamais au blind test
    if (!cur || PREF[r.mode] < PREF[cur.mode]) byId.set(r.work_id, r);
  }
  tagged = { rows: [...byId.values()], at: Date.now() };
  return tagged.rows;
}

const decadeOf = (year) => (year ? Math.floor(year / 10) * 10 : null);
export const matchesBlind = (r, f) =>
  (f.lang === "all" || (f.lang === "fr" ? r.fr === true : r.fr === false))
  && (!f.decades.length || f.decades.includes(decadeOf(r.year)))
  && (!f.validated || r.validated)
  && (f.hard > 0 || !isHard(r));
const isHard = (r) => (r?.difficulty || 0) >= HARD;

/* Titres piochables selon les filtres de la régie. */
export async function blindPool(blind) {
  return (await taggedSongs()).filter((r) => matchesBlind(r, blind));
}

/* Comptes pour la régie : titres marqués regroupés par (décennie, langue,
 * validé, déjà passé ce soir) ; le panneau en déduit tous les nombres
 * affichés, sans attendre le serveur quand on change un filtre. */
/* Titres déjà passés dans la partie en cours (depuis « Nouvelle partie »). */
function usedSince(tracks, s) {
  const since = sessionBlind(s)?.since || 0;
  return new Set((tracks || []).filter((t) => t.status === "playing" || (t.status !== "queued" && Date.parse(t.created_at) >= since)).map((t) => t.video_id));
}

const facetsCache = new Map(); // régie : interrogé toutes les 1,5 s, recalculé au plus toutes les 10 s
export async function blindFacets(s) {
  const hit = facetsCache.get(s.id);
  if (hit && Date.now() - hit.at < 10e3 && hit.since === (sessionBlind(s)?.since || 0)) return hit.cells;
  const cells = await computeFacets(s);
  facetsCache.set(s.id, { at: Date.now(), since: sessionBlind(s)?.since || 0, cells });
  if (facetsCache.size > 200) facetsCache.delete(facetsCache.keys().next().value);
  return cells;
}
async function computeFacets(s) {
  const { data: tracks } = await getSupabaseAdmin().from("jukebox_tracks").select("video_id,status,created_at").eq("session_id", s.id).neq("status", "queued");
  const used = usedSince(tracks, s);
  const cells = new Map();
  for (const r of await taggedSongs()) {
    const cell = [decadeOf(r.year), r.fr ?? null, !!r.validated, used.has(r.video_id), 0, isHard(r)]; // [5] : difficile
    const k = cell.join("|");
    if (cells.has(k)) cells.get(k)[4]++;
    else { cell[4] = 1; cells.set(k, cell); }
  }
  return [...cells.values()];
}

/* Tirage : chaque titre a la même chance (un groupe — décennie, langue —
 * sort donc en proportion de son nombre de titres), sauf les artistes des
 * RECENT_ARTISTS derniers titres, écartés tant qu'il reste d'autres artistes. */
const RECENT_ARTISTS = 5;
const artistKey = (a) => String(a || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function pickIndex(pool, recentArtists) {
  const banned = new Set(recentArtists.slice(-RECENT_ARTISTS).filter(Boolean));
  const idx = pool.map((_, i) => i).filter((i) => !banned.has(artistKey(songText(pool[i]).artist)));
  const from = idx.length ? idx : pool.map((_, i) => i); // pas assez d'artistes différents
  return from[Math.floor(Math.random() * from.length)];
}

/* Titres piochés encore en attente retirés (arrêt du blind test, filtres changés). */
export async function dropBlindPicks(s) {
  await getSupabaseAdmin().from("jukebox_tracks").delete()
    .eq("session_id", s.id).eq("status", "queued").eq("participant_id", AUTO_PID);
}

/* Garde AUTO_AHEAD titres piochés en tête de file (avant d'éventuels titres
 * proposés plus tôt par les invités), sauf ceux déjà passés ce soir. */
export async function topUpBlind(s) {
  const blind = sessionBlind(s);
  if (!blind?.on) return 0;
  const sb = getSupabaseAdmin();
  const { data: tracks } = await sb.from("jukebox_tracks").select("video_id,channel,status,participant_id,position,created_at,played_at").eq("session_id", s.id);
  const queued = (tracks || []).filter((t) => t.status === "queued");
  const need = AUTO_AHEAD - queued.filter((t) => t.participant_id === AUTO_PID).length;
  if (need <= 0) return 0;
  // déjà passés dans cette partie, ou déjà dans la file
  const used = new Set([...usedSince(tracks, s), ...queued.map((t) => t.video_id)]);
  const pool = (await blindPool(blind)).filter((r) => !used.has(r.video_id));
  // derniers titres de la partie (joués puis piochés en attente), du plus ancien au plus récent
  const since = blind.since || 0;
  const recent = [
    ...(tracks || []).filter((t) => t.status !== "queued" && t.played_at && Date.parse(t.played_at) >= since)
      .sort((a, b) => Date.parse(a.played_at) - Date.parse(b.played_at)),
    ...queued.filter((t) => t.participant_id === AUTO_PID).sort((a, b) => a.position - b.position),
  ].slice(-RECENT_ARTISTS);
  const history = recent.map((t) => artistKey(t.channel));
  // difficiles : au plus 1 sur blind.hard parmi les derniers titres de la partie
  const hardByVideo = new Set((await taggedSongs()).filter(isHard).map((r) => r.video_id));
  const hardHist = [
    ...(tracks || []).filter((t) => t.status !== "queued" && t.played_at && Date.parse(t.played_at) >= since)
      .sort((a, b) => Date.parse(a.played_at) - Date.parse(b.played_at)),
    ...queued.filter((t) => t.participant_id === AUTO_PID).sort((a, b) => a.position - b.position),
  ].map((t) => hardByVideo.has(t.video_id));
  const picks = [];
  while (picks.length < need && pool.length) {
    // pas de difficile maintenant : parmi les autres, s'il en reste (sinon, pour ne pas s'arrêter)
    const normal = hardAllowed(hardHist, blind.hard) ? null : pool.map((r, i) => (isHard(r) ? -1 : i)).filter((i) => i >= 0);
    const i = normal?.length ? normal[pickIndex(normal.map((j) => pool[j]), history)] : pickIndex(pool, history);
    const [r] = pool.splice(i, 1);
    picks.push(r);
    history.push(artistKey(songText(r).artist));
    hardHist.push(isHard(r));
  }
  if (!picks.length) return 0;
  // après les titres déjà piochés, avant ceux des invités
  const autos = queued.filter((t) => t.participant_id === AUTO_PID).map((t) => Number(t.position));
  const others = queued.filter((t) => t.participant_id !== AUTO_PID).map((t) => Number(t.position));
  const from = autos.length ? Math.max(...autos) : Math.min(Date.now(), ...others) - 1;
  const to = Math.min(Infinity, ...others.filter((p) => p > from));
  const step = Number.isFinite(to) ? (to - from) / (picks.length + 1) : 1;
  const { error } = await sb.from("jukebox_tracks").insert(picks.map((r, i) => {
    const { artist, title } = songText(r); // libellé propre, ou corrigé à la main
    return {
      session_id: s.id, video_id: r.video_id, title, channel: artist,
      thumb: `https://i.ytimg.com/vi/${r.video_id}/mqdefault.jpg`, duration: r.duration, video_title: r.video_title || null,
      participant_id: AUTO_PID, author: "Blind test", position: from + step * (i + 1),
    };
  }));
  if (error) throw error;
  return picks.length;
}

/* La régie accepte une réponse refusée à tort, élément par élément
 * (part : "artist" | "title") : 50 points, sans bonus de rapidité. */
export async function acceptAnswer(s, trackId, participantId, name, part) {
  const col = part === "title" ? "title_ok" : "artist_ok";
  const sb = getSupabaseAdmin();
  const { data: row } = await sb.from("jukebox_answers").select("*").eq("track_id", trackId).eq("participant_id", participantId).maybeSingle();
  if (row?.[col]) return;
  const { error } = await sb.from("jukebox_answers").upsert({
    session_id: s.id, track_id: trackId, participant_id: participantId, author: row?.author || name || "?",
    artist_ok: !!row?.artist_ok, title_ok: !!row?.title_ok, [col]: true,
    points: (row?.points || 0) + POINTS_BASE,
    attempts: row?.attempts || 0, last_answer: row?.last_answer || null,
  }, { onConflict: "track_id,participant_id" });
  if (error) throw error;
}

/* Stats des réponses par chanson (super-admin) : { work_id: { n, found } },
 * n = réponses d'invités, found = artiste ou titre trouvé. Gardé 2 min. */
let statsCache = null;
export async function blindStats() {
  if (statsCache && Date.now() - statsCache.at < 120e3) return statsCache.map;
  const sb = getSupabaseAdmin();
  const byTrack = new Map();
  for (let from = 0; from < 200000; from += 1000) {
    const { data, error } = await sb.from("jukebox_answers").select("track_id,artist_ok,title_ok").order("id").range(from, from + 999);
    if (error) throw error;
    for (const a of data) {
      const t = byTrack.get(a.track_id) || byTrack.set(a.track_id, { n: 0, found: 0 }).get(a.track_id);
      t.n++;
      if (a.artist_ok || a.title_ok) t.found++;
    }
    if (data.length < 1000) break;
  }
  // titre de la file → vidéo → chanson
  const ids = [...byTrack.keys()];
  const byVideo = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from("jukebox_tracks").select("id,video_id").in("id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const t of data) {
      const st = byTrack.get(t.id);
      const v = byVideo.get(t.video_id) || byVideo.set(t.video_id, { n: 0, found: 0 }).get(t.video_id);
      v.n += st.n; v.found += st.found;
    }
  }
  const videos = [...byVideo.keys()];
  const map = {};
  for (let i = 0; i < videos.length; i += 200) {
    const { data, error } = await sb.from("jukebox_catalog").select("work_id,video_id,mode").in("video_id", videos.slice(i, i + 200)).in("mode", ["normal", "clip"]);
    if (error) throw error;
    const seen = new Set(); // une vidéo commune aux versions paroles et clip : comptée une fois
    for (const r of data) {
      if (seen.has(`${r.work_id}|${r.video_id}`)) continue;
      seen.add(`${r.work_id}|${r.video_id}`);
      const st = byVideo.get(r.video_id);
      const w = map[r.work_id] || (map[r.work_id] = { n: 0, found: 0 });
      w.n += st.n; w.found += st.found;
    }
  }
  statsCache = { at: Date.now(), map };
  return map;
}
