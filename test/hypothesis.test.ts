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
import { recordPhaseLog } from "../src/engine/phase-log";
import {
  applyHookEffect,
  collectHooks,
  resolveHooks,
} from "../src/engine/phases";
import { resolveActions } from "../src/engine/resolve";
import { initLoop } from "../src/engine/setup";
import {
  loadBasicTragedyScenarioCatalog,
  loadFirstStepsScenarioCatalog,
} from "../src/scenario-catalog";
import type {
  CharacterId,
  GameState,
  PlacedCard,
  PublicObservationContext,
} from "../src/types";
import { isCharacterPresent } from "../src/types";
import { setBoardLife, setBoardLocation } from "./helpers";

function firstStepsState(): GameState {
  const scenario = structuredClone(
    loadFirstStepsScenarioCatalog()[0].scenario,
  );
  return createGameState(scenario);
}

function basicState(id: string): GameState {
  const entry = loadBasicTragedyScenarioCatalog().find((candidate) =>
    candidate.id === id
  );
  if (entry === undefined) throw new Error(`missing scenario ${id}`);
  return createGameState(structuredClone(entry.scenario));
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

function boardObservationContext(
  characters: NonNullable<PublicObservationContext["characters"]>,
): PublicObservationContext {
  return {
    ...observationContext(0),
    characters,
  };
}

function publicCharacter(
  location: "Hospital" | "Shrine" | "City" | "School",
  intrigue = 0,
  paranoia = 0,
): NonNullable<PublicObservationContext["characters"]>[CharacterId] {
  return {
    status: "alive",
    location,
    abilityLocations: [location],
    goodwill: 0,
    paranoia,
    intrigue,
  };
}

function roundEndDeathObservation(
  characters: NonNullable<PublicObservationContext["characters"]>,
  deadCharacter = "shrineMaiden",
): Extract<
  ProtagonistObservation,
  { kind: "mastermindAbilityResult" }
> {
  return {
    kind: "mastermindAbilityResult",
    loop: 1,
    day: 1,
    timing: "P9_ROUND_END",
    changes: [{
      kind: "status",
      character: deadCharacter,
      from: "alive",
      to: "dead",
    }],
    context: boardObservationContext(characters),
  };
}

function actualCombinationRemains(state: GameState): boolean {
  return evaluateStateRuleHypotheses(state).remaining.some((combination) =>
    combination.mainPlot === state.scenario.mainPlot &&
    combination.subPlots.length === state.scenario.subPlots.length &&
    combination.subPlots.every((plot) => state.scenario.subPlots.includes(plot))
  );
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

  it("keeps a public death trigger while discarding the hidden ability source", () => {
    const state = firstStepsState();
    state.loop.phaseLog = [{
      loop: 1,
      day: 2,
      phase: "P7_INCIDENT",
      kind: "abilityActivated",
      timing: "ON_DEATH",
      character: "shrineMaiden",
      description: "hidden lover role",
      publicTrigger: {
        kind: "death",
        deadCharacters: ["boyStudent"],
      },
      publicChanges: [{
        kind: "counter",
        target: { kind: "character", id: "shrineMaiden" },
        counter: "paranoia",
        delta: 6,
      }],
    }];

    const observations = collectProtagonistObservations(state);

    expect(observations).toContainEqual({
      kind: "mastermindAbilityResult",
      loop: 1,
      day: 2,
      timing: "ON_DEATH",
      trigger: {
        kind: "death",
        deadCharacters: ["boyStudent"],
      },
      changes: [{
        kind: "counter",
        target: { kind: "character", id: "shrineMaiden" },
        counter: "paranoia",
        delta: 6,
      }],
    });
    expect(JSON.stringify(observations)).not.toContain("hidden lover role");
  });

  it("snapshots the public board without retaining live references", () => {
    const state = firstStepsState();
    state.loop.locIntrigue.City = 2;
    const context = publicObservationContext(state.loop);
    const maiden = context.characters?.shrineMaiden;

    state.loop.locIntrigue.City = 3;
    state.loop.charCounters.shrineMaiden.paranoia = 4;

    expect(context.locationIntrigue).toEqual(
      observationContext(0, 2).locationIntrigue,
    );
    expect(maiden?.paranoia).toBe(0);
    expect(maiden?.status).toBe("alive");
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

  it("fixes loveAffair from a public +6 paranoia death reaction", () => {
    const observation: ProtagonistObservation = {
      kind: "mastermindAbilityResult",
      loop: 1,
      day: 2,
      timing: "ON_DEATH",
      trigger: {
        kind: "death",
        deadCharacters: ["girlStudent"],
      },
      changes: [{
        kind: "counter",
        target: { kind: "character", id: "boyStudent" },
        counter: "paranoia",
        delta: 6,
      }],
    };

    const evaluation = evaluateRuleHypotheses("basicTragedy", [observation]);

    expect(evaluation.remaining).toHaveLength(30);
    expect(evaluation.remaining.every(({ subPlots }) =>
      subPlots.includes("loveAffair")
    )).toBe(true);
    expect(evaluation.excluded).toHaveLength(75);
  });

  it("fixes threadsFate from multiple public loop-start +2 changes", () => {
    const observation: ProtagonistObservation = {
      kind: "mastermindAbilityResult",
      loop: 2,
      day: 1,
      timing: "LOOP_START",
      changes: ["boyStudent", "girlStudent"].map((id) => ({
        kind: "counter" as const,
        target: { kind: "character" as const, id },
        counter: "paranoia" as const,
        delta: 2,
      })),
    };

    const evaluation = evaluateRuleHypotheses("basicTragedy", [observation]);

    expect(evaluation.remaining).toHaveLength(30);
    expect(evaluation.remaining.every(({ subPlots }) =>
      subPlots.includes("threadsFate")
    )).toBe(true);
    expect(evaluation.excluded).toHaveLength(75);
  });

  it("keeps five main-plot combinations after both fixed subplots are observed", () => {
    const deathReaction: ProtagonistObservation = {
      kind: "mastermindAbilityResult",
      loop: 1,
      day: 2,
      timing: "ON_DEATH",
      trigger: { kind: "death", deadCharacters: ["girlStudent"] },
      changes: [{
        kind: "counter",
        target: { kind: "character", id: "boyStudent" },
        counter: "paranoia",
        delta: 6,
      }],
    };
    const loopStart: ProtagonistObservation = {
      kind: "mastermindAbilityResult",
      loop: 2,
      day: 1,
      timing: "LOOP_START",
      changes: ["boyStudent", "girlStudent"].map((id) => ({
        kind: "counter" as const,
        target: { kind: "character" as const, id },
        counter: "paranoia" as const,
        delta: 2,
      })),
    };

    const evaluation = evaluateRuleHypotheses(
      "basicTragedy",
      [deathReaction, loopStart],
    );

    expect(evaluation.remaining).toHaveLength(5);
    expect(evaluation.remaining.every(({ subPlots }) =>
      subPlots.includes("loveAffair") && subPlots.includes("threadsFate")
    )).toBe(true);
  });

  it("does not infer C-2 rules without the complete public pattern", () => {
    const deathWithoutTrigger: ProtagonistObservation = {
      kind: "mastermindAbilityResult",
      loop: 1,
      day: 2,
      timing: "ON_DEATH",
      changes: [{
        kind: "counter",
        target: { kind: "character", id: "boyStudent" },
        counter: "paranoia",
        delta: 6,
      }],
    };
    const oneLoopStartTarget: ProtagonistObservation = {
      kind: "mastermindAbilityResult",
      loop: 2,
      day: 1,
      timing: "LOOP_START",
      changes: [{
        kind: "counter",
        target: { kind: "character", id: "boyStudent" },
        counter: "paranoia",
        delta: 2,
      }],
    };

    expect(evaluateRuleHypotheses(
      "basicTragedy",
      [deathWithoutTrigger],
    ).remaining).toHaveLength(105);
    expect(evaluateRuleHypotheses(
      "basicTragedy",
      [oneLoopStartTarget],
    ).remaining).toHaveLength(105);
  });

  it("keeps only hiddenFreak for an ordinary serial-killer pair", () => {
    const observation = roundEndDeathObservation({
      shrineMaiden: publicCharacter("Shrine"),
      boyStudent: publicCharacter("Shrine"),
      girlStudent: publicCharacter("School"),
    });

    const evaluation = evaluateRuleHypotheses(
      "basicTragedy",
      [observation],
    );

    expect(evaluation.remaining).toHaveLength(30);
    expect(evaluation.excluded).toHaveLength(75);
    expect(evaluation.remaining.every(({ subPlots }) =>
      subPlots.includes("hiddenFreak")
    )).toBe(true);
  });

  it("also keeps paranoiaVirus when the only survivor can mutate", () => {
    const observation = roundEndDeathObservation({
      shrineMaiden: publicCharacter("Shrine"),
      boyStudent: publicCharacter("Shrine", 0, 3),
      girlStudent: publicCharacter("School"),
    });

    const evaluation = evaluateRuleHypotheses(
      "basicTragedy",
      [observation],
    );

    expect(evaluation.remaining).toHaveLength(55);
    expect(evaluation.excluded).toHaveLength(50);
    expect(evaluation.remaining.every(({ subPlots }) =>
      subPlots.includes("hiddenFreak") || subPlots.includes("paranoiaVirus")
    )).toBe(true);
  });

  it("uses murderPlan when a non-pair death matches the killer condition", () => {
    const observation = roundEndDeathObservation({
      shrineMaiden: publicCharacter("Shrine", 2),
      boyStudent: publicCharacter("Shrine"),
      girlStudent: publicCharacter("Shrine"),
    });

    const evaluation = evaluateRuleHypotheses(
      "basicTragedy",
      [observation],
    );

    expect(evaluation.remaining).toHaveLength(21);
    expect(evaluation.excluded).toHaveLength(84);
    expect(evaluation.remaining.every(({ mainPlot }) =>
      mainPlot === "murderPlan"
    )).toBe(true);
  });

  it("keeps the union of serial-killer and killer explanations", () => {
    const observation = roundEndDeathObservation({
      shrineMaiden: publicCharacter("Shrine", 2),
      boyStudent: publicCharacter("Shrine", 0, 3),
      girlStudent: publicCharacter("School"),
    });

    const evaluation = evaluateRuleHypotheses(
      "basicTragedy",
      [observation],
    );

    expect(evaluation.remaining).toHaveLength(65);
    expect(evaluation.excluded).toHaveLength(40);
    expect(evaluation.remaining.every(({ mainPlot, subPlots }) =>
      mainPlot === "murderPlan" ||
      subPlots.includes("hiddenFreak") ||
      subPlots.includes("paranoiaVirus")
    )).toBe(true);
  });

  it("does not infer a P9 cause without the observation-time board", () => {
    const observation = roundEndDeathObservation({
      shrineMaiden: publicCharacter("Shrine"),
      boyStudent: publicCharacter("Shrine"),
    });
    delete observation.context;

    expect(evaluateRuleHypotheses(
      "basicTragedy",
      [observation],
    ).remaining).toHaveLength(105);
  });

  it("preserves the outsider's inverse serial-killer assignment", () => {
    const observation = roundEndDeathObservation({
      shrineMaiden: publicCharacter("Shrine"),
      mysteryBoy: publicCharacter("Shrine"),
      boyStudent: publicCharacter("School"),
    });

    const evaluation = evaluateRuleHypotheses(
      "basicTragedy",
      [observation],
    );

    expect(evaluation.remaining).toHaveLength(75);
    expect(evaluation.remaining.every(({ subPlots }) =>
      !subPlots.includes("hiddenFreak")
    )).toBe(true);
  });

  it("requires an earlier friend reveal before interpreting loop-start goodwill", () => {
    const goodwill: ProtagonistObservation = {
      kind: "mastermindAbilityResult",
      loop: 2,
      day: 1,
      timing: "LOOP_START",
      changes: [{
        kind: "counter",
        target: { kind: "character", id: "girlStudent" },
        counter: "goodwill",
        delta: 1,
      }],
    };

    expect(evaluateRuleHypotheses(
      "basicTragedy",
      [goodwill],
    ).remaining).toHaveLength(105);

    const revealed = roleRevealed("girlStudent", "friend");
    const withReveal = evaluateRuleHypotheses(
      "basicTragedy",
      [revealed, goodwill],
    );
    expect(withReveal.remaining).toHaveLength(55);
    expect(withReveal.excluded).toHaveLength(50);
    expect(withReveal.remaining.every(({ subPlots }) =>
      subPlots.includes("circleFriends") || subPlots.includes("hiddenFreak")
    )).toBe(true);
    expect(withReveal.remaining).toEqual(
      evaluateRuleHypotheses("basicTragedy", [revealed]).remaining,
    );
  });

  it("keeps only cultist main plots after a valid intrigue forbid is ignored", () => {
    const observation: ProtagonistObservation = {
      kind: "intrigueForbidIgnored",
      loop: 1,
      day: 1,
      target: { kind: "character", id: "girlStudent" },
      context: boardObservationContext({
        girlStudent: publicCharacter("School"),
      }),
    };

    const evaluation = evaluateRuleHypotheses(
      "basicTragedy",
      [observation],
    );

    expect(evaluation.remaining).toHaveLength(42);
    expect(evaluation.excluded).toHaveLength(63);
    expect(evaluation.remaining.every(({ mainPlot }) =>
      mainPlot === "sealedItem" || mainPlot === "changeOfFuture"
    )).toBe(true);
  });

  it("collects cultist evidence only when exactly one protagonist forbid was valid", () => {
    const state = basicState("basicTragedy:7");
    const target = { kind: "character" as const, id: "classRep" };
    const cards: PlacedCard[] = [
      { owner: 0, card: "forbidIntrigue", target },
      { owner: "mastermind", card: "intriguePlus1", target },
    ];
    recordPhaseLog(state, {
      loop: 1,
      day: 1,
      phase: "P4_RESOLVE",
      kind: "actionResolved",
      results: [],
      placements: cards,
      publicContext: publicObservationContext(state.loop),
      publicChanges: [{
        kind: "counter",
        target,
        counter: "intrigue",
        delta: 1,
      }],
    });

    expect(collectProtagonistObservations(state)).toContainEqual(
      expect.objectContaining({
        kind: "intrigueForbidIgnored",
        target,
      }),
    );

    cards.push({ owner: 1, card: "forbidIntrigue", target });
    const invalidatedByRule = basicState("basicTragedy:7");
    recordPhaseLog(invalidatedByRule, {
      loop: 1,
      day: 1,
      phase: "P4_RESOLVE",
      kind: "actionResolved",
      results: [],
      placements: cards,
      publicChanges: [{
        kind: "counter",
        target,
        counter: "intrigue",
        delta: 1,
      }],
    });
    expect(collectProtagonistObservations(invalidatedByRule).some(
      ({ kind }) => kind === "intrigueForbidIgnored",
    )).toBe(false);
  });

  it("does not turn known P6 or P7 deaths into an unknown P9 cause", () => {
    const state = firstStepsState();
    state.loop.phaseLog = [
      {
        loop: 1,
        day: 1,
        phase: "P6_GOODWILL",
        kind: "goodwillUsed",
        character: "alien",
        rank: 4,
        abilityIndex: 0,
        response: "resolve",
        effectApplied: true,
        publicChanges: [{
          kind: "status",
          character: "boyStudent",
          from: "alive",
          to: "dead",
        }],
      },
      {
        loop: 1,
        day: 1,
        phase: "P7_INCIDENT",
        kind: "incidentJudged",
        incident: "murder",
        culprit: "boyStudent",
        fired: true,
        effectApplied: true,
        failureReasons: [],
      },
    ];

    const observations = collectProtagonistObservations(state);
    expect(observations.some(({ kind }) =>
      kind === "mastermindAbilityResult"
    )).toBe(false);
    expect(evaluateStateRuleHypotheses(state).remaining).toHaveLength(9);
  });

  it("preserves actual bundled combinations through C-3 and C-4 paths", () => {
    const serialState = basicState("basicTragedy:2");
    serialState.gamePhase = "ROUND";
    serialState.loop.phase = "P9_ROUND_END";
    for (const character of Object.keys(serialState.loop.board)) {
      if (isCharacterPresent(serialState.loop.board[character])) {
        setBoardLocation(serialState.loop, character, "School");
      }
    }
    setBoardLocation(serialState.loop, "boyStudent", "City");
    setBoardLocation(serialState.loop, "shrineMaiden", "City");
    resolveHooks(serialState, "P9_ROUND_END");
    expect(collectProtagonistObservations(serialState)).toContainEqual(
      expect.objectContaining({
        kind: "mastermindAbilityResult",
        timing: "P9_ROUND_END",
      }),
    );
    expect(evaluateStateRuleHypotheses(serialState).remaining).toHaveLength(30);
    expect(actualCombinationRemains(serialState)).toBe(true);

    const killerState = basicState("basicTragedy:4");
    killerState.gamePhase = "ROUND";
    killerState.loop.phase = "P9_ROUND_END";
    for (const character of Object.keys(killerState.loop.board)) {
      if (isCharacterPresent(killerState.loop.board[character])) {
        setBoardLocation(killerState.loop, character, "School");
      }
    }
    for (const character of ["classRep", "informer", "shrineMaiden"]) {
      setBoardLocation(killerState.loop, character, "City");
    }
    killerState.loop.charCounters.informer.intrigue = 2;
    const killer = collectHooks(killerState, "P9_ROUND_END").find(
      ({ self, hook }) => self === "classRep" && hook.kind === "optional",
    );
    if (killer === undefined) throw new Error("missing killer hook");
    expect(killer.hook.when(killerState, killer.self)).toBe(true);
    applyHookEffect(
      killerState,
      "P9_ROUND_END",
      killer.hook,
      killer.self,
    );
    expect(evaluateStateRuleHypotheses(killerState).remaining).toHaveLength(21);
    expect(actualCombinationRemains(killerState)).toBe(true);

    const friendState = basicState("basicTragedy:6");
    friendState.gamePhase = "ROUND";
    setBoardLife(friendState.loop, "classRep", false);
    resolveHooks(friendState, "LOOP_END");
    friendState.history.push(structuredClone(friendState.loop));
    friendState.loop = initLoop(friendState.scenario, 2);
    resolveHooks(friendState, "LOOP_START");
    expect(friendState.loop.charCounters.classRep.goodwill).toBe(1);
    expect(evaluateStateRuleHypotheses(friendState).remaining).toHaveLength(55);
    expect(actualCombinationRemains(friendState)).toBe(true);

    const cultistState = basicState("basicTragedy:7");
    cultistState.gamePhase = "ROUND";
    cultistState.loop.phase = "P4_RESOLVE";
    setBoardLocation(cultistState.loop, "richStudent", "City");
    setBoardLocation(cultistState.loop, "classRep", "City");
    const cultist = collectHooks(cultistState, "P4_RESOLVE").find(
      ({ self }) => self === "richStudent",
    );
    if (cultist === undefined) throw new Error("missing cultist hook");
    applyHookEffect(
      cultistState,
      "P4_RESOLVE",
      cultist.hook,
      cultist.self,
    );
    const cultistTarget = {
      kind: "character" as const,
      id: "classRep",
    };
    const cultistCards: PlacedCard[] = [
      { owner: 0, card: "forbidIntrigue", target: cultistTarget },
      {
        owner: "mastermind",
        card: "intriguePlus1",
        target: cultistTarget,
      },
    ];
    cultistState.loop.placed = cultistCards;
    const beforeCultistCards = structuredClone(cultistState.loop);
    resolveActions(cultistState);
    recordPhaseLog(cultistState, {
      loop: 1,
      day: 1,
      phase: "P4_RESOLVE",
      kind: "actionResolved",
      results: [],
      placements: cultistCards,
      publicContext: publicObservationContext(beforeCultistCards),
      publicChanges: publicBoardChanges(
        beforeCultistCards,
        cultistState.loop,
      ),
    });
    expect(collectProtagonistObservations(cultistState)).toContainEqual(
      expect.objectContaining({ kind: "intrigueForbidIgnored" }),
    );
    expect(evaluateStateRuleHypotheses(cultistState).remaining).toHaveLength(42);
    expect(actualCombinationRemains(cultistState)).toBe(true);
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
