import { describe, expect, it } from "vitest";

import { createGameState } from "../src/engine/game";
import { resolveGoodwillAbility } from "../src/engine/goodwill";
import {
  collectProtagonistObservations,
  enumerateRuleCombinations,
  evaluateRuleHypotheses,
  evaluateStateRuleHypotheses,
  publicBoardChanges,
  publicObservationContext,
  type ProtagonistObservation,
} from "../src/engine/hypothesis";
import {
  loadBasicTragedyScenarioCatalog,
  loadFirstStepsScenarioCatalog,
} from "../src/scenario-catalog";
import type { GameState, PublicObservationContext } from "../src/types";

function firstStepsState(): GameState {
  const scenario = structuredClone(
    loadFirstStepsScenarioCatalog()[0].scenario,
  );
  return createGameState(scenario);
}

function roleRevealed(
  character: string,
  role: string,
): ProtagonistObservation {
  return { kind: "roleRevealed", loop: 1, character, role };
}

function observationContext(
  schoolIntrigue: number,
  cityIntrigue = 0,
): PublicObservationContext {
  return {
    locationIntrigue: {
      Hospital: 0,
      Shrine: 0,
      City: cityIntrigue,
      School: schoolIntrigue,
    },
  };
}

describe("rule combination enumeration", () => {
  it("enumerates all 3 x 3 firstSteps combinations", () => {
    const combinations = enumerateRuleCombinations("firstSteps");
    expect(combinations).toHaveLength(9);
    expect(combinations.map(({ id }) => id)).toEqual([
      "murderPlan+shadowRipper",
      "murderPlan+unsettlingRumor",
      "murderPlan+hideousScript",
      "lightAvenger+shadowRipper",
      "lightAvenger+unsettlingRumor",
      "lightAvenger+hideousScript",
      "placeProtect+shadowRipper",
      "placeProtect+unsettlingRumor",
      "placeProtect+hideousScript",
    ]);
  });

  it("enumerates all 5 x C(7, 2) basicTragedy combinations", () => {
    expect(enumerateRuleCombinations("basicTragedy")).toHaveLength(105);
  });
});

describe("firstSteps hypothesis filtering", () => {
  it("keeps all nine combinations with no observations", () => {
    const evaluation = evaluateRuleHypotheses("firstSteps", []);
    expect(evaluation.remaining).toHaveLength(9);
    expect(evaluation.excluded).toEqual([]);
  });

  it("excludes exactly the combinations without a revealed key person", () => {
    const evaluation = evaluateRuleHypotheses("firstSteps", [
      roleRevealed("shrineMaiden", "keyPerson"),
    ]);

    expect(evaluation.remaining).toHaveLength(6);
    expect(evaluation.remaining.map(({ mainPlot }) => mainPlot)).not.toContain(
      "lightAvenger",
    );
    expect(evaluation.excluded).toHaveLength(3);
    expect(evaluation.excluded.every(({ contradictions }) =>
      contradictions.some(({ code }) => code === "revealedRoleUnavailable")
    )).toBe(true);
  });

  it("keeps only combinations containing the subplot revealed by informer", () => {
    const observation: ProtagonistObservation = {
      kind: "subplotRevealed",
      loop: 1,
      declaredSubplot: "shadowRipper",
      revealedSubplot: "unsettlingRumor",
    };
    const evaluation = evaluateRuleHypotheses("firstSteps", [observation]);

    expect(evaluation.remaining).toHaveLength(3);
    expect(evaluation.remaining.every(({ subPlots }) =>
      subPlots.includes("unsettlingRumor")
    )).toBe(true);
    expect(evaluation.excluded).toHaveLength(6);
  });

  it("applies the inverse role rule to the outsider", () => {
    const evaluation = evaluateRuleHypotheses("firstSteps", [
      roleRevealed("mysteryBoy", "brain"),
    ]);

    expect(evaluation.remaining).toHaveLength(3);
    expect(evaluation.remaining.every(({ mainPlot }) =>
      mainPlot === "placeProtect"
    )).toBe(true);
    expect(evaluation.excluded.every(({ contradictions }) =>
      contradictions.some(({ code }) => code === "outsiderRoleAssociated")
    )).toBe(true);
  });

  it("keeps all nine after a refusal because every firstSteps Rule Y adds a refusal role", () => {
    const observation: ProtagonistObservation = {
      kind: "goodwillRefused",
      loop: 1,
      day: 2,
      character: "shrineMaiden",
      rank: 5,
      abilityIndex: 1,
    };
    const evaluation = evaluateRuleHypotheses("firstSteps", [observation]);

    expect(evaluation.remaining).toHaveLength(9);
    expect(evaluation.excluded).toEqual([]);
  });

  it("uses a visible character intrigue increase without revealing its source", () => {
    const observation: ProtagonistObservation = {
      kind: "mastermindAbilityResult",
      loop: 1,
      day: 2,
      changes: [{
        kind: "counter",
        target: { kind: "character", id: "shrineMaiden" },
        counter: "intrigue",
        delta: 1,
      }],
    };
    const evaluation = evaluateRuleHypotheses("firstSteps", [observation]);

    expect(evaluation.remaining).toHaveLength(6);
    expect(evaluation.remaining.map(({ mainPlot }) => mainPlot)).not.toContain(
      "placeProtect",
    );
    expect(evaluation.excluded.every(({ contradictions }) =>
      contradictions.some(({ code }) => code === "mastermindAbilityUnavailable")
    )).toBe(true);
  });

  it("keeps all nine after a visible paranoia increase", () => {
    const observation: ProtagonistObservation = {
      kind: "mastermindAbilityResult",
      loop: 1,
      day: 1,
      changes: [{
        kind: "counter",
        target: { kind: "character", id: "shrineMaiden" },
        counter: "paranoia",
        delta: 1,
      }],
      context: observationContext(0),
    };

    const evaluation = evaluateRuleHypotheses("firstSteps", [observation]);

    expect(evaluation.remaining).toHaveLength(9);
    expect(evaluation.excluded).toEqual([]);
  });
});

