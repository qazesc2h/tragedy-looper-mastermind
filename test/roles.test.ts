import { describe, expect, it } from "vitest";

import {
  killCharacter,
  reviveCharacter,
  withDeathBatch,
} from "../src/engine/death";
import { settleGameFlow } from "../src/engine/game";
import { requestLoopEnd } from "../src/engine/flow";
import {
  advance,
  collectHooks,
  resolveHooks,
} from "../src/engine/phases";
import { resolveActions } from "../src/engine/resolve";
import { initLoop } from "../src/engine/setup";
import { effectiveAbilityRoles, ROLE_IMPL } from "../src/impl/roles";
import type {
  GameState,
  Hook,
  Scenario,
  Target,
} from "../src/types";
import { effectiveRole, resolvePlaceX } from "../src/types";
import {
  boardIsAlive,
  boardLocation,
  setBoardLife,
  setBoardLocation,
} from "./helpers";

const KEY_PERSON = "boyStudent";
const KILLER = "girlStudent";
const BRAIN = "policeOfficer";
const CULTIST = "officeWorker";
const CONSPIRACY_THEORIST = "journalist";
const FRIEND = "boss";
const LOVER = "girlStudent";
const LOVED_ONE = "boyStudent";
const TIME_TRAVELER = "informer";
const FACTOR = "boyStudent";

function createState(): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "",
    subPlots: [],
    cast: {
      [KEY_PERSON]: "keyPerson",
      [KILLER]: "killer",
      [BRAIN]: "brain",
      [CULTIST]: "cultist",
    },
    incidents: [],
    loops: 1,
    daysPerLoop: 3,
  };
  const loop = initLoop(scenario);
  setBoardLocation(loop, KEY_PERSON, "City");
  setBoardLocation(loop, KILLER, "City");
  setBoardLocation(loop, BRAIN, "City");
  setBoardLocation(loop, CULTIST, "City");
  return { scenario, gamePhase: "ROUND", loop, history: [], loopOutcomes: [] };
}

function createRoleState(cast: Scenario["cast"]): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "",
    subPlots: [],
    cast,
    incidents: [],
    loops: 1,
    daysPerLoop: 3,
    scriptSpecified: "boss" in cast
      ? { "Turf:boss": "School" }
      : undefined,
  };
  const loop = initLoop(scenario);
  for (const character of Object.keys(loop.board)) {
    setBoardLocation(loop, character, "City");
  }
  return { scenario, gamePhase: "ROUND", loop, history: [], loopOutcomes: [] };
}

function endLoop(state: GameState): void {
  state.gamePhase = "ROUND";
  delete state.result;
  requestLoopEnd(state, "lastDay");
  settleGameFlow(state);
}

function hook(role: string, index = 0): Hook {
  const result = ROLE_IMPL[role].hooks[index];
  if (!result) {
    throw new Error(`missing hook ${index} for role "${role}"`);
  }
  return result;
}

function applyIfEligible(
  targetHook: Hook,
  state: GameState,
  self: string,
  target?: Target,
): void {
  if (targetHook.when(state, self)) {
    targetHook.effect(state, self, target);
    settleGameFlow(state);
  }
}

describe("keyPerson", () => {
  const targetHook = hook("keyPerson");

  it("ends the loop when this character is dead", () => {
    const state = createState();
    setBoardLife(state.loop, KEY_PERSON, false);
    state.loop.charCounters[KEY_PERSON].intrigue = 3;

    expect(targetHook.when(state, KEY_PERSON)).toBe(true);
    applyIfEligible(targetHook, state, KEY_PERSON);

    expect(state.history).toHaveLength(1);
    expect(boardIsAlive(state.history[0], KEY_PERSON)).toBe(false);
    expect(state.loop.charCounters[KEY_PERSON].intrigue).toBe(3);
  });

  it("does not end the loop while this character is alive", () => {
    const state = createState();

    expect(targetHook.when(state, KEY_PERSON)).toBe(false);
    applyIfEligible(targetHook, state, KEY_PERSON);

    expect(state.history).toEqual([]);
  });
});

