import { describe, expect, it } from "vitest";

import {
  resolveGoodwillAbility,
  resolveGoodwillPhase,
} from "../src/engine/goodwill";
import type { GoodwillUse } from "../src/engine/goodwill";
import { advance } from "../src/engine/phases";
import { resolveActions } from "../src/engine/resolve";
import { initLoop } from "../src/engine/setup";
import type {
  CharacterId,
  Counters,
  GameState,
  Location,
  PlacedCard,
  RoleId,
  Scenario,
} from "../src/types";
import { loadManualExamples } from "./helpers";

interface GoodwillFixture {
  id: string;
  setup: string;
  preset: {
    counters: Record<CharacterId, Partial<Counters>>;
  };
  placed?: PlacedCard[];
  steps?: Array<{
    declare: Pick<GoodwillUse, "user" | "rank" | "target">;
    mastermindResponse: GoodwillUse["mastermindResponse"];
  }>;
}

interface ManualGoodwillView {
  setups: Record<string, { board: Record<CharacterId, Location> }>;
  cases: GoodwillFixture[];
}

const manualExamples =
  loadManualExamples() as unknown as ManualGoodwillView;

function fixture(id: string): GoodwillFixture {
  const found = manualExamples.cases.find((testCase) => testCase.id === id);
  if (!found) throw new Error(`missing manual fixture "${id}"`);
  return found;
}

function createState(
  fixtureId: string,
  roleOverrides: Record<CharacterId, RoleId> = {},
): GameState {
  const testCase = fixture(fixtureId);
  const setup = manualExamples.setups[testCase.setup];
  if (!setup) throw new Error(`missing setup "${testCase.setup}"`);

  const cast: Scenario["cast"] = {};
  for (const character of Object.keys(setup.board)) {
    cast[character] = roleOverrides[character] ?? "person";
  }
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "",
    subPlots: [],
    cast,
    incidents: [],
    loops: 1,
    daysPerLoop: 3,
  };
  const loop = initLoop(scenario);
  for (const [character, location] of Object.entries(setup.board)) {
    loop.board[character].at = location;
  }
  for (const [character, counters] of Object.entries(
    testCase.preset.counters,
  )) {
    Object.assign(loop.charCounters[character], counters);
  }

  return { scenario, loop, history: [] };
}

describe("goodwill-chain-and-refusal", () => {
  it("applies declarations in order and permits the newly enabled ability", () => {
    const testCase = fixture("goodwill-chain-and-refusal");
    const state = createState("goodwill-chain-and-refusal", {
      girlStudent: "killer",
    });
    state.loop.phase = "P6_GOODWILL";
    if (!testCase.steps) throw new Error("fixture steps are missing");

    const results = resolveGoodwillPhase(
      state,
      testCase.steps.map(({ declare, mastermindResponse }) => ({
        ...declare,
        mastermindResponse,
      })),
    );

    expect(results.map((result) => result.response)).toEqual([
      "resolve",
      "refuse",
    ]);
    expect(state.loop.charCounters.richStudent.goodwill).toBe(3);
    expect(state.loop.charCounters.girlStudent.goodwill).toBe(2);
    expect(state.loop.charCounters.boyStudent.paranoia).toBe(2);
  });

  it("rejects the restricted ability outside School or City", () => {
    const state = createState("goodwill-chain-and-refusal");
    state.loop.phase = "P6_GOODWILL";
    state.loop.board.richStudent.at = "Shrine";

    expect(() => resolveGoodwillAbility(state, {
      user: "richStudent",
      rank: 3,
      target: "girlStudent",
    }, "resolve")).toThrow("cannot be used at Shrine");
    expect(state.loop.charCounters.girlStudent.goodwill).toBe(1);
  });
});

describe("goodwill-comes-after-card-resolve", () => {
  it("does not apply a P6 restriction removal retroactively to P4", () => {
    const testCase = fixture("goodwill-comes-after-card-resolve");
    const state = createState("goodwill-comes-after-card-resolve");
    state.loop.phase = "P4_RESOLVE";
    if (!testCase.placed) throw new Error("fixture placements are missing");
    state.loop.placed = structuredClone(testCase.placed);

    advance(state);
    expect(state.loop.phase).toBe("P5_MASTERMIND_ABILITY");
    expect(state.loop.charCounters.doctor.goodwill).toBe(3);
    expect(state.loop.board.patient.at).toBe("Hospital");

    advance(state);
    expect(state.loop.phase).toBe("P6_GOODWILL");
    resolveGoodwillAbility(state, {
      user: "doctor",
      rank: 3,
      target: "patient",
    }, "resolve");
    advance(state);

    expect(state.loop.phase).toBe("P7_INCIDENT");
    expect(state.loop.board.patient.at).toBe("Hospital");
    expect(state.loop.locationRestrictionsRemoved).toEqual(["patient"]);

    state.loop.placed = [{
      owner: 1,
      card: "moveVertical",
      target: { kind: "character", id: "patient" },
    }];
    resolveActions(state);
    expect(state.loop.board.patient.at).toBe("City");
  });
});

describe("goodwill availability and refusal", () => {
  it("requires at least the printed rank in goodwill", () => {
    const state = createState("goodwill-chain-and-refusal");
    state.loop.phase = "P6_GOODWILL";
    state.loop.charCounters.girlStudent.goodwill = 1;

    expect(() => resolveGoodwillAbility(state, {
      user: "girlStudent",
      rank: 2,
      target: "boyStudent",
    }, "resolve")).toThrow("needs 2 goodwill");
    expect(state.loop.charCounters.boyStudent.paranoia).toBe(2);
  });

  it("marks a refused once-per-loop ability as spent", () => {
    const scenario: Scenario = {
      tragedySet: "basicTragedy",
      mainPlot: "",
      subPlots: [],
      cast: { classRep: "killer" },
      incidents: [],
      loops: 1,
      daysPerLoop: 3,
    };
    const state: GameState = {
      scenario,
      loop: initLoop(scenario),
      history: [],
    };
    state.loop.phase = "P6_GOODWILL";
    state.loop.charCounters.classRep.goodwill = 2;

    const result = resolveGoodwillAbility(state, {
      user: "classRep",
      rank: 2,
    }, "refuse");

    expect(result.refused).toBe(true);
    expect(state.loop.abilitiesUsedThisLoop).toEqual([
      "classRep:goodwill:0",
    ]);
    expect(() => resolveGoodwillAbility(state, {
      user: "classRep",
      rank: 2,
    }, "refuse")).toThrow("already spent this loop");
  });

  it("forces mandatory refusal even if resolve was requested", () => {
    const state = createState("goodwill-chain-and-refusal", {
      girlStudent: "witch",
    });
    state.loop.phase = "P6_GOODWILL";
    state.loop.charCounters.girlStudent.goodwill = 2;

    const result = resolveGoodwillAbility(state, {
      user: "girlStudent",
      rank: 2,
      target: "boyStudent",
    }, "resolve");

    expect(result.response).toBe("refuse");
    expect(result.effectApplied).toBe(false);
    expect(state.loop.charCounters.boyStudent.paranoia).toBe(2);
  });

  it("does not permit a role without refusal to refuse", () => {
    const state = createState("goodwill-chain-and-refusal");
    state.loop.phase = "P6_GOODWILL";
    state.loop.charCounters.girlStudent.goodwill = 2;

    expect(() => resolveGoodwillAbility(state, {
      user: "girlStudent",
      rank: 2,
      target: "boyStudent",
    }, "refuse")).toThrow("cannot refuse goodwill abilities");
    expect(state.loop.charCounters.boyStudent.paranoia).toBe(2);
  });
});