describe("observation model", () => {
  it("records the role at the exact goodwill reveal moment", () => {
    const state = firstStepsState();
    state.loop.phase = "P6_GOODWILL";
    state.loop.charCounters.shrineMaiden.goodwill = 5;

    resolveGoodwillAbility(state, {
      user: "shrineMaiden",
      rank: 5,
      abilityIndex: 1,
      target: "shrineMaiden",
    }, "resolve");

    expect(state.loop.publicInformationThisLoop).toContainEqual({
      kind: "roleReveal",
      character: "shrineMaiden",
      role: "serialKiller",
      loop: 1,
      day: 1,
    });
    expect(collectProtagonistObservations(state)).toContainEqual({
      kind: "roleRevealed",
      loop: 1,
      character: "shrineMaiden",
      role: "serialKiller",
    });
  });

  it("normalizes scattered public history without copying hidden causes", () => {
    const state = firstStepsState();
    state.scenario.cast.shrineMaiden = "keyPerson";
    state.loop.revealedRoleCharacters = ["shrineMaiden"];
    state.loop.publicInformationThisLoop = [
      {
        kind: "roleReveal",
        character: "shrineMaiden",
        role: "keyPerson",
        loop: 1,
        day: 2,
      },
      {
        kind: "goodwillRefusal",
        character: "shrineMaiden",
        rank: 5,
        abilityIndex: 1,
        loop: 1,
        day: 2,
      },
      {
        kind: "incidentCulprit",
        source: "godlyBeing",
        day: 3,
        incident: "murder",
        culprit: "boyStudent",
      },
      {
        kind: "subplot",
        source: "informer",
        declaredSubplot: "shadowRipper",
        revealedSubplot: "unsettlingRumor",
      },
    ];
    state.loop.phaseLog = [
      {
        loop: 1,
        day: 3,
        phase: "P7_INCIDENT",
        kind: "incidentJudged",
        incident: "murder",
        culprit: "boyStudent",
        fired: false,
        effectApplied: false,
        failureReasons: ["insufficientParanoia"],
      },
      {
        loop: 1,
        day: 2,
        phase: "P5_MASTERMIND_ABILITY",
        kind: "abilityActivated",
        character: "shrineMaiden",
        description: "hidden source description",
        publicChanges: [{
          kind: "counter",
          target: { kind: "character", id: "boyStudent" },
          counter: "paranoia",
          delta: 1,
        }],
        publicContext: observationContext(0, 2),
      },
    ];
    state.loopOutcomes = [{
      loop: 1,
      day: 3,
      reason: "effect",
      result: "protagonistsLost",
      losses: [{
        key: "role:keyPerson:shrineMaiden",
        id: "keyPerson",
        ko: "핵심 인물",
        label: "hidden exact loss",
      }],
    }];

    const observations = collectProtagonistObservations(state);
    expect(observations.map(({ kind }) => kind)).toEqual([
      "roleRevealed",
      "goodwillRefused",
      "incidentCulpritRevealed",
      "subplotRevealed",
      "incidentOccurred",
      "mastermindAbilityResult",
      "lossObserved",
    ]);
    expect(JSON.stringify(observations)).not.toContain("hidden source");
    expect(JSON.stringify(observations)).not.toContain("hidden exact loss");
    expect(observations).toContainEqual({
      kind: "incidentOccurred",
      loop: 1,
      day: 3,
      incident: "murder",
      occurred: false,
    });
    expect(observations).toContainEqual({
      kind: "mastermindAbilityResult",
      loop: 1,
      day: 2,
      changes: [{
        kind: "counter",
        target: { kind: "character", id: "boyStudent" },
        counter: "paranoia",
        delta: 1,
      }],
      context: observationContext(0, 2),
    });
  });

  it("derives only visible changes from a mastermind ability", () => {
    const state = firstStepsState();
    const before = structuredClone(state.loop);
    state.loop.charCounters.shrineMaiden.paranoia += 1;

    expect(publicBoardChanges(before, state.loop)).toEqual([{
      kind: "counter",
      target: { kind: "character", id: "shrineMaiden" },
      counter: "paranoia",
      delta: 1,
    }]);
  });

  it("snapshots public location intrigue without retaining a live reference", () => {
    const state = firstStepsState();
    state.loop.locIntrigue.City = 2;
    const context = publicObservationContext(state.loop);

    state.loop.locIntrigue.City = 3;

    expect(context).toEqual(observationContext(0, 2));
  });
});

