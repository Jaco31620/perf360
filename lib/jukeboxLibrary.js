/*
 * Jukebox — gestion de la mémoire des titres (super-admin) : affichage d'une
 * ligne, titres suspects, doublons et fusion, texte corrigé à la main,
 * export / import (sauvegarde).
 *
 *  - Suspects (calculés, sans quota) : vidéo bien plus longue ou plus courte
 *    que le titre Deezer, titre de la vidéo qui ne contient pas le titre
 *    cherché, mots « live », « cover », « reprise »… absents du libellé.
 *    Un titre validé à la main n'est jamais suspect.
 *  - Doublons : même mode et même vidéo, ou interprète + titre identiques une
 *    fois nettoyés, fautes de frappe tolérées. « Ce ne sont pas des doublons »
 *    est retenu (jukebox_config « dup_ignore »).
 *  - Fusion : la ligne gardée reçoit les écoutes, étiquettes, année, langue ;
 *    les autres restent comme alias (merged_into) : leur titre Deezer donne la
 *    vidéo de la ligne gardée, sans nouvelle recherche YouTube.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { songText, SEARCH_MODES } from "@/lib/jukebox";
import { checkAnswer, normalizeText, cleanTitle, distance, tolerance } from "@/lib/jukeboxBlind";

const sb = () => getSupabaseAdmin();

/* Toutes les lignes (par pages : Supabase en renvoie 1 000 au plus). */
export async function allSongs(build = (q) => q, max = 20000) {
  const out = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(sb().from("jukebox_songs").select("*")).order("key").range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const SUSPECT_WORDS = /\b(cover|covers|reprise|live|concert|tribute|hommage|remix|nightcore|slowed|sped up|8d)\b/i;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
export function suspectReasons(r) {
  if (r.validated || r.missing) return [];
  const out = [];
  if (r.song_duration && r.duration) {
    const d = r.duration - r.song_duration;
    if (Math.abs(d) > Math.max(30, r.song_duration * 0.2))
      out.push(`vidéo ${d > 0 ? "plus longue" : "plus courte"} (${mmss(r.duration)} au lieu de ${mmss(r.song_duration)})`);
  }
  if (r.video_title) {
    const { artist, title } = songText(r);
    const c = checkAnswer(`${r.video_title} ${r.video_channel || ""}`, artist, title);
    if (!c.title) out.push(c.artist ? "titre absent de la vidéo" : "ni le titre ni l'interprète dans la vidéo");
    const w = r.video_title.match(SUSPECT_WORDS);
    if (w && !SUSPECT_WORDS.test(r.label || "")) out.push(`« ${w[0].toLowerCase()} » dans la vidéo`);
  }
  return out;
}

/* Ligne de la mémoire telle qu'affichée dans le super-admin. */
export function songOut(r) {
  const text = songText(r);
  return {
    key: r.key, mode: r.key.split(":")[2], label: r.label || null, videoId: r.video_id,
    artist: text.artist, title: text.title, fixed: !!(r.artist_fix || r.title_fix),
    duration: r.duration, songDuration: r.song_duration ?? null, checkedAt: r.checked_at,
    validated: !!r.validated, blind: !!r.blind, lyrics: !!r.lyrics, missing: !!r.missing, plays: r.plays || 0, rank: r.rank ?? null,
    year: r.year ?? null, fr: r.fr ?? null, enriched: !!r.enriched_at,
    videoTitle: r.video_title || null, videoChannel: r.video_channel || null,
    suspect: suspectReasons(r),
  };
}

/* ---------- Texte corrigé à la main ----------
 * Pour toutes les lignes du titre Deezer (tous modes). Vide, ou identique au
 * libellé nettoyé automatiquement : retour à l'automatique. */
export async function setSongText(key, artist, title) {
  const id = String(key || "").split(":")[1];
  if (!/^\d+$/.test(id || "")) return;
  const { data: row } = await sb().from("jukebox_songs").select("label").eq("key", String(key)).maybeSingle();
  const auto = songText({ label: row?.label });
  const a = String(artist || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const t = String(title || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const { error } = await sb().from("jukebox_songs").update({
    artist_fix: a && a !== auto.artist ? a : null,
    title_fix: t && t !== auto.title ? t : null,
  }).like("key", `dz:${id}:%`);
  if (error) throw error;
}

/* ---------- Doublons ---------- */
async function ignoredPairs() {
  const { data } = await sb().from("jukebox_config").select("value").eq("key", "dup_ignore").maybeSingle();
  try { return new Set(JSON.parse(data?.value || "[]")); } catch (e) { return new Set(); }
}
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export async function ignoreDuplicates(keys) {
  keys = [...new Set((keys || []).map(String))].slice(0, 20);
  const set = await ignoredPairs();
  for (const a of keys) for (const b of keys) if (a < b) set.add(pairKey(a, b));
  const { error } = await sb().from("jukebox_config").upsert({ key: "dup_ignore", value: JSON.stringify([...set].slice(-5000)) });
  if (error) throw error;
}

/* Groupes de doublons possibles : lignes au format songOut + group, dupWhy. */
export async function findDuplicates() {
  const rows = await allSongs((q) => q.is("merged_into", null));
  const ignored = await ignoredPairs();
  const parent = new Map(rows.map((r) => [r.key, r.key]));
  const find = (k) => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k))), parent.get(k)));
  const why = new Map();
  const link = (a, b, reason) => {
    if (a.key === b.key || ignored.has(pairKey(a.key, b.key))) return;
    parent.set(find(a.key), find(b.key));
    for (const k of [a.key, b.key]) if (!why.has(k)) why.set(k, reason);
  };
  for (const { id: mode } of SEARCH_MODES) {
    const list = rows.filter((r) => r.key.endsWith(`:${mode}`)).map((r) => {
      const t = songText(r);
      return { r, artist: normalizeText(cleanTitle(t.artist)), title: normalizeText(cleanTitle(t.title)) };
    });
    const bucket = (f) => {
      const m = new Map();
      for (const x of list) if (f(x)) (m.get(f(x)) || m.set(f(x), []).get(f(x))).push(x);
      return [...m.values()].filter((g) => g.length > 1);
    };
    for (const g of bucket((x) => x.r.video_id)) for (const x of g.slice(1)) link(g[0].r, x.r, "même vidéo");
    // même interprète : titres proches ; même titre : interprètes proches
    for (const g of bucket((x) => x.artist))
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const a = g[i].title.replace(/ /g, ""), b = g[j].title.replace(/ /g, "");
        if (a && distance(a, b) <= tolerance(Math.min(a.length, b.length))) link(g[i].r, g[j].r, a === b ? "même titre" : "titres proches");
      }
    for (const g of bucket((x) => x.title))
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const a = g[i].artist.replace(/ /g, ""), b = g[j].artist.replace(/ /g, "");
        if (a && distance(a, b) <= tolerance(Math.min(a.length, b.length))) link(g[i].r, g[j].r, "interprètes proches");
      }
  }
  const groups = new Map();
  for (const r of rows) {
    const root = find(r.key);
    (groups.get(root) || groups.set(root, []).get(root)).push(r);
  }
  return [...groups.values()].filter((g) => g.length > 1).slice(0, 100)
    .flatMap((g, i) => g.sort((a, b) => (b.validated - a.validated) || (b.plays || 0) - (a.plays || 0))
      .map((r) => ({ ...songOut(r), group: i, dupWhy: why.get(r.key) || null })));
}

