import { describe, expect, it } from "vitest";

import { characterDataOf } from "../src/data";
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
import {
  advanceGame,
  createGameState,
  finishLoop,
} from "../src/engine/game";
import { initLoop } from "../src/engine/setup";
import {
  loadBasicTragedyScenarioCatalog,
  loadFirstStepsScenarioCatalog,
} from "../src/scenario-catalog";
import { effectiveRole, type GameState, type Scenario } from "../src/types";
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

const fullCast = [
  "doctor",
  "patient",
  "girlStudent",
  "officeWorker",
  "informer",
  "boyStudent",
  "classRep",
  "shrineMaiden",
  "richStudent",
];

function roundObservation(
  day: number,
  record: Extract<ProtagonistObservation, { kind: "roundEvidence" }>["record"],
  dead: readonly string[] = [],
  lastDay = false,
): Extract<ProtagonistObservation, { kind: "roundEvidence" }> {
  return {
    kind: "roundEvidence",
    loop: 1,
    record,
    context: {
      locationIntrigue: {
        Hospital: 0,
        Shrine: 0,
        City: 0,
        School: 0,
      },
      characters: Object.fromEntries(fullCast.map((character) => [
        character,
        {
          status: dead.includes(character) ? "dead" : "alive",
          location: "Hospital",
          abilityLocations: ["Hospital"],
          goodwill: 0,
          paranoia: 0,
          intrigue: 0,
        },
      ])),
    },
    lastDay,
    protectedAtRoundEnd: [],
    deathReactions: [],
  };
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

  it("does not confirm a paranoia-3 pair killer as the base serial killer", () => {
    const observation = roundObservation(1, {
      day: 1,
      roundEndPairs: [{
        location: "Hospital",
        characters: ["doctor", "patient"],
        paranoia: [3, 0],
        intrigue: [0, 0],
      }],
      deathBatches: [{
        phase: "P9_ROUND_END",
        characters: ["patient"],
        cityIntrigue: 0,
      }],
    }, ["patient"]);
    const table = buildRolePossibilityTable(
      "basicTragedy",
      fullCast,
      [combination("murderPlan+hiddenFreak+paranoiaVirus")],
      [observation],
    );

    expect(table.cells.doctor.serialKiller.status).toBe("possible");
    expect(table.cells.doctor.person.status).toBe("possible");
  });

  it("propagates a revealed transformed person back to paranoia virus", () => {
    const observation = roundObservation(1, {
      day: 1,
      roundEndPairs: [{
        location: "Hospital",
        characters: ["doctor", "patient"],
        paranoia: [3, 0],
        intrigue: [0, 0],
      }],
      deathBatches: [{
        phase: "P9_ROUND_END",
        characters: ["patient"],
        cityIntrigue: 0,
      }],
    }, ["patient"]);
    const evaluation = evaluateRuleHypotheses(
      "basicTragedy",
      [observation, roleRevealed("doctor", "person")],
      { publicCast: fullCast },
    );

    expect(evaluation.remaining.length).toBeGreaterThan(0);
    expect(evaluation.remaining.every(({ subPlots }) =>
      subPlots.includes("paranoiaVirus")
    )).toBe(true);
  });

  it("keeps only deaths from the immediate-ending phase as key-ability candidates", () => {
    const observation = roundObservation(1, {
      day: 1,
      deathBatches: [
        {
          phase: "P4_RESOLVE",
          characters: ["doctor"],
          cityIntrigue: 0,
        },
        {
          phase: "P6_GOODWILL",
          characters: ["patient"],
          cityIntrigue: 0,
        },
      ],
      immediateLoopEnd: {
        phase: "P6_GOODWILL",
        reason: "effect",
      },
    }, ["doctor", "patient"]);
    const table = buildRolePossibilityTable(
      "basicTragedy",
      fullCast,
      [combination("murderPlan+hiddenFreak+unknownFactor")],
      [observation],
    );
    const candidates = fullCast.filter((character) =>
      table.cells[character]?.keyPerson?.status !== "impossible"
    );

    expect(candidates).toEqual(["patient"]);
    expect(table.cells.doctor.keyPerson.status).toBe("impossible");
    expect(table.cells.patient.keyPerson.status).toBe("confirmed");
  });

  it("propagates no-death pair conditions only after immortality is exhausted", () => {
    const first = roundObservation(1, {
      day: 1,
      roundEndPairs: [{
        location: "Hospital",
        characters: ["doctor", "patient"],
        paranoia: [0, 0],
        intrigue: [0, 0],
      }],
    });
    const second = roundObservation(2, {
      day: 2,
      roundEndPairs: [{
        location: "Hospital",
        characters: ["doctor", "girlStudent"],
        paranoia: [0, 0],
        intrigue: [0, 0],
      }],
    });
    const future = combination("changeOfFuture+hiddenFreak+threadsFate");

    expect(buildRolePossibilityTable(
      "basicTragedy",
      fullCast,
      [future],
      [first],
    ).cells.doctor.serialKiller.status).toBe("possible");
    expect(buildRolePossibilityTable(
      "basicTragedy",
      fullCast,
      [future],
      [first, roleRevealed("patient", "person")],
    ).cells.doctor.serialKiller.status).toBe("impossible");

    const protectedObservation = {
      ...first,
      protectedAtRoundEnd: ["patient"],
    } satisfies Extract<ProtagonistObservation, { kind: "roundEvidence" }>;
    expect(buildRolePossibilityTable(
      "basicTragedy",
      fullCast,
      [future],
      [protectedObservation, roleRevealed("patient", "person")],
    ).cells.doctor.serialKiller.status).toBe("possible");
    expect(buildRolePossibilityTable(
      "basicTragedy",
      fullCast,
      [future],
      [first, second],
    ).cells.doctor.serialKiller.status).toBe("impossible");

    const withCopycat = [...fullCast, "copycat"];
    expect(buildRolePossibilityTable(
      "basicTragedy",
      withCopycat,
      [future],
      [first, second],
    ).cells.doctor.serialKiller.status).toBe("possible");
    const third = roundObservation(3, {
      day: 3,
      roundEndPairs: [{
        location: "Hospital",
        characters: ["doctor", "boyStudent"],
        paranoia: [0, 0],
        intrigue: [0, 0],
      }],
    });
    expect(buildRolePossibilityTable(
      "basicTragedy",
      withCopycat,
      [future],
      [first, second, third],
    ).cells.doctor.serialKiller.status).toBe("impossible");
  });

  it("replays the first-day serial-killer versus Factor immediate loss", () => {
    const scenario: Scenario = {
      tragedySet: "basicTragedy",
      mainPlot: "murderPlan",
      subPlots: ["hiddenFreak", "unknownFactor"],
      cast: {
        doctor: "serialKiller",
        patient: "factor",
        girlStudent: "keyPerson",
        officeWorker: "killer",
        informer: "brain",
        boyStudent: "friend",
        classRep: "person",
        shrineMaiden: "person",
        richStudent: "person",
      },
      incidents: [],
      loops: 2,
      daysPerLoop: 3,
    };
    const state = createGameState(scenario);
    state.gamePhase = "ROUND";
    state.loop.phase = "P9_ROUND_END";
    for (const character of Object.keys(state.scenario.cast)) {
      setBoardLocation(state.loop, character, "School");
    }
    setBoardLocation(state.loop, "doctor", "Hospital");
    setBoardLocation(state.loop, "patient", "Hospital");
    state.loop.locIntrigue.City = 2;

    advanceGame(state);
    expect(state.loop.board.patient.status).toBe("dead");
    expect(state.loopOutcomes[0]?.reason).toBe("effect");

    const evaluation = evaluateRoleTableHypotheses(
      "basicTragedy",
      Object.keys(scenario.cast),
      collectProtagonistObservations(state),
    );
    expect(evaluation.table.cells.doctor.serialKiller.status).toBe(
      "confirmed",
    );
    expect(evaluation.table.cells.patient.keyPerson.status).toBe("possible");
    expect(evaluation.table.cells.patient.factor.status).toBe("possible");
    for (const [character, role] of Object.entries(scenario.cast)) {
      expect(
        evaluation.table.cells[character]?.[role]?.status,
        `${character}=${role}`,
      ).not.toBe("impossible");
    }
  });

  it("uses death and an unblocked round completion to exclude mandatory roles", () => {
    const observation = roundObservation(1, {
      day: 1,
      deathBatches: [{
        phase: "P4_RESOLVE",
        characters: ["doctor"],
        cityIntrigue: 2,
        aliveAfterDeaths: fullCast.filter((character) =>
          character !== "doctor"
        ),
      }],
      roundEndPairs: [],
    }, ["doctor"]);
    const table = buildRolePossibilityTable(
      "basicTragedy",
      fullCast,
      [
        combination("murderPlan+loveAffair+unknownFactor"),
        combination("changeOfFuture+loveAffair+unknownFactor"),
      ],
      [observation],
    );

    expect(table.cells.doctor.timeTraveler.status).toBe("impossible");
    expect(table.cells.doctor.keyPerson.status).toBe("impossible");
    expect(table.cells.doctor.factor.status).toBe("impossible");
    expect(table.cells.doctor.lover.status).toBe("impossible");
    expect(table.cells.doctor.lovedOne.status).toBe("impossible");
  });

  it("excludes immortality after a goodwill forbid actually applies", () => {
    const table = buildRolePossibilityTable(
      "basicTragedy",
      fullCast,
      [combination("changeOfFuture+hiddenFreak+threadsFate")],
      [{
        kind: "goodwillForbidApplied",
        loop: 1,
        day: 1,
        character: "patient",
      }],
    );

    expect(table.cells.patient.timeTraveler.status).toBe("impossible");
  });

  it("keeps an absent character available outside the observation that it missed", () => {
    const observation: ProtagonistObservation = {
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
            status: "absent",
            goodwill: 0,
            paranoia: 0,
            intrigue: 0,
          },
          patient: {
            status: "alive",
            location: "Hospital",
            abilityLocations: ["Hospital"],
            goodwill: 0,
            paranoia: 0,
            intrigue: 0,
          },
        },
      },
    };
    const table = buildRolePossibilityTable(
      "firstSteps",
      ["doctor", "patient", "copycat"],
      [combination("murderPlan+shadowRipper")],
      [observation],
    );

    expect(table.cells.doctor.brain.status).toBe("possible");
    expect(table.cells.patient.brain.status).toBe("possible");
  });

  it("excludes threads of fate after its mandatory loop-start change is absent", () => {
    const observation: ProtagonistObservation = {
      kind: "mandatoryEffectMissing",
      loop: 2,
      day: 1,
      effect: "threadsFate",
      character: "doctor",
    };
    const evaluation = evaluateRuleHypotheses(
      "basicTragedy",
      [observation],
      { publicCast: fullCast },
    );

    expect(evaluation.remaining.some(({ subPlots }) =>
      subPlots.includes("threadsFate")
    )).toBe(false);
  });
});

