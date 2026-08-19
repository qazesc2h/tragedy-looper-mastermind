import { describe, expect, it } from "vitest";

import {
  buildRolePossibilityTable,
  collectProtagonistObservations,
  enumerateRuleCombinations,
  evaluateRoleTableHypotheses,
  evaluateRuleHypotheses,
  type ProtagonistObservation,
  type RuleCombination,
} from "../src/engine/hypothesis";
import { attemptProtagonistDeath, reviveCharacter } from "../src/engine/death";
import { applyHookEffect, collectHooks } from "../src/engine/phases";
import { createGameState, finishLoop } from "../src/engine/game";
import { initLoop } from "../src/engine/setup";
import { loadFirstStepsScenarioCatalog } from "../src/scenario-catalog";
import type { GameState, Scenario } from "../src/types";
import { setBoardLife, setBoardLocation } from "./helpers";

function combination(id: string): RuleCombination {
  const found = [
    ...enumerateRuleCombinations("firstSteps"),
    ...enumerateRuleCombinations("basicTragedy"),
  ].find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing combination ${id}`);
  return found;
}

function roleRevealed(
  character: string,
  role: string,
  confirmed = true,
): Extract<ProtagonistObservation, { kind: "roleRevealed" }> {
  return { kind: "roleRevealed", loop: 1, character, role, confirmed };
}

describe("role possibility table", () => {
  it("removes columns that no remaining rule combination supplies", () => {
    const withoutLoveAffair = enumerateRuleCombinations("basicTragedy")
      .filter(({ subPlots }) => !subPlots.includes("loveAffair"));
    const table = buildRolePossibilityTable(
      "basicTragedy",
      ["doctor", "girlStudent"],
      withoutLoveAffair,
      [],
    );

    expect(table.roles).toContain("person");
    expect(table.roles).not.toContain("lover");
    expect(table.roles).not.toContain("lovedOne");
  });

  it("applies active-rule and person exclusions to an outsider", () => {
    const table = buildRolePossibilityTable(
      "firstSteps",
      [
        "mysteryBoy",
        "doctor",
        "patient",
        "girlStudent",
        "shrineMaiden",
        "boyStudent",
      ],
      [combination("murderPlan+unsettlingRumor")],
      [],
    );

    for (const role of [
      "person",
      "keyPerson",
      "killer",
      "brain",
      "conspiracyTheorist",
    ]) {
      expect(table.cells.mysteryBoy[role].status).toBe("impossible");
    }
    expect(table.cells.doctor.person.status).toBe("possible");
    expect(table.cells.doctor.brain.status).toBe("possible");
  });

  it("confirms a revealed role and closes every other role in that row", () => {
    const revealed = roleRevealed("doctor", "keyPerson");
    const table = buildRolePossibilityTable(
      "firstSteps",
      ["doctor", "girlStudent", "shrineMaiden"],
      [combination("murderPlan+unsettlingRumor")],
      [revealed],
    );

    expect(table.cells.doctor.keyPerson).toMatchObject({
      status: "confirmed",
      reasons: [{ code: "roleRevealed", observation: revealed }],
    });
    expect(table.cells.doctor.brain).toMatchObject({
      status: "impossible",
      reasons: [{ code: "otherRoleConfirmed", observation: revealed }],
    });
  });

  it("closes the same role elsewhere when its maximum is confirmed", () => {
    const table = buildRolePossibilityTable(
      "firstSteps",
      ["doctor", "girlStudent", "shrineMaiden"],
      [combination("murderPlan+unsettlingRumor")],
      [roleRevealed("doctor", "keyPerson")],
    );

    expect(table.cells.girlStudent.keyPerson).toMatchObject({
      status: "impossible",
      reasons: [{
        code: "roleMaximumReached",
        maximum: 1,
        confirmedCharacters: ["doctor"],
      }],
    });
    expect(table.cells.shrineMaiden.keyPerson.status).toBe("impossible");
  });

  it("does not treat an inexact legacy reveal as confirmation", () => {
    const table = buildRolePossibilityTable(
      "firstSteps",
      ["doctor", "girlStudent"],
      [combination("murderPlan+unsettlingRumor")],
      [roleRevealed("doctor", "keyPerson", false)],
    );

    expect(table.cells.doctor.keyPerson.status).toBe("possible");
    expect(table.cells.girlStudent.keyPerson.status).toBe("possible");
  });

  it("keeps only goodwill-refusal roles after an actual refusal", () => {
    const observation: ProtagonistObservation = {
      kind: "goodwillRefused",
      loop: 1,
      day: 1,
      character: "doctor",
      rank: 2,
      abilityIndex: 0,
    };
    const table = buildRolePossibilityTable(
      "basicTragedy",
      ["doctor", "girlStudent"],
      enumerateRuleCombinations("basicTragedy"),
      [observation],
    );

    expect(table.cells.doctor.person.status).toBe("impossible");
    expect(table.cells.doctor.killer.status).toBe("possible");
    expect(table.cells.doctor.brain.status).toBe("possible");
    expect(table.cells.doctor.factor.status).toBe("possible");
    expect(table.cells.doctor.cultist.status).toBe("possible");
    expect(table.cells.doctor.witch.status).toBe("possible");
  });

  it("excludes only mandatory refusal roles after a refusable ability resolves", () => {
    const observation: ProtagonistObservation = {
      kind: "goodwillAccepted",
      loop: 1,
      day: 1,
      character: "doctor",
      rank: 2,
      abilityIndex: 0,
    };
    const table = buildRolePossibilityTable(
      "basicTragedy",
      ["doctor", "girlStudent"],
      enumerateRuleCombinations("basicTragedy"),
      [observation],
    );

    expect(table.cells.doctor.cultist.status).toBe("impossible");
    expect(table.cells.doctor.witch.status).toBe("impossible");
    expect(table.cells.doctor.killer.status).toBe("possible");
    expect(table.cells.doctor.brain.status).toBe("possible");
    expect(table.cells.doctor.person.status).toBe("possible");
  });

  it("intersects repeated location ability observations and confirms one brain", () => {
    const observation = (
      loop: number,
      doctorLocation: "Hospital" | "School",
      patientLocation: "Hospital" | "School",
    ): ProtagonistObservation => ({
      kind: "mastermindAbilityResult",
      loop,
      day: 1,
      timing: "P5_MASTERMIND_ABILITY",
      changes: [{
        kind: "counter",
        target: { kind: "location", at: "Hospital" },
        counter: "intrigue",
        delta: 1,
      }],
      context: {
        locationIntrigue: {
          Hospital: 0,
          Shrine: 0,
          City: 0,
          School: 0,
        },
        characters: {
          doctor: {
            status: "alive",
            location: doctorLocation,
            abilityLocations: [doctorLocation],
            goodwill: 0,
            paranoia: 0,
            intrigue: 0,
          },
          patient: {
            status: "alive",
            location: patientLocation,
            abilityLocations: [patientLocation],
            goodwill: 0,
            paranoia: 0,
            intrigue: 0,
          },
        },
      },
    });
    const table = buildRolePossibilityTable(
      "firstSteps",
      ["doctor", "patient"],
      [combination("murderPlan+shadowRipper")],
      [
        observation(1, "Hospital", "Hospital"),
        observation(2, "Hospital", "School"),
      ],
    );

    expect(table.cells.doctor.brain.status).toBe("confirmed");
    expect(table.cells.doctor.person.status).toBe("impossible");
    expect(table.cells.patient.brain).toMatchObject({
      status: "impossible",
      reasons: [{ code: "abilityLocationIntersection" }],
    });
  });

  it("does not constrain brain locations while unsettling rumor remains", () => {
    const table = buildRolePossibilityTable(
      "firstSteps",
      ["doctor", "patient"],
      [
        combination("murderPlan+shadowRipper"),
        combination("murderPlan+unsettlingRumor"),
      ],
      [{
        kind: "mastermindAbilityResult",
        loop: 1,
        day: 1,
        timing: "P5_MASTERMIND_ABILITY",
        changes: [{
          kind: "counter",
          target: { kind: "location", at: "Hospital" },
          counter: "intrigue",
          delta: 1,
        }],
        context: {
          locationIntrigue: {
            Hospital: 0,
            Shrine: 0,
            City: 0,
            School: 0,
          },
          characters: {
            doctor: {
              status: "alive",
              location: "Hospital",
              goodwill: 0,
              paranoia: 0,
              intrigue: 0,
            },
            patient: {
              status: "alive",
              location: "School",
              goodwill: 0,
              paranoia: 0,
              intrigue: 0,
            },
          },
        },
      }],
    );

    expect(table.cells.doctor.brain.status).toBe("possible");
    expect(table.cells.patient.brain.status).toBe("possible");
  });

  it("propagates row singletons and role maxima to a fixed point", () => {
    const table = buildRolePossibilityTable(
      "firstSteps",
      ["doctor", "patient", "girlStudent", "shrineMaiden"],
      [combination("lightAvenger+shadowRipper")],
      [
        {
          kind: "goodwillRefused",
          loop: 1,
          day: 1,
          character: "doctor",
          rank: 2,
          abilityIndex: 0,
        },
        roleRevealed("girlStudent", "conspiracyTheorist"),
        roleRevealed("shrineMaiden", "serialKiller"),
      ],
    );

    expect(table.cells.doctor.brain).toMatchObject({
      status: "confirmed",
      reasons: expect.arrayContaining([{ code: "onlyRemainingRole" }]),
    });
    expect(table.cells.patient.brain).toMatchObject({
      status: "impossible",
      reasons: expect.arrayContaining([{
        code: "roleMaximumReached",
        maximum: 1,
        confirmedCharacters: ["doctor"],
      }]),
    });
    expect(table.cells.patient.person).toMatchObject({
      status: "confirmed",
      reasons: expect.arrayContaining([{ code: "onlyRemainingRole" }]),
    });
  });

  it("confirms the sole candidate for a role required by every remaining rule", () => {
    const observation: ProtagonistObservation = {
      kind: "goodwillAccepted",
      loop: 1,
      day: 1,
      character: "doctor",
      rank: 2,
      abilityIndex: 0,
    };
    const table = buildRolePossibilityTable(
      "firstSteps",
      ["doctor", "girlStudent"],
      [combination("placeProtect+unsettlingRumor")],
      [observation],
    );

    expect(table.cells.doctor.cultist.status).toBe("impossible");
    expect(table.cells.girlStudent.cultist).toMatchObject({
      status: "confirmed",
      reasons: expect.arrayContaining([{
        code: "requiredRoleForcedCandidate",
        minimum: 1,
      }]),
    });
  });

  it("confirms the last friend when a two-friend rule has one confirmed", () => {
    const cast = [
      "doctor",
      "girlStudent",
      "boyStudent",
      "classRep",
      "shrineMaiden",
      "patient",
      "officeWorker",
      "informer",
      "richStudent",
    ];
    const observations: ProtagonistObservation[] = [
      roleRevealed("doctor", "friend"),
      ...cast.filter((character) =>
        character !== "doctor" && character !== "girlStudent"
      ).map((character): ProtagonistObservation => ({
        kind: "deadAtLoopEndWithoutRoleReveal",
        loop: 1,
        character,
      })),
    ];
    const table = buildRolePossibilityTable(
      "basicTragedy",
      cast,
      [combination("murderPlan+circleFriends+threadsFate")],
      observations,
    );

    expect(table.cells.girlStudent.friend).toMatchObject({
      status: "confirmed",
      reasons: expect.arrayContaining([{
        code: "requiredRoleForcedCandidate",
        minimum: 2,
      }]),
    });
  });

  it("confirms a lone self-targeting conspiracy theorist through the real P5 path", () => {
    const prevailing = loadFirstStepsScenarioCatalog().find(
      ({ rawTitle }) => rawTitle === "Prevailing Secrecy",
    );
    if (prevailing === undefined) throw new Error("missing Prevailing Secrecy");
    const state = createGameState(structuredClone(prevailing.scenario));
    state.gamePhase = "ROUND";
    state.loop.phase = "P5_MASTERMIND_ABILITY";
    for (const character of Object.keys(state.scenario.cast)) {
      setBoardLocation(state.loop, character, "School");
    }
    setBoardLocation(state.loop, "shrineMaiden", "Shrine");
    const hook = collectHooks(state, "P5_MASTERMIND_ABILITY").find(
      ({ self }) => self === "shrineMaiden",
    );
    if (hook === undefined) throw new Error("missing shrine maiden P5 hook");

    applyHookEffect(
      state,
      "P5_MASTERMIND_ABILITY",
      hook.hook,
      hook.self,
      { kind: "character", id: "shrineMaiden" },
    );

    expect(state.loop.charCounters.shrineMaiden.paranoia).toBe(1);
    const evaluation = evaluateRoleTableHypotheses(
      "firstSteps",
      Object.keys(state.scenario.cast),
      collectProtagonistObservations(state),
    );
    expect(evaluation.table.cells.shrineMaiden.conspiracyTheorist).toMatchObject({
      status: "confirmed",
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "abilityLocationIntersection" }),
      ]),
    });
  });

  it("keeps Factor as an alternative to a paranoia-placement location", () => {
    const observation: ProtagonistObservation = {
      kind: "mastermindAbilityResult",
      loop: 1,
      day: 1,
      timing: "P5_MASTERMIND_ABILITY",
      changes: [{
        kind: "counter",
        target: { kind: "character", id: "shrineMaiden" },
        counter: "paranoia",
        delta: 1,
      }],
      context: {
        locationIntrigue: {
          Hospital: 0,
          Shrine: 0,
          City: 0,
          School: 2,
        },
        characters: {
          shrineMaiden: {
            status: "alive",
            location: "Shrine",
            goodwill: 0,
            paranoia: 0,
            intrigue: 0,
          },
          doctor: {
            status: "alive",
            location: "School",
            goodwill: 0,
            paranoia: 0,
            intrigue: 0,
          },
        },
      },
    };
    const table = buildRolePossibilityTable(
      "basicTragedy",
      ["shrineMaiden", "doctor"],
      [combination("murderPlan+paranoiaVirus+unknownFactor")],
      [observation],
    );

    expect(table.cells.shrineMaiden.conspiracyTheorist.status).toBe(
      "possible",
    );
  });
});

describe("role table to rule propagation", () => {
  it("keeps the existing 9 and 105 rule spaces without table evidence", () => {
    const cast = [
      "boyStudent",
      "girlStudent",
      "classRep",
      "shrineMaiden",
      "doctor",
      "patient",
      "officeWorker",
      "informer",
      "richStudent",
    ];

    expect(evaluateRoleTableHypotheses(
      "firstSteps",
      cast,
      [],
    ).remaining).toHaveLength(9);
    expect(evaluateRoleTableHypotheses(
      "basicTragedy",
      cast,
      [],
    ).remaining).toHaveLength(105);
  });

  it("excludes a rule when none of the characters can hold a required role", () => {
    const observations: ProtagonistObservation[] = [
      {
        kind: "subplotRevealed",
        loop: 1,
        declaredSubplot: "shadowRipper",
        revealedSubplot: "unsettlingRumor",
      },
      roleRevealed("mysteryBoy", "cultist"),
      roleRevealed("doctor", "person"),
    ];
    const rulesOnly = evaluateRuleHypotheses(
      "firstSteps",
      observations,
    );
    const evaluation = evaluateRoleTableHypotheses(
      "firstSteps",
      ["mysteryBoy", "doctor"],
      observations,
    );

    expect(rulesOnly.remaining.map(({ mainPlot }) => mainPlot)).toEqual([
      "murderPlan",
      "lightAvenger",
    ]);
    expect(evaluation.remaining).toEqual([]);
    expect(evaluation.propagationPasses).toBe(2);
    expect(evaluation.excluded.filter(({ tableContradictions }) =>
      tableContradictions.some(({ code, role }) =>
        code === "requiredRoleUnavailable" && role === "brain"
      )
    )).toHaveLength(2);
  });

  it("uses confirmed counts to reject only combinations with a lower maximum", () => {
    const observations = [
      roleRevealed("doctor", "friend"),
      roleRevealed("girlStudent", "friend"),
    ];
    const evaluation = evaluateRoleTableHypotheses(
      "basicTragedy",
      [
        "doctor",
        "girlStudent",
        "shrineMaiden",
        "boyStudent",
        "classRep",
        "patient",
        "officeWorker",
        "informer",
        "richStudent",
      ],
      observations,
    );

    expect(evaluation.remaining.length).toBeGreaterThan(0);
    expect(evaluation.remaining.every(({ subPlots }) =>
      subPlots.includes("circleFriends")
    )).toBe(true);
    expect(evaluation.excluded.some(({ tableContradictions }) =>
      tableContradictions.some((contradiction) =>
        contradiction.code === "confirmedRoleCountExceedsMaximum" &&
        contradiction.role === "friend" &&
        contradiction.maximum === 1
      )
    )).toBe(true);
  });

  it("does not require optional zero-minimum roles", () => {
    const observations: ProtagonistObservation[] = [
      {
        kind: "subplotRevealed",
        loop: 1,
        declaredSubplot: "shadowRipper",
        revealedSubplot: "hideousScript",
      },
      roleRevealed("doctor", "person"),
      roleRevealed("girlStudent", "person"),
    ];
    const evaluation = evaluateRoleTableHypotheses(
      "firstSteps",
      ["doctor", "girlStudent"],
      observations,
    );

    expect(evaluation.excluded.every(({ tableContradictions }) =>
      tableContradictions.every(({ role }) => role !== "curmudgeon")
    )).toBe(true);
  });

  it("uses required role cardinality without excluding a one-friend rule", () => {
    const observation: ProtagonistObservation = {
      kind: "deadAtLoopEndWithoutRoleReveal",
      loop: 1,
      character: "doctor",
    };
    const evaluation = evaluateRoleTableHypotheses(
      "basicTragedy",
      ["doctor", "girlStudent"],
      [observation],
    );

    expect(evaluation.table.cells.doctor.friend).toMatchObject({
      status: "impossible",
      reasons: [{ code: "loopEndRoleRevealMissing", observation }],
    });
    expect(evaluation.remaining.some(({ subPlots }) =>
      subPlots.includes("circleFriends")
    )).toBe(false);
    expect(evaluation.remaining.some(({ subPlots }) =>
      subPlots.includes("hiddenFreak")
    )).toBe(true);
  });
});

describe("loop-end friend non-reveal observations", () => {
  function friendScenario(): Scenario {
    return {
      tragedySet: "basicTragedy",
      mainPlot: "murderPlan",
      subPlots: ["circleFriends", "threadsFate"],
      cast: {
        doctor: "person",
        girlStudent: "friend",
        boyStudent: "friend",
      },
      incidents: [],
      loops: 2,
      daysPerLoop: 5,
    };
  }

  it("records a dead non-friend with no reveal after protagonist death ends the loop", () => {
    const state = createGameState(friendScenario());
    state.gamePhase = "ROUND";
    setBoardLife(state.loop, "doctor", false);
    expect(attemptProtagonistDeath(state)).toEqual({ died: true });
    finishLoop(state);

    expect(collectProtagonistObservations(state)).toContainEqual(expect.objectContaining({
      kind: "deadAtLoopEndWithoutRoleReveal",
      loop: 1,
      character: "doctor",
    }));
  });

  it("still reveals a dead friend when protagonist death ended the loop", () => {
    const state = createGameState(friendScenario());
    state.gamePhase = "ROUND";
    setBoardLife(state.loop, "girlStudent", false);
    attemptProtagonistDeath(state);
    finishLoop(state);

    const observations = collectProtagonistObservations(state);
    expect(observations).toContainEqual(expect.objectContaining({
      kind: "roleRevealed",
      character: "girlStudent",
      role: "friend",
      confirmed: true,
    }));
    expect(observations).not.toContainEqual(expect.objectContaining({
      kind: "deadAtLoopEndWithoutRoleReveal",
      character: "girlStudent",
    }));
  });

  it("uses only the final living state after a revival", () => {
    const state = createGameState(friendScenario());
    state.gamePhase = "ROUND";
    setBoardLife(state.loop, "doctor", false);
    expect(reviveCharacter(state, "doctor")).toBe(true);
    attemptProtagonistDeath(state);
    finishLoop(state);

    expect(collectProtagonistObservations(state)).not.toContainEqual(
      expect.objectContaining({
        kind: "deadAtLoopEndWithoutRoleReveal",
        character: "doctor",
      }),
    );
  });
});

describe("goodwill acceptance observations", () => {
  it("ignores outsider and nurse abilities that cannot be refused", () => {
    const scenario: Scenario = {
      tragedySet: "basicTragedy",
      mainPlot: "murderPlan",
      subPlots: ["circleFriends", "loveAffair"],
      cast: {
        mysteryBoy: "curmudgeon",
        nurse: "person",
        doctor: "person",
      },
      incidents: [],
      loops: 1,
      daysPerLoop: 5,
    };
    const loop = initLoop(scenario);
    loop.phaseLog = [
      {
        loop: 1,
        day: 1,
        phase: "P6_GOODWILL",
        kind: "goodwillUsed",
        character: "mysteryBoy",
        rank: 3,
        abilityIndex: 1,
        response: "resolve",
        effectApplied: true,
      },
      {
        loop: 1,
        day: 1,
        phase: "P6_GOODWILL",
        kind: "goodwillUsed",
        character: "nurse",
        rank: 2,
        abilityIndex: 0,
        response: "resolve",
        effectApplied: true,
      },
      {
        loop: 1,
        day: 1,
        phase: "P6_GOODWILL",
        kind: "goodwillUsed",
        character: "doctor",
        rank: 2,
        abilityIndex: 0,
        response: "resolve",
        effectApplied: true,
      },
    ];
    const state: GameState = {
      scenario,
      gamePhase: "ROUND",
      loop,
      history: [],
      loopOutcomes: [],
    };

    expect(collectProtagonistObservations(state).filter(
      ({ kind }) => kind === "goodwillAccepted"
    )).toEqual([{
      kind: "goodwillAccepted",
      loop: 1,
      day: 1,
      character: "doctor",
      rank: 2,
      abilityIndex: 0,
    }]);
  });
});
