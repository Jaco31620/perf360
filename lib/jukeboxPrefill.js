/*
 * Jukebox — pré-remplissage de la mémoire des titres.
 * Le super-admin met des titres en attente (liste « Artiste - Titre » ou
 * playlist Deezer, pour un ou plusieurs modes) ; chaque matin vers 6 h (cron
 * /api/jukebox/prefill, 5 h UTC), on cherche leur vidéo YouTube jusqu'à
 * épuisement du quota. À cette heure-là, c'est le reste du quota de la veille
 * (remis à zéro à minuit, heure du Pacifique, soit 8 h ou 9 h en France) :
 * il serait perdu de toute façon, les soirées du jour gardent un quota neuf.
 * La file et le dernier rapport sont dans jukebox_config (pas de table).
 * Les titres trouvés arrivent « À vérifier » dans la mémoire, marqués
 * « blind test » si demandé.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeMode } from "@/lib/jukebox";
import { deezerFirst, deezerPlaylistTracks, youtubeForSong, songKey } from "@/lib/jukeboxServer";

const QUEUE_KEY = "prefill_queue";
const LAST_KEY = "prefill_last";
export const MAX_LINES = 100; // lignes par ajout (API Deezer : ~50 requêtes / 5 s)
const MAX_QUEUE = 2000;

async function readJson(key, fallback) {
  const { data } = await getSupabaseAdmin().from("jukebox_config").select("value").eq("key", key).maybeSingle();
  try { return data?.value ? JSON.parse(data.value) : fallback; } catch (e) { return fallback; }
}
async function writeJson(key, value) {
  const { error } = await getSupabaseAdmin().from("jukebox_config").upsert({ key, value: JSON.stringify(value) });
  if (error) throw error;
}

const itemKey = (it) => songKey(it.d, it.m);

export async function prefillState() {
  const [queue, last] = await Promise.all([readJson(QUEUE_KEY, []), readJson(LAST_KEY, null)]);
  return { pending: queue.length, last };
}

/* Ajoute des titres Deezer (pour chaque mode) à la file, sauf ceux déjà en
 * mémoire ou déjà en attente. */
async function enqueue(songs, modes, blind) {
  const items = [];
  for (const s of songs) for (const m of modes)
    items.push({ d: s.deezerId, m, a: s.channel, t: s.title, s: s.duration, ...(blind ? { b: 1 } : {}) });
  const queue = await readJson(QUEUE_KEY, []);
  const pending = new Set(queue.map(itemKey));
  const known = new Set();
  const keys = items.map(itemKey);
  for (let i = 0; i < keys.length; i += 200) { // par paquets : URL de requête limitée
    const { data } = await getSupabaseAdmin().from("jukebox_songs").select("key").in("key", keys.slice(i, i + 200));
    for (const r of data || []) known.add(r.key);
  }
  // déjà en mémoire : marqués « blind test » tout de suite si demandé
  if (blind && known.size) await getSupabaseAdmin().from("jukebox_songs").update({ blind: true }).in("key", [...known]);
  const fresh = items.filter((it) => {
    const k = itemKey(it);
    if (pending.has(k) || known.has(k)) return false;
    pending.add(k);
    return true;
  });
  const next = [...queue, ...fresh].slice(0, MAX_QUEUE);
  await writeJson(QUEUE_KEY, next);
  return { added: next.length - queue.length, skipped: items.length - fresh.length, pending: next.length };
}

const cleanModes = (modes) => {
  const out = [...new Set((Array.isArray(modes) ? modes : []).map(normalizeMode))];
  return out.length ? out : ["normal"];
};

/* Lignes « Artiste - Titre » → titres Deezer (le premier résultat). */
export async function prefillFromLines(text, modes, blind) {
  const lines = [...new Set(String(text || "").split("\n").map((l) => l.trim()).filter(Boolean))].slice(0, MAX_LINES);
  const songs = [];
  const notFound = [];
  for (let i = 0; i < lines.length; i += 5) { // 5 par 5 pour ménager l'API Deezer
    const batch = lines.slice(i, i + 5);
    const found = await Promise.all(batch.map((l) => deezerFirst(l).catch(() => null)));
    found.forEach((s, j) => (s ? songs.push(s) : notFound.push(batch[j])));
  }
  return { ...(await enqueue(songs, cleanModes(modes), blind)), notFound };
}

/* Playlist Deezer publique (blind test, soirée…) : tous ses titres. */
export async function prefillFromPlaylist(id, modes, blind) {
  const songs = await deezerPlaylistTracks(id);
  if (!songs) return null;
  return { ...(await enqueue(songs, cleanModes(modes), blind)), notFound: [] };
}

/* File d'attente détaillée (super-admin). */
export async function prefillItems() {
  return (await readJson(QUEUE_KEY, [])).map((it) => ({
    key: itemKey(it), artist: it.a, title: it.t, mode: it.m, blind: !!it.b,
  }));
}

/* Retirer des titres de la file, ou les passer en tête (traités en premier). */
export async function editPrefill(keys, op) {
  const set = new Set(Array.isArray(keys) ? keys.map(String) : []);
  const queue = await readJson(QUEUE_KEY, []);
  const hit = queue.filter((it) => set.has(itemKey(it)));
  const rest = queue.filter((it) => !set.has(itemKey(it)));
  await writeJson(QUEUE_KEY, op === "top" ? [...hit, ...rest] : rest);
}

export async function clearPrefill() {
  await writeJson(QUEUE_KEY, []);
}

/* Traitement (cron) : jusqu'au quota atteint, à la file vide ou à la limite
 * de temps de la fonction. */
export async function runPrefill(budgetMs = 270e3) {
  const start = Date.now();
  const queue = await readJson(QUEUE_KEY, []);
  const handled = new Set();
  let found = 0, failed = 0, stop = "empty";
  for (const it of queue) {
    if (Date.now() - start > budgetMs) { stop = "time"; break; }
    try {
      const video = await youtubeForSong({ deezerId: it.d, channel: it.a, title: it.t, duration: it.s }, it.m);
      video ? found++ : failed++;
      if (video && it.b) await getSupabaseAdmin().from("jukebox_songs").update({ blind: true }).eq("key", itemKey(it));
      handled.add(itemKey(it));
    } catch (e) {
      if (e?.quota) { stop = "quota"; break; }
      failed++;
      handled.add(itemKey(it));
    }
  }
  // relire la file : des titres ont pu être ajoutés pendant le traitement
  const rest = (await readJson(QUEUE_KEY, [])).filter((it) => !handled.has(itemKey(it)));
  await writeJson(QUEUE_KEY, rest);
  const report = { at: new Date().toISOString(), found, failed, stop, remaining: rest.length };
  await writeJson(LAST_KEY, report);
  return report;
}
