// Blind test : autres réponses acceptées, notées entre parenthèses
import { describe, it, expect } from "vitest";
import { checkAnswer, altAnswers } from "@/lib/jukeboxBlind";

describe("réponses entre parenthèses", () => {
  const omd = "Orchestral Manoeuvres in the Dark (OMD)";
  it("artiste : nom complet ou sigle", () => {
    expect(checkAnswer("OMD", omd, "Enola Gay").artist).toBe(true);
    expect(checkAnswer("orchestral manoeuvres in the dark", omd, "Enola Gay").artist).toBe(true);
    expect(checkAnswer("enola gay omd", omd, "Enola Gay")).toEqual({ artist: true, title: true });
  });
  it("titre : titre principal ou autre titre entre parenthèses", () => {
    expect(checkAnswer("yakalelo", "Collectif Métissé", "Ces soirées-là (Yakalelo)").title).toBe(true);
    expect(checkAnswer("ces soirées là", "Collectif Métissé", "Ces soirées-là (Yakalelo)").title).toBe(true);
  });
  it("mentions techniques ignorées : « live », « remastered 2011 », « feat. »", () => {
    expect(altAnswers("Bohemian Rhapsody (Remastered 2011)")).toEqual([]);
    expect(altAnswers("Hotel California (Live)")).toEqual([]);
    expect(altAnswers("Señorita (feat. Camila Cabello)")).toEqual([]);
    expect(checkAnswer("live", "Eagles", "Hotel California (Live)").title).toBe(false);
  });
  it("duo et « feat. » : chaque artiste reste accepté", () => {
    expect(checkAnswer("rihanna", "Calvin Harris feat. Rihanna", "This Is What You Came For").artist).toBe(true);
    expect(checkAnswer("calvin harris", "Calvin Harris feat. Rihanna", "This Is What You Came For").artist).toBe(true);
  });
  it("« feat. » dans le titre : l'artiste invité compte comme interprète, pas comme titre", () => {
    const r = checkAnswer("camila cabello", "Shawn Mendes", "Señorita (feat. Camila Cabello)");
    expect(r).toEqual({ artist: true, title: false });
    expect(checkAnswer("cabello", "Shawn Mendes", "Señorita (feat. Camila Cabello)").artist).toBe(true); // nom de famille
    expect(checkAnswer("senorita", "Shawn Mendes", "Señorita (feat. Camila Cabello)").title).toBe(true);
    expect(checkAnswer("dua lipa", "Calvin Harris", "One Kiss (with Dua Lipa)").artist).toBe(true); // « (with …) » de Deezer
    expect(checkAnswer("myself", "Billy Idol", "Dancing with Myself").artist).toBe(false); // « with » hors parenthèses : pas un invité
  });
  it("sans parenthèses : rien de changé (nom de famille d'un artiste)", () => {
    expect(checkAnswer("balavoine", "Daniel Balavoine", "L'Aziza").artist).toBe(true);
    expect(checkAnswer("omd", "Orchestral Manoeuvres in the Dark", "Enola Gay").artist).toBe(false);
  });
});
