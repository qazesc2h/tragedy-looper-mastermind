import { describe, expect, it } from "vitest";

import { killCharacter } from "../src/engine/death";
import { distanceToLoss } from "../src/engine/loss";
import { validatePlacement } from "../src/engine/legal";
import { goodwillResponseAvailability } from "../src/engine/goodwill";
import {
  collectProtagonistObservations,
  evaluateStateRoleTableHypotheses,
} from "../src/engine/hypothesis";
import { applyHookEffect, collectHooks } from "../src/engine/phases";
import { placeExtraCard } from "../src/engine/extra-cards";
import { publicObservationContext } from "../src/engine/public-observation";
import { IMMORTAL_ROLE_IDS, roleIsImmortal } from "../src/engine/role-properties";
import { initLoop } from "../src/engine/setup";
import { validateScenario } from "../src/engine/validate";
import {
  effectiveGoodwillRefusal,
  ROLE_IMPL,
  zombieRoleAbilityActive,
} from "../src/impl/roles";
import {
  effectiveRole,
  startLocationOf,
  type GameState,
  type RoleId,
  type Scenario,
} from "../src/types";
import {
  boardIsAlive,
  boardLocation,
  setBoardLife,
  setBoardLocation,
} from "./helpers";

function primeState(
  mainPlot: string,
  subPlots: string[],
  cast: Record<string, RoleId>,
): GameState {
  const scenario: Scenario = {
    tragedySet: "primeEvil",
    mainPlot,
    subPlots,
    cast,
    incidents: [],
    loops: 3,
    daysPerLoop: 4,
  };
  return {
    scenario,
    gamePhase: "ROUND",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
  };
}

describe("Prime Evil role metadata", () => {
  it("preserves the seven upstream role sources and the Ghost maximum", () => {
    expect(Object.fromEntries([
      "vampire",
      "werewolf",
      "nightmare",
      "ghost",
      "showOff",
      "coward",
      "zombie",
    ].map((role) => [role, ROLE_IMPL[role].hooks.length]))).toEqual({
      vampire: 2,
      werewolf: 2,
      nightmare: 2,
      ghost: 1,
      showOff: 2,
      coward: 1,
      zombie: 2,
    });
    expect(ROLE_IMPL.ghost).toMatchObject({ ko: "유령", max: 1 });
    expect(ROLE_IMPL.ghost.hooks[0].source).toEqual({
      timing: "Mastermind Ability",
      prerequisite: "This card is a corpse",
      description: "Palce 1 :paranoia: on any character in this location, or any character in the :ghost:’s starting location.",
    });
    expect(ROLE_IMPL.zombie.hooks.map(({ source }) => source)).toEqual([
      {
        timing: "Day End",
        description: "If there is a location where there are more :zombies: than non-:zombies:, kill one character in that location (reminder: a corpse is no longer considered as a character).",
      },
      {
        timing: "Day End",
        description: "You may move one :zombie: corpse to a neighboring location.",
      },
    ]);
    expect(validateScenario({
      tragedySet: "primeEvil",
      mainPlot: "cursedLand",
      subPlots: ["witchsCurse", "keyGirl"],
      cast: { boyStudent: "ghost", girlStudent: "ghost" },
      incidents: [],
      loops: 3,
      daysPerLoop: 4,
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "ROLE_COUNT_EXCEEDED",
    }));
  });

  it("adds every tagged immortal and applies Show-Off's paranoia exception", () => {
    expect(IMMORTAL_ROLE_IDS).toEqual(expect.arrayContaining([
      "vampire",
      "nightmare",
      "showOff",
    ]));
    for (const role of IMMORTAL_ROLE_IDS) {
      expect(ROLE_IMPL[role].tags).toContain("immortal");
    }
    expect(roleIsImmortal("showOff", 2)).toBe(true);
    expect(roleIsImmortal("showOff", 3)).toBe(false);
  });
});

