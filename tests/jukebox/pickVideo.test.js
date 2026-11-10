// Choix de la vidéo : clip officiel (mode clip), paroles / karaoké
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => ({}) }));
const { pickVideo } = await import("@/lib/jukeboxServer");

const song = { channel: "Daft Punk", title: "One More Time", duration: 320 };
const v = (id, title, channel, duration, extra = {}) => ({ id, title, channel, duration, ...extra });

describe("pickVideo — clip", () => {
  it("le clip officiel de la chaîne de l'artiste passe devant la vidéo de paroles mieux classée", () => {
    const { video, confidence } = pickVideo([
      v("lyrics00001", "Daft Punk - One More Time (Lyrics)", "7clouds", 320),
      v("clip0000001", "Daft Punk - One More Time (Official Video)", "Daft Punk", 330, { licensed: true }),
    ], song, "clip");
    expect(video.id).toBe("clip0000001");
    expect(confidence).toBe(3);
  });
  it("chaîne VEVO reconnue", () => {
    const { video } = pickVideo([
      v("other000001", "One More Time", "Random Uploader", 320),
      v("vevo0000001", "Daft Punk - One More Time", "DaftPunkVEVO", 330),
    ], song, "clip");
    expect(video.id).toBe("vevo0000001");
  });
  it("live et reprises écartés, sauf si le titre lui-même est un live", () => {
    const { video } = pickVideo([
      v("live0000001", "Daft Punk - One More Time (Live Alive 2007) Official Video", "Daft Punk", 330),
      v("clip0000002", "Daft Punk - One More Time", "Daft Punk", 325),
    ], song, "clip");
    expect(video.id).toBe("clip0000002");
    const live = pickVideo([v("live0000001", "Daft Punk - One More Time (Live)", "Daft Punk", 330)], { ...song, title: "One More Time (Live)" }, "clip");
    expect(live.video.id).toBe("live0000001");
  });
  it("aucun clip : la meilleure vidéo quand même, confiance faible (une version clip existe toujours)", () => {
    const { video, confidence } = pickVideo([v("lyrics00001", "Daft Punk - One More Time (Lyrics)", "7clouds", 320)], song, "clip");
    expect(video.id).toBe("lyrics00001");
    expect(confidence).toBe(1);
  });
});

describe("pickVideo — clip v2 : titre ET artiste, exclusions", () => {
  it("un clip officiel d'une AUTRE chanson du même artiste ne passe plus devant la bonne chanson", () => {
    const { video } = pickVideo([
      v("around00001", "Daft Punk - Around The World (Official Music Video)", "DaftPunkVEVO", 330, { licensed: true }),
      v("good0000001", "Daft Punk - One More Time", "Some Channel", 322),
    ], song, "clip");
    expect(video.id).toBe("good0000001");
  });
  it("l'audio seul (« - Topic ») passe derrière une vraie vidéo, même mieux notée", () => {
    const { video } = pickVideo([
      v("topic000001", "One More Time", "Daft Punk", 320, { topic: true, licensed: true }),
      v("clip0000001", "Daft Punk - One More Time (Official Video)", "DaftPunkVEVO", 330),
    ], song, "clip");
    expect(video.id).toBe("clip0000001");
  });
  it("jamais une vidéo exclue (version paroles, vidéo refusée) ; rien d'autre → pas de vidéo", () => {
    const res = [v("lyrics00001", "Daft Punk - One More Time (Lyrics)", "7clouds", 320), v("clip0000001", "Daft Punk - One More Time (Official Video)", "Daft Punk", 330)];
    expect(pickVideo(res, song, "clip", { exclude: ["clip0000001"] }).video.id).toBe("lyrics00001");
    expect(pickVideo(res, song, "clip", { exclude: ["clip0000001", "lyrics00001"] }).video).toBe(null);
  });
  it("la moins mauvaise quand rien ne correspond au titre : confiance faible", () => {
    const { video, confidence } = pickVideo([v("other000001", "Daft Punk - Around The World (Official Video)", "Daft Punk", 300)], song, "clip");
    expect(video.id).toBe("other000001");
    expect(confidence).toBe(1);
  });
});

describe("pickVideo — paroles / karaoké", () => {
  it("paroles : vidéo de paroles à la bonne durée", () => {
    const { video } = pickVideo([
      v("clip0000001", "Daft Punk - One More Time (Official Video)", "Daft Punk", 330),
      v("lyricslong1", "Daft Punk - One More Time (Lyrics) 1 hour", "x", 3600),
      v("lyrics00001", "Daft Punk - One More Time (Lyrics)", "7clouds", 320),
    ], song, "normal");
    expect(video.id).toBe("lyrics00001");
  });
  it("karaoké : version karaoké d'abord", () => {
    const { video } = pickVideo([v("orig0000001", "One More Time", "Daft Punk", 320), v("kara0000001", "One More Time (Karaoke Version)", "Sing King", 318)], song, "karaoke");
    expect(video.id).toBe("kara0000001");
  });
});
