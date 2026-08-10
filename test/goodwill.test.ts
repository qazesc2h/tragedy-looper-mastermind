import { describe, expect, it } from "vitest";

import {
  goodwillResponseAvailability,
  resolveGoodwillAbility,
  resolveGoodwillPhase,
} from "../src/engine/goodwill";
import type { GoodwillUse } from "../src/engine/goodwill";
import { resolveIncident } from "../src/engine/incident";
import {
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
  setLoopStartTraitLocationChoice,
} from "../src/engine/game";
import { advance } from "../src/engine/phases";
import { resolveActions } from "../src/engine/resolve";
import { initLoop } from "../src/engine/setup";
import { effectiveRole } from "../src/types";
import type {
  CharacterId,
  Counters,
  GameState,
  Location,
  PlacedCard,
  RoleId,
  Scenario,
} from "../src/types";
import {
  boardIsAlive,
  boardLocation,
  loadManualExamples,
  setBoardLife,
  setBoardLocation,
} from "./helpers";

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
    setBoardLocation(loop, character, location);
  }
  for (const [character, counters] of Object.entries(
    testCase.preset.counters,
  )) {
    Object.assign(loop.charCounters[character], counters);
  }

  return { scenario, gamePhase: "ROUND", loop, history: [], loopOutcomes: [] };
}

function createInformationState(
  characters: readonly CharacterId[],
  incidents: Scenario["incidents"],
  subPlots: string[] = ["circleFriends", "threadsFate"],
): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "murderPlan",
    subPlots,
    cast: Object.fromEntries(
      characters.map((character) => [character, "person"]),
    ),
    incidents,
    loops: 3,
    daysPerLoop: 6,
    scriptSpecified: {
      ...(characters.includes("godlyBeing")
        ? { "enters on loop:godlyBeing": 1 }
        : {}),
    },
  };
  const state = createGameState(scenario);
  chooseInitialLeader(state, 0);
  if (characters.includes("henchman")) {
    setLoopStartTraitLocationChoice(state, "henchman", "City");
  }
  continueFromTimeGap(state);
  state.loop.phase = "P6_GOODWILL";
  return state;
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
    setBoardLocation(state.loop, "richStudent", "Shrine");

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
    expect(state.loop.phase).toBe("P4_RESOLVE");
    expect(state.loop.actionResolutionComplete).toBe(true);
    advance(state);
    expect(state.loop.phase).toBe("P5_MASTERMIND_ABILITY");
    expect(state.loop.charCounters.doctor.goodwill).toBe(3);
    expect(boardLocation(state.loop, "patient")).toBe("Hospital");

    advance(state);
    expect(state.loop.phase).toBe("P6_GOODWILL");
    resolveGoodwillAbility(state, {
      user: "doctor",
      rank: 3,
      target: "patient",
    }, "resolve");
    advance(state);

    expect(state.loop.phase).toBe("P7_INCIDENT");
    expect(boardLocation(state.loop, "patient")).toBe("Hospital");
    expect(state.loop.locationRestrictionsRemoved).toEqual(["patient"]);

    state.loop.placed = [{
      owner: 1,
      card: "moveVertical",
      target: { kind: "character", id: "patient" },
    }];
    resolveActions(state);
    expect(boardLocation(state.loop, "patient")).toBe("City");
  });
});

