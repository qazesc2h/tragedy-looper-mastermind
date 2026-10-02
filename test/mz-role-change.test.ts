import { describe, expect, it } from "vitest";

import { killCharacter } from "../src/engine/death";
import {
  expireExtraCards,
  placeExtraCard,
  removeExtraCard,
} from "../src/engine/extra-cards";
import {
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
  settleGameFlow,
} from "../src/engine/game";
import {
  collectProtagonistObservations,
  evaluateRoleTableHypotheses,
  evaluateRuleHypotheses,
  type ProtagonistObservation,
  type RuleCombination,
} from "../src/engine/hypothesis";
import { goodwillResponseAvailability } from "../src/engine/goodwill";
import { distanceToLoss } from "../src/engine/loss";
import { collectHooks } from "../src/engine/phases";
import { resolveRoleReveal } from "../src/engine/role-reveal";
import { initLoop } from "../src/engine/setup";
import { effectiveAbilityRoles } from "../src/impl/roles";
import {
  effectiveRole,
  type CharacterId,
  type ExtraCardInstance,
  type GameState,
  type PublicObservationContext,
  type Scenario,
} from "../src/types";

const BOY = "boyStudent";
const GIRL = "girlStudent";
const DOCTOR = "doctor";
const PATIENT = "patient";

function scenario(fatedConnections = true): Scenario {
  return {
    tragedySet: "basicTragedy",
    mainPlot: "murderPlan",
    subPlots: fatedConnections ? ["fatedConnections"] : [],
    cast: {
      [BOY]: "conspiracyTheorist",
      [GIRL]: "keyPerson",
      [DOCTOR]: "brain",
      [PATIENT]: "person",
    },
    incidents: [],
    loops: 3,
    daysPerLoop: 4,
  };
}

function card(
  instanceId: string,
  sourceId: string,
  target: CharacterId = BOY,
  expiresAt: ExtraCardInstance["expiresAt"] = "loopStart",
): ExtraCardInstance {
  return {
    instanceId,
    cardId: `test-${instanceId}`,
    controller: "mastermind",
    source: { kind: "rule", id: sourceId },
    target: { kind: "character", id: target },
    expiresAt,
  };
}

function state(fatedConnections = true): GameState {
  const configured = scenario(fatedConnections);
  return {
    scenario: configured,
    gamePhase: "ROUND",
    loop: initLoop(configured),
    history: [],
    loopOutcomes: [],
  };
}