describe("killer / kill keyPerson", () => {
  const targetHook = hook("killer");

  it("kills a co-located keyPerson at exactly 2 intrigue", () => {
    const state = createState();
    state.loop.charCounters[KEY_PERSON].intrigue = 2;
    state.loop.charCounters[KEY_PERSON].goodwill = 1;

    expect(targetHook.when(state, KILLER)).toBe(true);
    applyIfEligible(targetHook, state, KILLER);

    expect(boardIsAlive(state.loop, KEY_PERSON)).toBe(false);
    expect(state.loop.charCounters[KEY_PERSON]).toMatchObject({
      goodwill: 1,
      intrigue: 2,
    });
  });

  it("does not kill a keyPerson with only 1 intrigue", () => {
    const state = createState();
    state.loop.charCounters[KEY_PERSON].intrigue = 1;

    expect(targetHook.when(state, KILLER)).toBe(false);
    applyIfEligible(targetHook, state, KILLER);

    expect(boardIsAlive(state.loop, KEY_PERSON)).toBe(true);
  });

  it("does not kill a keyPerson in another location", () => {
    const state = createState();
    state.loop.charCounters[KEY_PERSON].intrigue = 2;
    setBoardLocation(state.loop, KEY_PERSON, "School");

    expect(targetHook.when(state, KILLER)).toBe(false);
    applyIfEligible(targetHook, state, KILLER);

    expect(boardIsAlive(state.loop, KEY_PERSON)).toBe(true);
  });

  it("does not target a dead keyPerson", () => {
    const state = createState();
    state.loop.charCounters[KEY_PERSON].intrigue = 2;
    setBoardLife(state.loop, KEY_PERSON, false);

    expect(targetHook.when(state, KILLER)).toBe(false);
  });
});

describe("killer / protagonists death", () => {
  const targetHook = hook("killer", 1);

  it("matches at exactly 4 intrigue", () => {
    const state = createState();
    state.loop.charCounters[KILLER].intrigue = 4;
    const before = structuredClone(state.loop);

    expect(targetHook.when(state, KILLER)).toBe(true);
    applyIfEligible(targetHook, state, KILLER);

    expect(state.loop).toEqual(before);
  });

  it("does not match at 3 intrigue", () => {
    const state = createState();
    state.loop.charCounters[KILLER].intrigue = 3;

    expect(targetHook.when(state, KILLER)).toBe(false);
  });
});

describe("brain", () => {
  const targetHook = hook("brain");

  it("places 1 intrigue on this location", () => {
    const state = createState();

    expect(targetHook.when(state, BRAIN)).toBe(true);
    targetHook.effect(state, BRAIN, {
      kind: "location",
      at: "City",
    });

    expect(state.loop.locIntrigue.City).toBe(1);
  });

  it("places 1 intrigue on a living character in this location", () => {
    const state = createState();

    targetHook.effect(state, BRAIN, {
      kind: "character",
      id: KEY_PERSON,
    });

    expect(state.loop.charCounters[KEY_PERSON].intrigue).toBe(1);
  });

  it("does not allow a character in another location as the target", () => {
    const state = createState();
    setBoardLocation(state.loop, KEY_PERSON, "School");

    expect(() => targetHook.effect(state, BRAIN, {
      kind: "character",
      id: KEY_PERSON,
    })).toThrow("living character in this location");
    expect(state.loop.charCounters[KEY_PERSON].intrigue).toBe(0);
  });

  it("lets boss-as-brain target both the turf and actual location", () => {
    const state = createRoleState({
      boss: "brain",
      boyStudent: "person",
      girlStudent: "person",
    });
    setBoardLocation(state.loop, "boyStudent", "School");

    targetHook.effect(state, "boss", {
      kind: "character",
      id: "boyStudent",
    });
    targetHook.effect(state, "boss", {
      kind: "character",
      id: "girlStudent",
    });

    expect(state.loop.charCounters.boyStudent.intrigue).toBe(1);
    expect(state.loop.charCounters.girlStudent.intrigue).toBe(1);
  });

  it("does nothing when the optional effect is not selected", () => {
    const state = createState();

    expect(targetHook.when(state, BRAIN)).toBe(true);
    expect(state.loop.locIntrigue.City).toBe(0);
    expect(state.loop.charCounters[KEY_PERSON].intrigue).toBe(0);
  });
});

