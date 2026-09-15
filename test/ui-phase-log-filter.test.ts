import { describe, expect, it } from "vitest";

import { initLoop } from "../src/engine/setup";
import {
  phaseLogFilteredTimeline,
  phaseLogTimeline,
} from "../src/ui/phase-log";
import type { GameState, LoopState, Scenario } from "../src/types";

const scenario: Scenario = {
  tragedySet: "basicTragedy",
  mainPlot: "murderPlan",
  subPlots: [],
  cast: {
    girlStudent: "person",
    nurse: "person",
  },
  incidents: [],
  loops: 2,
  daysPerLoop: 3,
};

function historicalLoop(): LoopState {
  const loop = initLoop(scenario, 1);
  loop.day = 3;
  loop.phaseLog = [{
    loop: 1,
    day: 2,
    phase: "P2_MASTERMIND_ACTION",
    kind: "cardsPlaced",
    placements: [{
      owner: "mastermind",
      card: "intriguePlus1",
      target: { kind: "character", id: "girlStudent" },
    }, {
      owner: 0,
      card: "forbidIntrigue",
      target: { kind: "location", at: "Shrine" },
    }],
  }, {
    loop: 1,
    day: 2,
    phase: "P4_RESOLVE",
    kind: "actionResolved",
    // 필터는 표시 문자열을 검색하지 않는다.
    results: ["nurse와 Shrine이 문자열에만 등장"],
    publicContext: {
      locationIntrigue: { Hospital: 0, Shrine: 0, City: 0, School: 0 },
      characters: {
        girlStudent: {
          status: "alive",
          location: "Shrine",
          goodwill: 0,
          paranoia: 0,
          intrigue: 0,
        },
      },
    },
    publicChanges: [{
      kind: "counter",
      target: { kind: "character", id: "girlStudent" },
      counter: "intrigue",
      delta: 1,
    }, {
      kind: "counter",
      target: { kind: "location", at: "Shrine" },
      counter: "intrigue",
      delta: 1,
    }, {
      kind: "movement",
      character: "girlStudent",
      from: "School",
      to: "Shrine",
    }, {
      kind: "status",
      character: "girlStudent",
      from: "alive",
      to: "dead",
      at: "Shrine",
    }],
  }, {
    loop: 1,
    day: 2,
    phase: "P5_MASTERMIND_ABILITY",
    kind: "abilityActivated",
    character: "nurse",
    targets: [{ kind: "character", id: "girlStudent" }],
    description: "test ability",
    publicChanges: [],
  }, {
    loop: 1,
    day: 2,
    phase: "P6_GOODWILL",
    kind: "goodwillUsed",
    character: "nurse",
    rank: 2,
    abilityIndex: 0,
    response: "resolve",
    effectApplied: true,
    targets: [{ kind: "character", id: "girlStudent" }],
    publicChanges: [],
  }, {
    loop: 1,
    day: 2,
    phase: "P7_INCIDENT",
    kind: "incidentJudged",
    incident: "murder",
    culprit: "nurse",
    fired: true,
    effectApplied: true,
    failureReasons: [],
    targets: [{ kind: "character", id: "girlStudent" }],
    deaths: ["girlStudent"],
  }];
  loop.publicInformationThisLoop = [{
    kind: "roleReveal",
    character: "girlStudent",
    role: "serialKiller",
    loop: 1,
    day: 2,
  }];
  loop.roundEvidence = [{
    day: 2,
    roundEndPairs: [{
      location: "Shrine",
      characters: ["girlStudent", "nurse"],
      paranoia: [3, 0],
      intrigue: [0, 0],
    }],
  }];
  return loop;
}

function stateWithHistory(): GameState {
  const current = initLoop(scenario, 2);
  current.phaseLog = [{
    loop: 2,
    day: 1,
    phase: "P2_MASTERMIND_ACTION",
    kind: "cardsPlaced",
    placements: [{
      owner: "mastermind",
      card: "paranoiaPlus1",
      target: { kind: "character", id: "girlStudent" },
    }],
  }];
  return {
    scenario,
    gamePhase: "ROUND",
    loop: current,
    history: [historicalLoop()],
    loopOutcomes: [],
  };
}

describe("phase log structured filters", () => {
  it("indexes a borrowed goodwill ability by activator and original owner", () => {
    const state = stateWithHistory();
    state.loop.phaseLog = [{
      loop: 2,
      day: 1,
      phase: "P6_GOODWILL",
      kind: "goodwillUsed",
      character: "littleSister",
      abilityOwner: "nurse",
      rank: 2,
      abilityIndex: 0,
      response: "resolve",
      effectApplied: true,
      publicChanges: [],
    }];

    for (const character of ["littleSister", "nurse"] as const) {
      const borrowed = phaseLogFilteredTimeline(state, {
        kind: "character",
        id: character,
      }).filter((item) => item.loop === 2 && item.kind === "ability");
      expect(borrowed).toHaveLength(1);
      expect(borrowed[0]?.characters).toEqual([
        "littleSister",
        "nurse",
      ]);
    }
  });

  it("collects every character event from IDs and keeps loop/day order", () => {
    const items = phaseLogFilteredTimeline(stateWithHistory(), {
      kind: "character",
      id: "girlStudent",
    });

    expect(items.map(({ kind }) => kind)).toEqual([
      "card",
      "change",
      "change",
      "change",
      "ability",
      "ability",
      "roleReveal",
      "incident",
      "roundEndPair",
      "card",
    ]);
    expect(items.map(({ loop, day }) => [loop, day])).toEqual([
      ...Array.from({ length: 9 }, () => [1, 2]),
      [2, 1],
    ]);
  });

  it("collects location cards, intrigue, entry/exit, death, and pair facts", () => {
    const items = phaseLogFilteredTimeline(stateWithHistory(), {
      kind: "location",
      at: "Shrine",
    });

    expect(items.map(({ kind }) => kind)).toEqual([
      "card",
      "change",
      "change",
      "change",
      "roundEndPair",
    ]);
  });

  it("uses a legacy public context for death location without matching text", () => {
    const state = stateWithHistory();
    const action = state.history[0]?.phaseLog?.find((entry) =>
      entry.kind === "actionResolved"
    );
    if (action?.kind !== "actionResolved" || action.publicChanges === undefined) {
      throw new Error("missing action trace");
    }
    const death = action.publicChanges.find((change) =>
      change.kind === "status"
    );
    if (death?.kind !== "status") throw new Error("missing death trace");
    delete death.at;

    expect(phaseLogFilteredTimeline(state, {
      kind: "location",
      at: "Shrine",
    }).some((item) => item.kind === "change" &&
      item.change.kind === "status")).toBe(true);
    expect(phaseLogTimeline(state).some((item) =>
      item.kind === "change" && item.change.kind === "status" &&
      item.locations.includes("Shrine")
    )).toBe(true);
  });

  it("does not invent matches from action result strings", () => {
    const state = stateWithHistory();
    state.history[0]!.phaseLog = state.history[0]!.phaseLog?.filter((entry) =>
      entry.kind === "actionResolved"
    );
    const action = state.history[0]!.phaseLog?.[0];
    if (action?.kind !== "actionResolved") throw new Error("missing action");
    action.publicChanges = [];
    state.history[0]!.publicInformationThisLoop = [];
    state.history[0]!.roundEvidence = [];
    state.loop.phaseLog = [];

    expect(phaseLogFilteredTimeline(state, {
      kind: "character",
      id: "nurse",
    })).toEqual([]);
  });
});
