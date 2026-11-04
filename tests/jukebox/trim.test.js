// Rognage par usage (SQL v29) : réglage propre à une version, repli sur le réglage commun
import { describe, it, expect, vi } from "vitest";
import { fakeSupabase } from "../helpers/fakeSupabase";

let sb;
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => sb }));
const { saveTrim, withTrims } = await import("@/lib/jukeboxTrim");
const VID = "abcdefghijk";

describe("withTrims", () => {
  it("réglage propre à la version d'abord, puis réglage commun ; « entière » explicite l'emporte", async () => {
    sb = fakeSupabase(() => ({ data: [
      { video_id: VID, kind: "", start_at: 12, end_at: null, source: "manual" },
      { video_id: VID, kind: "clip", start_at: 0, end_at: null, source: "manual" },
    ], error: null }));
    const paroles = { videoId: VID, mode: "normal" }, clip = { videoId: VID, mode: "clip" };
    await withTrims([paroles, clip], (t) => [t.mode]);
    expect(paroles).toMatchObject({ start: 12, end: null, trimKind: null }); // commun
    expect(clip).toMatchObject({ start: 0, end: null, trimKind: "clip" }); // entière pour le clip
  });
});

describe("saveTrim", () => {
  const upserts = () => sb.calls.filter((c) => c.ops.some((o) => o.name === "upsert")).map((c) => c.ops.find((o) => o.name === "upsert").args[0]);
  it("rognage de la version paroles : ligne propre (kind normal), le réglage du clip n'est pas touché", async () => {
    sb = fakeSupabase(() => ({ data: null, error: null }));
    await saveTrim(VID, { start: 25, end: null, kind: "normal" });
    expect(upserts()).toEqual([expect.objectContaining({ video_id: VID, kind: "normal", start_at: 25, end_at: null })]);
  });
  it("« sans rognage » sur le clip alors qu'un réglage commun existe : « entière » explicite pour le clip", async () => {
    sb = fakeSupabase(({ op }) => (op("maybeSingle") ? { data: { video_id: VID }, error: null } : { data: null, error: null }));
    await saveTrim(VID, { start: 0, end: null, kind: "clip" });
    expect(upserts()).toEqual([expect.objectContaining({ kind: "clip", start_at: 0, end_at: null })]);
  });
  it("colonne kind absente (avant le SQL v29) : rognage par vidéo, sans rien retenir pour la suite", async () => {
    let first = true;
    sb = fakeSupabase(({ op }) => {
      if (op("upsert") && op("upsert").args[0].kind !== undefined && first) { first = false; return { data: null, error: { code: "42703", message: "column kind does not exist" } }; }
      return { data: null, error: null };
    });
    await saveTrim(VID, { start: 25, end: null, kind: "normal" });
    expect(upserts().at(-1)).not.toHaveProperty("kind");
    // appel suivant (colonne créée entre-temps) : de nouveau par version
    sb = fakeSupabase(() => ({ data: null, error: null }));
    await saveTrim(VID, { start: 30, end: null, kind: "normal" });
    expect(upserts()).toEqual([expect.objectContaining({ kind: "normal", start_at: 30 })]);
  });
});