describe("cultist", () => {
  const targetHook = hook("cultist");

  it("ignores an active forbid intrigue on this location", () => {
    const state = createState();
    state.loop.placed = [
      {
        owner: 0,
        card: "forbidIntrigue",
        target: { kind: "location", at: "City" },
      },
      {
        owner: "mastermind",
        card: "intriguePlus1",
        target: { kind: "location", at: "City" },
      },
    ];

    expect(targetHook.when(state, CULTIST)).toBe(true);
    targetHook.effect(state, CULTIST);
    resolveActions(state);

    expect(state.loop.locIntrigue.City).toBe(1);
  });

  it("ignores an active forbid intrigue on every character here", () => {
    const state = createState();
    state.loop.placed = [
      {
        owner: 0,
        card: "forbidIntrigue",
        target: { kind: "character", id: KEY_PERSON },
      },
      {
        owner: "mastermind",
        card: "intriguePlus1",
        target: { kind: "character", id: KEY_PERSON },
      },
    ];

    targetHook.effect(state, CULTIST);
    resolveActions(state);

    expect(state.loop.charCounters[KEY_PERSON].intrigue).toBe(1);
  });

  it("does not ignore forbid intrigue outside this location", () => {
    const state = createState();
    setBoardLocation(state.loop, KEY_PERSON, "School");
    state.loop.placed = [
      {
        owner: 0,
        card: "forbidIntrigue",
        target: { kind: "character", id: KEY_PERSON },
      },
      {
        owner: "mastermind",
        card: "intriguePlus1",
        target: { kind: "character", id: KEY_PERSON },
      },
    ];

    targetHook.effect(state, CULTIST);
    resolveActions(state);

    expect(state.loop.charCounters[KEY_PERSON].intrigue).toBe(0);
  });

  it("does not ignore anything when the optional hook is not used", () => {
    const state = createState();
    state.loop.placed = [
      {
        owner: 0,
        card: "forbidIntrigue",
        target: { kind: "location", at: "City" },
      },
      {
        owner: "mastermind",
        card: "intriguePlus1",
        target: { kind: "location", at: "City" },
      },
    ];

    resolveActions(state);

    expect(state.loop.locIntrigue.City).toBe(0);
  });

  it("applies round-wide forbid invalidation before the cultist scope", () => {
    const state = createState();
    state.loop.placed = [
      {
        owner: 0,
        card: "forbidIntrigue",
        target: { kind: "location", at: "City" },
      },
      {
        owner: 1,
        card: "forbidIntrigue",
        target: { kind: "location", at: "School" },
      },
      {
        owner: "mastermind",
        card: "intriguePlus1",
        target: { kind: "location", at: "School" },
      },
    ];

    targetHook.effect(state, CULTIST);
    resolveActions(state);

    expect(state.loop.locIntrigue.School).toBe(1);
  });

  it("uses this character's location after movement resolves", () => {
    const state = createState();
    state.loop.placed = [
      {
        owner: "mastermind",
        card: "moveVertical",
        target: { kind: "character", id: CULTIST },
      },
      {
        owner: 0,
        card: "forbidIntrigue",
        target: { kind: "location", at: "Hospital" },
      },
      {
        owner: "mastermind",
        card: "intriguePlus1",
        target: { kind: "location", at: "Hospital" },
      },
    ];

    targetHook.effect(state, CULTIST);
    resolveActions(state);

    expect(boardLocation(state.loop, CULTIST)).toBe("Hospital");
    expect(state.loop.locIntrigue.Hospital).toBe(1);
    expect(state.loop.cultistsIgnoringForbidIntrigue).toBeUndefined();
  });
});

