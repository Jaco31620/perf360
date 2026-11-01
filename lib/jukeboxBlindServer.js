/*
 * Jukebox — blind test, côté serveur (fonction « blindtest » activée par le
 * super-admin ; la régie l'allume et le règle dans options.blind).
 *  - Tant que la réponse n'est pas dévoilée (par la régie, ou au bout du délai
 *    choisi), le public ne voit ni le titre en cours ni la file.
 *  - Mode « phone » : les invités répondent (table jukebox_answers), points
 *    = 50 par élément trouvé (artiste, titre) + bonus de rapidité.
 *  - Les titres sont piochés au hasard parmi ceux de la mémoire marqués
 *    « blind test » dans le super-admin, selon les filtres de la régie
 *    (langue, décennies, vidéos validées), jamais deux fois le même.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeFeatures } from "@/lib/jukebox";
import { normalizeBlind, splitVideoTitle, POINTS_BASE } from "@/lib/jukeboxBlind";

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
    const { data } = await sb.from("jukebox_answers")
      .select("participant_id,author,points,track_id,artist_ok,title_ok,attempts,last_answer,tries").eq("session_id", s.id);
    const rows = data || [];
    const totals = {};
    for (const r of rows) {
      const t = (totals[r.participant_id] ||= { pid: r.participant_id, name: r.author, points: 0 });
      t.points += r.points;
      t.name = r.author;
    }
    const board = Object.values(totals).filter((t) => t.points > 0).sort((a, b) => b.points - a.points);
    out.top = board.slice(0, 5).map(({ name, points }) => ({ name, points }));
    out.players = Object.keys(totals).length;
    if (pid) {
      const i = board.findIndex((t) => t.pid === pid);
      const mine = now ? rows.find((r) => r.track_id === now.id && r.participant_id === pid) : null;
      out.me = {
        points: totals[pid]?.points || 0,
        rank: i >= 0 ? i + 1 : null,
        round: mine ? { artist: mine.artist_ok, title: mine.title_ok, points: mine.points, attempts: mine.attempts } : null,
      };
    }
    const round = now ? rows.filter((r) => r.track_id === now.id) : [];
    if (out.revealed || admin)
      out.found = round.filter((r) => r.artist_ok || r.title_ok).sort((a, b) => b.points - a.points)
        .map((r) => ({ name: r.author, artist: r.artist_ok, title: r.title_ok, points: r.points }));
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

/* Tous les titres « blind test » de la mémoire, un par titre Deezer (version
 * normale de préférence à la version karaoké). Gardé 30 s : la régie interroge toutes les 1,5 s. */
let tagged = null;
async function taggedSongs() {
  if (tagged && Date.now() - tagged.at < 30e3) return tagged.rows;
  const { data, error } = await getSupabaseAdmin().from("jukebox_songs")
    .select("key,video_id,label,duration,year,fr,validated,video_title")
    .eq("blind", true).eq("missing", false).not("label", "is", null).limit(5000);
  if (error) throw error;
  const byId = new Map();
  for (const r of data || []) {
    const [, id, mode] = r.key.split(":");
    if (!byId.has(id) || mode !== "karaoke") byId.set(id, r);
  }
  tagged = { rows: [...byId.values()], at: Date.now() };
  return tagged.rows;
}

const decadeOf = (year) => (year ? Math.floor(year / 10) * 10 : null);
export const matchesBlind = (r, f) =>
  (f.lang === "all" || (f.lang === "fr" ? r.fr === true : r.fr === false))
  && (!f.decades.length || f.decades.includes(decadeOf(r.year)))
  && (!f.validated || r.validated);

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

export async function blindFacets(s) {
  const { data: tracks } = await getSupabaseAdmin().from("jukebox_tracks").select("video_id,status,created_at").eq("session_id", s.id).neq("status", "queued");
  const used = usedSince(tracks, s);
  const cells = new Map();
  for (const r of await taggedSongs()) {
    const cell = [decadeOf(r.year), r.fr ?? null, !!r.validated, used.has(r.video_id)];
    const k = cell.join("|");
    if (cells.has(k)) cells.get(k)[4]++;
    else cells.set(k, [...cell, 1]);
  }
  return [...cells.values()];
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
  const { data: tracks } = await sb.from("jukebox_tracks").select("video_id,status,participant_id,position,created_at").eq("session_id", s.id);
  const queued = (tracks || []).filter((t) => t.status === "queued");
  const need = AUTO_AHEAD - queued.filter((t) => t.participant_id === AUTO_PID).length;
  if (need <= 0) return 0;
  // déjà passés dans cette partie, ou déjà dans la file
  const used = new Set([...usedSince(tracks, s), ...queued.map((t) => t.video_id)]);
  const pool = (await blindPool(blind)).filter((r) => !used.has(r.video_id));
  const picks = [];
  while (picks.length < need && pool.length) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  if (!picks.length) return 0;
  // après les titres déjà piochés, avant ceux des invités
  const autos = queued.filter((t) => t.participant_id === AUTO_PID).map((t) => Number(t.position));
  const others = queued.filter((t) => t.participant_id !== AUTO_PID).map((t) => Number(t.position));
  const from = autos.length ? Math.max(...autos) : Math.min(Date.now(), ...others) - 1;
  const to = Math.min(Infinity, ...others.filter((p) => p > from));
  const step = Number.isFinite(to) ? (to - from) / (picks.length + 1) : 1;
  const { error } = await sb.from("jukebox_tracks").insert(picks.map((r, i) => {
    const [artist, ...rest] = r.label.split(" – ");
    return {
      session_id: s.id, video_id: r.video_id, title: rest.join(" – ") || r.label, channel: artist,
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
