/* Signalements de la régie : libellés connus seulement, version du catalogue
 * retrouvée par la vidéo (mode de la soirée d'abord), seconde de lecture. */
import { describe, it, expect, vi } from "vitest";
import { fakeSupabase } from "../helpers/fakeSupabase";

let sb;
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => sb }));

const track = { video_id: "abcdefghijk", title: "Into the Groove", channel: "Madonna" };
function setup(versions) {
  const inserted = [];
  sb = fakeSupabase(({ table, op }) => {
    if (table === "jukebox_catalog") return { data: versions, error: null };
    if (table === "jukebox_reports" && op("insert")) { inserted.push(op("insert").args[0]); return { error: null }; }
    return { data: null, error: null };
  });
  return inserted;
}

describe("createReport", () => {
  it("garde les libellés connus, la version du mode de la soirée et la seconde de lecture", async () => {
    const inserted = setup([{ key: "w:1:clip", mode: "clip" }, { key: "w:1:normal", mode: "normal" }]);
    const { createReport } = await import("@/lib/jukeboxReports");
    expect(await createReport({ id: "s1", name: "Soirée" }, track, "normal", { reasons: ["start", "pirate", "start"], comment: "  blabla  ", position: 14.26 })).toBe(null);
    expect(inserted[0]).toMatchObject({ song_key: "w:1:normal", reasons: ["start"], comment: "blabla", position: 14.3, session_name: "Soirée" });
  });
  it("rien de coché ni écrit : refusé", async () => {
    setup([]);
    const { createReport } = await import("@/lib/jukeboxReports");
    expect(await createReport({ id: "s1" }, track, "normal", { reasons: [], comment: " " })).toMatch(/au moins/);
  });
  it("commentaire seul : « autre » ; titre hors mémoire : sans version", async () => {
    const inserted = setup([]);
    const { createReport } = await import("@/lib/jukeboxReports");
    await createReport({ id: "s1" }, track, "normal", { reasons: [], comment: "son qui sature" });
    expect(inserted[0]).toMatchObject({ song_key: null, reasons: ["other"], position: null });
  });
});
