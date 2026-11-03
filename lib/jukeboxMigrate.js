/*
 * Jukebox — migration du catalogue (SERVEUR) : ancienne table jukebox_songs
 * (une ligne par fiche Deezer × mode, clé « dz:<id>:<mode> », fiches
 * rattachées par merged_into) → modèle chanson / fiches Deezer / versions
 * (SQL v28 : jukebox_works, jukebox_work_aliases, jukebox_versions).
 *
 * Règles :
 *  - une chanson par fiche Deezer « racine » ; une fiche rattachée (merged_into)
 *    devient une fiche Deezer de la chanson de sa ligne gardée ;
 *  - versions : une par mode (normal = paroles, karaoke) ; si deux fiches
 *    d'une même chanson ont une version du même mode, la ligne gardée l'emporte
 *    (« conflit » compté dans le compte rendu) ;
 *  - chanson : texte corrigé, année, langue, pays, ISRC de la ligne gardée
 *    (mode normal d'abord), sinon des autres ; écoutes additionnées (lignes non
 *    rattachées seulement : les alias recomptaient les mêmes écoutes) ;
 *    blind test si une de ses lignes l'était (y compris un alias) ;
 *  - références converties : propositions de changement de vidéo
 *    (jukebox_video_changes.song_key) et doublons ignorés (dup_ignore).
 * Relançable sans risque : ce qui existe déjà n'est ni recréé ni écrasé.
 * L'ancienne table n'est pas modifiée (sauvegarde).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const OLD_KEY = /^dz:(\d+):(normal|karaoke)$/;
const BATCH = 500;

async function pageAll(table, cols = "*", order = null) {
  const sb = getSupabaseAdmin();
  const out = [];
  for (let from = 0; from < 100000; from += 1000) {
    let q = sb.from(table).select(cols);
    if (order) q = q.order(order);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function inBatches(rows, write) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await write(rows.slice(i, i + BATCH));
    if (error) throw error;
  }
}

const first = (list, f) => {
  for (const r of list) if (r[f] !== null && r[f] !== undefined && r[f] !== "") return r[f];
  return null;
};

/* Calcul pur (testé) : lignes anciennes + fiches déjà migrées → nouvelles
 * chansons, fiches, versions, table de correspondance des clés. */
export function planMigration(oldRows, existingAliases = [], newId = () => crypto.randomUUID()) {
  const rows = oldRows.filter((r) => OLD_KEY.test(r.key));
  const parse = (k) => { const m = OLD_KEY.exec(k); return m ? { id: m[1], mode: m[2] } : null; };
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const byId = new Map();
  for (const r of rows) {
    const { id } = parse(r.key);
    (byId.get(id) || byId.set(id, []).get(id)).push(r);
  }
  // fiche racine d'une fiche Deezer : celle de sa ligne gardée (chaîne suivie, sans boucle)
  const rootOf = (id, seen = new Set()) => {
    if (seen.has(id)) return id;
    seen.add(id);
    const m = (byId.get(id) || []).find((r) => r.merged_into && byKey.has(r.merged_into));
    return m ? rootOf(parse(m.merged_into).id, seen) : id;
  };
  const groups = new Map(); // racine → fiches Deezer
  for (const id of byId.keys()) {
    const root = rootOf(id);
    (groups.get(root) || groups.set(root, []).get(root)).push(id);
  }

  const workOf = new Map(existingAliases.map((a) => [String(a.deezer_id), a.work_id]));
  const works = [], aliases = [], versions = [];
  const keyMap = new Map(); // « dz:id:mode » → « w:chanson:mode »
  let conflicts = 0, reused = 0;
  for (const [root, ids] of groups) {
    ids.sort((a, b) => (a === root ? -1 : b === root ? 1 : 0)); // racine d'abord
    const known = ids.map((id) => workOf.get(id)).find(Boolean);
    const workId = known || newId();
    if (known) reused++;
    const own = ids.flatMap((id) => byId.get(id).filter((r) => !r.merged_into));
    const all = ids.flatMap((id) => byId.get(id));
    // ordre de préférence : ligne gardée en mode normal, puis ses autres modes, puis les autres fiches
    const pref = [...own].sort((a, b) => (parse(a.key).id === root ? 0 : 1) - (parse(b.key).id === root ? 0 : 1)
      || (parse(a.key).mode === "normal" ? 0 : 1) - (parse(b.key).mode === "normal" ? 0 : 1));
    const meta = pref.length ? pref : all;
    if (!known) {
      works.push({
        id: workId,
        label: first(meta, "label"), artist_fix: first(meta, "artist_fix"), title_fix: first(meta, "title_fix"),
        isrc: first(meta, "isrc") ?? (all.some((r) => r.isrc === "") ? "" : null),
        song_duration: first(meta, "song_duration"), year: first(meta, "year"), lang: first(meta, "lang"),
        country: first(meta, "country"), fr: first(meta, "fr"), enriched_at: first(meta, "enriched_at"),
        rank: Math.max(0, ...all.map((r) => r.rank || 0)) || null,
        plays: own.reduce((n, r) => n + (r.plays || 0), 0),
        blind: all.some((r) => r.blind),
        created_at: all.map((r) => r.created_at || r.checked_at).filter(Boolean).sort()[0] || new Date().toISOString(),
      });
    }
    for (const id of ids) {
      const rs = byId.get(id);
      aliases.push({
        deezer_id: Number(id), work_id: workId,
        label: first(rs, "label"), song_duration: first(rs, "song_duration"), isrc: first(rs, "isrc"),
      });
    }
    const kinds = new Set();
    for (const r of pref) {
      const { mode } = parse(r.key);
      if (kinds.has(mode)) { conflicts++; continue; }
      kinds.add(mode);
      versions.push({
        work_id: workId, kind: mode, video_id: r.video_id, duration: r.duration ?? null,
        video_title: r.video_title ?? null, video_channel: r.video_channel ?? null,
        lyrics: !!r.lyrics, validated: !!r.validated, missing: !!r.missing, source: "migration",
        checked_at: r.checked_at || new Date().toISOString(), created_at: r.created_at || r.checked_at || new Date().toISOString(),
      });
    }
    for (const r of all) keyMap.set(r.key, `w:${workId}:${parse(r.key).mode}`);
  }
  return { rows: rows.length, works, aliases, versions, keyMap, conflicts, reused, songs: groups.size };
}

