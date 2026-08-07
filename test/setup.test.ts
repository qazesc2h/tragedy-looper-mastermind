import { describe, expect, it } from "vitest";

import {
  characterDataOf,
  loadBasicTragedyScenarios,
} from "../src/data";
import { initLoop } from "../src/engine/setup";
import { boardIsAlive, boardLocation } from "./helpers";

const scenarios = loadBasicTragedyScenarios({
  // 복수 시작 장소는 테스트 호출자도 반드시 명시한다. initLoop가 고르지 않는다.
  scriptSpecified: {
    "startLocation:henchman": "Hospital",
  },
});

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
        expect(boardIsAlive(loop, character)).toBe(true);
        expect(characterDataOf(character).startLocation).toContain(
          boardLocation(loop, character),
        );
        expect(loop.charCounters[character]).toEqual({
          goodwill: 0,
          paranoia: 0,
          intrigue: 0,
          protection: 0,
        });
      }
    });
  }

  it("requires a script-specified start location when choices exist", () => {
    const scenario = loadBasicTragedyScenarios().find(
      (candidate) => "henchman" in candidate.cast,
    );
    expect(scenario).toBeDefined();

    expect(() => initLoop(scenario!)).toThrow(
      'scenario.scriptSpecified["startLocation:henchman"]',
    );
  });
});