describe("Prime Evil role execution", () => {
  it("lets Vampire kill only a co-located Key Person with 2 intrigue and counts mixed corpses for its loss", () => {
    const state = primeState("nobleBloodline", ["keyGirl", "thoseHabits"], {
      richStudent: "vampire",
      girlStudent: "keyPerson",
      boyStudent: "person",
    });
    const start = startLocationOf("richStudent", state.scenario);
    setBoardLocation(state.loop, "girlStudent", start);
    setBoardLocation(state.loop, "boyStudent", start);
    state.loop.charCounters.girlStudent.intrigue = 1;
    const kill = ROLE_IMPL.vampire.hooks[0];
    expect(kill.when(state, "richStudent")).toBe(false);
    state.loop.charCounters.girlStudent.intrigue = 2;
    expect(kill.when(state, "richStudent")).toBe(true);
    kill.effect(state, "richStudent", { kind: "character", id: "girlStudent" });
    expect(boardIsAlive(state.loop, "girlStudent")).toBe(false);

    state.loop.locIntrigue[start] = 1;
    expect(ROLE_IMPL.vampire.hooks[1].when(state, "richStudent")).toBe(true);
    expect(distanceToLoss(state)).toContainEqual(expect.objectContaining({
      id: "vampire",
      current: 2,
      needed: 2,
      met: true,
    }));
  });

  it("blocks Mastermind cards on Werewolf and opens its loss only after today's Night Madness", () => {
    const state = primeState("moonlightBeast", ["keyGirl", "thoseHabits"], {
      boyStudent: "werewolf",
      girlStudent: "keyPerson",
    });
    expect(validatePlacement(state, {
      owner: "mastermind",
      card: "intriguePlus1",
      target: { kind: "character", id: "boyStudent" },
    })).toEqual({ ok: false, reason: "늑대인간 능력" });
    expect(validatePlacement(state, {
      owner: 0,
      card: "intriguePlus1",
      target: { kind: "character", id: "boyStudent" },
    }).ok).toBe(true);
    expect(ROLE_IMPL.werewolf.hooks[0].when(state, "boyStudent")).toBe(false);
    state.loop.incidentOccurrencesFiredThisLoop = [{
      day: state.loop.day,
      incident: "nightMadness",
      culprit: { kind: "location", at: "City" },
    }];
    expect(ROLE_IMPL.werewolf.hooks[0].when(state, "boyStudent")).toBe(true);
    expect(distanceToLoss(state)).toContainEqual(expect.objectContaining({
      id: "werewolf",
      met: true,
    }));
  });

  it("lets Nightmare kill at its location and counts intrigue only on actual corpses", () => {
    const state = primeState("nightMistNightmare", ["keyGirl", "thoseHabits"], {
      richStudent: "nightmare",
      girlStudent: "keyPerson",
      boyStudent: "person",
    });
    setBoardLocation(state.loop, "girlStudent", "City");
    setBoardLocation(state.loop, "richStudent", "City");
    const kill = ROLE_IMPL.nightmare.hooks[0];
    expect(kill.when(state, "richStudent")).toBe(true);
    kill.effect(state, "richStudent", { kind: "character", id: "girlStudent" });
    expect(boardIsAlive(state.loop, "girlStudent")).toBe(false);
    state.loop.locIntrigue.City = 3;
    expect(ROLE_IMPL.nightmare.hooks[1].when(state, "richStudent")).toBe(false);
    state.loop.charCounters.girlStudent.intrigue = 3;
    expect(ROLE_IMPL.nightmare.hooks[1].when(state, "richStudent")).toBe(true);
    expect(distanceToLoss(state)).toContainEqual(expect.objectContaining({
      id: "nightmare",
      current: 3,
      needed: 3,
      met: true,
    }));
  });

  it("activates Ghost only as a corpse and targets living characters in its current or starting location", () => {
    const state = primeState("cursedLand", ["keyGirl", "thoseHabits"], {
      richStudent: "ghost",
      girlStudent: "keyPerson",
      boyStudent: "person",
    });
    const start = startLocationOf("richStudent", state.scenario);
    setBoardLocation(state.loop, "richStudent", "City");
    setBoardLocation(state.loop, "girlStudent", start);
    setBoardLocation(state.loop, "boyStudent", "Hospital");
    const hook = ROLE_IMPL.ghost.hooks[0];
    expect(hook.when(state, "richStudent")).toBe(false);
    setBoardLife(state.loop, "richStudent", false);
    expect(hook.when(state, "richStudent")).toBe(true);
    expect(hook.selectableTargets?.(state, "richStudent")).toEqual([
      { kind: "character", id: "girlStudent" },
    ]);
    hook.effect(state, "richStudent", { kind: "character", id: "girlStudent" });
    expect(state.loop.charCounters.girlStudent.paranoia).toBe(1);
    expect(collectHooks(state, "P5_MASTERMIND_ABILITY")).toContainEqual(
      expect.objectContaining({ self: "richStudent", hook }),
    );
  });

  it("switches Show-Off from immortal to mandatory goodwill refusal at 3 paranoia", () => {
    const state = primeState("OnesFromGrave", ["keyGirl", "thoseHabits"], {
      boyStudent: "showOff",
      girlStudent: "keyPerson",
    });
    expect(effectiveGoodwillRefusal(state, "boyStudent")).toBeUndefined();
    expect(killCharacter(state, "boyStudent")).toBe(false);
    state.loop.charCounters.boyStudent.paranoia = 3;
    expect(effectiveGoodwillRefusal(state, "boyStudent")).toBe("Mandatory");
    expect(goodwillResponseAvailability(state, "boyStudent", false))
      .toMatchObject({
        refusalKind: "mandatory",
        resolveAllowed: false,
        refuseAllowed: true,
      });
    expect(killCharacter(state, "boyStudent")).toBe(true);
  });

  it("moves Coward only from 2 paranoia and only to a neighboring location", () => {
    const state = primeState("OnesFromGrave", ["keyGirl", "thoseHabits"], {
      boyStudent: "coward",
      girlStudent: "keyPerson",
    });
    setBoardLocation(state.loop, "boyStudent", "City");
    const hook = ROLE_IMPL.coward.hooks[0];
    expect(hook.when(state, "boyStudent")).toBe(false);
    state.loop.charCounters.boyStudent.paranoia = 2;
    expect(hook.when(state, "boyStudent")).toBe(true);
    expect(hook.selectableTargets?.(state, "boyStudent")).toEqual([
      { kind: "location", at: "Hospital" },
      { kind: "location", at: "School" },
    ]);
    hook.effect(state, "boyStudent", { kind: "location", at: "Hospital" });
    expect(boardLocation(state.loop, "boyStudent")).toBe("Hospital");
  });

  it("derives actual and anonymous Zombies under Ones From Grave and resolves one global kill", () => {
    const state = primeState("OnesFromGrave", ["keyGirl", "thoseHabits"], {
      boyStudent: "coward",
      girlStudent: "keyPerson",
    });
    setBoardLocation(state.loop, "boyStudent", "City");
    setBoardLocation(state.loop, "girlStudent", "City");
    setBoardLife(state.loop, "boyStudent", false);
    state.loop.locIntrigue.City = 1;
    expect(effectiveRole(state, "boyStudent")).toBe("zombie");
    expect(zombieRoleAbilityActive(state)).toBe(true);
    const collected = collectHooks(state, "P9_ROUND_END").filter(
      ({ hook }) => hook === ROLE_IMPL.zombie.hooks[0],
    );
    expect(collected).toEqual([{ self: "", hook: ROLE_IMPL.zombie.hooks[0] }]);
    const hook = ROLE_IMPL.zombie.hooks[0];
    expect(hook.when(state, "")).toBe(true);
    hook.effect(state, "", { kind: "character", id: "girlStudent" });
    expect(boardIsAlive(state.loop, "girlStudent")).toBe(false);
    expect(hook.when(state, "")).toBe(false);

    setBoardLife(state.loop, "boyStudent", true);
    expect(effectiveRole(state, "boyStudent")).toBe("coward");
  });

  it("moves one actual Zombie corpse to an adjacent location and keeps an attached Curse on its card", () => {
    const state = primeState("OnesFromGrave", ["keyGirl", "thoseHabits"], {
      boyStudent: "coward",
      girlStudent: "keyPerson",
    });
    state.loop.phase = "P9_ROUND_END";
    setBoardLocation(state.loop, "boyStudent", "City");
    setBoardLife(state.loop, "boyStudent", false);
    placeExtraCard(state.loop, {
      instanceId: "corpse-curse",
      cardId: "curse",
      controller: "mastermind",
      source: { kind: "incident", id: "darkRumor" },
      target: { kind: "character", id: "boyStudent" },
      expiresAt: "loopEnd",
    });
    const hook = ROLE_IMPL.zombie.hooks[1];
    expect(hook.when(state, "")).toBe(true);
    expect(hook.selectableTargets?.(state, "")).toContainEqual({
      kind: "character",
      id: "boyStudent",
    });
    expect(hook.selectableDestinations?.(
      state,
      "",
      { kind: "character", id: "boyStudent" },
    )).toEqual(["Hospital", "School"]);

    applyHookEffect(
      state,
      "P9_ROUND_END",
      hook,
      "",
      { kind: "character", id: "boyStudent" },
      undefined,
      false,
      "Hospital",
    );
    expect(boardLocation(state.loop, "boyStudent")).toBe("Hospital");
    expect(state.loop.extraCards[0]?.target).toEqual({
      kind: "character",
      id: "boyStudent",
    });
    expect(state.loop.phaseLog?.at(-1)).toMatchObject({
      kind: "abilityActivated",
      timing: "P9_ROUND_END",
      targets: [
        { kind: "character", id: "boyStudent" },
        { kind: "location", at: "Hospital" },
      ],
      publicChanges: [{
        kind: "movement",
        character: "boyStudent",
        from: "City",
        to: "Hospital",
      }],
    });
    expect(hook.when(state, "")).toBe(false);
  });

  it("moves one anonymous Zombie as Intrigue minus/plus and reveals Ones From Grave", () => {
    const state = primeState("OnesFromGrave", ["keyGirl", "thoseHabits"], {
      boyStudent: "person",
      girlStudent: "keyPerson",
    });
    state.loop.phase = "P9_ROUND_END";
    state.loop.locIntrigue.City = 2;
    const hook = ROLE_IMPL.zombie.hooks[1];
    expect(hook.selectableTargets?.(state, "")).toContainEqual({
      kind: "location",
      at: "City",
    });
    expect(() => hook.effect(
      state,
      "",
      { kind: "location", at: "City" },
      "Shrine",
    )).toThrow("neighboring destination");

    applyHookEffect(
      state,
      "P9_ROUND_END",
      hook,
      "",
      { kind: "location", at: "City" },
      undefined,
      false,
      "School",
    );
    expect(state.loop.locIntrigue).toMatchObject({ City: 1, School: 1 });
    expect(state.loop.phaseLog?.at(-1)).toMatchObject({
      kind: "abilityActivated",
      publicChanges: expect.arrayContaining([
        expect.objectContaining({
          kind: "counter",
          target: { kind: "location", at: "City" },
          counter: "intrigue",
          delta: -1,
        }),
        expect.objectContaining({
          kind: "counter",
          target: { kind: "location", at: "School" },
          counter: "intrigue",
          delta: 1,
        }),
      ]),
    });
    expect(collectProtagonistObservations(state)).toContainEqual(
      expect.objectContaining({
        kind: "mastermindAbilityResult",
        timing: "P9_ROUND_END",
      }),
    );
    expect(evaluateStateRoleTableHypotheses(state).remaining.every(
      ({ mainPlot }) => mainPlot === "OnesFromGrave",
    )).toBe(true);
  });

  it("does not turn location intrigue into a Zombie outside Prime Evil", () => {
    const state = primeState("OnesFromGrave", ["keyGirl", "thoseHabits"], {
      boyStudent: "person",
      girlStudent: "keyPerson",
    });
    state.scenario.tragedySet = "basicTragedy";
    state.loop.locIntrigue.City = 3;
    expect(zombieRoleAbilityActive(state)).toBe(false);
    expect(collectHooks(state, "P9_ROUND_END").some(
      ({ hook }) => hook === ROLE_IMPL.zombie.hooks[0],
    )).toBe(false);
  });

  it("excludes Coward and Ghost when their publicly mandatory P5 changes are absent", () => {
    const state = primeState("cursedLand", ["panicObsession", "keyGirl"], {
      boyStudent: "person",
      richStudent: "person",
      girlStudent: "keyPerson",
    });
    state.loop.charCounters.boyStudent.paranoia = 2;
    setBoardLife(state.loop, "richStudent", false);
    setBoardLocation(
      state.loop,
      "girlStudent",
      startLocationOf("richStudent", state.scenario),
    );
    state.loop.phaseLog = [{
      loop: 1,
      day: 1,
      phase: "P5_MASTERMIND_ABILITY",
      kind: "abilitySkipped",
      publicContext: publicObservationContext(state.loop),
    }];

    const observations = collectProtagonistObservations(state);
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "mandatoryEffectMissing",
        effect: "coward",
        character: "boyStudent",
      }),
      expect.objectContaining({
        kind: "mandatoryEffectMissing",
        effect: "ghost",
        character: "richStudent",
      }),
    ]));
    const evaluation = evaluateStateRoleTableHypotheses(state);
    expect(evaluation.table.cells.boyStudent.coward.status).toBe("impossible");
    expect(evaluation.table.cells.richStudent.ghost.status).toBe("impossible");

    const restricted = primeState(
      "cursedLand",
      ["panicObsession", "keyGirl"],
      { boyStudent: "person", girlStudent: "keyPerson" },
    );
    restricted.loop.charCounters.boyStudent.paranoia = 2;
    restricted.loop.movementRestrictions = [{
      kind: "character",
      character: "boyStudent",
      startDay: 1,
      throughDay: 1,
      source: "suspiciousLetter",
    }];
    restricted.loop.phaseLog = [{
      loop: 1,
      day: 1,
      phase: "P5_MASTERMIND_ABILITY",
      kind: "abilitySkipped",
      publicContext: publicObservationContext(restricted.loop),
    }];
    expect(collectProtagonistObservations(restricted)).not.toContainEqual(
      expect.objectContaining({
        kind: "mandatoryEffectMissing",
        effect: "coward",
        character: "boyStudent",
      }),
    );
  });
});
