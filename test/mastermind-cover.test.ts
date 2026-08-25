import { describe, expect, it } from "vitest";

import { mastermindCoverGuidance } from "../src/engine/mastermind-cover";
import { createGameState } from "../src/engine/game";
import { loadScenarioCatalog } from "../src/scenario-catalog";

function stateFor(id: string, difficultyIndex = 0) {
  const entry = loadScenarioCatalog().find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`missing scenario ${id}`);
  const difficulty = entry.difficulties.find(
    ({ index }) => index === difficultyIndex,
  );
  if (difficulty === undefined) {
    throw new Error(`missing scenario difficulty ${id}#${difficultyIndex}`);
  }
  return createGameState(difficulty.scenario);
}

describe("mastermind cover guidance", () => {
  it("generates a complete ranking for all 47 bundled difficulties", () => {
    const results = loadScenarioCatalog().flatMap((entry) =>
      entry.difficulties.map((difficulty) => ({
        key: `${entry.id}#${difficulty.index}`,
        roleHolderCount: Object.values(difficulty.scenario.cast).filter(
          (role) => role !== "person",
        ).length,
        guidance: mastermindCoverGuidance(
          createGameState(difficulty.scenario),
        ),
      }))
    );

    expect(results).toHaveLength(47);
    for (const { key, roleHolderCount, guidance } of results) {
      expect(guidance.candidates, key).toHaveLength(roleHolderCount);
      expect(guidance.recommendation, key).toBeDefined();
      expect(new Set(guidance.candidates.map(({ character }) => character)).size,
        key).toBe(roleHolderCount);
      expect(guidance.candidates.every(({ role }) => role !== "person"), key)
        .toBe(true);
      for (const candidate of guidance.candidates) {
        expect(candidate.exposurePathCount, key).toBe(
          candidate.exposurePaths.length,
        );
        expect(
          candidate.automaticPathCount + candidate.mastermindPathCount +
            candidate.protagonistPathCount,
          key,
        ).toBe(candidate.exposurePathCount);
      }
    }
  });

  it("separates passive witch ability pressure from mandatory-refusal exposure", () => {
    const witches = loadScenarioCatalog().flatMap((entry) =>
      entry.difficulties.flatMap((difficulty) =>
        mastermindCoverGuidance(createGameState(difficulty.scenario))
          .candidates.filter(({ role }) => role === "witch")
      )
    );

    expect(witches.length).toBeGreaterThan(0);
    expect(witches.every(({ baseDifficulty }) =>
      baseDifficulty === "passive"
    )).toBe(true);
    expect(witches.some(({ exposurePaths }) =>
      exposurePaths.some(({ key }) => key.includes("mandatory-refusal"))
    )).toBe(true);
    expect(witches.some(({ exposurePaths }) =>
      !exposurePaths.some(({ key }) => key.includes("mandatory-refusal"))
    )).toBe(true);
  });

  it("marks forced serial-killer and lovers paths as hard to hide", () => {
    const candidates = loadScenarioCatalog().flatMap((entry) =>
      entry.difficulties.flatMap((difficulty) =>
        mastermindCoverGuidance(createGameState(difficulty.scenario))
          .candidates
      )
    );
    for (const role of ["serialKiller", "lover", "lovedOne"]) {
      const matching = candidates.filter((candidate) => candidate.role === role);
      expect(matching.length, role).toBeGreaterThan(0);
      expect(matching.every(({ difficulty, automaticPathCount }) =>
        difficulty === "hard" && automaticPathCount > 0
      ), role).toBe(true);
    }
  });

  it("counts both time-traveler immortality and forbid-goodwill exposure", () => {
    const timeTraveler = loadScenarioCatalog().flatMap((entry) =>
      entry.difficulties.flatMap((difficulty) =>
        mastermindCoverGuidance(createGameState(difficulty.scenario))
          .candidates
      )
    ).find(({ role }) => role === "timeTraveler");

    expect(timeTraveler?.exposurePaths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "role:timeTraveler:forbid-goodwill",
        control: "mastermind",
      }),
      expect.objectContaining({
        key: "role:timeTraveler:immortal",
        control: "automatic",
      }),
    ]));
    expect(timeTraveler).toMatchObject({ difficulty: "hard" });
  });

  it("shows the victory-route tradeoff for controlled abilities", () => {
    const candidates = loadScenarioCatalog().flatMap((entry) =>
      entry.difficulties.flatMap((difficulty) =>
        mastermindCoverGuidance(createGameState(difficulty.scenario))
          .candidates
      )
    );
    const brain = candidates.find(({ role, affectedVictoryRouteCount }) =>
      role === "brain" && affectedVictoryRouteCount > 0
    );
    const theorist = candidates.find(({ role, affectedVictoryRouteCount }) =>
      role === "conspiracyTheorist" && affectedVictoryRouteCount > 0
    );
    expect(brain).toMatchObject({
      baseDifficulty: "controlled",
      mastermindPathCount: 1,
    });
    expect(theorist).toMatchObject({
      baseDifficulty: "controlled",
      mastermindPathCount: 1,
    });
  });

  it("moves a directly revealed role behind every unrevealed candidate", () => {
    const state = stateFor("basicTragedy:1");
    const first = mastermindCoverGuidance(state).candidates[0];
    state.loop.revealedRoleCharacters = [first.character];
    const recalculated = mastermindCoverGuidance(state);

    expect(recalculated.recommendation?.character).not.toBe(first.character);
    expect(recalculated.candidates.find(({ character }) =>
      character === first.character
    )?.alreadyRevealed).toBe(true);
    const firstRevealedIndex = recalculated.candidates.findIndex(
      ({ alreadyRevealed }) => alreadyRevealed,
    );
    expect(recalculated.candidates.slice(0, firstRevealedIndex).every(
      ({ alreadyRevealed }) => !alreadyRevealed,
    )).toBe(true);
  });

  it("expresses the early, late, and one-character final-defense distinction", () => {
    const basic = mastermindCoverGuidance(stateFor("basicTragedy:2"));
    const firstSteps = mastermindCoverGuidance(stateFor("firstSteps:1"));
    const serialKiller = basic.candidates.find(({ role }) =>
      role === "serialKiller"
    );

    expect(basic.earlyPrinciple).toContain("룰 가설");
    expect(basic.latePrinciple).toContain("승리에 필요한");
    expect(basic.finalDefensePrinciple).toContain("한 명만 틀려도");
    expect(serialKiller).toMatchObject({ difficulty: "hard" });
    expect(serialKiller?.recommendationReason).toContain("후순위");
    expect(firstSteps.hasFinalGuess).toBe(false);
    expect(firstSteps.finalDefensePrinciple).toContain("최후의 싸움이 없다");
  });

  it("treats the nurse as hiding mandatory refusal and separates common role reveals", () => {
    const lesser = mastermindCoverGuidance(stateFor("basicTragedy:8"));
    const nurse = lesser.candidates.find(({ character }) => character === "nurse");
    const shrineReveal = lesser.commonExposure.find(({ key }) =>
      key.startsWith("common-goodwill-reveal:shrineMaiden:")
    );

    expect(nurse).toMatchObject({ role: "cultist", baseDifficulty: "controlled" });
    expect(nurse?.exposurePaths.some(({ key }) =>
      key.includes("mandatory-refusal")
    )).toBe(false);
    expect(nurse?.recommendationReason).toContain("거부 불가라 절대 우호 무시 여부가 드러나지 않는다");
    expect(shrineReveal?.targetCharacterNames.length).toBeGreaterThan(0);
    expect(lesser.candidates.some(({ role }) => role === "person")).toBe(false);
  });

  it("excludes AI from the Shrine Maiden's same-location role reveal", () => {
    const state = stateFor("basicTragedy:8");
    state.scenario.cast.ai = "brain";
    state.loop.board.ai = { status: "alive", at: "City" };
    state.loop.charCounters.ai = {
      goodwill: 0,
      paranoia: 0,
      intrigue: 0,
      protection: 0,
    };
    const guidance = mastermindCoverGuidance(state);
    const shrineReveal = guidance.commonExposure.find(({ key }) =>
      key.startsWith("common-goodwill-reveal:shrineMaiden:")
    );

    expect(shrineReveal?.excludedCharacterNames).toContain("AI");
    expect(shrineReveal?.targetCharacterNames).not.toContain("AI");
  });
});