describe("goodwill availability and refusal", () => {
  it.each([
    ["killer", "optional"],
    ["brain", "optional"],
    ["factor", "optional"],
    ["cultist", "mandatory"],
    ["witch", "mandatory"],
  ] as const)("uses effective %s role's %s refusal rule", (role, refusalKind) => {
    const state = createState("goodwill-chain-and-refusal", {
      girlStudent: role,
    });

    expect(goodwillResponseAvailability(
      state,
      "girlStudent",
      false,
    )).toMatchObject({
      role,
      refusalKind,
      resolveAllowed: refusalKind === "optional",
      refuseAllowed: true,
    });
  });

  it("allows only resolution without goodwill refusal and for protected abilities", () => {
    const state = createState("goodwill-chain-and-refusal");
    expect(goodwillResponseAvailability(
      state,
      "girlStudent",
      false,
    )).toMatchObject({
      role: "person",
      refusalKind: "none",
      resolveAllowed: true,
      refuseAllowed: false,
    });

    state.scenario.cast.girlStudent = "witch";
    expect(goodwillResponseAvailability(
      state,
      "girlStudent",
      true,
    )).toMatchObject({
      role: "witch",
      refusalKind: "mandatory",
      resolveAllowed: true,
      refuseAllowed: false,
    });
  });

  it("rejects dead officeWorker and boyStudent as ability users", () => {
    const scenario: Scenario = {
      tragedySet: "basicTragedy",
      mainPlot: "",
      subPlots: [],
      cast: {
        officeWorker: "person",
        boyStudent: "person",
        girlStudent: "person",
      },
      incidents: [],
      loops: 1,
      daysPerLoop: 3,
    };
    const state: GameState = {
      scenario,
      gamePhase: "ROUND",
      loop: initLoop(scenario),
      history: [],
      loopOutcomes: [],
    };
    state.loop.phase = "P6_GOODWILL";
    for (const character of Object.keys(state.loop.board)) {
      setBoardLocation(state.loop, character, "City");
    }
    state.loop.charCounters.officeWorker.goodwill = 3;
    state.loop.charCounters.boyStudent.goodwill = 2;
    state.loop.charCounters.girlStudent.paranoia = 1;
    setBoardLife(state.loop, "officeWorker", false);
    setBoardLife(state.loop, "boyStudent", false);

    expect(() => resolveGoodwillAbility(state, {
      user: "officeWorker",
      rank: 3,
      abilityIndex: 0,
    }, "resolve")).toThrow("is dead and cannot use goodwill abilities");
    expect(() => resolveGoodwillAbility(state, {
      user: "boyStudent",
      rank: 2,
      abilityIndex: 0,
      target: "girlStudent",
    }, "resolve")).toThrow("is dead and cannot use goodwill abilities");

    expect(state.loop.revealedRoleCharacters).toBeUndefined();
    expect(state.loop.charCounters.girlStudent.paranoia).toBe(1);
  });

  it("closes an alien rank-4 death batch after the ability resolves", () => {
    const scenario: Scenario = {
      tragedySet: "basicTragedy",
      mainPlot: "",
      subPlots: [],
      cast: {
        alien: "person",
        girlStudent: "lovedOne",
        boyStudent: "lover",
      },
      incidents: [],
      loops: 1,
      daysPerLoop: 3,
    };
    const state: GameState = {
      scenario,
      gamePhase: "ROUND",
      loop: initLoop(scenario),
      history: [],
      loopOutcomes: [],
    };
    state.loop.phase = "P6_GOODWILL";
    for (const character of Object.keys(state.loop.board)) {
      setBoardLocation(state.loop, character, "City");
    }
    state.loop.charCounters.alien.goodwill = 4;

    resolveGoodwillAbility(state, {
      user: "alien",
      rank: 4,
      abilityIndex: 0,
      target: "girlStudent",
    }, "resolve");

    expect(boardIsAlive(state.loop, "girlStudent")).toBe(false);
    expect(state.loop.charCounters.boyStudent.paranoia).toBe(6);
  });

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
      gamePhase: "ROUND",
      loop: initLoop(scenario),
      history: [],
      loopOutcomes: [],
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
    expect(state.loop.publicInformationThisLoop).toEqual([{
      kind: "goodwillRefusal",
      character: "classRep",
      rank: 2,
      abilityIndex: 0,
      loop: 1,
      day: 1,
    }]);
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
    expect(state.loop.publicInformationThisLoop).toEqual([{
      kind: "goodwillRefusal",
      character: "girlStudent",
      rank: 2,
      abilityIndex: 0,
      loop: 1,
      day: 1,
    }]);
  });

  it("lets mysteryBoy's protected ability resolve through mandatory refusal", () => {
    const scenario: Scenario = {
      tragedySet: "basicTragedy",
      mainPlot: "",
      subPlots: [],
      cast: { mysteryBoy: "witch" },
      incidents: [],
      loops: 3,
      daysPerLoop: 3,
    };
    const state: GameState = {
      scenario,
      gamePhase: "ROUND",
      loop: initLoop(scenario),
      history: [],
      loopOutcomes: [],
    };
    state.loop.loop = 2;
    state.loop.phase = "P6_GOODWILL";
    state.loop.charCounters.mysteryBoy.goodwill = 3;

    const result = resolveGoodwillAbility(state, {
      user: "mysteryBoy",
      rank: 3,
      abilityIndex: 1,
    }, "resolve");

    expect(result.response).toBe("resolve");
    expect(result.effectApplied).toBe(true);
    expect(state.loop.revealedRoleCharacters).toEqual(["mysteryBoy"]);
    expect(effectiveRole(state, "mysteryBoy")).toBe("witch");
  });

  it("rejects mysteryBoy's protected ability during loop 1", () => {
    const scenario: Scenario = {
      tragedySet: "basicTragedy",
      mainPlot: "",
      subPlots: [],
      cast: { mysteryBoy: "witch" },
      incidents: [],
      loops: 3,
      daysPerLoop: 3,
    };
    const state: GameState = {
      scenario,
      gamePhase: "ROUND",
      loop: initLoop(scenario),
      history: [],
      loopOutcomes: [],
    };
    state.loop.phase = "P6_GOODWILL";
    state.loop.charCounters.mysteryBoy.goodwill = 3;

    expect(() => resolveGoodwillAbility(state, {
      user: "mysteryBoy",
      rank: 3,
      abilityIndex: 1,
    }, "resolve")).toThrow("available from loop 2");
    expect(state.loop.revealedRoleCharacters).toBeUndefined();
  });

  it("allows officeWorker's rank-3 ability in loop 1 to be refused", () => {
    const scenario: Scenario = {
      tragedySet: "basicTragedy",
      mainPlot: "",
      subPlots: [],
      cast: { officeWorker: "witch" },
      incidents: [],
      loops: 3,
      daysPerLoop: 3,
    };
    const state: GameState = {
      scenario,
      gamePhase: "ROUND",
      loop: initLoop(scenario),
      history: [],
      loopOutcomes: [],
    };
    state.loop.phase = "P6_GOODWILL";
    state.loop.charCounters.officeWorker.goodwill = 3;

    const result = resolveGoodwillAbility(state, {
      user: "officeWorker",
      rank: 3,
      abilityIndex: 0,
    }, "refuse");

    expect(result).toMatchObject({ refused: true, effectApplied: false });
    expect(state.loop.revealedRoleCharacters).toBeUndefined();
  });

  it("does not let an optional-refusal role refuse nurse's protected ability", () => {
    const scenario: Scenario = {
      tragedySet: "basicTragedy",
      mainPlot: "",
      subPlots: [],
      cast: { nurse: "killer", girlStudent: "person" },
      incidents: [],
      loops: 1,
      daysPerLoop: 3,
    };
    const state: GameState = {
      scenario,
      gamePhase: "ROUND",
      loop: initLoop(scenario),
      history: [],
      loopOutcomes: [],
    };
    state.loop.phase = "P6_GOODWILL";
    state.loop.charCounters.nurse.goodwill = 2;
    state.loop.charCounters.girlStudent.paranoia = 3;
    setBoardLocation(state.loop, "girlStudent", "Hospital");

    expect(() => resolveGoodwillAbility(state, {
      user: "nurse",
      rank: 2,
      abilityIndex: 0,
      target: "girlStudent",
    }, "refuse")).toThrow("this goodwill ability cannot be refused");
    expect(state.loop.charCounters.girlStudent.paranoia).toBe(3);
    expect(state.loop.publicInformationThisLoop).toBeUndefined();
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
    expect(state.loop.publicInformationThisLoop).toBeUndefined();
  });
});

