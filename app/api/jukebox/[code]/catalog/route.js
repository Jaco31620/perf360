/*
 * Catalogue pour les invités : titres VÉRIFIÉS (version validée de la soirée :
 * paroles, clip ou karaoké), à parcourir quand on n'a pas d'idée.
 * ?decade=1980,1990 (une ou plusieurs décennies) &lang=fr|intl &sort=plays|alpha &q=<texte> &offset=<n>
 * → { results: [...], more } (30 par page ; format des résultats de recherche :
 * l'ajout passe par la fiche Deezer, sans recherche YouTube). Option de la
 * soirée « catalogue » (oui par défaut).
 */
import { tooMany, clientIp } from "@/lib/jukeboxRate";
import { loadSession, publicSession } from "@/lib/jukeboxServer";
import { catalog } from "@/lib/jukeboxCatalog";
import { songText } from "@/lib/jukebox";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PAGE = 30;
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

    let q = catalog("key,work_id,deezer_id,video_id,label,artist_fix,title_fix,duration,year,fr,plays")
      .eq("mode", pub.searchMode).eq("validated", true).eq("missing", false).not("deezer_id", "is", null);
    // une ou plusieurs décennies (« 1980,1990 ») : l'une OU l'autre
    const decs = [...new Set(p("decade").split(",").map((d) => parseInt(d, 10)).filter((d) => d >= 1900 && d <= 2100))].slice(0, 10);
    if (decs.length) q = q.or(decs.map((d) => `and(year.gte.${d},year.lte.${d + 9})`).join(","));
    if (p("lang") === "fr") q = q.eq("fr", true);
    if (p("lang") === "intl") q = q.eq("fr", false);
    const term = p("q").trim().slice(0, 80).replace(/[%_,()*.:"\\]/g, " ").replace(/\s+/g, " ");
    if (term) q = q.or(["label", "artist_fix", "title_fix"].map((c) => `${c}.ilike.*${term}*`).join(","));
    q = p("sort") === "alpha" ? q.order("label", { ascending: true }) : q.order("plays", { ascending: false }).order("rank", { ascending: false, nullsFirst: false }).order("label");
    const offset = Math.max(0, Math.min(5000, parseInt(p("offset"), 10) || 0));
    const { data, error } = await q.range(offset, offset + PAGE); // une ligne de plus : y en a-t-il encore ?
    if (error) throw error;

    // titres déjà passés ce soir
    const { data: played } = await getSupabaseAdmin().from("jukebox_tracks").select("title,channel,video_id,played_at")
      .eq("session_id", s.id).in("status", ["played", "skipped"]).order("played_at", { ascending: false }).limit(500);
    const last = new Map();
    for (const t of played || []) for (const k of [`${norm(t.title)}|${norm(t.channel)}`, t.video_id]) if (!last.has(k)) last.set(k, t.played_at);

    const rows = (data || []).slice(0, PAGE);
    return Response.json({
      more: (data || []).length > PAGE,
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
