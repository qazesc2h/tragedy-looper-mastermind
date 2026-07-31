import { describe, expect, it } from "vitest";

import { resolveActions } from "../src/engine/resolve";
import { initLoop } from "../src/engine/setup";
import { ROLE_IMPL } from "../src/impl/roles";
import type {
  GameState,
  Hook,
  Scenario,
  Target,
} from "../src/types";

const KEY_PERSON = "boyStudent";
const KILLER = "girlStudent";
const BRAIN = "policeOfficer";
const CULTIST = "officeWorker";

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
  loop.board[KEY_PERSON].at = "City";
  loop.board[KILLER].at = "City";
  loop.board[BRAIN].at = "City";
  loop.board[CULTIST].at = "City";
  return { scenario, loop, history: [] };
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
  }
}

describe("keyPerson", () => {
  const targetHook = hook("keyPerson");

  it("ends the loop when this character is dead", () => {
    const state = createState();
    state.loop.board[KEY_PERSON].alive = false;
    state.loop.charCounters[KEY_PERSON].intrigue = 3;

    expect(targetHook.when(state, KEY_PERSON)).toBe(true);
    applyIfEligible(targetHook, state, KEY_PERSON);

    expect(state.history).toHaveLength(1);
    expect(state.history[0].board[KEY_PERSON].alive).toBe(false);
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

    expect(state.loop.board[KEY_PERSON].alive).toBe(false);
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

    expect(state.loop.board[KEY_PERSON].alive).toBe(true);
  });

  it("does not kill a keyPerson in another location", () => {
    const state = createState();
    state.loop.charCounters[KEY_PERSON].intrigue = 2;
    state.loop.board[KEY_PERSON].at = "School";

    expect(targetHook.when(state, KILLER)).toBe(false);
    applyIfEligible(targetHook, state, KILLER);

    expect(state.loop.board[KEY_PERSON].alive).toBe(true);
  });

  it("does not target a dead keyPerson", () => {
    const state = createState();
    state.loop.charCounters[KEY_PERSON].intrigue = 2;
    state.loop.board[KEY_PERSON].alive = false;

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
    state.loop.board[KEY_PERSON].at = "School";

    expect(() => targetHook.effect(state, BRAIN, {
      kind: "character",
      id: KEY_PERSON,
    })).toThrow("living character in this location");
    expect(state.loop.charCounters[KEY_PERSON].intrigue).toBe(0);
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
    state.loop.board[KEY_PERSON].at = "School";
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

    expect(state.loop.board[CULTIST].at).toBe("Hospital");
    expect(state.loop.locIntrigue.Hospital).toBe(1);
    expect(state.loop.cultistsIgnoringForbidIntrigue).toBeUndefined();
  });
});