describe("basicTragedy rule-layer regression", () => {
  function visibleParanoiaIncrease(
    schoolIntrigue: number,
  ): Extract<ProtagonistObservation, { kind: "mastermindAbilityResult" }> {
    return {
      kind: "mastermindAbilityResult",
      loop: 1,
      day: 1,
      changes: [{
        kind: "counter",
        target: { kind: "character", id: "shrineMaiden" },
        counter: "paranoia",
        delta: 1,
      }],
      context: observationContext(schoolIntrigue),
    };
  }

  it("excludes 30 combinations when Factor lacks its School condition", () => {
    const evaluation = evaluateRuleHypotheses("basicTragedy", [
      visibleParanoiaIncrease(0),
    ]);

    expect(evaluation.remaining).toHaveLength(75);
    expect(evaluation.excluded).toHaveLength(30);
  });

  it("allows Factor to explain paranoia when School has 2 intrigue", () => {
    const evaluation = evaluateRuleHypotheses("basicTragedy", [
      visibleParanoiaIncrease(2),
    ]);

    expect(evaluation.remaining).toHaveLength(90);
    expect(evaluation.excluded).toHaveLength(15);
  });

  it("keeps old observations without context conservative", () => {
    const observation = visibleParanoiaIncrease(0);
    delete observation.context;

    const evaluation = evaluateRuleHypotheses("basicTragedy", [observation]);

    expect(evaluation.remaining).toHaveLength(90);
  });

  it("excludes combinations that cannot explain a normal character's refusal", () => {
    const observation: ProtagonistObservation = {
      kind: "goodwillRefused",
      loop: 1,
      day: 1,
      character: "shrineMaiden",
      rank: 5,
      abilityIndex: 1,
    };
    const evaluation = evaluateRuleHypotheses("basicTragedy", [observation]);

    expect(evaluation.remaining.length).toBeGreaterThan(0);
    expect(evaluation.remaining.length).toBeLessThan(105);
    expect(evaluation.excluded.every(({ contradictions }) =>
      contradictions.some(({ code }) => code === "goodwillRefusalUnavailable")
    )).toBe(true);
  });

  it("recalculates 105 combinations at every 3 x 7 x 9 checkpoint", () => {
    const scenario = structuredClone(
      loadBasicTragedyScenarioCatalog()[0].scenario,
    );
    const state = createGameState(scenario);
    const startedAt = performance.now();
    let evaluation = evaluateStateRuleHypotheses(state);
    for (let checkpoint = 1; checkpoint < 3 * 7 * 9; checkpoint += 1) {
      evaluation = evaluateStateRuleHypotheses(state);
    }
    const elapsed = performance.now() - startedAt;

    expect(evaluation.combinations).toHaveLength(105);
    expect(elapsed).toBeLessThan(1_000);
  });
});
