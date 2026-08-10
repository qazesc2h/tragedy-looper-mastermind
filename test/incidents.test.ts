import { describe, expect, it } from "vitest";

import { resolveIncident } from "../src/engine/incident";
import { resolveGoodwillAbility } from "../src/engine/goodwill";
import {
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
  settleGameFlow,
  setLoopStartTraitLocationChoice,
} from "../src/engine/game";
import { evaluateLoss } from "../src/engine/loss";
import { advance } from "../src/engine/phases";
import { initLoop } from "../src/engine/setup";
import { INCIDENT_IMPL } from "../src/impl/incidents";
import type {
  GameState,
  IncidentHook,
  RoleId,
  Scenario,
} from "../src/types";
import {
  boardIsAlive,
  boardLocation,
  setBoardLocation,
} from "./helpers";

const CULPRIT = "boyStudent";
const TARGET = "girlStudent";
const OTHER = "policeOfficer";
const TIME_TRAVELER = "informer";

function createState(
  incident: string,
  roles: Record<string, RoleId> = {
    [CULPRIT]: "person",
    [TARGET]: "person",
    [OTHER]: "person",
  },
): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "",
    subPlots: [],
    cast: roles,
    incidents: [{ day: 1, incident, culprit: CULPRIT }],
    loops: 1,
    daysPerLoop: 3,
    scriptSpecified: "boss" in roles
      ? { "Turf:boss": "School" }
      : undefined,
  };
  const loop = initLoop(scenario);
  for (const character of Object.keys(loop.board)) {
    setBoardLocation(loop, character, "City");
  }
  loop.charCounters[CULPRIT].paranoia = 2;
  loop.phase = "P7_INCIDENT";
  return { scenario, gamePhase: "ROUND", loop, history: [], loopOutcomes: [] };
}

function createIncidentState(
  incident: string,
  culprit: string,
  characters: readonly string[],
  mainPlot = "",
): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot,
    subPlots: [],
    cast: Object.fromEntries(
      characters.map((character) => [character, "person"]),
    ),
    incidents: [{ day: 1, incident, culprit }],
    loops: 1,
    daysPerLoop: 3,
  };
  const state: GameState = characters.includes("henchman")
    ? createGameState(scenario)
    : { scenario, gamePhase: "ROUND", loop: initLoop(scenario), history: [], loopOutcomes: [] };
  if (characters.includes("henchman")) {
    chooseInitialLeader(state, 0);
    setLoopStartTraitLocationChoice(state, "henchman", "City");
    continueFromTimeGap(state);
  }
  const loop = state.loop;
  for (const character of characters) {
    setBoardLocation(loop, character, "City");
  }
  loop.charCounters[culprit].paranoia = 10;
  loop.phase = "P7_INCIDENT";
  state.gamePhase = "ROUND";
  return state;
}

function activateHenchmanSuppression(state: GameState): void {
  state.loop.phase = "P6_GOODWILL";
  state.loop.charCounters.henchman.goodwill = 3;
  resolveGoodwillAbility(state, {
    user: "henchman",
    rank: 3,
    abilityIndex: 1,
  }, "resolve");
  state.loop.phase = "P7_INCIDENT";
}

function incidentHook(incident: string, index = 0): IncidentHook {
  const targetHook = INCIDENT_IMPL[incident].hooks[index];
  if (!targetHook) {
    throw new Error(`missing hook ${index} for incident "${incident}"`);
  }
  return targetHook;
}

describe("incident resolution", () => {
  it("returns fired separately when an incident has no applied effect", () => {
    const state = createState("suicide", {
      [CULPRIT]: "timeTraveler",
    });

    expect(resolveIncident(state)).toEqual({
      incident: "suicide",
      culprit: CULPRIT,
      fired: true,
      effectApplied: false,
    });
    expect(boardIsAlive(state.loop, CULPRIT)).toBe(true);
    expect(state.loop.incidentsFiredThisLoop).toEqual(["suicide"]);
    expect(state.loop.incidentOccurrencesFiredThisLoop).toEqual([{
      day: 1,
      incident: "suicide",
      culprit: CULPRIT,
    }]);
  });

  it("returns the P7 result and advances to P8", () => {
    const state = createState("foulEvil");

    expect(advance(state)).toEqual({
      incident: "foulEvil",
      culprit: CULPRIT,
      fired: true,
      effectApplied: true,
    });
    expect(state.loop.phase).toBe("P8_LEADER_PASS");
    expect(state.loop.locIntrigue.Shrine).toBe(2);
  });

  it("does not fire without a scheduled incident", () => {
    const state = createState("foulEvil");
    state.scenario.incidents = [];

    expect(resolveIncident(state)).toEqual({
      fired: false,
      effectApplied: false,
    });
  });

  it("does not choose a required effect target or leave P7 implicitly", () => {
    const state = createState("missingPerson");

    expect(() => advance(state)).toThrow("requires a location target");
    expect(state.loop.phase).toBe("P7_INCIDENT");
    expect(boardLocation(state.loop, CULPRIT)).toBe("City");
    expect(state.loop.incidentsFiredThisLoop).toBeUndefined();
  });
});