describe("timeTraveler / forbid goodwill", () => {
  const forbidHook = hook("timeTraveler");

  it("ignores Forbid goodwill on this character", () => {
    const state = createRoleState({ [TIME_TRAVELER]: "timeTraveler" });
    state.loop.placed = [
      {
        card: "forbidGoodwill",
        target: { kind: "character", id: TIME_TRAVELER },
        owner: "mastermind",
      },
      {
        card: "goodwillPlus1",
        target: { kind: "character", id: TIME_TRAVELER },
        owner: 0,
      },
    ];

    expect(forbidHook.kind).toBe("mandatory");
    expect(forbidHook.when(state, TIME_TRAVELER)).toBe(true);
    state.loop.phase = "P4_RESOLVE";
    advance(state);

    expect(state.loop.charCounters[TIME_TRAVELER].goodwill).toBe(1);
    expect(state.loop.timeTravelersIgnoringForbidGoodwill).toBeUndefined();
  });

  it("does not ignore Forbid goodwill on another character", () => {
    const state = createRoleState({
      [TIME_TRAVELER]: "timeTraveler",
      [KEY_PERSON]: "person",
    });
    state.loop.placed = [
      {
        card: "forbidGoodwill",
        target: { kind: "character", id: KEY_PERSON },
        owner: "mastermind",
      },
      {
        card: "goodwillPlus1",
        target: { kind: "character", id: KEY_PERSON },
        owner: 0,
      },
    ];

    state.loop.phase = "P4_RESOLVE";
    advance(state);

    expect(state.loop.charCounters[KEY_PERSON].goodwill).toBe(0);
  });
});

describe("timeTraveler / last day loss", () => {
  const lastDayHook = hook("timeTraveler", 1);

  it("may end the loop at day end on the last day with 2 goodwill", () => {
    const state = createRoleState({ [TIME_TRAVELER]: "timeTraveler" });
    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";
    state.loop.charCounters[TIME_TRAVELER].goodwill = 2;

    expect(ROLE_IMPL.timeTraveler.hooks).toHaveLength(2);
    expect(lastDayHook.phase).toBe("P9_ROUND_END");
    expect(lastDayHook.kind).toBe("optional");
    expect(lastDayHook.when(state, TIME_TRAVELER)).toBe(true);
    applyIfEligible(lastDayHook, state, TIME_TRAVELER);

    expect(state.history).toHaveLength(1);
  });

  it("does not fire before the last day", () => {
    const state = createRoleState({ [TIME_TRAVELER]: "timeTraveler" });
    state.loop.day = state.scenario.daysPerLoop - 1;
    state.loop.phase = "P9_ROUND_END";
    state.loop.charCounters[TIME_TRAVELER].goodwill = 2;

    expect(lastDayHook.when(state, TIME_TRAVELER)).toBe(false);
    applyIfEligible(lastDayHook, state, TIME_TRAVELER);

    expect(state.history).toEqual([]);
  });

  it("does not fire with 3 goodwill on the last day", () => {
    const state = createRoleState({ [TIME_TRAVELER]: "timeTraveler" });
    state.loop.day = state.scenario.daysPerLoop;
    state.loop.charCounters[TIME_TRAVELER].goodwill = 3;

    expect(lastDayHook.when(state, TIME_TRAVELER)).toBe(false);
    expect(collectHooks(state, "LAST_DAY")).toEqual([]);
  });
});

