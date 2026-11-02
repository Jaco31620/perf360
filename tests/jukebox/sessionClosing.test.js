/* Fermeture des soirées (lib/jukebox.js) : 8 h, heure de Paris, le lendemain
 * de (création + N jours), changements d'heure, fermeture manuelle,
 * prolongation (options.closesAt), durée illimitée. */
import { describe, it, expect } from "vitest";
import { morningAfter, autoCloseAt, sessionEndsAt, closedReason, validLabel, cleanValid, VALID_CHOICES } from "@/lib/jukebox";

const t = (iso) => Date.parse(iso);
const iso = (ms) => new Date(ms).toISOString();
const DAY = 864e5;

describe("morningAfter", () => {
  it("hiver (UTC+1) : 8 h à Paris = 07:00Z le lendemain", () => {
    expect(iso(morningAfter(t("2026-01-10T20:00:00Z")))).toBe("2026-01-11T07:00:00.000Z");
  });
  it("été (UTC+2) : 8 h à Paris = 06:00Z le lendemain", () => {
    expect(iso(morningAfter(t("2026-07-14T10:00:00Z")))).toBe("2026-07-15T06:00:00.000Z");
  });
  it("le jour est celui de Paris, pas celui d'UTC (23:30Z = 00:30 à Paris le lendemain)", () => {
    // 2026-01-10T23:30Z = 11 janvier 00:30 à Paris → fermeture le 12 à 8 h
    expect(iso(morningAfter(t("2026-01-10T23:30:00Z")))).toBe("2026-01-12T07:00:00.000Z");
  });
  it("veille du passage à l'heure d'été (29/03/2026) : 8 h CEST = 06:00Z", () => {
    expect(iso(morningAfter(t("2026-03-28T21:00:00Z")))).toBe("2026-03-29T06:00:00.000Z");
  });
  it("veille du passage à l'heure d'hiver (25/10/2026) : 8 h CET = 07:00Z", () => {
    expect(iso(morningAfter(t("2026-10-24T20:00:00Z")))).toBe("2026-10-25T07:00:00.000Z");
  });
  it("fin d'année : passe au 1er janvier", () => {
    expect(iso(morningAfter(t("2026-12-31T18:00:00Z")))).toBe("2027-01-01T07:00:00.000Z");
  });
});

describe("autoCloseAt", () => {
  it("1 jour : soirée du vendredi soir fermée le dimanche 8 h", () => {
    expect(iso(autoCloseAt(t("2026-01-09T21:00:00Z"), 1))).toBe("2026-01-11T07:00:00.000Z");
  });
  it("traverse le passage à l'heure d'été", () => {
    expect(iso(autoCloseAt(t("2026-03-27T21:00:00Z"), 1))).toBe("2026-03-29T06:00:00.000Z");
    expect(iso(autoCloseAt(t("2026-03-25T19:00:00Z"), 7))).toBe("2026-04-02T06:00:00.000Z");
  });
  it("traverse le passage à l'heure d'hiver", () => {
    expect(iso(autoCloseAt(t("2026-10-23T20:00:00Z"), 1))).toBe("2026-10-25T07:00:00.000Z");
    expect(iso(autoCloseAt(t("2026-10-20T19:00:00Z"), 7))).toBe("2026-10-28T07:00:00.000Z");
  });
  // N jours de calendrier à Paris (et non N × 24 h) : une soirée créée juste
  // avant un changement d'heure ne ferme ni un jour trop tôt ni trop tard
  // (bug trouvé par ces tests et corrigé le 02/11/2026).
  it("créée le 25/10/2026 à 00:30 (Paris), 1 jour → 27/10 8 h", () => {
    expect(iso(autoCloseAt(t("2026-10-24T22:30:00Z"), 1))).toBe("2026-10-27T07:00:00.000Z");
  });
  it("créée le 28/03/2026 à 23:30 (Paris), 1 jour → 30/03 8 h", () => {
    expect(iso(autoCloseAt(t("2026-03-28T22:30:00Z"), 1))).toBe("2026-03-30T06:00:00.000Z");
  });
  it("durée hors liste ou absente : jamais de fermeture automatique", () => {
    expect(autoCloseAt(t("2026-01-09T21:00:00Z"), null)).toBeNull();
    expect(autoCloseAt(t("2026-01-09T21:00:00Z"), 5)).toBeNull();
    expect(autoCloseAt(t("2026-01-09T21:00:00Z"), 0)).toBeNull();
  });
  it("durée en texte (\"7\") acceptée", () => {
    expect(autoCloseAt(t("2026-01-09T21:00:00Z"), "7")).toBe(autoCloseAt(t("2026-01-09T21:00:00Z"), 7));
  });
});