function context(
  cards: ExtraCardInstance[] = [],
  dead: readonly CharacterId[] = [],
): PublicObservationContext {
  return {
    locationIntrigue: {
      Hospital: 0,
      Shrine: 0,
      City: 0,
      School: 0,
    },
    extraCards: cards.map(({ source: _source, ...publicCard }) => publicCard),
    characters: Object.fromEntries(
      [BOY, GIRL, DOCTOR, PATIENT].map((character) => [
        character,
        {
          status: dead.includes(character) ? "dead" : "alive",
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

const fatedCombination: RuleCombination = {
  id: "murderPlan+fatedConnections",
  mainPlot: "murderPlan",
  subPlots: ["fatedConnections"],
};

describe("MZ-2 fated-connections role replacement", () => {
  it.each([
    ["fated-connections", "fatedConnections"],
    ["dice-of-gods", "diceOfGods"],
    ["faked-suicide", "fakedSuicide"],
  ])("uses attachment, not the %s card source", (instanceId, sourceId) => {
    const game = state();
    placeExtraCard(game.loop, card(instanceId, sourceId));

    expect(effectiveRole(game, BOY)).toBe("keyPerson");
  });

  it("does not replace the role when fated connections is inactive", () => {
    const game = state(false);
    placeExtraCard(game.loop, card("other-source", "diceOfGods"));

    expect(effectiveRole(game, BOY)).toBe("conspiracyTheorist");
  });

  it("removes the original role abilities while the card is attached", () => {
    const game = state();
    placeExtraCard(game.loop, card("role-change", "fatedConnections"));

    expect(effectiveAbilityRoles(game, BOY)).toEqual(["keyPerson"]);
    expect(collectHooks(game, "P5_MASTERMIND_ABILITY").some(
      ({ self }) => self === BOY,
    )).toBe(false);

    removeExtraCard(game.loop, "role-change");
    expect(effectiveRole(game, BOY)).toBe("conspiracyTheorist");
    expect(effectiveAbilityRoles(game, BOY)).toEqual(["conspiracyTheorist"]);
  });

  it("removes the original role's goodwill refusal while attached", () => {
    const game = state();
    game.scenario.cast[BOY] = "killer";
    expect(goodwillResponseAvailability(game, BOY, false)).toMatchObject({
      role: "killer",
      refusalKind: "optional",
      refuseAllowed: true,
    });

    placeExtraCard(game.loop, card("goodwill-role-change", "diceOfGods"));

    expect(goodwillResponseAvailability(game, BOY, false)).toEqual({
      role: "keyPerson",
      refusalKind: "none",
      resolveAllowed: true,
      refuseAllowed: false,
    });
  });

  it("returns to the base role when loop-start removal expires the card", () => {
    const game = createGameState(scenario());
    chooseInitialLeader(game, 0);
    placeExtraCard(game.loop, card("until-next-loop", "fatedConnections"));
    expect(effectiveRole(game, BOY)).toBe("keyPerson");

    continueFromTimeGap(game);

    expect(game.loop.extraCards).toEqual([]);
    expect(effectiveRole(game, BOY)).toBe("conspiracyTheorist");
    expect(game.loop.phaseLog).toContainEqual(expect.objectContaining({
      kind: "extraCardsExpired",
      timing: "loopStart",
    }));
  });

  it("ends the loop immediately when a replaced key person dies", () => {
    const game = state();
    placeExtraCard(game.loop, card("fatal", "fakedSuicide", BOY, "manual"));

    expect(killCharacter(game, BOY)).toBe(true);
    expect(game.loop.pendingImmediateLossKeys).toContain(
      `role:keyPerson:${BOY}`,
    );
    settleGameFlow(game);

    expect(game.gamePhase).toBe("LOOP_JUDGMENT");
    expect(game.loopOutcomes).toContainEqual(expect.objectContaining({
      result: "protagonistsLost",
      reason: "effect",
    }));
  });

  it("reports the base and replaced key people as separate loss conditions", () => {
    const game = state();
    placeExtraCard(game.loop, card("second-key-person", "diceOfGods"));

    expect(distanceToLoss(game).filter(({ role }) => role === "keyPerson")
      .map(({ character }) => character).sort()).toEqual([BOY, GIRL].sort());
  });

  it("records the effective role and card snapshot at reveal time", () => {
    const game = state();
    placeExtraCard(game.loop, card("revealed", "diceOfGods"));

    expect(resolveRoleReveal(game, BOY)).toBe(true);
    expect(game.loop.roleRevealResolutionsThisLoop).toContainEqual(
      expect.objectContaining({
        character: BOY,
        actualRoleAtReveal: "keyPerson",
        claimedRole: "keyPerson",
      }),
    );
    expect(game.loop.publicInformationThisLoop).toContainEqual(
      expect.objectContaining({
        kind: "roleClaim",
        character: BOY,
        claimedRole: "keyPerson",
        context: expect.objectContaining({
          extraCards: [expect.objectContaining({
            target: { kind: "character", id: BOY },
          })],
        }),
      }),
    );
  });

  it("keeps role-table observations separated before and after replacement", () => {
    const game = state();
    game.scenario.cast[BOY] = "killer";
    expect(resolveRoleReveal(game, BOY)).toBe(true);
    game.history.push(structuredClone(game.loop));

    game.loop = initLoop(game.scenario, 2, game.loop);
    placeExtraCard(game.loop, card("later", "diceOfGods"));
    expect(resolveRoleReveal(game, BOY)).toBe(true);

    const observations = collectProtagonistObservations(game);
    const evaluation = evaluateRoleTableHypotheses(
      "basicTragedy",
      [BOY, GIRL, DOCTOR, PATIENT],
      observations,
      [fatedCombination],
    );

    expect(observations.filter((observation) =>
      observation.kind === "roleRevealed" && observation.character === BOY
    ).map((observation) => observation.kind === "roleRevealed"
      ? observation.role
      : undefined)).toEqual(["killer", "keyPerson"]);
    expect(evaluation.remaining).toEqual([fatedCombination]);
    expect(evaluation.table.cells[BOY].killer.status).toBe("confirmed");
    expect(evaluation.table.cells[BOY].keyPerson.status).toBe("impossible");
  });

  it("does not count multiple replaced key people against the base-role maximum", () => {
    const observations: ProtagonistObservation[] = [BOY, DOCTOR].map(
      (character, index) => ({
        kind: "roleRevealed",
        loop: 1,
        character,
        role: "keyPerson",
        context: context([
          card(`dynamic-${index}`, "fatedConnections", character, "manual"),
        ]),
      }),
    );

    const evaluation = evaluateRoleTableHypotheses(
      "basicTragedy",
      [BOY, GIRL, DOCTOR, PATIENT],
      observations,
      [fatedCombination],
    );

    expect(evaluation.remaining).toEqual([fatedCombination]);
    expect([BOY, DOCTOR].filter((character) =>
      evaluation.table.cells[character].keyPerson.status === "confirmed"
    )).toEqual([]);
  });

  it("keeps legacy claims conservative when the extra-card snapshot is absent", () => {
    const legacyContext = context();
    delete legacyContext.extraCards;
    const observation: ProtagonistObservation = {
      kind: "roleRevealed",
      loop: 1,
      character: BOY,
      role: "keyPerson",
      context: legacyContext,
    };
    const fatedOnly: RuleCombination = {
      id: "fatedConnections",
      mainPlot: "fatedConnections",
      subPlots: [],
    };

    expect(evaluateRuleHypotheses(
      "basicTragedy",
      [observation],
      {
        publicCast: [BOY, GIRL],
        candidateCombinations: [fatedOnly],
      },
    ).remaining).toEqual([fatedOnly]);
  });

  it("explains an immediate loss without fixing the replaced base role", () => {
    const revealedPerson: ProtagonistObservation = {
      kind: "roleRevealed",
      loop: 1,
      character: BOY,
      role: "person",
      context: context(),
    };
    const loss: ProtagonistObservation = {
      kind: "lossObserved",
      loop: 1,
      day: 2,
      timing: "effect",
      context: {
        ...context([
          card("loss", "fatedConnections", BOY, "manual"),
        ], [BOY]),
        phase: "P9_ROUND_END",
        lastDay: false,
        startingLocations: { [BOY]: "School" },
        firedIncidents: [],
        endingDeathBatches: [{
          phase: "P9_ROUND_END",
          characters: [BOY],
          cityIntrigue: 0,
        }],
      },
    };

    expect(evaluateRuleHypotheses(
      "basicTragedy",
      [revealedPerson, loss],
      {
        publicCast: [BOY, GIRL, DOCTOR, PATIENT],
        candidateCombinations: [fatedCombination],
      },
    ).remaining).toEqual([fatedCombination]);

    const withoutFated = { ...fatedCombination, id: "murderPlan", subPlots: [] };
    expect(evaluateRuleHypotheses(
      "basicTragedy",
      [revealedPerson, loss],
      {
        publicCast: [BOY, GIRL, DOCTOR, PATIENT],
        candidateCombinations: [withoutFated],
      },
    ).remaining).toEqual([]);
  });

  it("keeps the existing lifetime API source-independent", () => {
    const game = state();
    placeExtraCard(game.loop, card("start", "diceOfGods"));
    placeExtraCard(game.loop, card("manual", "fakedSuicide", DOCTOR, "manual"));

    expect(expireExtraCards(game.loop, "loopStart").map(({ instanceId }) =>
      instanceId
    )).toEqual(["start"]);
    expect(effectiveRole(game, BOY)).toBe("conspiracyTheorist");
    expect(effectiveRole(game, DOCTOR)).toBe("keyPerson");
  });
});