/* fresh : nouveau catalogue vidé puis refait depuis l'ancien (pour reprendre
 * les dernières modifications faites dans l'ancien avant la bascule). */
export async function migrateCatalog({ fresh = false } = {}) {
  const sb = getSupabaseAdmin();
  if (fresh) { // fiches et versions supprimées avec leur chanson (cascade)
    const { error } = await sb.from("jukebox_works").delete().not("id", "is", null);
    if (error) throw error;
  }
  const old = await pageAll("jukebox_songs", "*", "key");
  const existing = await pageAll("jukebox_work_aliases", "deezer_id,work_id");
  const plan = planMigration(old, existing);

  await inBatches(plan.works, (b) => sb.from("jukebox_works").insert(b));
  await inBatches(plan.aliases, (b) => sb.from("jukebox_work_aliases").upsert(b, { onConflict: "deezer_id", ignoreDuplicates: true }));
  await inBatches(plan.versions, (b) => sb.from("jukebox_versions").upsert(b, { onConflict: "work_id,kind", ignoreDuplicates: true }));

  // propositions de changement de vidéo : clé de la version
  let changes = 0;
  const { data: ch, error: e1 } = await sb.from("jukebox_video_changes").select("song_key").like("song_key", "dz:%");
  if (e1) throw e1;
  for (const k of new Set((ch || []).map((c) => c.song_key))) {
    const to = plan.keyMap.get(k);
    if (!to) continue;
    const { error } = await sb.from("jukebox_video_changes").update({ song_key: to }).eq("song_key", k);
    if (error) throw error;
    changes++;
  }

  // doublons ignorés : paires de clés de versions
  let pairs = 0;
  const { data: cfg } = await sb.from("jukebox_config").select("value").eq("key", "dup_ignore").maybeSingle();
  let list = [];
  try { list = JSON.parse(cfg?.value || "[]"); } catch (e) { list = []; }
  const out = new Set();
  for (const p of list) {
    const [a, b] = String(p).split("|");
    const na = plan.keyMap.get(a) || a, nb = plan.keyMap.get(b) || b;
    if (na === nb) continue;
    if (na !== a || nb !== b) pairs++;
    out.add(na < nb ? `${na}|${nb}` : `${nb}|${na}`);
  }
  if (list.length) {
    const { error } = await sb.from("jukebox_config").upsert({ key: "dup_ignore", value: JSON.stringify([...out].slice(-5000)) });
    if (error) throw error;
  }

  const count = async (t) => (await sb.from(t).select("*", { count: "exact", head: true })).count || 0;
  const [works, aliases, versions] = await Promise.all([count("jukebox_works"), count("jukebox_work_aliases"), count("jukebox_versions")]);
  return {
    oldRows: plan.rows, oldAliases: old.filter((r) => r.merged_into).length,
    songs: plan.songs, newSongs: plan.works.length, alreadyMigrated: plan.reused,
    conflicts: plan.conflicts, changesConverted: changes, dupPairsConverted: pairs,
    totals: { works, aliases, versions },
  };
}

/* État pour le super-admin : null si les tables v28 n'existent pas encore. */
export async function catalogState() {
  const sb = getSupabaseAdmin();
  const { count: works, error } = await sb.from("jukebox_works").select("*", { count: "exact", head: true });
  if (error) return null;
  const { count: versions } = await sb.from("jukebox_versions").select("*", { count: "exact", head: true });
  const { count: old } = await sb.from("jukebox_songs").select("*", { count: "exact", head: true }).is("merged_into", null);
  return { works: works || 0, versions: versions || 0, oldVersions: old || 0 };
}
