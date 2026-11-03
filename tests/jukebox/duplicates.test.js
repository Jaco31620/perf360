/* Doublons et rapprochement de chansons :
 *  - recherche invités (preferKnown) : même chanson sous plusieurs fiches
 *    Deezer = une seule ligne (textKey : ponctuation, accents, casse ignorés) ;
 *  - recherche Deezer (deezerSearch) : versions identiques fusionnées,
 *    originales devant les reprises, durées hors limites écartées ;
 *  - mémoire des titres (findDuplicates) : regroupement par même vidéo,
 *    même ISRC, titres / interprètes proches, paires ignorées. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeSupabase } from "../helpers/fakeSupabase";

let sb;
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => sb }));
const { preferKnown, deezerSearch } = await import("@/lib/jukeboxServer");
const { findDuplicates } = await import("@/lib/jukeboxLibrary");

/* ---------- preferKnown : textKey ---------- */
describe("preferKnown : même interprète + titre à la ponctuation près", () => {
  // rows : versions connues, une par fiche Deezer (clé « dz:<id>:<mode> » de commodité → chanson « w<id> »)
  const memory = (rows) => {
    const withWork = rows.map((r) => ({ ...r, work_id: `w${r.key.split(":")[1]}`, deezer_id: Number(r.key.split(":")[1]), mode: "normal" }));
    sb = fakeSupabase(({ table, op }) => {
      if (table === "jukebox_work_aliases") return { data: withWork.map((r) => ({ deezer_id: r.deezer_id, work_id: r.work_id })), error: null };
      if (table !== "jukebox_catalog") return { data: null, error: null };
      if (op("in") && op("in").args[0] === "work_id") return { data: withWork, error: null }; // par fiche Deezer → chanson
      return { data: [], error: null }; // par libellé
    });
  };
  const res = (deezerId, channel, title) => ({ id: `dz${deezerId}`, deezerId, channel, title });

  it("« Du rhum, des femmes » == « Du rhum des femmes » : une seule ligne", async () => {
    memory([]);
    const out = await preferKnown([res(1, "Soldat Louis", "Du rhum, des femmes"), res(2, "Soldat Louis", "Du rhum des femmes")], "normal", "du rhum");
    expect(out.map((r) => r.deezerId)).toEqual([1]);
  });
  it("accents, casse, tirets et apostrophes ignorés", async () => {
    memory([]);
    const out = await preferKnown([
      res(1, "Édith Piaf", "La Vie en rose"), res(2, "EDITH PIAF", "la vie en rose"),
      res(3, "Edith-Piaf", "La vie en rosé"), res(4, "Michel Sardou", "Les lacs du Connemara"),
      res(5, "Michel Sardou", "Les lacs du Connemara (Live)"),
    ], "normal", "");
    expect(out.map((r) => r.deezerId)).toEqual([1, 4, 5]); // « Live » reste une autre chanson
  });
  it("la fiche validée passe devant et est gardée ; « vid » n'est pas renvoyé", async () => {
    memory([{ key: "dz:2:normal", video_id: "VIDEO000002", label: "Soldat Louis – Du rhum des femmes", duration: 200, validated: true }]);
    const out = await preferKnown([res(1, "Soldat Louis", "Du rhum, des femmes"), res(2, "Soldat Louis", "Du rhum des femmes")], "normal", "");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ deezerId: 2, known: 2 });
    expect(out[0]).not.toHaveProperty("vid");
  });
  it("même vidéo connue sous deux fiches au texte différent : une seule ligne", async () => {
    memory([
      { key: "dz:1:normal", video_id: "SAMEVIDEO01", label: "Queen – Bohemian Rhapsody", validated: false },
      { key: "dz:2:normal", video_id: "SAMEVIDEO01", label: "Queen – Bohemian Rhapsody - Remastered 2011", validated: true },
    ]);
    const out = await preferKnown([res(1, "Queen", "Bohemian Rhapsody"), res(2, "Queen", "Bohemian Rhapsody (Live Aid)")], "normal", "");
    expect(out.map((r) => r.deezerId)).toEqual([2]);
  });
  it("interprètes différents : deux lignes", async () => {
    memory([]);
    const out = await preferKnown([res(1, "Gloria Gaynor", "I Will Survive"), res(2, "Cake", "I Will Survive")], "normal", "");
    expect(out).toHaveLength(2);
  });
});