describe("butterflyEffect", () => {
  const targetHook = incidentHook("butterflyEffect");

  it("puts the selected counter on a character in the culprit's location", () => {
    const state = createState("butterflyEffect");

    expect(targetHook.when(state, CULPRIT)).toBe(true);
    expect(targetHook.effect(state, CULPRIT, {
      target: TARGET,
      counter: "intrigue",
    })).toBe(true);
    expect(state.loop.charCounters[TARGET].intrigue).toBe(1);
  });

  it("rejects a character outside the culprit's location", () => {
    const state = createState("butterflyEffect");
    setBoardLocation(state.loop, TARGET, "School");

    expect(() => targetHook.effect(state, CULPRIT, {
      target: TARGET,
      counter: "intrigue",
    })).toThrow("target is not eligible");
    expect(state.loop.charCounters[TARGET].intrigue).toBe(0);
  });
});

describe("farawayMurder", () => {
  const targetHook = incidentHook("farawayMurder");

  it("kills a character with exactly 2 intrigue", () => {
    const state = createState("farawayMurder");
    state.loop.charCounters[TARGET].intrigue = 2;

    expect(targetHook.when(state, CULPRIT)).toBe(true);
    expect(targetHook.effect(state, CULPRIT, { target: TARGET })).toBe(true);
    expect(boardIsAlive(state.loop, TARGET)).toBe(false);
  });

  it("does nothing when no character has 2 intrigue", () => {
    const state = createState("farawayMurder");
    state.loop.charCounters[TARGET].intrigue = 1;

    expect(targetHook.effect(state, CULPRIT)).toBe(false);
    expect(boardIsAlive(state.loop, TARGET)).toBe(true);
  });
});

describe("foulEvil", () => {
  const targetHook = incidentHook("foulEvil");

  it("always places 2 intrigue on the Shrine", () => {
    const state = createState("foulEvil");

    expect(targetHook.when(state, CULPRIT)).toBe(true);
    expect(targetHook.effect(state, CULPRIT)).toBe(true);
    expect(state.loop.locIntrigue.Shrine).toBe(2);
  });

  it("has no prerequisite and applies again from a nonzero value", () => {
    const state = createState("foulEvil");
    state.loop.locIntrigue.Shrine = 3;

    expect(targetHook.when(state, CULPRIT)).toBe(true);
    targetHook.effect(state, CULPRIT);
    expect(state.loop.locIntrigue.Shrine).toBe(5);
  });
});

