/* Enrichissement de nuit : quand relancer un tour, protection de la route,
 * relance sans attendre la fin du tour suivant. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const upsert = vi.fn(async () => ({}));
vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ upsert, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}));
vi.mock("@/lib/jukeboxRate", () => ({ tooMany: async () => false }));

import { nightStop, nightSkip, launchEnrichRound, MAX_ROUNDS, wikidataYear, DEADLINE } from "@/lib/jukeboxEnrich";
import { GET } from "@/app/api/jukebox/enrich/route";

beforeEach(() => { upsert.mockClear(); vi.stubEnv("CRON_SECRET", "s3cret"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("nightStop", () => {
  it("continue tant qu'il reste du travail et que ça avance", () => {
    expect(nightStop(1, { done: 5, left: 3 })).toBe(null);
  });
  it("s'arrête quand tout est fait, sans progrès, ou au dernier tour", () => {
    expect(nightStop(1, { done: 5, left: 0 })).toBe("done");
    expect(nightStop(1, { done: 0, left: 3 })).toBe("stalled");
    expect(nightStop(MAX_ROUNDS, { done: 5, left: 3 })).toBe("rounds");
  });
});

describe("nightSkip (cron de secours)", () => {
  const now = Date.parse("2026-11-08T06:10:00Z");
  const at = (min) => new Date(now - min * 60e3).toISOString();
  it("passe son tour si la nuit est finie ou en cours", () => {
    expect(nightSkip({ at: at(40), stop: "done" }, now)).toBe(true);
    expect(nightSkip({ at: at(2), stop: null }, now)).toBe(true);
  });
  it("tourne sinon : rien cette nuit, chaîne coupée ou inachevée", () => {
    expect(nightSkip(null, now)).toBe(false);
    expect(nightSkip({ at: at(24 * 60), stop: "done" }, now)).toBe(false);
    expect(nightSkip({ at: at(30), stop: null }, now)).toBe(false);
    expect(nightSkip({ at: at(30), stop: "rounds" }, now)).toBe(false);
    expect(nightSkip({ at: at(30), stop: "relaunch" }, now)).toBe(false);
  });
});

describe("launchEnrichRound", () => {
  it("transmet le secret et le numéro de tour ; la coupure à 4 s est normale", async () => {
    const fetchMock = vi.fn(async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); });
    vi.stubGlobal("fetch", fetchMock);
    await launchEnrichRound("https://x.test", 2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://x.test/api/jukebox/enrich?round=2");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer s3cret");
    expect(upsert).not.toHaveBeenCalled();
  });
  it("note un refus dans le rapport", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await launchEnrichRound("https://x.test", 2);
    const report = JSON.parse(upsert.mock.calls[0][0].value);
    expect(report.stop).toBe("relaunch");
    expect(report.error).toContain("403");
  });
});

describe("GET /api/jukebox/enrich", () => {
  it("refuse sans le secret", async () => {
    const res = await GET(new Request("https://x.test/api/jukebox/enrich?round=1"));
    expect(res.status).toBe(401);
  });
});

describe("échéance des appels réseau", () => {
  it("n'appelle plus rien une fois l'échéance atteinte (le tour peut écrire son rapport)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(wikidataYear("Queen", "Bohemian Rhapsody", Date.now() + 500)).rejects.toThrow(DEADLINE);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("borne chaque appel par l'échéance", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ search: [] }) }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await wikidataYear("Queen", "Bohemian Rhapsody", Date.now() + 60e3)).toBe(null);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