/* Fusion : `keep` garde sa vidéo ; écoutes additionnées, étiquettes et
 * informations reprises des autres lignes quand elle ne les a pas. */
export async function mergeSongs(keep, keys) {
  keys = [...new Set((keys || []).map(String))].filter((k) => k !== keep).slice(0, 20);
  const { data: rows, error } = await sb().from("jukebox_songs").select("*").in("key", [keep, ...keys]);
  if (error) throw error;
  const k = rows.find((r) => r.key === keep);
  const others = rows.filter((r) => r.key !== keep);
  if (!k || !others.length) return "Titres introuvables.";
  const mode = keep.split(":")[2];
  if (others.some((r) => r.key.split(":")[2] !== mode)) return "Seuls des titres du même mode peuvent être fusionnés.";
  const pick = (f) => k[f] ?? others.find((r) => r[f] != null)?.[f] ?? null;
  const patch = {
    plays: rows.reduce((n, r) => n + (r.plays || 0), 0),
    rank: Math.max(0, ...rows.map((r) => r.rank || 0)) || null,
    blind: rows.some((r) => r.blind),
    validated: !!k.validated || others.some((r) => r.validated && r.video_id === k.video_id),
    year: pick("year"), fr: pick("fr"), artist_fix: pick("artist_fix"), title_fix: pick("title_fix"),
  };
  const now = new Date().toISOString();
  const r1 = await sb().from("jukebox_songs").update(patch).eq("key", keep);
  if (r1.error) throw r1.error;
  const r2 = await sb().from("jukebox_songs").update({ merged_into: keep, blind: false, validated: false, enriched_at: now })
    .in("key", others.map((r) => r.key));
  if (r2.error) throw r2.error;
  // alias des lignes fusionnées : vers la ligne gardée
  await sb().from("jukebox_songs").update({ merged_into: keep }).in("merged_into", others.map((r) => r.key));
  return null;
}