describe("role table to rule propagation", () => {
  it("keeps every bundled script's actual role assignment possible", () => {
    const catalog = [
      ...loadFirstStepsScenarioCatalog(),
      ...loadBasicTragedyScenarioCatalog(),
    ];
    for (const { id, scenario } of catalog) {
      const state = createGameState(scenario);
      const evaluation = evaluateRoleTableHypotheses(
        scenario.tragedySet,
        Object.keys(scenario.cast),
        [],
      );
      for (const character of Object.keys(scenario.cast)) {
        const role = effectiveRole(state, character);
        // 일부 공식 각본의 plot-less 캐릭터 `person`은 실제 역할 미지정
        // 자리표시자다. 공개 후보표가 추정할 수 있는 실제 배정만 검사한다.
        if (role === "person" && characterDataOf(character).plotLessRole) {
          continue;
        }
        expect(
          evaluation.table.cells[character]?.[role]?.status,
          `${id}: ${character}=${role}`,
        ).not.toBe("impossible");
      }
    }
  });

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

describe("friend loop-start goodwill observations", () => {
  const revealedBeforeLoopStart = {
    ...roleRevealed("doctor", "person", false),
    loop: 1,
  };

  it("confirms friend from the mandatory +1 goodwill after an earlier reveal", () => {
    const observation: ProtagonistObservation = {
      kind: "mastermindAbilityResult",
      loop: 2,
      day: 1,
      timing: "LOOP_START",
      changes: [{
        kind: "counter",
        target: { kind: "character", id: "doctor" },
        counter: "goodwill",
        delta: 1,
      }],
    };
    const table = buildRolePossibilityTable(
      "basicTragedy",
      fullCast,
      enumerateRuleCombinations("basicTragedy"),
      [revealedBeforeLoopStart, observation],
    );

    expect(table.cells.doctor.friend).toMatchObject({
      status: "confirmed",
      reasons: [{ code: "friendLoopStartGoodwill", observation }],
    });
  });

  it("does not infer friend from loop-start goodwill without an earlier reveal", () => {
    const observation: ProtagonistObservation = {
      kind: "mastermindAbilityResult",
      loop: 2,
      day: 1,
      timing: "LOOP_START",
      changes: [{
        kind: "counter",
        target: { kind: "character", id: "doctor" },
        counter: "goodwill",
        delta: 1,
      }],
    };
    const table = buildRolePossibilityTable(
      "basicTragedy",
      fullCast,
      enumerateRuleCombinations("basicTragedy"),
      [observation],
    );

    expect(table.cells.doctor.friend.status).toBe("possible");
  });

  it("excludes friend when its mandatory goodwill is absent after a reveal", () => {
    const observation: ProtagonistObservation = {
      kind: "mandatoryEffectMissing",
      loop: 2,
      day: 1,
      effect: "friend",
      character: "doctor",
    };
    const table = buildRolePossibilityTable(
      "basicTragedy",
      fullCast,
      enumerateRuleCombinations("basicTragedy"),
      [revealedBeforeLoopStart, observation],
    );

    expect(table.cells.doctor.friend).toMatchObject({
      status: "impossible",
      reasons: [{ code: "friendLoopStartGoodwillMissing", observation }],
    });
  });

  it("collects the missing mandatory effect after any earlier reveal path", () => {
    const scenario: Scenario = {
      tragedySet: "basicTragedy",
      mainPlot: "murderPlan",
      subPlots: ["circleFriends"],
      cast: { doctor: "person", girlStudent: "friend" },
      incidents: [],
      loops: 2,
      daysPerLoop: 5,
    };
    const state = createGameState(scenario);
    state.history.push({
      ...structuredClone(state.loop),
      revealedRoleCharacters: ["doctor"],
    });
    state.loop = initLoop(scenario, 2);
    state.gamePhase = "ROUND";

    expect(collectProtagonistObservations(state)).toContainEqual(
      expect.objectContaining({
        kind: "mandatoryEffectMissing",
        loop: 2,
        effect: "friend",
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
