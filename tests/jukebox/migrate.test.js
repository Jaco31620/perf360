// Migration du catalogue : ancienne table (dz:<id>:<mode>, merged_into) → chansons / fiches / versions
import { describe, it, expect } from "vitest";
import { planMigration } from "@/lib/jukeboxMigrate";

let n = 0;
const ids = () => `w${++n}`;
const row = (key, extra = {}) => ({ key, video_id: `v_${key}`, label: "Daft Punk – One More Time", plays: 0, blind: false, validated: false, missing: false, checked_at: "2026-10-01T00:00:00Z", ...extra });

describe("planMigration", () => {
  it("une fiche Deezer en deux modes → une chanson, deux versions", () => {
    n = 0;
    const p = planMigration([row("dz:1:normal", { year: 2000, plays: 3 }), row("dz:1:karaoke", { plays: 1 })], [], ids);
    expect(p.works).toHaveLength(1);
    expect(p.works[0]).toMatchObject({ id: "w1", year: 2000, plays: 4 });
    expect(p.versions.map((v) => v.kind).sort()).toEqual(["karaoke", "normal"]);
    expect(p.aliases).toEqual([expect.objectContaining({ deezer_id: 1, work_id: "w1" })]);
    expect(p.keyMap.get("dz:1:karaoke")).toBe("w:w1:karaoke");
  });

  it("fiche rattachée (merged_into) → fiche Deezer de la chanson gardée, pas de version propre", () => {
    n = 0;
    const p = planMigration([
      row("dz:1:normal", { validated: true, plays: 5 }),
      row("dz:2:normal", { merged_into: "dz:1:normal", plays: 5, blind: true }), // alias : écoutes recomptées, blind posé par le pré-remplissage
    ], [], ids);
    expect(p.works).toHaveLength(1);
    expect(p.works[0].plays).toBe(5); // les écoutes de l'alias ne sont pas recomptées
    expect(p.works[0].blind).toBe(true); // l'étiquette blind de l'alias n'est plus perdue
    expect(p.versions).toHaveLength(1);
    expect(p.versions[0]).toMatchObject({ work_id: "w1", kind: "normal", validated: true, video_id: "v_dz:1:normal" });
    expect(p.aliases.map((a) => a.deezer_id).sort()).toEqual([1, 2]);
    expect(p.keyMap.get("dz:2:normal")).toBe("w:w1:normal");
  });

  it("fiche rattachée en normal mais avec sa propre version karaoké : versions réunies", () => {
    n = 0;
    const p = planMigration([
      row("dz:1:normal"), row("dz:2:normal", { merged_into: "dz:1:normal" }), row("dz:2:karaoke"),
    ], [], ids);
    expect(p.works).toHaveLength(1);
    expect(p.versions.map((v) => v.kind).sort()).toEqual(["karaoke", "normal"]);
  });

  it("conflit : deux fiches de la même chanson avec une version du même mode → la ligne gardée l'emporte", () => {
    n = 0;
    const p = planMigration([
      row("dz:1:normal", { video_id: "garde" }), row("dz:2:normal", { merged_into: "dz:1:normal" }), row("dz:2:karaoke", { merged_into: "dz:1:karaoke" }),
      row("dz:1:karaoke", { video_id: "k1" }),
    ], [], ids);
    expect(p.works).toHaveLength(1);
    expect(p.versions.find((v) => v.kind === "normal").video_id).toBe("garde");
    expect(p.conflicts).toBe(0);
    const q = planMigration([row("dz:1:normal", { video_id: "garde" }), row("dz:3:normal", { merged_into: "dz:1:normal" }), row("dz:3:karaoke"), row("dz:1:karaoke", { video_id: "k1" })], [], ids);
    expect(q.versions.find((v) => v.kind === "karaoke").video_id).toBe("k1"); // racine d'abord
    expect(q.conflicts).toBe(1);
  });

  it("chaînes de rattachement suivies, boucle sans plantage", () => {
    n = 0;
    const p = planMigration([
      row("dz:1:normal"), row("dz:2:normal", { merged_into: "dz:1:normal" }), row("dz:3:normal", { merged_into: "dz:2:normal" }),
      row("dz:8:normal", { merged_into: "dz:9:normal" }), row("dz:9:normal", { merged_into: "dz:8:normal" }),
    ], [], ids);
    expect(new Set(p.aliases.filter((a) => a.deezer_id <= 3).map((a) => a.work_id)).size).toBe(1);
    expect(p.songs).toBeGreaterThanOrEqual(2);
  });

  it("parent disparu : la fiche rattachée devient sa propre chanson", () => {
    n = 0;
    const p = planMigration([row("dz:5:normal", { merged_into: "dz:404:normal" })], [], ids);
    expect(p.works).toHaveLength(1);
    expect(p.aliases[0].deezer_id).toBe(5);
  });

  it("relance : fiches déjà migrées → chanson réutilisée, rien de recréé", () => {
    n = 0;
    const p = planMigration([row("dz:1:normal"), row("dz:1:karaoke")], [{ deezer_id: 1, work_id: "deja" }], ids);
    expect(p.works).toHaveLength(0);
    expect(p.reused).toBe(1);
    expect(p.versions.every((v) => v.work_id === "deja")).toBe(true);
  });

  it("métadonnées : ISRC, langue, pays, texte corrigé repris (ligne gardée en mode normal d'abord)", () => {
    n = 0;
    const p = planMigration([
      row("dz:1:karaoke", { year: 1999, lang: "eng" }),
      row("dz:1:normal", { year: 2000, isrc: "GBDUW0000059", country: "FR", artist_fix: "Daft Punk", title_fix: "One More Time" }),
    ], [], ids);
    expect(p.works[0]).toMatchObject({ year: 2000, isrc: "GBDUW0000059", country: "FR", lang: "eng", artist_fix: "Daft Punk", title_fix: "One More Time" });
  });

  it("clés hors format ignorées", () => {
    const p = planMigration([row("autre"), row("dz:x:normal")], [], ids);
    expect(p.rows).toBe(0);
  });
});