describe("conspiracyTheorist", () => {
  const targetHook = hook("conspiracyTheorist");

  it("has max 1 and may place paranoia on itself", () => {
    const state = createRoleState({
      [CONSPIRACY_THEORIST]: "conspiracyTheorist",
    });

    expect(ROLE_IMPL.conspiracyTheorist.max).toBe(1);
    expect(targetHook.when(state, CONSPIRACY_THEORIST)).toBe(true);
    targetHook.effect(state, CONSPIRACY_THEORIST, {
      kind: "character",
      id: CONSPIRACY_THEORIST,
    });

    expect(
      state.loop.charCounters[CONSPIRACY_THEORIST].paranoia,
    ).toBe(1);
  });

  it("does not allow a character outside this location", () => {
    const state = createRoleState({
      [CONSPIRACY_THEORIST]: "conspiracyTheorist",
      [KEY_PERSON]: "person",
    });
    setBoardLocation(state.loop, KEY_PERSON, "School");

    expect(() => targetHook.effect(state, CONSPIRACY_THEORIST, {
      kind: "character",
      id: KEY_PERSON,
    })).toThrow("living character in this location");
    expect(state.loop.charCounters[KEY_PERSON].paranoia).toBe(0);
  });

  it("does nothing when the optional hook is not selected", () => {
    const state = createRoleState({
      [CONSPIRACY_THEORIST]: "conspiracyTheorist",
    });

    expect(targetHook.when(state, CONSPIRACY_THEORIST)).toBe(true);
    expect(
      state.loop.charCounters[CONSPIRACY_THEORIST].paranoia,
    ).toBe(0);
  });
});

describe("serialKiller", () => {
  const targetHook = hook("serialKiller");

  it("kills the exactly 1 other living character here", () => {
    const state = createRoleState({
      [KILLER]: "serialKiller",
      [KEY_PERSON]: "person",
      [BRAIN]: "person",
    });
    setBoardLife(state.loop, BRAIN, false);
    state.loop.charCounters[KEY_PERSON].intrigue = 2;

    expect(targetHook.when(state, KILLER)).toBe(true);
    applyIfEligible(targetHook, state, KILLER);

    expect(boardIsAlive(state.loop, KEY_PERSON)).toBe(false);
    expect(state.loop.charCounters[KEY_PERSON].intrigue).toBe(2);
  });

  it("does not fire when 2 other living characters are here", () => {
    const state = createRoleState({
      [KILLER]: "serialKiller",
      [KEY_PERSON]: "person",
      [BRAIN]: "person",
    });

    expect(targetHook.when(state, KILLER)).toBe(false);
    resolveHooks(state, "P9_ROUND_END");

    expect(boardIsAlive(state.loop, KEY_PERSON)).toBe(true);
    expect(boardIsAlive(state.loop, BRAIN)).toBe(true);
  });

  it("kills both serial killers after simultaneous target resolution", () => {
    const state = createRoleState({
      [KILLER]: "serialKiller",
      [KEY_PERSON]: "serialKiller",
    });

    resolveHooks(state, "P9_ROUND_END");

    expect(boardIsAlive(state.loop, KILLER)).toBe(false);
    expect(boardIsAlive(state.loop, KEY_PERSON)).toBe(false);
  });

  it("cannot kill an immortal timeTraveler or remove its protection", () => {
    const state = createRoleState({
      [KILLER]: "serialKiller",
      [TIME_TRAVELER]: "timeTraveler",
    });
    state.loop.charCounters[TIME_TRAVELER].protection = 1;

    resolveHooks(state, "P9_ROUND_END");

    expect(boardIsAlive(state.loop, TIME_TRAVELER)).toBe(true);
    expect(state.loop.charCounters[TIME_TRAVELER].protection).toBe(1);
  });
});

describe("character death and revival", () => {
  it("checks protection after immortality and consumes it for a mortal", () => {
    const state = createRoleState({ [KEY_PERSON]: "person" });
    state.loop.charCounters[KEY_PERSON].protection = 1;

    expect(killCharacter(state, KEY_PERSON)).toBe(false);
    expect(boardIsAlive(state.loop, KEY_PERSON)).toBe(true);
    expect(state.loop.charCounters[KEY_PERSON].protection).toBe(0);
  });

  it("kills an unprotected mortal and can revive the corpse", () => {
    const state = createRoleState({ [KEY_PERSON]: "person" });

    expect(killCharacter(state, KEY_PERSON)).toBe(true);
    expect(boardIsAlive(state.loop, KEY_PERSON)).toBe(false);
    expect(reviveCharacter(state, KEY_PERSON)).toBe(true);
    expect(boardIsAlive(state.loop, KEY_PERSON)).toBe(true);
    expect(reviveCharacter(state, KEY_PERSON)).toBe(false);
  });
});

