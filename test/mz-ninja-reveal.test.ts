import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { placeExtraCard } from "../src/engine/extra-cards";
import { createGameState } from "../src/engine/game";
import { resolveGoodwillAbility } from "../src/engine/goodwill";
import {
  evaluateRoleTableHypotheses,
  evaluateRuleHypotheses,
  type ProtagonistObservation,
  type RuleCombination,
} from "../src/engine/hypothesis";
import { mastermindCoverGuidance } from "../src/engine/mastermind-cover";
import {
  actualRoleWasRevealed,
  claimedRoleWasRevealed,
  resolveRoleReveal,
  roleClaimOptions,
} from "../src/engine/role-reveal";
import { PLOT_IMPL } from "../src/impl/plots";
import {
  effectiveRole,
  type ExtraCardInstance,
  type GameState,
  type PublicObservationContext,
  type Scenario,
} from "../src/types";

const NINJA = "officeWorker";
const CLAIMED = "girlStudent";
const BRAIN = "doctor";
const PERSON = "patient";
const OTHER = "boyStudent";

const originalMurderPlanRoles = PLOT_IMPL.murderPlan.addsRoles;

beforeAll(() => {
  PLOT_IMPL.murderPlan.addsRoles = {
    ...originalMurderPlanRoles,
    ninja: 1,
  };
});

afterAll(() => {
  PLOT_IMPL.murderPlan.addsRoles = originalMurderPlanRoles;
});

function scenario(subPlots: string[] = []): Scenario {
  return {
    tragedySet: "basicTragedy",
    mainPlot: "murderPlan",
    subPlots,
    cast: {
      [NINJA]: "ninja",
      [CLAIMED]: "keyPerson",
      [BRAIN]: "brain",
      [OTHER]: "killer",
      [PERSON]: "person",
    },
    incidents: [],
    loops: 3,
    daysPerLoop: 4,
  };
}

function state(subPlots: string[] = []): GameState {
  const game = createGameState(scenario(subPlots));
  game.gamePhase = "ROUND";
  game.loop.phase = "P6_GOODWILL";
  game.loop.loop = 2;
  return game;
}

function extraCard(character: string): ExtraCardInstance {
  return {
    instanceId: `card-${character}`,
    cardId: "test-card",
    controller: "mastermind",
    source: { kind: "rule", id: "diceOfGods" },
    target: { kind: "character", id: character },
    expiresAt: "loopStart",
  };
}

function context(
  extraCards: ExtraCardInstance[] = [],
): PublicObservationContext {
  return {
    locationIntrigue: { Hospital: 0, Shrine: 0, City: 0, School: 0 },
    extraCards: extraCards.map(({ source: _source, ...card }) => card),
    characters: Object.fromEntries(
      [NINJA, CLAIMED, BRAIN, OTHER, PERSON].map((character) => [
        character,
        {
          status: "alive",
          location: "School",
          abilityLocations: ["School"],
          goodwill: 0,
          paranoia: 0,
          intrigue: 0,
        },
      ]),
    ),
  };
}

const ninjaCombination: RuleCombination = {
  id: "murderPlan",
  mainPlot: "murderPlan",
  subPlots: [],
};

function reveal(
  role: string,
  observationContext: PublicObservationContext = context(),
): Extract<ProtagonistObservation, { kind: "roleRevealed" }> {
  return {
    kind: "roleRevealed",
    loop: 2,
    character: NINJA,
    role,
    context: observationContext,
    observedAt: { loop: 2, day: 3, phase: "P6_GOODWILL", sequence: 0 },
  };
}

