/* Années : Wikidata (date de publication de la chanson dont l'interprète
 * correspond), la plus ancienne des fiches ; un autre interprète est ignoré. */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => null }));

const claims = (performer, time) => ({ claims: {
  P175: [{ mainsnak: { datavalue: { value: { id: performer } } } }],
  P577: [{ mainsnak: { datavalue: { value: { time } } } }],
} });

function stub(entities, performers) {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const p = new URL(url).searchParams;
    const body = p.get("action") === "wbsearchentities" ? { search: Object.keys(entities).map((id) => ({ id })) }
      : p.get("props") === "claims" ? { entities }
      : { entities: performers };
    return { ok: true, json: async () => body };
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe("wikidataYear", () => {
  it("la plus ancienne des fiches de cet interprète", async () => {
    stub({ Q1: claims("P1", "+1985-07-23T00:00:00Z"), Q2: claims("P1", "+1989-01-01T00:00:00Z"), Q3: claims("P2", "+1970-01-01T00:00:00Z") },
      { P1: { labels: { en: { value: "Madonna" } } }, P2: { labels: { en: { value: "Autre Groupe" } } } });
    const { wikidataYear } = await import("@/lib/jukeboxEnrich");
    expect(await wikidataYear("Madonna", "Into the Groove")).toBe(1985);
  });
  it("interprète trouvé par un alias", async () => {
    stub({ Q1: claims("P1", "+1980-01-01T00:00:00Z") }, { P1: { labels: { fr: { value: "Michel Hamburger" } }, aliases: { fr: [{ value: "Michel Berger" }] } } });
    const { wikidataYear } = await import("@/lib/jukeboxEnrich");
    expect(await wikidataYear("Michel Berger", "La groupie du pianiste")).toBe(1980);
  });
  it("pas la chanson (autre interprète) : null", async () => {
    stub({ Q1: claims("P2", "+1975-01-01T00:00:00Z") }, { P2: { labels: { en: { value: "Someone Else" } } } });
    const { wikidataYear } = await import("@/lib/jukeboxEnrich");
    expect(await wikidataYear("Queen", "Bohemian Rhapsody")).toBe(null);
  });
});
