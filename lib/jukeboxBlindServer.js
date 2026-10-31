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

/* Secondes depuis que la réponse est dévoilée (null : pas encore). */
export function revealedFor(blind, now) {
  if (!now) return null;
  const started = Date.parse(now.played_at) || Date.now();
  if (blind.revealedId === now.id) return (Date.now() - (blind.revealedAt || started)) / 1000;
  if (blind.reveal > 0) {
    const t = (Date.now() - started) / 1000 - blind.reveal;
    if (t >= 0) return t;
  }
  return null;
}

/* Partie « blind » de l'état d'une soirée (GET). */
export async function blindView(s, blind, now, { admin, pid }) {
  const sb = getSupabaseAdmin();
  const since = revealedFor(blind, now);
  const out = {
    on: true, mode: blind.mode, reveal: blind.reveal, after: blind.after,
    revealed: since !== null,
    revealedFor: since,
    revealIn: now && since === null && blind.reveal > 0
      ? Math.max(0, Math.ceil(blind.reveal - (Date.now() - (Date.parse(now.played_at) || Date.now())) / 1000)) : null,
  };
  if (blind.mode === "phone") {
    const { data } = await sb.from("jukebox_answers")
      .select("participant_id,author,points,track_id,artist_ok,title_ok,attempts,last_answer").eq("session_id", s.id);
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
      }));
  }
  if (admin) out.pool = (await blindPool(blind)).length;
  return out;
}

/* Titres « blind test » piochables selon les filtres, un par titre Deezer
 * (version normale de préférence). Gardé 30 s par filtre : la régie interroge toutes les 1,5 s. */
const poolCache = new Map();
export async function blindPool(blind) {
  const filters = { lang: blind.lang, decades: blind.decades, validated: blind.validated };
  const ck = JSON.stringify(filters);
  const hit = poolCache.get(ck);
  if (hit && Date.now() - hit.at < 30e3) return hit.rows;
  let req = getSupabaseAdmin().from("jukebox_songs").select("key,video_id,label,duration,year,validated")
    .eq("blind", true).eq("missing", false).not("label", "is", null);
  if (blind.lang === "fr") req = req.eq("fr", true);
  if (blind.lang === "intl") req = req.eq("fr", false);
  if (blind.validated) req = req.eq("validated", true);
  if (blind.decades.length) req = req.or(blind.decades.map((d) => `and(year.gte.${d},year.lte.${d + 9})`).join(","));
  const { data, error } = await req.limit(5000);
  if (error) throw error;
  const byId = new Map();
  for (const r of data || []) {
    const [, id, mode] = r.key.split(":");
    if (!byId.has(id) || mode === "normal") byId.set(id, r);
  }
  const rows = [...byId.values()];
  poolCache.set(ck, { rows, at: Date.now() });
  return rows;
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
  const { data: tracks } = await sb.from("jukebox_tracks").select("video_id,status,participant_id,position").eq("session_id", s.id);
  const queued = (tracks || []).filter((t) => t.status === "queued");
  const need = AUTO_AHEAD - queued.filter((t) => t.participant_id === AUTO_PID).length;
  if (need <= 0) return 0;
  const used = new Set((tracks || []).map((t) => t.video_id));
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
      thumb: `https://i.ytimg.com/vi/${r.video_id}/mqdefault.jpg`, duration: r.duration,
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
