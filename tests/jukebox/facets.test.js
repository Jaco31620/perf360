import { it, expect, vi } from "vitest";
import { fakeSupabase } from "../helpers/fakeSupabase";
let sb;
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => sb }));
const { songFacets } = await import("@/lib/jukeboxServer");
it("total", async () => {
  const rows = [
    { key: "w:A:normal", work_id: "A", mode: "normal", label: "Queen – Bohemian Rhapsody", validated: true, fr: false, year: 1975, enriched_at: "x" },
    { key: "w:A:clip", work_id: "A", mode: "clip", label: "Queen – Bohemian Rhapsody", validated: false, fr: false, year: 1975, enriched_at: "x" },
    { key: "w:B:normal", work_id: "B", mode: "normal", label: "Indochine – L'aventurier", validated: false, fr: true, year: 1982, enriched_at: "x" },
  ];
  sb = fakeSupabase(() => ({ data: rows, error: null }));
  expect((await songFacets({})).total).toEqual({ versions: 3, songs: 2 });
  expect((await songFacets({ status: "todo" })).total).toEqual({ versions: 2, songs: 2 });
  expect((await songFacets({ lang: "fr" })).total).toEqual({ versions: 1, songs: 1 });
  expect((await songFacets({ decade: "1970", mode: "normal" })).total).toEqual({ versions: 1, songs: 1 });
  expect((await songFacets({ q: "queen" })).total).toEqual({ versions: 2, songs: 1 });
});
