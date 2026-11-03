// Catalogue v28 : écritures chanson / version, fusion de chansons
import { describe, it, expect, vi } from "vitest";
import { fakeSupabase } from "../helpers/fakeSupabase";

let sb;
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => sb }));
const { updateVersion, parseKey, versionKey } = await import("@/lib/jukeboxCatalog");
const { mergeSongs } = await import("@/lib/jukeboxLibrary");

const W1 = "11111111-1111-1111-1111-111111111111";
const W2 = "22222222-2222-2222-2222-222222222222";

describe("clés de version", () => {
  it("w:<chanson>:<version>", () => {
    expect(parseKey(versionKey(W1, "clip"))).toEqual({ workId: W1, kind: "clip" });
    expect(parseKey("dz:12:normal")).toBeNull();
    expect(parseKey(`w:${W1}:autre`)).toBeNull();
  });
});

describe("updateVersion : chaque colonne à sa place", () => {
  it("validation sur la version, blind test sur la chanson", async () => {
    sb = fakeSupabase(() => ({ data: null, error: null }));
    await updateVersion(versionKey(W1, "normal"), { validated: true, blind: true });
    const upd = sb.calls.filter((c) => c.ops.some((o) => o.name === "update"));
    const byTable = Object.fromEntries(upd.map((c) => [c.table, c.ops.find((o) => o.name === "update").args[0]]));
    expect(byTable.jukebox_versions).toEqual({ validated: true });
    expect(byTable.jukebox_works).toEqual({ blind: true });
  });
});

describe("mergeSongs : fusion de chansons", () => {
  const works = [
    { id: W1, plays: 3, rank: 10, blind: false, year: null, lang: null, isrc: null, artist_fix: null },
    { id: W2, plays: 2, rank: 50, blind: true, year: 1995, lang: "fra", isrc: "FR123", artist_fix: "Céline Dion" },
  ];
  const versions = [
    { work_id: W1, kind: "normal", video_id: "AAAAAAAAAAA", validated: false },
    { work_id: W2, kind: "normal", video_id: "AAAAAAAAAAA", validated: true }, // même vidéo, validée chez l'autre
    { work_id: W2, kind: "karaoke", video_id: "KKKKKKKKKKK", validated: false }, // mode absent de la gardée : repris
  ];
  const run = async () => {
    sb = fakeSupabase(({ table, op }) => {
      if (op("update") || op("delete")) return { data: null, error: null };
      if (table === "jukebox_works") return { data: structuredClone(works), error: null };
      if (table === "jukebox_versions") return { data: structuredClone(versions), error: null };
      return { data: null, error: null };
    });
    const err = await mergeSongs(versionKey(W1, "normal"), [versionKey(W2, "normal")]);
    return { err, calls: sb.calls };
  };

  it("chanson gardée : écoutes additionnées, étiquettes et infos reprises (langue, ISRC compris)", async () => {
    const { err, calls } = await run();
    expect(err).toBeNull();
    const patch = calls.find((c) => c.table === "jukebox_works" && c.ops.some((o) => o.name === "update")).ops.find((o) => o.name === "update").args[0];
    expect(patch).toMatchObject({ plays: 5, rank: 50, blind: true, year: 1995, lang: "fra", isrc: "FR123", artist_fix: "Céline Dion" });
  });
  it("versions : karaoké repris, validation reprise (même vidéo), fiches Deezer déplacées, chanson fusionnée supprimée", async () => {
    const { calls } = await run();
    const ops = (table, name) => calls.filter((c) => c.table === table && c.ops.some((o) => o.name === name));
    const vUpd = ops("jukebox_versions", "update").map((c) => c.ops.find((o) => o.name === "update").args[0]);
    expect(vUpd).toContainEqual({ work_id: W1 }); // karaoké déplacé
    expect(vUpd).toContainEqual({ validated: true }); // même vidéo validée chez l'autre
    const alias = ops("jukebox_work_aliases", "update")[0];
    expect(alias.ops.find((o) => o.name === "update").args[0]).toEqual({ work_id: W1 });
    expect(alias.ops.find((o) => o.name === "in").args[1]).toEqual([W2]);
    const del = ops("jukebox_works", "delete")[0];
    expect(del.ops.find((o) => o.name === "in").args[1]).toEqual([W2]);
    // propositions de changement : vers la version gardée
    const ch = ops("jukebox_video_changes", "update").map((c) => c.ops.find((o) => o.name === "update").args[0].song_key);
    expect(ch).toContain(`w:${W1}:karaoke`);
  });
  it("rien à fusionner", async () => {
    sb = fakeSupabase(() => ({ data: [], error: null }));
    expect(await mergeSongs(versionKey(W1, "normal"), [versionKey(W1, "normal")])).toBe("Titres introuvables.");
  });
});
