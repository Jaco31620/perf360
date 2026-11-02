/* Blind test : tirage (chaque titre a la même chance, artistes récents
 * écartés) via topUpBlind, et classement avec égalités (rankOf) via
 * blindView — avec un faux client Supabase. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeSupabase } from "../helpers/fakeSupabase";

let sb;
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => sb }));

const session = { id: "s1", options: { features: { blindtest: true }, blind: { on: true, mode: "phone" } } };
const song = (id, label, extra = {}) => ({ key: `dz:${id}:normal`, video_id: `vid${String(id).padStart(8, "0")}`, label, duration: 200, ...extra });

/* Monte la mémoire (titres blind test), l'historique de la soirée, et
 * renvoie les titres insérés par topUpBlind. */
async function draw({ songs, tracks = [] }) {
  vi.resetModules(); // taggedSongs() garde la mémoire 30 s en cache : module neuf à chaque tirage
  const inserted = [];
  sb = fakeSupabase(({ table, op }) => {
    if (table === "jukebox_songs") return { data: songs, error: null };
    if (table === "jukebox_tracks" && op("insert")) { inserted.push(...op("insert").args[0]); return { error: null }; }
    if (table === "jukebox_tracks") return { data: tracks, error: null };
    return { data: null, error: null };
  });
  const { topUpBlind } = await import("@/lib/jukeboxBlindServer");
  const n = await topUpBlind(session);
  return { n, inserted };
}

afterEach(() => vi.restoreAllMocks());

describe("tirage du blind test (topUpBlind / pickIndex)", () => {
  it("pioche 2 titres d'avance, artiste et titre propres", async () => {
    const { n, inserted } = await draw({ songs: [song(1, "Queen – Bohemian Rhapsody (Remastered 2011)"), song(2, "ABBA – Waterloo")] });
    expect(n).toBe(2);
    expect(inserted.map((r) => r.participant_id)).toEqual(["blind-auto", "blind-auto"]);
    expect(inserted.find((r) => r.video_id === "vid00000001")).toMatchObject({ channel: "Queen", title: "Bohemian Rhapsody" });
  });

  it("chaque titre a la même chance : un groupe de 3 titres sort 3 fois sur 4 face à un titre seul", async () => {
    const songs = [
      song(1, "Indochine – L'aventurier", { year: 1982, fr: true }),
      song(2, "Téléphone – Un autre monde", { year: 1984, fr: true }),
      song(3, "Daniel Balavoine – L'Aziza", { year: 1985, fr: true }),
      song(4, "Nirvana – Smells Like Teen Spirit", { year: 1991, fr: false }),
    ];
    const firsts = [];
    for (let k = 0; k < 4; k++) {
      // Math.random balaie les 4 quarts : 1er tirage déterministe
      vi.spyOn(Math, "random").mockReturnValue((k + 0.5) / 4);
      firsts.push((await draw({ songs })).inserted[0].video_id);
      vi.restoreAllMocks();
    }
    expect(new Set(firsts).size).toBe(4); // chaque titre occupe exactement 1/4 du tirage
    const fr80 = firsts.filter((v) => ["vid00000001", "vid00000002", "vid00000003"].includes(v)).length;
    expect(fr80).toBe(3);
  });

  it("une version karaoké et normale du même titre Deezer ne comptent qu'une fois (version normale)", async () => {
    const songs = [song(1, "Queen – Bohemian Rhapsody"), { ...song(1, "Queen – Bohemian Rhapsody"), key: "dz:1:karaoke", video_id: "karaokevid1" }];
    const { inserted } = await draw({ songs });
    expect(inserted.map((r) => r.video_id)).toEqual(["vid00000001"]);
  });

  it("écarte l'artiste des derniers titres joués tant qu'il reste d'autres artistes", async () => {
    const songs = [
      song(1, "Queen – Bohemian Rhapsody"), song(2, "Queen – We Will Rock You"), song(3, "Queen – Don't Stop Me Now"),
      song(4, "ABBA – Waterloo"), song(5, "Muse – Uprising"),
    ];
    const tracks = [{ video_id: "playedqueen", channel: "Queen", status: "played", participant_id: "x", created_at: "2026-01-01T20:00:00Z", played_at: "2026-01-01T20:00:00Z", position: 1 }];
    for (const r of [0, 0.3, 0.6, 0.999]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      const { inserted } = await draw({ songs, tracks });
      vi.restoreAllMocks();
      // 1er tirage : pas Queen ; 2e : ni Queen ni l'artiste qu'on vient de tirer
      expect(inserted.map((x) => x.channel).sort()).toEqual(["ABBA", "Muse"]);
    }
  });

  it("artiste récent comparé sans accents ni casse (« BEYONCÉ » joué → « Beyonce » écarté)", async () => {
    const songs = [song(1, "Beyonce – Halo"), song(2, "ABBA – Waterloo")];
    const tracks = [{ video_id: "x", channel: "BEYONCÉ", status: "played", participant_id: "x", created_at: "2026-01-01T20:00:00Z", played_at: "2026-01-01T20:00:00Z", position: 1 }];
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { inserted } = await draw({ songs, tracks });
    expect(inserted[0].channel).toBe("ABBA");
  });

  it("pas assez d'artistes différents : l'artiste récent est quand même pioché", async () => {
    const songs = [song(1, "Queen – Bohemian Rhapsody"), song(2, "Queen – We Will Rock You")];
    const tracks = [{ video_id: "x", channel: "Queen", status: "played", participant_id: "x", created_at: "2026-01-01T20:00:00Z", played_at: "2026-01-01T20:00:00Z", position: 1 }];
    const { n } = await draw({ songs, tracks });
    expect(n).toBe(2);
  });

  it("un titre déjà passé dans la partie n'est pas repioché", async () => {
    const songs = [song(1, "Queen – Bohemian Rhapsody"), song(2, "ABBA – Waterloo")];
    const tracks = [{ video_id: "vid00000001", channel: "Queen", status: "played", participant_id: "x", created_at: "2026-01-01T20:00:00Z", played_at: "2026-01-01T20:00:00Z", position: 1 }];
    const { inserted } = await draw({ songs, tracks });
    expect(inserted.map((r) => r.video_id)).toEqual(["vid00000002"]);
  });
});