describe("sessionEndsAt / closedReason", () => {
  const created_at = "2026-01-09T21:00:00Z";
  const auto = t("2026-01-11T07:00:00Z"); // 1 jour

  it("validDays null et pas de fermeture manuelle : jamais fermée", () => {
    const s = { created_at, options: { validDays: null } };
    expect(sessionEndsAt(s)).toBeNull();
    expect(closedReason(s, t("2030-01-01T00:00:00Z"))).toBeNull();
  });
  it("sans options du tout : jamais fermée", () => {
    expect(sessionEndsAt({ created_at })).toBeNull();
    expect(sessionEndsAt(null)).toBeNull();
  });
  it("fermeture automatique : ouverte avant, « auto » à partir de l'heure", () => {
    const s = { created_at, options: { validDays: 1 } };
    expect(sessionEndsAt(s)).toBe(auto);
    expect(closedReason(s, auto - 1)).toBeNull();
    expect(closedReason(s, auto)).toBe("auto");
  });
  it("fermeture manuelle seule (sans limite de durée)", () => {
    const closedAt = t("2026-01-10T12:00:00Z");
    const s = { created_at, options: { closedAt } };
    expect(sessionEndsAt(s)).toBe(closedAt);
    expect(closedReason(s, closedAt - 1)).toBeNull();
    expect(closedReason(s, closedAt + 1)).toBe("manual");
  });
  it("manuelle avant l'automatique : la plus proche l'emporte → « manual »", () => {
    const closedAt = t("2026-01-10T12:00:00Z");
    const s = { created_at, options: { validDays: 1, closedAt } };
    expect(sessionEndsAt(s)).toBe(closedAt);
    expect(closedReason(s, auto + 1)).toBe("manual");
  });
  it("manuelle après l'automatique : fermée « auto » à l'heure automatique", () => {
    const s = { created_at, options: { validDays: 1, closedAt: auto + DAY } };
    expect(sessionEndsAt(s)).toBe(auto);
    expect(closedReason(s, auto + 2 * DAY)).toBe("auto");
  });
  it("prolongation (closesAt) : remplace la fermeture calculée depuis validDays", () => {
    const closesAt = t("2026-02-01T07:00:00Z");
    const s = { created_at, options: { validDays: 1, closesAt } };
    expect(sessionEndsAt(s)).toBe(closesAt);
    expect(closedReason(s, auto + 1)).toBeNull(); // rouverte
    expect(closedReason(s, closesAt)).toBe("auto");
  });
  it("prolongation + fermeture manuelle plus proche : manuelle", () => {
    const closesAt = t("2026-02-01T07:00:00Z"), closedAt = t("2026-01-20T07:00:00Z");
    const s = { created_at, options: { closesAt, closedAt } };
    expect(sessionEndsAt(s)).toBe(closedAt);
    expect(closedReason(s, closesAt + 1)).toBe("manual");
  });
});

describe("validLabel / cleanValid", () => {
  it("libellés", () => {
    expect(validLabel(1)).toBe("1 jour");
    expect(validLabel(2)).toBe("2 jours");
    expect(validLabel(14)).toBe("14 jours");
    expect(validLabel(30)).toBe("1 mois");
    expect(validLabel(90)).toBe("3 mois");
    expect(validLabel(180)).toBe("6 mois");
    expect(validLabel(365)).toBe("1 an");
  });
  it("chaque choix proposé a un libellé non vide", () => {
    for (const n of VALID_CHOICES) expect(validLabel(n)).toMatch(/\S/);
  });
  it("cleanValid : seules les valeurs de la liste passent (nombre ou texte)", () => {
    expect(cleanValid(7)).toBe(7);
    expect(cleanValid("30")).toBe(30);
    expect(cleanValid(5)).toBeNull();
    expect(cleanValid(0)).toBeNull();
    expect(cleanValid(null)).toBeNull();
    expect(cleanValid(undefined)).toBeNull();
    expect(cleanValid("abc")).toBeNull();
  });
});