describe("godlyBeing rank 3 / reveal an incident culprit", () => {
  it("reveals the selected scenario occurrence regardless of whether it fired", () => {
    const state = createInformationState(
      ["godlyBeing", "officeWorker", "alien"],
      [
        { day: 4, incident: "missingPerson", culprit: "officeWorker" },
        { day: 5, incident: "missingPerson", culprit: "alien" },
      ],
    );
    state.loop.charCounters.godlyBeing.goodwill = 3;

    const result = resolveGoodwillAbility(state, {
      user: "godlyBeing",
      rank: 3,
      abilityIndex: 1,
      incident: { day: 5, incident: "missingPerson" },
    }, "resolve");

    expect(result.effectApplied).toBe(true);
    expect(state.loop.publicInformationThisLoop).toEqual([{
      kind: "incidentCulprit",
      source: "godlyBeing",
      day: 5,
      incident: "missingPerson",
      culprit: "alien",
    }]);
    expect(state.loop.incidentOccurrencesFiredThisLoop).toBeUndefined();
  });

  it("rejects an incident occurrence that is not in the scenario", () => {
    const state = createInformationState(
      ["godlyBeing", "officeWorker"],
      [{ day: 4, incident: "missingPerson", culprit: "officeWorker" }],
    );
    state.loop.charCounters.godlyBeing.goodwill = 3;

    expect(() => resolveGoodwillAbility(state, {
      user: "godlyBeing",
      rank: 3,
      abilityIndex: 1,
      incident: { day: 5, incident: "missingPerson" },
    }, "resolve")).toThrow("chosen incident is not in the scenario");
    expect(state.loop.publicInformationThisLoop).toBeUndefined();
  });
});