describe("witch", () => {
  it("has mandatory goodwill refusal and no hooks", () => {
    expect(ROLE_IMPL.witch.goodwillRefusal).toBe("Mandatory");
    expect(ROLE_IMPL.witch.hooks).toEqual([]);

    const state = createRoleState({ [KEY_PERSON]: "witch" });
    expect(collectHooks(state, "P9_ROUND_END")).toEqual([]);
  });

  it("is found as giant time bomb X's location anchor", () => {
    const state = createRoleState({ shrineMaiden: "witch" });
    state.scenario.mainPlot = "giantTimeBomb";

    expect(resolvePlaceX(state)).toBe("Shrine");
  });

  it("returns no place X when giant time bomb has no witch", () => {
    const state = createRoleState({ shrineMaiden: "person" });
    state.scenario.mainPlot = "giantTimeBomb";

    expect(resolvePlaceX(state)).toBeUndefined();
  });
});

describe("curmudgeon", () => {
  it("has no maximum, may refuse goodwill, and has no ability hooks", () => {
    expect(ROLE_IMPL.curmudgeon.max).toBeUndefined();
    expect(ROLE_IMPL.curmudgeon.goodwillRefusal).toBe("Optional");
    expect(ROLE_IMPL.curmudgeon.hooks).toEqual([]);
  });
});

describe("friend / reveal role", () => {
  const revealHook = hook("friend");

  it("reveals the role when this card is dead", () => {
    const state = createRoleState({ [FRIEND]: "friend" });
    setBoardLife(state.loop, FRIEND, false);

    expect(revealHook.when(state, FRIEND)).toBe(true);
    applyIfEligible(revealHook, state, FRIEND);

    expect(state.loop.revealedRoleCharacters).toEqual([FRIEND]);
    expect(boardIsAlive(state.loop, FRIEND)).toBe(false);
  });

  it("does not reveal the role while this card is alive", () => {
    const state = createRoleState({ [FRIEND]: "friend" });

    expect(revealHook.when(state, FRIEND)).toBe(false);
    applyIfEligible(revealHook, state, FRIEND);

    expect(state.loop.revealedRoleCharacters).toBeUndefined();
  });
});

describe("friend / revealed role bonus", () => {
  const loopStartHook = hook("friend", 1);

  it("adds 1 goodwill in a later loop after the role was revealed", () => {
    const state = createRoleState({ [FRIEND]: "friend" });
    setBoardLife(state.loop, FRIEND, false);

    endLoop(state);
    state.loop = initLoop(state.scenario);
    state.loop.loop = 2;

    expect(state.history[0].revealedRoleCharacters).toEqual([FRIEND]);
    expect(loopStartHook.when(state, FRIEND)).toBe(true);
    resolveHooks(state, "LOOP_START");

    expect(state.loop.charCounters[FRIEND].goodwill).toBe(1);
  });

  it("does not add goodwill if the role has never been revealed", () => {
    const state = createRoleState({ [FRIEND]: "friend" });

    expect(loopStartHook.when(state, FRIEND)).toBe(false);
    resolveHooks(state, "LOOP_START");

    expect(state.loop.charCounters[FRIEND].goodwill).toBe(0);
  });
});

