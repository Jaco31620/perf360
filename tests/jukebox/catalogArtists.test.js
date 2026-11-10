/* Catalogue invités : vue « Artistes » et titres d'un interprète. */
import { describe, it, expect, vi } from "vitest";

const ROWS = [
  { key: "a", work_id: 1, deezer_id: 11, video_id: "v1", label: "Joe Dassin – Les Champs-Elysées", plays: 5, year: 1969 },
  { key: "b", work_id: 2, deezer_id: 12, video_id: "v2", label: "Joe Dassin – L'été indien", plays: 2, year: 1975 },
  { key: "c", work_id: 3, deezer_id: 13, video_id: "v3", label: "Téléphone – New York avec toi", plays: 9, year: 1984 },
  { key: "d", work_id: 4, deezer_id: 14, video_id: "v4", label: "ABBA – Dancing Queen", plays: 1, year: 1976 },
  { key: "e", work_id: 5, deezer_id: 15, video_id: "v5", label: "Queen – Bohemian Rhapsody", plays: 3, year: 1975 },
];
// requête PostgREST simulée : chaînable, renvoie toutes les lignes (le filtre fin est dans la route)
const chain = () => {
  const q = new Proxy({}, { get: (_, k) => (k === "range" ? async () => ({ data: ROWS, error: null }) : k === "then" ? undefined : () => q) });
  return q;
};
vi.mock("@/lib/jukeboxCatalog", () => ({ catalog: () => chain() }));
vi.mock("@/lib/jukeboxRate", () => ({ tooMany: async () => false, clientIp: () => "1" }));
vi.mock("@/lib/jukeboxServer", () => ({
  loadSession: async () => ({ id: "s" }),
  publicSession: () => ({ catalog: true, searchMode: "normal" }),
}));
const played = () => { const q = new Proxy({}, { get: (_, k) => (k === "limit" ? async () => ({ data: [] }) : k === "then" ? undefined : () => q) }); return q; };
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => ({ from: () => played() }) }));

const { GET } = await import("@/app/api/jukebox/[code]/catalog/route");
const call = async (qs) => (await GET(new Request(`https://x.test/api/jukebox/ABC/catalog?${qs}`), { params: Promise.resolve({ code: "ABC" }) })).json();

describe("catalogue : artistes", () => {
  it("regroupe par interprète, les plus joués d'abord", async () => {
    const d = await call("view=artists");
    expect(d.artists).toEqual([
      { name: "Téléphone", count: 1 }, { name: "Joe Dassin", count: 2 }, { name: "Queen", count: 1 }, { name: "ABBA", count: 1 },
    ]);
  });
  it("A → Z", async () => {
    expect((await call("view=artists&sort=alpha")).artists.map((a) => a.name)).toEqual(["ABBA", "Joe Dassin", "Queen", "Téléphone"]);
  });
  it("titres d'un interprète : pas ceux dont seul le titre ressemble", async () => {
    const d = await call("artist=Queen");
    expect(d.results.map((r) => r.title)).toEqual(["Bohemian Rhapsody"]);
    expect(d.more).toBe(false);
    expect((await call("artist=Joe%20Dassin")).results).toHaveLength(2);
  });
});
