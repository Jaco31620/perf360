/* Codes d'activation, dates en français, textes des messages. */
import { describe, it, expect } from "vitest";
import { normalizeActCode, activationStatus } from "@/lib/jukeboxActivation"; // supabaseAdmin est paresseux : aucun env requis à l'import
import { fmtDateFr } from "@/lib/dates";
import { inviteText, activationText, guestText, helpUrl } from "@/lib/jukeboxMessages";

describe("normalizeActCode", () => {
  it("saisie libre → « ABCD-EFGH »", () => {
    expect(normalizeActCode("abcdefgh")).toBe("ABCD-EFGH");
    expect(normalizeActCode(" abcd efgh ")).toBe("ABCD-EFGH");
    expect(normalizeActCode("ab-cd_ef.gh")).toBe("ABCD-EFGH");
    expect(normalizeActCode("ABCD-EFGH")).toBe("ABCD-EFGH");
  });
  it("longueur différente de 8 : majuscules sans séparateur", () => {
    expect(normalizeActCode("abc-12")).toBe("ABC12");
    expect(normalizeActCode("abcdefghi")).toBe("ABCDEFGHI");
  });
  it("vide / null", () => {
    expect(normalizeActCode("")).toBe("");
    expect(normalizeActCode(null)).toBe("");
    expect(normalizeActCode(undefined)).toBe("");
  });
});

describe("activationStatus", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  const base = { revoked_at: null, expires_at: null, max_parties: 3, used: 0 };
  it("actif", () => {
    expect(activationStatus(base, now)).toBe("active");
    expect(activationStatus({ ...base, max_parties: null, used: 99 }, now)).toBe("active"); // illimité
    expect(activationStatus({ ...base, expires_at: "2026-11-03T00:00:00Z" }, now)).toBe("active");
  });
  it("épuisé", () => {
    expect(activationStatus({ ...base, used: 3 }, now)).toBe("spent");
    expect(activationStatus({ ...base, used: 4 }, now)).toBe("spent");
  });
  it("expiré (à l'instant même compris)", () => {
    expect(activationStatus({ ...base, expires_at: "2026-11-01T00:00:00Z" }, now)).toBe("expired");
    expect(activationStatus({ ...base, expires_at: new Date(now).toISOString() }, now)).toBe("expired");
  });
  it("priorité : désactivé > expiré > épuisé", () => {
    const all = { revoked_at: "2026-10-01T00:00:00Z", expires_at: "2026-10-01T00:00:00Z", max_parties: 1, used: 1 };
    expect(activationStatus(all, now)).toBe("revoked");
    expect(activationStatus({ ...all, revoked_at: null }, now)).toBe("expired");
  });
});

describe("fmtDateFr", () => {
  it("AAAA-MM-JJ → date longue en français", () => {
    expect(fmtDateFr("2026-11-15")).toBe("dimanche 15 novembre 2026");
    expect(fmtDateFr("2026-03-29")).toBe("dimanche 29 mars 2026"); // jour du changement d'heure
    expect(fmtDateFr("2024-02-29")).toBe("jeudi 29 février 2024");
  });
  it("autre texte renvoyé tel quel, vide → ''", () => {
    expect(fmtDateFr("demain")).toBe("demain");
    expect(fmtDateFr("15/11/2026")).toBe("15/11/2026");
    expect(fmtDateFr("")).toBe("");
    expect(fmtDateFr(null)).toBe("");
    expect(fmtDateFr(undefined)).toBe("");
  });
});

describe("messages", () => {
  const origin = "https://perf360.fr";
  it("invitation de l'organisateur", () => {
    const t = inviteText({ origin, code: "123456", name: "Anniv Laure", regieCode: "987654" });
    expect(t).toContain("« Anniv Laure »");
    expect(t).toContain("https://perf360.fr/jukebox/123456/telecommande");
    expect(t).toContain("https://perf360.fr/jukebox/123456/regie");
    expect(t).toContain("987 654"); // code régie espacé
    expect(t).toContain("perf360.fr/tv");
    expect(t).not.toContain("https://perf360.fr/tv"); // hôte sans protocole
    expect(t).toContain(helpUrl(origin));
  });
  it("code régie absent : pas de plantage", () => {
    expect(inviteText({ origin, code: "123456", name: "X" })).toContain("…");
  });
  it("code d'activation, avec et sans options", () => {
    const full = activationText({ origin, code: "ABCD-EFGH", label: "Max", partiesText: "2 soirées", expiresText: "31 décembre 2026", validText: "7 jours" });
    expect(full).toContain("Bonjour Max,");
    expect(full).toContain("ABCD-EFGH");
    expect(full).toContain("https://perf360.fr/jukebox?activation=ABCD-EFGH");
    expect(full).toContain("2 soirées, jusqu'au 31 décembre 2026.");
    expect(full).toContain("ouverte 7 jours");
    const bare = activationText({ origin, code: "ABCD-EFGH", label: "Max", partiesText: "1 soirée" });
    expect(bare).toContain("créer 1 soirée.");
    expect(bare).not.toContain("jusqu'au");
    expect(bare).not.toContain("reste ouverte");
  });
  it("message des invités", () => {
    const t = guestText({ origin, code: "123456", name: "Soirée" });
    expect(t).toContain("https://perf360.fr/jukebox/123456");
    expect(t).toContain("code 123 456 sur perf360.fr/jukebox");
  });
});