describe("lover / lovedOne death reactions", () => {
  const loverHook = hook("lover");
  const lovedOneHook = hook("lovedOne");

  it("reacts through killCharacter when Lover A dies", () => {
    const state = createRoleState({
      [LOVER]: "lover",
      [LOVED_ONE]: "lovedOne",
    });

    expect(ROLE_IMPL.lover.ko).toBe("연인B");
    expect(loverHook.phase).toBe("ON_DEATH");
    expect(killCharacter(state, LOVED_ONE)).toBe(true);

    expect(state.loop.charCounters[LOVER].paranoia).toBe(6);
  });

  it("does not react when an unrelated character dies", () => {
    const state = createRoleState({
      [LOVER]: "lover",
      [LOVED_ONE]: "lovedOne",
      [FRIEND]: "person",
    });

    expect(killCharacter(state, FRIEND)).toBe(true);

    expect(state.loop.charCounters[LOVER].paranoia).toBe(0);
    expect(state.loop.charCounters[LOVED_ONE].paranoia).toBe(0);
  });

  it("reacts through killCharacter when Lover B dies", () => {
    const state = createRoleState({
      [LOVER]: "lover",
      [LOVED_ONE]: "lovedOne",
    });

    expect(ROLE_IMPL.lovedOne.ko).toBe("연인A");
    expect(lovedOneHook.phase).toBe("ON_DEATH");
    expect(killCharacter(state, LOVER)).toBe(true);

    expect(state.loop.charCounters[LOVED_ONE].paranoia).toBe(6);
  });

  it("does not record a death blocked by protection", () => {
    const state = createRoleState({
      [LOVER]: "lover",
      [LOVED_ONE]: "lovedOne",
    });
    state.loop.charCounters[LOVED_ONE].protection = 1;

    expect(killCharacter(state, LOVED_ONE)).toBe(false);

    expect(boardIsAlive(state.loop, LOVED_ONE)).toBe(true);
    expect(state.loop.charCounters[LOVED_ONE].protection).toBe(0);
    expect(state.loop.charCounters[LOVER].paranoia).toBe(0);
  });

  it("does nothing when both lovers die in the same batch", () => {
    const state = createRoleState({
      [LOVER]: "lover",
      [LOVED_ONE]: "lovedOne",
    });

    withDeathBatch(state, () => {
      expect(killCharacter(state, LOVER)).toBe(true);
      expect(killCharacter(state, LOVED_ONE)).toBe(true);
    });

    expect(state.loop.charCounters[LOVER].paranoia).toBe(0);
    expect(state.loop.charCounters[LOVED_ONE].paranoia).toBe(0);
  });

  it("treats death after revival as a fresh death event", () => {
    const state = createRoleState({
      [LOVER]: "lover",
      [LOVED_ONE]: "lovedOne",
    });

    expect(killCharacter(state, LOVED_ONE)).toBe(true);
    expect(state.loop.charCounters[LOVER].paranoia).toBe(6);
    expect(reviveCharacter(state, LOVED_ONE)).toBe(true);
    expect(killCharacter(state, LOVED_ONE)).toBe(true);

    expect(state.loop.charCounters[LOVER].paranoia).toBe(12);
  });

  it("finishes all death reactions before settling a keyPerson loss", () => {
    const state = createRoleState({
      [CULTIST]: "keyPerson",
      [LOVER]: "lover",
      [LOVED_ONE]: "lovedOne",
    });

    withDeathBatch(state, () => {
      expect(killCharacter(state, CULTIST)).toBe(true);
      expect(killCharacter(state, LOVER)).toBe(true);
    });

    expect(state.loop.charCounters[LOVED_ONE].paranoia).toBe(6);
    expect(state.gamePhase).toBe("ROUND");

    settleGameFlow(state);

    expect(state.gamePhase).toBe("LOOP_JUDGMENT");
    expect(state.history[0].charCounters[LOVED_ONE].paranoia).toBe(6);
  });

  it("closes the P9 mandatory batch before resolving death reactions", () => {
    const state = createRoleState({
      [BRAIN]: "serialKiller",
      [LOVER]: "lover",
      [LOVED_ONE]: "lovedOne",
    });
    setBoardLocation(state.loop, LOVER, "School");

    resolveHooks(state, "P9_ROUND_END");

    expect(boardIsAlive(state.loop, LOVED_ONE)).toBe(false);
    expect(state.loop.charCounters[LOVER].paranoia).toBe(6);
  });
});