describe("policeOfficer rank 4 / reveal a fired incident culprit", () => {
  it("reveals an occurrence that actually fired this loop", () => {
    const state = createInformationState(
      ["policeOfficer", "boyStudent", "girlStudent"],
      [
        { day: 1, incident: "suicide", culprit: "boyStudent" },
        { day: 2, incident: "foulEvil", culprit: "girlStudent" },
      ],
    );
    state.loop.charCounters.policeOfficer.goodwill = 4;
    state.loop.incidentsFiredThisLoop = ["suicide"];
    state.loop.incidentOccurrencesFiredThisLoop = [{
      day: 1,
      incident: "suicide",
      culprit: "boyStudent",
    }];

    resolveGoodwillAbility(state, {
      user: "policeOfficer",
      rank: 4,
      abilityIndex: 0,
      incident: { day: 1, incident: "suicide" },
    }, "resolve");

    expect(state.loop.publicInformationThisLoop).toEqual([{
      kind: "incidentCulprit",
      source: "policeOfficer",
      day: 1,
      incident: "suicide",
      culprit: "boyStudent",
    }]);
  });

  it("rejects a scheduled occurrence that did not fire", () => {
    const state = createInformationState(
      ["policeOfficer", "boyStudent", "girlStudent"],
      [
        { day: 1, incident: "suicide", culprit: "boyStudent" },
        { day: 2, incident: "foulEvil", culprit: "girlStudent" },
      ],
    );
    state.loop.charCounters.policeOfficer.goodwill = 4;
    state.loop.incidentsFiredThisLoop = ["suicide", "foulEvil"];
    state.loop.incidentOccurrencesFiredThisLoop = [{
      day: 1,
      incident: "suicide",
      culprit: "boyStudent",
    }];

    expect(() => resolveGoodwillAbility(state, {
      user: "policeOfficer",
      rank: 4,
      abilityIndex: 0,
      incident: { day: 2, incident: "foulEvil" },
    }, "resolve")).toThrow("requires an incident that fired this loop");
    expect(state.loop.publicInformationThisLoop).toBeUndefined();
  });

  it("rejects a past occurrence whose firing condition was not met", () => {
    const state = createInformationState(
      ["policeOfficer", "boyStudent"],
      [{ day: 1, incident: "suicide", culprit: "boyStudent" }],
    );
    state.loop.phase = "P7_INCIDENT";

    expect(resolveIncident(state)).toEqual({
      incident: "suicide",
      culprit: "boyStudent",
      fired: false,
      effectApplied: false,
    });
    expect(state.loop.incidentOccurrencesFiredThisLoop).toBeUndefined();

    state.loop.day = 2;
    state.loop.phase = "P6_GOODWILL";
    state.loop.charCounters.policeOfficer.goodwill = 4;

    expect(() => resolveGoodwillAbility(state, {
      user: "policeOfficer",
      rank: 4,
      abilityIndex: 0,
      incident: { day: 1, incident: "suicide" },
    }, "resolve")).toThrow("requires an incident that fired this loop");
    expect(state.loop.publicInformationThisLoop).toBeUndefined();
  });
});

describe("informer rank 5 / name another active subplot", () => {
  it("reveals the other active subplot when the leader names an active one", () => {
    const state = createInformationState(["informer"], []);
    state.loop.charCounters.informer.goodwill = 5;

    resolveGoodwillAbility(state, {
      user: "informer",
      rank: 5,
      abilityIndex: 0,
      declaredSubplot: "circleFriends",
      revealedSubplot: "threadsFate",
    }, "resolve");

    expect(state.loop.publicInformationThisLoop).toEqual([{
      kind: "subplot",
      source: "informer",
      declaredSubplot: "circleFriends",
      revealedSubplot: "threadsFate",
    }]);
  });

  it("allows an inactive declaration and either active subplot as the reveal", () => {
    const state = createInformationState(["informer"], []);
    state.loop.charCounters.informer.goodwill = 5;

    resolveGoodwillAbility(state, {
      user: "informer",
      rank: 5,
      abilityIndex: 0,
      declaredSubplot: "hiddenFreak",
      revealedSubplot: "circleFriends",
    }, "resolve");

    expect(state.loop.publicInformationThisLoop?.[0]).toMatchObject({
      declaredSubplot: "hiddenFreak",
      revealedSubplot: "circleFriends",
    });
  });

  it("does not reveal the same active subplot that the leader named", () => {
    const state = createInformationState(["informer"], []);
    state.loop.charCounters.informer.goodwill = 5;

    expect(() => resolveGoodwillAbility(state, {
      user: "informer",
      rank: 5,
      abilityIndex: 0,
      declaredSubplot: "circleFriends",
      revealedSubplot: "circleFriends",
    }, "resolve")).toThrow("must reveal a different active subplot");
  });
});