describe("MZ-3 ninja role claims", () => {
  it("offers truth and only other assigned non-Person base roles", () => {
    const game = state(["fatedConnections"]);
    // 동적으로 생긴 핵심 인물은 Q10 후보를 늘리지 않는다.
    game.scenario.cast[CLAIMED] = "person";
    placeExtraCard(game.loop, extraCard(CLAIMED));

    expect(effectiveRole(game, CLAIMED)).toBe("keyPerson");
    expect(roleClaimOptions(game, NINJA)).toEqual([
      { claimedRole: "ninja", result: "truthful" },
      { claimedRole: "brain", result: "ninjaLie" },
      { claimedRole: "killer", result: "ninjaLie" },
    ]);
  });

  it("records truth and lies privately without a public lie marker", () => {
    const truthful = state();
    expect(resolveRoleReveal(truthful, NINJA, "ninja")).toBe(true);
    expect(truthful.loop.roleRevealResolutionsThisLoop).toContainEqual(
      expect.objectContaining({
        character: NINJA,
        actualRoleAtReveal: "ninja",
        claimedRole: "ninja",
        result: "truthful",
      }),
    );

    const lying = state();
    expect(resolveRoleReveal(lying, NINJA, "keyPerson")).toBe(true);
    const claim = lying.loop.publicInformationThisLoop?.find(
      ({ kind }) => kind === "roleClaim",
    );
    expect(claim).toMatchObject({
      kind: "roleClaim",
      character: NINJA,
      claimedRole: "keyPerson",
    });
    expect(claim).not.toHaveProperty("actualRoleAtReveal");
    expect(claim).not.toHaveProperty("result");
    expect(lying.loop.roleRevealResolutionsThisLoop).toContainEqual(
      expect.objectContaining({
        actualRoleAtReveal: "ninja",
        claimedRole: "keyPerson",
        result: "ninjaLie",
      }),
    );
  });

  it("rejects Person, Ninja-as-a-lie, and roles absent from the base cast", () => {
    const game = state();
    expect(() => resolveRoleReveal(game, NINJA, "person")).toThrow(
      /not allowed/,
    );
    expect(() => resolveRoleReveal(game, NINJA, "factor")).toThrow(
      /not allowed/,
    );
  });

  it("cannot lie after fated connections replaces Ninja with Key Person", () => {
    const game = state(["fatedConnections"]);
    placeExtraCard(game.loop, extraCard(NINJA));

    expect(effectiveRole(game, NINJA)).toBe("keyPerson");
    expect(roleClaimOptions(game, NINJA)).toEqual([
      { claimedRole: "keyPerson", result: "truthful" },
    ]);
    expect(() => resolveRoleReveal(game, NINJA, "brain")).toThrow(
      /not allowed/,
    );
  });

  it("threads the selected lie through a goodwill role reveal", () => {
    const game = state();
    game.loop.charCounters[NINJA].goodwill = 3;

    resolveGoodwillAbility(game, {
      user: NINJA,
      rank: 3,
      abilityIndex: 0,
      roleClaim: "killer",
    }, "resolve");

    expect(game.loop.roleRevealResolutionsThisLoop).toContainEqual(
      expect.objectContaining({
        character: NINJA,
        actualRoleAtReveal: "ninja",
        claimedRole: "killer",
        result: "ninjaLie",
      }),
    );
  });

  it("lets Secret Record read the claim while Friend history reads actuality", () => {
    const game = state();
    resolveRoleReveal(game, NINJA, "keyPerson");

    expect(claimedRoleWasRevealed(game, "keyPerson")).toBe(true);
    expect(actualRoleWasRevealed(game, NINJA, "keyPerson")).toBe(false);
    expect(actualRoleWasRevealed(game, NINJA, "ninja")).toBe(true);
  });

  it("keeps both the declared role and Ninja in the role table", () => {
    const observation = reveal("keyPerson");
    const evaluation = evaluateRoleTableHypotheses(
      "basicTragedy",
      [NINJA, CLAIMED, BRAIN, OTHER, PERSON],
      [observation],
      [ninjaCombination],
    );

    expect(evaluation.remaining).toEqual([ninjaCombination]);
    expect(evaluation.table.cells[NINJA].keyPerson.status).toBe("possible");
    expect(evaluation.table.cells[NINJA].ninja.status).toBe("possible");
    expect(evaluation.table.cells[NINJA].ninja.reasons).toContainEqual({
      code: "ninjaLiePossible",
      observation,
    });
  });

  it.each(["person", "ninja"])(
    "treats a %s declaration as truthful only",
    (role) => {
      const evaluation = evaluateRoleTableHypotheses(
        "basicTragedy",
        [NINJA, CLAIMED, BRAIN, OTHER, PERSON],
        [reveal(role)],
        [ninjaCombination],
      );

      expect(evaluation.table.cells[NINJA][role].status).toBe("confirmed");
    },
  );

  it("keeps the old confirmation behavior when Ninja is unavailable", () => {
    const noNinja: RuleCombination = {
      id: "sealedItem",
      mainPlot: "sealedItem",
      subPlots: [],
    };
    const observation: ProtagonistObservation = {
      ...reveal("brain"),
      character: BRAIN,
    };
    const evaluation = evaluateRoleTableHypotheses(
      "basicTragedy",
      [BRAIN, PERSON],
      [observation],
      [noNinja],
    );

    expect(evaluation.table.cells[BRAIN].brain.status).toBe("confirmed");
  });

  it("does not use a transformed Ninja lie when the attached card is known", () => {
    const fatedCombination: RuleCombination = {
      id: "murderPlan+fatedConnections",
      mainPlot: "murderPlan",
      subPlots: ["fatedConnections"],
    };
    const observation = reveal("brain", context([extraCard(NINJA)]));

    expect(evaluateRuleHypotheses("basicTragedy", [observation], {
      publicCast: [NINJA, CLAIMED, BRAIN, OTHER, PERSON],
      candidateCombinations: [fatedCombination],
    }).remaining).toEqual([]);
  });

  it("stays conservative when a legacy claim has no extra-card snapshot", () => {
    const legacyContext = context();
    delete legacyContext.extraCards;
    const fatedCombination: RuleCombination = {
      id: "murderPlan+fatedConnections",
      mainPlot: "murderPlan",
      subPlots: ["fatedConnections"],
    };

    expect(evaluateRuleHypotheses("basicTragedy", [
      reveal("keyPerson", legacyContext),
    ], {
      publicCast: [NINJA, CLAIMED, BRAIN, OTHER, PERSON],
      candidateCombinations: [fatedCombination],
    }).remaining).toEqual([fatedCombination]);
  });

  it("changes cover guidance from certain exposure to a possible lie", () => {
    const game = state();
    const before = mastermindCoverGuidance(game).candidates.find(
      ({ character }) => character === NINJA,
    );
    expect(before?.exposurePaths.some(({ observation }) =>
      observation.includes("닌자의 거짓 공개 가능성은 남는다")
    )).toBe(true);

    resolveRoleReveal(game, NINJA, "killer");
    const after = mastermindCoverGuidance(game).candidates.find(
      ({ character }) => character === NINJA,
    );
    expect(after?.alreadyRevealed).toBe(false);
  });

  it("keeps a truthful non-Ninja claim ambiguous when the script has Ninja", () => {
    const game = state();
    game.scenario.cast[NINJA] = "killer";
    game.scenario.cast[PERSON] = "ninja";
    const before = mastermindCoverGuidance(game).candidates.find(
      ({ character }) => character === NINJA,
    );
    expect(before?.exposurePaths.some(({ observation }) =>
      observation.includes("닌자의 거짓 공개 가능성은 남는다")
    )).toBe(true);

    resolveRoleReveal(game, NINJA, "killer");
    const after = mastermindCoverGuidance(game).candidates.find(
      ({ character }) => character === NINJA,
    );
    expect(after?.alreadyRevealed).toBe(false);
  });
});