describe("classement avec égalités (rankOf dans blindView)", () => {
  const answers = [
    { participant_id: "p1", author: "Alice", points: 30, track_id: "t1" },
    { participant_id: "p2", author: "Bob", points: 20, track_id: "t1" },
    { participant_id: "p2", author: "Bob", points: 10, track_id: "t2" }, // Bob : 30 au total
    { participant_id: "p3", author: "Chloé", points: 20, track_id: "t1" },
    { participant_id: "p4", author: "Dan", points: 0, track_id: "t1" },
    { participant_id: "p5", author: "Eve", points: 5, track_id: "t1" },
  ];
  async function view(pid) {
    vi.resetModules();
    sb = fakeSupabase(({ table }) => (table === "jukebox_answers" ? { data: answers, error: null } : { data: null, error: null }));
    const { blindView } = await import("@/lib/jukeboxBlindServer");
    const { normalizeBlind } = await import("@/lib/jukeboxBlind");
    return blindView(session, normalizeBlind(session.options.blind), null, { admin: false, pid });
  }

  it("rang de compétition : 1, 1, 3, 4 (0 point : hors classement)", async () => {
    const out = await view(null);
    expect(out.top.map((x) => [x.name, x.points, x.rank])).toEqual([
      ["Alice", 30, 1], ["Bob", 30, 1], ["Chloé", 20, 3], ["Eve", 5, 4],
    ]);
    expect(out.players).toBe(5);
  });
  it("rang du joueur : ex aequo, et null sans point", async () => {
    expect((await view("p2")).me).toMatchObject({ points: 30, rank: 1 });
    expect((await view("p3")).me).toMatchObject({ points: 20, rank: 3 });
    expect((await view("p4")).me).toMatchObject({ points: 0, rank: null });
  });
});
