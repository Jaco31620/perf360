/*
 * Catalogue pour les invités : titres VÉRIFIÉS (version validée de la soirée :
 * paroles, clip ou karaoké), à parcourir quand on n'a pas d'idée.
 * ?decade=1980,1990 (une ou plusieurs décennies) &lang=fr|intl &sort=plays|alpha &q=<texte> &offset=<n>
 * → { results: [...], more } (30 par page ; format des résultats de recherche :
 * l'ajout passe par la fiche Deezer, sans recherche YouTube). Option de la
 * soirée « catalogue » (oui par défaut).
 *  &artist=<nom> : les titres de cet interprète (tous, sans pages)
 *  &view=artists : les interprètes → { artists: [{ name, count }] }
 */
import { tooMany, clientIp } from "@/lib/jukeboxRate";
import { loadSession, publicSession } from "@/lib/jukeboxServer";
import { catalog } from "@/lib/jukeboxCatalog";
import { songText } from "@/lib/jukebox";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sameArtist } from "@/lib/jukeboxBlind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PAGE = 30;
const MAX_ROWS = 5000; // interprètes et titres d'un interprète : tout le catalogue du mode, par blocs de 1000
// texte tapé ou nom d'artiste, sans les caractères spéciaux de PostgREST (« _ » : n'importe quel caractère)
const safe = (x) => String(x || "").trim().slice(0, 80).replace(/[%,()*.:"\\]/g, "_").replace(/\s+/g, " ");
const norm = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export async function GET(req, { params }) {
  const { code } = await params;
  const url = new URL(req.url);
  const p = (k) => String(url.searchParams.get(k) || "");
  try {
    const s = await loadSession(code);
    if (!s) return Response.json({ error: "Soirée introuvable." }, { status: 404 });
    const pub = publicSession(s);
    if (!pub.catalog) return Response.json({ error: "Catalogue non proposé pour cette soirée." }, { status: 403 });
    if (await tooMany(`search:${clientIp(req)}`, 600, 600))
      return Response.json({ results: [], error: "Beaucoup de recherches : patientez quelques minutes." }, { status: 429 });

    const decs = [...new Set(p("decade").split(",").map((d) => parseInt(d, 10)).filter((d) => d >= 1900 && d <= 2100))].slice(0, 10);
    const term = p("q").trim().slice(0, 80).replace(/[%_,()*.:"\\]/g, " ").replace(/\s+/g, " ");
    const artist = p("artist").trim().slice(0, 80);
    const query = (cols) => {
      let q = catalog(cols).eq("mode", pub.searchMode).eq("validated", true).eq("missing", false).not("deezer_id", "is", null);
      // une ou plusieurs décennies (« 1980,1990 ») : l'une OU l'autre
      if (decs.length) q = q.or(decs.map((d) => `and(year.gte.${d},year.lte.${d + 9})`).join(","));
      if (p("lang") === "fr") q = q.eq("fr", true);
      if (p("lang") === "intl") q = q.eq("fr", false);
      if (term) q = q.or(["label", "artist_fix", "title_fix"].map((c) => `${c}.ilike.*${term}*`).join(","));
      // interprète : dégrossi par la base, puis comparé au nom affiché (featuring, majuscules…)
      if (artist) q = q.or(["label", "artist_fix"].map((c) => `${c}.ilike.*${safe(artist)}*`).join(","));
      return p("sort") === "alpha" ? q.order("label", { ascending: true }) : q.order("plays", { ascending: false }).order("rank", { ascending: false, nullsFirst: false }).order("label");
    };
    const all = async (cols) => {
      const rows = [];
      for (let from = 0; from < MAX_ROWS; from += 1000) {
        const { data, error } = await query(cols).range(from, from + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if ((data || []).length < 1000) break;
      }
      return rows;
    };

    // liste des interprètes (nombre de titres), dans l'ordre demandé
    if (p("view") === "artists") {
      const by = new Map();
      for (const r of await all("label,artist_fix,plays,rank")) {
        const name = songText(r).artist;
        const k = norm(name);
        if (!k) continue;
        const a = by.get(k) || { name, count: 0, plays: 0 };
        a.count++;
        a.plays += Number(r.plays) || 0;
        by.set(k, a);
      }
      const artists = [...by.values()].sort(p("sort") === "alpha"
        ? (a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" })
        : (a, b) => b.plays - a.plays || b.count - a.count || a.name.localeCompare(b.name, "fr"));
      return Response.json({ artists: artists.map(({ name, count }) => ({ name, count })) }, { headers: { "cache-control": "no-store" } });
    }

    const cols = "key,work_id,deezer_id,video_id,label,artist_fix,title_fix,duration,year,fr,plays";
    let data;
    if (artist) data = (await all(cols)).filter((r) => sameArtist(songText(r).artist, artist));
    else {
      const offset = Math.max(0, Math.min(5000, parseInt(p("offset"), 10) || 0));
      const res = await query(cols).range(offset, offset + PAGE); // une ligne de plus : y en a-t-il encore ?
      if (res.error) throw res.error;
      data = res.data;
    }

    // titres déjà passés ce soir
    const { data: played } = await getSupabaseAdmin().from("jukebox_tracks").select("title,channel,video_id,played_at")
      .eq("session_id", s.id).in("status", ["played", "skipped"]).order("played_at", { ascending: false }).limit(500);
    const last = new Map();
    for (const t of played || []) for (const k of [`${norm(t.title)}|${norm(t.channel)}`, t.video_id]) if (!last.has(k)) last.set(k, t.played_at);

    const rows = artist ? data : (data || []).slice(0, PAGE);
    return Response.json({
      more: !artist && (data || []).length > PAGE,
      results: rows.map((r) => {
        const t = songText(r);
        const at = last.get(`${norm(t.title)}|${norm(t.artist)}`) || last.get(r.video_id);
        return {
          id: `dz${r.deezer_id}`, deezerId: Number(r.deezer_id), title: t.title, channel: t.artist, year: r.year || null,
          thumb: `https://i.ytimg.com/vi/${r.video_id}/mqdefault.jpg`, duration: r.duration, known: 2,
          ...(at ? { playedAt: at } : {}),
        };
      }),
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("jukebox catalog:", e);
    return Response.json({ error: "Catalogue indisponible." }, { status: 502 });
  }
}
