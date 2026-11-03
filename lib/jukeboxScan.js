/*
 * Jukebox — recherche automatique des versions manquantes (SERVEUR) : chaque
 * chanson du catalogue doit avoir une version clip (clip officiel, sinon la
 * meilleure vidéo trouvée — éventuellement la même que la version paroles).
 * Passage chaque matin (cron /api/jukebox/prefill) APRÈS le pré-remplissage,
 * avec le reste du quota YouTube de la veille, jusqu'à épuisement du quota ou
 * de la limite de temps. Priorité : chansons les plus jouées, validées, blind
 * test. Le karaoké n'est pas cherché automatiquement.
 * Chaque trouvaille arrive « À vérifier » (indice de confiance pour la revue).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { allVersions } from "@/lib/jukeboxCatalog";
import { deezerTrack, youtubeForSong } from "@/lib/jukeboxServer";

const LAST_KEY = "clip_scan_last";
const WANTED = "clip";

/* Chansons sans version clip, par priorité décroissante. */
export async function missingClips() {
  const rows = await allVersions();
  const byWork = new Map();
  for (const r of rows) {
    const w = byWork.get(r.work_id) || { workId: r.work_id, deezerId: r.deezer_id, label: r.label, plays: r.plays || 0, blind: !!r.blind, validated: false, kinds: new Set() };
    w.kinds.add(r.mode);
    if (r.validated) w.validated = true;
    byWork.set(r.work_id, w);
  }
  return [...byWork.values()].filter((w) => !w.kinds.has(WANTED) && w.deezerId)
    .sort((a, b) => b.plays - a.plays || Number(b.validated) - Number(a.validated) || Number(b.blind) - Number(a.blind));
}

async function writeLast(report) {
  await getSupabaseAdmin().from("jukebox_config").upsert({ key: LAST_KEY, value: JSON.stringify(report) });
}
export async function scanState() {
  const [{ data }, missing] = await Promise.all([
    getSupabaseAdmin().from("jukebox_config").select("value").eq("key", LAST_KEY).maybeSingle(),
    missingClips().catch(() => null),
  ]);
  let last = null;
  try { last = data?.value ? JSON.parse(data.value) : null; } catch (e) { last = null; }
  return { missing: missing ? missing.length : null, last };
}

/* Cherche les clips manquants jusqu'au quota, au temps ou à `max` chansons. */
export async function scanClips(budgetMs = 60e3, max = 1000) {
  const start = Date.now();
  const list = (await missingClips()).slice(0, max);
  let found = 0, failed = 0, errors = 0, stop = list.length ? "done" : "empty", error = null;
  for (const w of list) {
    if (Date.now() - start > budgetMs) { stop = "time"; break; }
    try {
      const song = await deezerTrack(w.deezerId); // fiche Deezer complète (gratuite) : titre, artiste, durée, ISRC
      const video = song ? await youtubeForSong(song, WANTED, { source: "scan" }) : null;
      video ? found++ : failed++;
      errors = 0;
    } catch (e) {
      if (e?.quota) { stop = "quota"; break; }
      error = String(e?.message || e);
      console.error("jukebox scan:", w.label, error);
      if (++errors >= 3) { stop = "error"; break; }
    }
  }
  const report = { at: new Date().toISOString(), found, failed, stop, remaining: Math.max(0, list.length - found - failed), ...(stop === "error" ? { error } : {}) };
  await writeLast(report).catch(() => {});
  return report;
}