describe("hospitalIncident", () => {
  const deathHook = incidentHook("hospitalIncident");
  const lossHook = incidentHook("hospitalIncident", 1);

  it("kills everyone in the Hospital at 1 Hospital intrigue", () => {
    const state = createState("hospitalIncident");
    state.loop.locIntrigue.Hospital = 1;
    setBoardLocation(state.loop, TARGET, "Hospital");
    setBoardLocation(state.loop, OTHER, "Hospital");

    expect(deathHook.when(state, CULPRIT)).toBe(true);
    expect(deathHook.effect(state, CULPRIT)).toBe(true);
    expect(boardIsAlive(state.loop, TARGET)).toBe(false);
    expect(boardIsAlive(state.loop, OTHER)).toBe(false);
    expect(boardIsAlive(state.loop, CULPRIT)).toBe(true);
  });

  it("does not kill anyone without Hospital intrigue", () => {
    const state = createState("hospitalIncident");
    setBoardLocation(state.loop, TARGET, "Hospital");

    expect(deathHook.when(state, CULPRIT)).toBe(false);
    expect(boardIsAlive(state.loop, TARGET)).toBe(true);
  });

  it("applies the protagonists-death condition at 2 Hospital intrigue", () => {
    const state = createState("hospitalIncident");
    state.loop.locIntrigue.Hospital = 2;

    expect(lossHook.when(state, CULPRIT)).toBe(true);
    expect(lossHook.effect(state, CULPRIT)).toBe(true);
  });

  it("does not apply the protagonists-death condition at 1 intrigue", () => {
    const state = createState("hospitalIncident");
    state.loop.locIntrigue.Hospital = 1;

    expect(lossHook.when(state, CULPRIT)).toBe(false);
  });

  it("does not add paranoia when both lovers die in the same incident", () => {
    const state = createState("hospitalIncident", {
      [CULPRIT]: "person",
      [TARGET]: "lover",
      [OTHER]: "lovedOne",
    });
    state.loop.locIntrigue.Hospital = 1;
    setBoardLocation(state.loop, TARGET, "Hospital");
    setBoardLocation(state.loop, OTHER, "Hospital");

    resolveIncident(state);

    expect(boardIsAlive(state.loop, TARGET)).toBe(false);
    expect(boardIsAlive(state.loop, OTHER)).toBe(false);
    expect(state.loop.charCounters[TARGET].paranoia).toBe(0);
    expect(state.loop.charCounters[OTHER].paranoia).toBe(0);
  });

  it("resolves a lover reaction before a simultaneous keyPerson loss", () => {
    const lovedOne = "boss";
    const state = createState("hospitalIncident", {
      [CULPRIT]: "person",
      [TARGET]: "lover",
      [OTHER]: "keyPerson",
      [lovedOne]: "lovedOne",
    });
    state.loop.locIntrigue.Hospital = 1;
    setBoardLocation(state.loop, TARGET, "Hospital");
    setBoardLocation(state.loop, OTHER, "Hospital");

    advance(state);

    expect(state.loop.charCounters[lovedOne].paranoia).toBe(6);
    expect(state.pendingLoopEnd).toBeUndefined();
    expect(state.loop.pendingImmediateLossKeys).toEqual([
      `role:keyPerson:${OTHER}`,
    ]);

    settleGameFlow(state);

    expect(state.gamePhase).toBe("LOOP_JUDGMENT");
    expect(state.history[0].charCounters[lovedOne].paranoia).toBe(6);
  });
});

describe("increasingUnease", () => {
  const targetHook = incidentHook("increasingUnease");

  it("places paranoia, then intrigue on another character", () => {
    const state = createState("increasingUnease");

    expect(targetHook.when(state, CULPRIT)).toBe(true);
    expect(targetHook.effect(state, CULPRIT, {
      target: TARGET,
      otherTarget: OTHER,
    })).toBe(true);
    expect(state.loop.charCounters[TARGET].paranoia).toBe(2);
    expect(state.loop.charCounters[OTHER].intrigue).toBe(1);
  });

  it("rejects using the same character for both effects", () => {
    const state = createState("increasingUnease");

    expect(() => targetHook.effect(state, CULPRIT, {
      target: TARGET,
      otherTarget: TARGET,
    })).toThrow("target is not eligible");
    expect(state.loop.charCounters[TARGET].paranoia).toBe(0);
    expect(state.loop.charCounters[OTHER].intrigue).toBe(0);
  });
});

describe("missingPerson", () => {
  const targetHook = incidentHook("missingPerson");

  it("moves the culprit and puts intrigue on that location", () => {
    const state = createState("missingPerson");

    expect(targetHook.when(state, CULPRIT)).toBe(true);
    expect(targetHook.effect(state, CULPRIT, { location: "Shrine" })).toBe(true);
    expect(boardLocation(state.loop, CULPRIT)).toBe("Shrine");
    expect(state.loop.locIntrigue.Shrine).toBe(1);
  });

  it("does not choose a location when none is supplied", () => {
    const state = createState("missingPerson");

    expect(() => targetHook.effect(state, CULPRIT)).toThrow(
      "requires a location target",
    );
    expect(boardLocation(state.loop, CULPRIT)).toBe("City");
  });
});

describe("murder", () => {
  const targetHook = incidentHook("murder");

  it("kills another character in the culprit's location", () => {
    const state = createState("murder");

    expect(targetHook.when(state, CULPRIT)).toBe(true);
    expect(targetHook.effect(state, CULPRIT, { target: TARGET })).toBe(true);
    expect(boardIsAlive(state.loop, TARGET)).toBe(false);
  });

  it("does nothing when no other character is in that location", () => {
    const state = createState("murder", { [CULPRIT]: "person" });

    expect(targetHook.effect(state, CULPRIT)).toBe(false);
    expect(boardIsAlive(state.loop, CULPRIT)).toBe(true);
  });

  it("does not use boss turf for an incident location judgment", () => {
    const state = createState("murder", {
      [CULPRIT]: "person",
      boss: "person",
      [TARGET]: "person",
    });
    setBoardLocation(state.loop, "boss", "City");
    setBoardLocation(state.loop, TARGET, "School");

    expect(() => targetHook.effect(state, "boss", { target: TARGET }))
      .toThrow("murder target is not eligible");
    expect(boardIsAlive(state.loop, TARGET)).toBe(true);
  });
});