describe("lovedOne / protagonists death", () => {
  const lossHook = hook("lovedOne", 1);

  it("matches at exactly 3 paranoia and 1 intrigue", () => {
    const state = createRoleState({ [LOVED_ONE]: "lovedOne" });
    state.loop.charCounters[LOVED_ONE].paranoia = 3;
    state.loop.charCounters[LOVED_ONE].intrigue = 1;
    const before = structuredClone(state.loop);

    expect(ROLE_IMPL.lover.hooks).toHaveLength(1);
    expect(lossHook.kind).toBe("lossDeath");
    expect(lossHook.when(state, LOVED_ONE)).toBe(true);
    applyIfEligible(lossHook, state, LOVED_ONE);

    expect(state.loop).toEqual(before);
  });

  it("does not match below 3 paranoia", () => {
    const state = createRoleState({ [LOVED_ONE]: "lovedOne" });
    state.loop.charCounters[LOVED_ONE].paranoia = 2;
    state.loop.charCounters[LOVED_ONE].intrigue = 1;

    expect(lossHook.when(state, LOVED_ONE)).toBe(false);
  });

  it("does not match without intrigue", () => {
    const state = createRoleState({ [LOVED_ONE]: "lovedOne" });
    state.loop.charCounters[LOVED_ONE].paranoia = 3;

    expect(lossHook.when(state, LOVED_ONE)).toBe(false);
  });
});

describe("factor / gained abilities", () => {
  const schoolHook = hook("factor");
  const cityHook = hook("factor", 1);

  it("gains the conspiracyTheorist ability at 2 School intrigue", () => {
    const state = createRoleState({
      [FACTOR]: "factor",
      [KILLER]: "person",
    });
    state.loop.locIntrigue.School = 2;

    expect(schoolHook.when(state, FACTOR)).toBe(true);
    const granted = collectHooks(state, "P5_MASTERMIND_ABILITY")
      .find(({ self }) => self === FACTOR);
    expect(granted).toBeDefined();
    granted?.hook.effect(state, FACTOR, {
      kind: "character",
      id: KILLER,
    });

    expect(state.loop.charCounters[KILLER].paranoia).toBe(1);
  });

  it("does not gain the conspiracyTheorist ability at 1 School intrigue", () => {
    const state = createRoleState({ [FACTOR]: "factor" });
    state.loop.locIntrigue.School = 1;

    expect(schoolHook.when(state, FACTOR)).toBe(false);
    expect(collectHooks(state, "P5_MASTERMIND_ABILITY")).toEqual([]);
  });

  it("gains the keyPerson ability at 2 City intrigue", () => {
    const state = createRoleState({ [FACTOR]: "factor" });
    state.loop.locIntrigue.City = 2;
    killCharacter(state, FACTOR);

    expect(cityHook.when(state, FACTOR)).toBe(true);
    resolveHooks(state, "ALWAYS");
    settleGameFlow(state);

    expect(state.history).toHaveLength(1);
    expect(boardIsAlive(state.history[0], FACTOR)).toBe(false);
  });

  it("does not gain the keyPerson ability at 1 City intrigue", () => {
    const state = createRoleState({ [FACTOR]: "factor" });
    state.loop.locIntrigue.City = 1;
    killCharacter(state, FACTOR);

    expect(cityHook.when(state, FACTOR)).toBe(false);
    resolveHooks(state, "ALWAYS");

    expect(state.history).toEqual([]);
  });

  it("gains both abilities when both location conditions hold", () => {
    const state = createRoleState({ [FACTOR]: "factor" });
    state.loop.locIntrigue.School = 2;
    state.loop.locIntrigue.City = 2;

    expect(effectiveAbilityRoles(state, FACTOR)).toEqual([
      "factor",
      "conspiracyTheorist",
      "keyPerson",
    ]);
  });

  it("does not become signWithMe's keyPerson when it gains that ability", () => {
    const state = createRoleState({ [FACTOR]: "factor" });
    state.scenario.mainPlot = "signWithMe";
    state.loop.locIntrigue.City = 2;
    state.loop.charCounters[FACTOR].intrigue = 2;

    expect(effectiveAbilityRoles(state, FACTOR)).toContain("keyPerson");
    expect(effectiveRole(state, FACTOR)).toBe("factor");
    const signWithMeLossTargets = Object.keys(state.scenario.cast).filter(
      (character) =>
        effectiveRole(state, character) === "keyPerson" &&
        state.loop.charCounters[character].intrigue >= 2,
    );
    expect(signWithMeLossTargets).toEqual([]);
  });
});
