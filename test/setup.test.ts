import { describe, expect, it } from "vitest";

import {
  characterDataOf,
  loadBasicTragedyScenarios,
} from "../src/data";
import { initLoop } from "../src/engine/setup";
import { isCharacterPresent } from "../src/types";
import { boardIsAlive, boardLocation } from "./helpers";

const scenarios = loadBasicTragedyScenarios();

describe("basic tragedy setup", () => {
  it("loads all 22 scripts", () => {
    expect(scenarios).toHaveLength(22);
  });

  for (const [index, scenario] of scenarios.entries()) {
    it(`initializes script ${index + 1}`, () => {
      const loop = initLoop(scenario);

      expect(Object.keys(loop.board)).toEqual(Object.keys(scenario.cast));
      expect(Array.isArray(scenario.subPlots)).toBe(true);
      expect(Object.values(scenario.cast).every(
        (role) => typeof role === "string",
      )).toBe(true);
      expect(loop.loop).toBe(1);
      expect(loop.day).toBe(1);
      expect(loop.phase).toBe("P1_ROUND_START");
      expect(loop.leader).toBe(0);
      expect(loop.locIntrigue).toEqual({
        Hospital: 0,
        Shrine: 0,
        City: 0,
        School: 0,
      });
      expect(loop.spentOncePerLoop).toEqual({
        mastermind: [],
        protagonists: [[], [], []],
      });
      expect(loop.abilitiesUsedThisLoop).toEqual([]);
      expect(loop.placed).toEqual([]);

      for (const character of Object.keys(scenario.cast)) {
        const characterData = characterDataOf(character);
        if (characterData.comesInLater || character === "henchman") {
          expect(isCharacterPresent(loop.board[character])).toBe(false);
        } else {
          expect(boardIsAlive(loop, character)).toBe(true);
          expect(characterData.startLocation).toContain(
            boardLocation(loop, character),
          );
        }
        expect(loop.charCounters[character]).toEqual({
          goodwill: 0,
          paranoia: 0,
          intrigue: 0,
          protection: 0,
        });
      }
    });
  }

  it("initializes henchman without a static scenario location", () => {
    const scenario = loadBasicTragedyScenarios().find(
      (candidate) => "henchman" in candidate.cast,
    );
    expect(scenario).toBeDefined();

    const loop = initLoop(scenario!);
    expect(loop.board.henchman).toEqual({ status: "absent" });
    expect(loop.loopStartTraitLocationChoices).toBeUndefined();
  });
});