/* ---------- Export / import ---------- */
export const EXPORT_COLUMNS = ["key", "label", "artist_fix", "title_fix", "video_id", "video_title", "video_channel", "duration", "song_duration",
  "validated", "blind", "lyrics", "missing", "plays", "rank", "year", "fr", "merged_into", "checked_at", "enriched_at", "created_at"];

export async function exportSongs() {
  return (await allSongs()).map((r) => Object.fromEntries(EXPORT_COLUMNS.map((c) => [c, r[c] ?? null])));
}

const BOOL = ["validated", "blind", "lyrics", "missing"];
const INT = ["duration", "song_duration", "plays", "rank", "year"];
const TEXT = ["label", "artist_fix", "title_fix", "video_title", "video_channel", "merged_into"];
const DATE = ["checked_at", "enriched_at", "created_at"];
const KEY_RE = new RegExp(`^dz:\\d+:(${SEARCH_MODES.map((m) => m.id).join("|")})$`);

/* Restauration : lignes ajoutées ou mises à jour (colonnes connues seulement). */
export async function importSongs(input) {
  const rows = [];
  let skipped = 0;
  for (const x of (Array.isArray(input) ? input : []).slice(0, 20000)) {
    const v = (c) => (x?.[c] === undefined || x[c] === "" ? null : x[c]);
    if (!KEY_RE.test(String(v("key"))) || !/^[\w-]{11}$/.test(String(v("video_id")))) { skipped++; continue; }
    const r = { key: String(v("key")), video_id: String(v("video_id")) };
    for (const c of BOOL) r[c] = v(c) === true || v(c) === "true" || v(c) === "1";
    for (const c of INT) r[c] = v(c) == null || !Number.isFinite(Number(v(c))) ? null : Math.round(Number(v(c)));
    for (const c of TEXT) r[c] = v(c) == null ? null : String(v(c)).slice(0, 500);
    for (const c of DATE) r[c] = v(c) && !Number.isNaN(Date.parse(v(c))) ? new Date(v(c)).toISOString() : null;
    r.fr = v("fr") == null ? null : v("fr") === true || v("fr") === "true";
    r.plays ??= 0;
    r.checked_at ??= new Date(0).toISOString(); // sans date : revérifié la nuit suivante
    if (!r.created_at) delete r.created_at;
    rows.push(r);
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb().from("jukebox_songs").upsert(rows.slice(i, i + 500));
    if (error) throw error;
  }
  return { imported: rows.length, skipped };
}