describe("spreading", () => {
  const targetHook = incidentHook("spreading");

  it("removes 1 goodwill when that is all, then adds 2 to another", () => {
    const state = createState("spreading");
    state.loop.charCounters[TARGET].goodwill = 1;

    expect(targetHook.when(state, CULPRIT)).toBe(true);
    expect(targetHook.effect(state, CULPRIT, {
      target: TARGET,
      otherTarget: OTHER,
    })).toBe(true);
    expect(state.loop.charCounters[TARGET].goodwill).toBe(0);
    expect(state.loop.charCounters[OTHER].goodwill).toBe(2);
  });

  it("does nothing when no character has goodwill to remove", () => {
    const state = createState("spreading");

    expect(targetHook.effect(state, CULPRIT)).toBe(false);
    expect(state.loop.charCounters[OTHER].goodwill).toBe(0);
  });
});

describe("suicide", () => {
  const targetHook = incidentHook("suicide");

  it("kills the culprit", () => {
    const state = createState("suicide");

    expect(targetHook.when(state, CULPRIT)).toBe(true);
    expect(targetHook.effect(state, CULPRIT)).toBe(true);
    expect(boardIsAlive(state.loop, CULPRIT)).toBe(false);
  });

  it("does nothing when the culprit is an immortal timeTraveler", () => {
    const state = createState("suicide", {
      [CULPRIT]: "timeTraveler",
      [TIME_TRAVELER]: "person",
    });

    expect(targetHook.effect(state, CULPRIT)).toBe(false);
    expect(boardIsAlive(state.loop, CULPRIT)).toBe(true);
  });
});

describe("henchman rank 3 / suppress incidents by culprit", () => {
  it("does not fire or record an incident whose culprit is henchman", () => {
    const state = createIncidentState(
      "foulEvil",
      "henchman",
      ["henchman", "boyStudent"],
    );
    activateHenchmanSuppression(state);

    expect(resolveIncident(state)).toEqual({
      incident: "foulEvil",
      culprit: "henchman",
      fired: false,
      effectApplied: false,
    });
    expect(state.loop.locIntrigue.Shrine).toBe(0);
    expect(state.loop.incidentsFiredThisLoop).toBeUndefined();
    expect(state.loop.incidentOccurrencesFiredThisLoop).toBeUndefined();
  });

  it("does not suppress an incident with another culprit", () => {
    const state = createIncidentState(
      "foulEvil",
      "boyStudent",
      ["henchman", "boyStudent"],
    );
    activateHenchmanSuppression(state);

    expect(resolveIncident(state)).toEqual({
      incident: "foulEvil",
      culprit: "boyStudent",
      fired: true,
      effectApplied: true,
    });
    expect(state.loop.locIntrigue.Shrine).toBe(2);
    expect(state.loop.incidentsFiredThisLoop).toEqual(["foulEvil"]);
  });

  it("keeps suppressed butterflyEffect from satisfying changeOfFuture", () => {
    const state = createIncidentState(
      "butterflyEffect",
      "henchman",
      ["henchman", "boyStudent"],
      "changeOfFuture",
    );
    activateHenchmanSuppression(state);

    expect(resolveIncident(state).fired).toBe(false);
    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";

    expect(evaluateLoss(state).some(({ id }) => id === "changeOfFuture"))
      .toBe(false);
  });

  it("records blackCat butterflyEffect as fired even though its effect is empty", () => {
    const state = createIncidentState(
      "butterflyEffect",
      "blackCat",
      ["blackCat", "boyStudent"],
      "changeOfFuture",
    );

    expect(resolveIncident(state)).toEqual({
      incident: "butterflyEffect",
      culprit: "blackCat",
      fired: true,
      effectApplied: false,
    });
    expect(state.loop.incidentsFiredThisLoop).toEqual(["butterflyEffect"]);
    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";

    expect(evaluateLoss(state)).toContainEqual(expect.objectContaining({
      id: "changeOfFuture",
      met: true,
    }));
  });
});