describe("ai rank 3 / resolve an incident effect as AI", () => {
  it("uses AI as the culprit without checking or recording incident firing", () => {
    const state = createInformationState(
      ["ai", "boyStudent", "girlStudent"],
      [{ day: 2, incident: "murder", culprit: "boyStudent" }],
    );
    state.loop.charCounters.ai.goodwill = 3;
    setBoardLocation(state.loop, "ai", "City");
    setBoardLocation(state.loop, "girlStudent", "City");

    const result = resolveGoodwillAbility(state, {
      user: "ai",
      rank: 3,
      abilityIndex: 2,
      incident: { day: 2, incident: "murder" },
      incidentChoice: { target: "girlStudent" },
    }, "resolve");

    expect(result.effectApplied).toBe(true);
    expect(boardIsAlive(state.loop, "girlStudent")).toBe(false);
    expect(state.loop.incidentsFiredThisLoop).toBeUndefined();
    expect(state.loop.incidentOccurrencesFiredThisLoop).toBeUndefined();
    expect(state.loop.publicInformationThisLoop).toEqual([{
      kind: "incidentEffect",
      source: "ai",
      day: 2,
      incident: "murder",
      culprit: "ai",
      effectApplied: true,
    }]);
  });

  it("uses the leader's incident choice for an effect that needs a location", () => {
    const state = createInformationState(
      ["ai", "officeWorker"],
      [{ day: 4, incident: "missingPerson", culprit: "officeWorker" }],
    );
    state.loop.charCounters.ai.goodwill = 3;

    resolveGoodwillAbility(state, {
      user: "ai",
      rank: 3,
      abilityIndex: 2,
      incident: { day: 4, incident: "missingPerson" },
      incidentChoice: { location: "Shrine" },
    }, "resolve");

    expect(boardLocation(state.loop, "ai")).toBe("Shrine");
    expect(state.loop.locIntrigue.Shrine).toBe(1);
    expect(boardLocation(state.loop, "officeWorker")).not.toBe("Shrine");
    expect(state.loop.incidentsFiredThisLoop).toBeUndefined();
  });

  it("does not choose a required incident-effect target implicitly", () => {
    const state = createInformationState(
      ["ai", "officeWorker"],
      [{ day: 4, incident: "missingPerson", culprit: "officeWorker" }],
    );
    state.loop.charCounters.ai.goodwill = 3;
    const before = boardLocation(state.loop, "ai");

    expect(() => resolveGoodwillAbility(state, {
      user: "ai",
      rank: 3,
      abilityIndex: 2,
      incident: { day: 4, incident: "missingPerson" },
    }, "resolve")).toThrow("requires a location target");
    expect(boardLocation(state.loop, "ai")).toBe(before);
    expect(state.loop.publicInformationThisLoop).toBeUndefined();
  });
});

describe("loop-long goodwill effects", () => {
  it("records henchman's incident suppression by culprit", () => {
    const state = createInformationState(["henchman"], []);
    state.loop.charCounters.henchman.goodwill = 3;

    const result = resolveGoodwillAbility(state, {
      user: "henchman",
      rank: 3,
      abilityIndex: 1,
    }, "resolve");

    expect(result.effectApplied).toBe(true);
    expect(state.loop.incidentCulpritSuppressedFor).toEqual(["henchman"]);
    expect(state.loop.publicInformationThisLoop).toBeUndefined();
  });

  it("records soldier as the protagonist-death blocker without public disclosure", () => {
    const state = createInformationState(["soldier"], []);
    state.loop.charCounters.soldier.goodwill = 5;

    const result = resolveGoodwillAbility(state, {
      user: "soldier",
      rank: 5,
      abilityIndex: 1,
    }, "resolve");

    expect(result.effectApplied).toBe(true);
    expect(state.loop.protagonistDeathPreventedBy).toEqual(["soldier"]);
    expect(state.loop.publicInformationThisLoop).toBeUndefined();
  });
});
