/* Mode clip v2 : ce qui passe en soirée clip, « pas de clip », lignes du catalogue. */
import { describe, it, expect, vi } from "vitest";
import { clipState, playFor, noClipError, CLIP_SEARCH_MAX } from "@/lib/jukeboxClipRules";
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => ({}) }));
const { clipRows } = await import("@/lib/jukeboxServer");

const P = { ok: { validated: true }, todo: { validated: false }, gone: { validated: false, missing: true } };
const C = { ok: { validated: true }, todo: { validated: false }, no: { validated: true, no_clip: true }, gone: { validated: false, missing: true } };

describe("clipState", () => {
  it("statuts", () => {
    expect(clipState(null)).toBe("wait");
    expect(clipState(C.gone)).toBe("wait"); // clip validé disparu : en attente de recherche
    expect(clipState(C.todo)).toBe("todo");
    expect(clipState(C.ok)).toBe("ok");
    expect(clipState(C.no)).toBe("noclip");
    expect(clipState({ ...C.no, missing: true })).toBe("noclip"); // la décision reste
  });
});

describe("playFor : soirée clip", () => {
  it("clip validé : le clip, quelle que soit la version paroles", () => {
    for (const p of [P.ok, P.todo, null]) expect(playFor(C.ok, p)).toBe("clip");
  });
  it("pas de clip : la version paroles, cherchée s'il n'y en a pas", () => {
    expect(playFor(C.no, P.ok)).toBe("paroles");
    expect(playFor(C.no, P.todo)).toBe("paroles");
    expect(playFor(C.no, null)).toBe("searchParoles");
    expect(playFor(C.no, P.gone)).toBe("searchParoles");
  });
  it("clip à vérifier : jamais joué si la version paroles est validée, sinon le candidat", () => {
    expect(playFor(C.todo, P.ok)).toBe("paroles");
    expect(playFor(C.todo, P.todo)).toBe("clip");
    expect(playFor(C.todo, null)).toBe("clip");
  });
  it("clip en attente : on le cherche, quelle que soit la version paroles", () => {
    for (const p of [P.ok, P.todo, null, P.gone]) expect(playFor(null, p)).toBe("searchClip");
    expect(playFor(C.gone, P.ok)).toBe("searchClip");
  });
  it("garde-fou du quota : version paroles connue → elle, plutôt qu'une recherche", () => {
    expect(playFor(null, P.ok, { searchesToday: CLIP_SEARCH_MAX })).toBe("paroles");
    expect(playFor(null, P.todo, { searchesToday: CLIP_SEARCH_MAX })).toBe("paroles");
    expect(playFor(null, null, { searchesToday: CLIP_SEARCH_MAX })).toBe("searchClip"); // titre inconnu : on cherche quand même
  });
});

describe("noClipError", () => {
  it("seulement avec une version paroles validée", () => {
    expect(noClipError(C.todo, P.ok)).toBe(null);
    expect(noClipError(C.todo, P.todo)).toMatch(/paroles/);
    expect(noClipError(C.todo, P.gone)).toMatch(/paroles/);
    expect(noClipError(null, P.ok)).toMatch(/Aucune/);
  });
});

describe("clipRows : une ligne par chanson (ce qui passera)", () => {
  const row = (work_id, mode, extra) => ({ work_id, mode, video_id: `${work_id}-${mode}`, ...extra });
  it("clip validé, paroles faute de clip, candidat sans paroles validée", () => {
    const out = clipRows([
      row("a", "clip", C.ok), row("a", "normal", P.ok),
      row("b", "clip", C.todo), row("b", "normal", P.ok),
      row("c", "clip", C.no), row("c", "normal", P.ok),
      row("d", "clip", C.todo),
      row("e", "normal", P.ok),
    ]);
    const by = Object.fromEntries(out.map((r) => [r.work_id, r]));
    expect(by.a).toMatchObject({ video_id: "a-clip", validated: true, noClip: false });
    expect(by.b).toMatchObject({ video_id: "b-normal", validated: true, noClip: true });
    expect(by.c).toMatchObject({ video_id: "c-normal", validated: true, noClip: true });
    expect(by.d).toMatchObject({ video_id: "d-clip", validated: false, noClip: true });
    expect(by.e).toMatchObject({ video_id: "e-normal", validated: true, noClip: true });
  });
  it("jamais la vidéo refusée d'un « pas de clip »", () => {
    expect(clipRows([row("c", "clip", C.no)])).toEqual([]);
  });
});