/* ---------- deezerSearch ---------- */
describe("deezerSearch (fetch simulé)", () => {
  const dz = (id, artist, title, { title_short = title, rank = 0, duration = 200 } = {}) =>
    ({ id, title, title_short, rank, duration, artist: { name: artist }, album: { cover_medium: `c${id}` } });
  const mockDeezer = (data) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data }) })));
  afterEach(() => vi.unstubAllGlobals());

  it("versions identiques (même interprète + titre court) : une seule, la plus écoutée", async () => {
    mockDeezer([
      dz(1, "Queen", "Bohemian Rhapsody (Remastered 2011)", { title_short: "Bohemian Rhapsody", rank: 500 }),
      dz(2, "Queen", "Bohemian Rhapsody", { rank: 900 }),
    ]);
    const out = await deezerSearch("bohemian rhapsody");
    expect(out.map((r) => r.deezerId)).toEqual([2]);
    expect(out[0]).toMatchObject({ id: "dz2", channel: "Queen", title: "Bohemian Rhapsody", thumb: "c2" });
  });
  it("recherche « live » : les versions live restent distinctes", async () => {
    mockDeezer([
      dz(1, "Queen", "Bohemian Rhapsody (Live Aid)", { title_short: "Bohemian Rhapsody", rank: 100 }),
      dz(2, "Queen", "Bohemian Rhapsody", { rank: 900 }),
    ]);
    expect((await deezerSearch("bohemian rhapsody live")).map((r) => r.deezerId).sort()).toEqual([1, 2]);
  });
  it("originale devant la reprise karaoké, ordre de Deezer conservé entre chansons différentes", async () => {
    mockDeezer([
      dz(1, "Karaoke Hits", "I Will Survive (Karaoke Version)", { title_short: "I Will Survive", rank: 999 }),
      dz(2, "Queen", "Don't Stop Me Now", { rank: 10 }),
      dz(3, "Gloria Gaynor", "I Will Survive", { rank: 800 }),
    ]);
    expect((await deezerSearch("survive")).map((r) => r.deezerId)).toEqual([3, 1, 2]);
  });
  it("on cherche une reprise : elle n'est pas reléguée", async () => {
    mockDeezer([
      dz(3, "Gloria Gaynor", "I Will Survive", { rank: 100 }),
      dz(1, "Karaoke Hits", "I Will Survive (Karaoke Version)", { title_short: "I Will Survive", rank: 999 }),
    ]);
    expect((await deezerSearch("i will survive karaoke")).map((r) => r.deezerId)).toEqual([1, 3]);
  });
  it("durées hors limites (extrait < 45 s, mix > 15 min) écartées ; 15 résultats au plus", async () => {
    mockDeezer([
      dz(1, "A", "Court", { duration: 30 }), dz(2, "B", "Long", { duration: 16 * 60 }),
      ...Array.from({ length: 20 }, (_, i) => dz(10 + i, `Artiste ${i}`, `Titre ${i}`)),
    ]);
    const out = await deezerSearch("x");
    expect(out).toHaveLength(15);
    expect(out.some((r) => r.deezerId < 10)).toBe(false);
  });
});

/* ---------- findDuplicates ---------- */
describe("findDuplicates (mémoire simulée)", () => {
  const row = (id, label, extra = {}) => ({ key: `dz:${id}:normal`, video_id: `V${String(id).padStart(10, "0")}`, label, plays: 0, validated: false, ...extra });
  const rows = [
    row(1, "Queen – Bohemian Rhapsody", { video_id: "SAMEVIDEO01", plays: 3 }),
    row(2, "Queen – Bohemian Rhapsody (Live Aid)", { video_id: "SAMEVIDEO01", validated: true }),
    { ...row(3, "Queen – Bohemian Rhapsody", { video_id: "SAMEVIDEO01" }), key: "dz:3:karaoke" }, // autre mode
    row(4, "Soldat Louis – Du rhum, des femmes", { isrc: "FRZ018800001" }),
    row(5, "Various – Track 12", { isrc: "FRZ018800001" }),
    row(6, "Soldat Louis – Du rhum des femmes"),
    row(7, "Stromae – Alors on danse"),
    row(8, "Stromae – Alors on dance"),
    row(9, "Stromae – Papaoutai"),
    row(10, "Johnny Halliday – Allumer le feu"),
    row(11, "Johnny Hallyday – Allumer le feu"),
    row(12, "Indochine – L'aventurier"),
    row(13, "Indochine – L'aventurier"),
    row(14, "Nirvana – Lithium"), row(15, "Muse – Uprising"), // ni ISRC ni rien en commun
  ];
  beforeEach(() => {
    sb = fakeSupabase(({ table }) => {
      if (table === "jukebox_catalog") return { data: rows, error: null };
      if (table === "jukebox_config") return { data: { value: JSON.stringify(["dz:12:normal|dz:13:normal"]) }, error: null };
      return { data: null, error: null };
    });
  });
  const groups = (out) => {
    const m = new Map();
    for (const r of out) (m.get(r.group) || m.set(r.group, []).get(r.group)).push(r.key.split(":")[1] + (r.mode === "karaoke" ? "k" : ""));
    return [...m.values()].map((g) => g.join(","));
  };

  it("groupes attendus (même vidéo, ISRC + même titre transitif, titres proches, interprètes proches)", async () => {
    const out = await findDuplicates();
    expect(groups(out).map((g) => g.split(",").sort().join(",")).sort()).toEqual(["1,2", "10,11", "4,5,6", "7,8"]);
  });
  it("raisons", async () => {
    const why = Object.fromEntries((await findDuplicates()).map((r) => [r.key, r.dupWhy]));
    expect(why["dz:1:normal"]).toBe("même vidéo");
    expect(why["dz:4:normal"]).toBe("même enregistrement (ISRC)");
    expect(why["dz:5:normal"]).toBe("même enregistrement (ISRC)");
    expect(why["dz:6:normal"]).toBe("même titre"); // « Du rhum, des femmes » == « Du rhum des femmes »
    expect(why["dz:7:normal"]).toBe("titres proches");
    expect(why["dz:10:normal"]).toBe("interprètes proches");
  });
  it("même vidéo dans un autre mode, paire ignorée, titres éloignés : pas de doublon", async () => {
    const keys = (await findDuplicates()).map((r) => r.key);
    for (const k of ["dz:3:karaoke", "dz:12:normal", "dz:13:normal", "dz:9:normal", "dz:14:normal", "dz:15:normal"]) expect(keys).not.toContain(k);
  });
  it("dans un groupe : validé d'abord, puis le plus écouté", async () => {
    const out = await findDuplicates();
    const g = out.filter((r) => ["dz:1:normal", "dz:2:normal"].includes(r.key));
    expect(g.map((r) => r.key)).toEqual(["dz:2:normal", "dz:1:normal"]);
  });
});
