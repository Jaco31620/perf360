/* File équitable (fairPosition, lib/jukeboxServer.js) : tour par tour entre
 * les invités au lieu de l'ordre d'arrivée. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => { throw new Error("pas de base dans ce test"); } }));
const { fairPosition } = await import("@/lib/jukeboxServer");

const NOW = 1_800_000_000_000;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

const q = (...items) => items.map(([participant_id, position]) => ({ participant_id, position }));

/* Ajoute successivement des titres (pid) et renvoie l'ordre de la file. */
function simulate(pids) {
  const queue = [];
  pids.forEach((pid, n) => {
    queue.push({ participant_id: pid, position: fairPosition(queue, pid), n });
    queue.sort((a, b) => a.position - b.position);
  });
  return queue.map((t) => t.participant_id).join("");
}

describe("fairPosition", () => {
  it("file vide : maintenant", () => {
    expect(fairPosition([], "A")).toBe(NOW);
  });
  it("nouvel invité : se place après le 1er tour, avant le 2e titre de A", () => {
    expect(fairPosition(q(["A", 10], ["A", 20]), "B")).toBe(15);
  });
  it("invité qui a déjà le plus de titres : en fin de file (au moins maintenant)", () => {
    expect(fairPosition(q(["A", 10], ["B", 20]), "A")).toBe(NOW);
    const later = NOW + 5000;
    expect(fairPosition(q(["A", 10], ["B", later]), "A")).toBe(later + 1);
  });
  it("round-robin : A A A B B C → A B C A B A", () => {
    expect(simulate(["A", "A", "A", "B", "B", "C"])).toBe("ABCABA");
  });
  it("arrivées entremêlées : A B A A C B → A B C A B A", () => {
    expect(simulate(["A", "B", "A", "A", "C", "B"])).toBe("ABCABA");
  });
  it("respecte un déplacement fait en régie (tours recalculés sur l'ordre actuel)", () => {
    // la régie a mis le titre de B devant ceux de A : B(0) A(0) A(1)
    // C (tour 0) se place après le dernier titre de tour 0, donc entre A(0) et A(1)
    expect(fairPosition(q(["B", 5], ["A", 10], ["A", 20]), "C")).toBe(15);
  });
});
