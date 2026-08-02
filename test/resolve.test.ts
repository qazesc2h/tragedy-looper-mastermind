import { describe, expect, it } from "vitest";

import { characterDataOf } from "../src/data";
import { resolveIncident } from "../src/engine/incident";
import { resolveActions } from "../src/engine/resolve";
import { initLoop } from "../src/engine/setup";
import type {
  ActionCard,
  CharacterId,
  Counters,
  GameState,
  Location,
  LoopState,
  PlacedCard,
  Scenario,
} from "../src/types";
import { loadManualExamples } from "./helpers";

const EXECUTABLE_CASE_IDS = new Set([
  "resolve-basic",
  "move-compose-forbidden-location",
  "move-forbid-card",
  "move-same-card-twice",
  "intrigue-forbid-single",
  "intrigue-forbid-doubled-cancels",
  "paranoia-plus-minus-order",
]);

interface ResolveExpectation {
  board?: Record<CharacterId, Location>;
  counters?: Record<CharacterId, Partial<Counters>>;
  locIntrigue?: Partial<Record<Location, number>>;
  spentOncePerLoop?: {
    mastermind?: ActionCard[];
    protagonists?: [ActionCard[], ActionCard[], ActionCard[]];
  };
}

interface ManualCase {
  id: string;
  setup?: string;
  placed?: PlacedCard[];
  expect?: ResolveExpectation;
  cases?: IncidentTriggerCase[];
}

interface IncidentTriggerCase {
  culprit: CharacterId;
  paranoia: number;
  alive: boolean;
  paranoiaLimit: number;
  expectFires: boolean;
}

interface ManualExamplesView {
  setups: Record<string, {
    board: Record<CharacterId, Location>;
  }>;
  cases: ManualCase[];
}

const manualExamples =
  loadManualExamples() as unknown as ManualExamplesView;

function createFixtureState(testCase: ManualCase): GameState {
  if (!testCase.setup || !testCase.placed) {
    throw new Error(`fixture "${testCase.id}" is not an action resolve case`);
  }
  const setup = manualExamples.setups[testCase.setup];
  if (!setup) {
    throw new Error(
      `fixture "${testCase.id}" references unknown setup "${testCase.setup}"`,
    );
  }

  const cast: Scenario["cast"] = {};
  for (const character of Object.keys(setup.board)) {
    cast[character] = "person";
  }
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "",
    subPlots: [],
    cast,
    incidents: [],
    loops: 1,
    daysPerLoop: 1,
  };
  const loop = initLoop(scenario);
  for (const [character, location] of Object.entries(setup.board)) {
    loop.board[character].at = location;
  }
  loop.placed = structuredClone(testCase.placed);

  return { scenario, loop, history: [] };
}

function expectFixtureResult(
  state: GameState,
  expected: ResolveExpectation,
): void {
  for (const [character, location] of Object.entries(expected.board ?? {})) {
    expect(state.loop.board[character].at).toBe(location);
  }
  for (const [character, counters] of Object.entries(
    expected.counters ?? {},
  )) {
    if (counters.goodwill !== undefined) {
      expect(state.loop.charCounters[character].goodwill).toBe(
        counters.goodwill,
      );
    }
    if (counters.paranoia !== undefined) {
      expect(state.loop.charCounters[character].paranoia).toBe(
        counters.paranoia,
      );
    }
    if (counters.intrigue !== undefined) {
      expect(state.loop.charCounters[character].intrigue).toBe(
        counters.intrigue,
      );
    }
  }
  for (const [location, intrigue] of Object.entries(
    expected.locIntrigue ?? {},
  )) {
    expect(state.loop.locIntrigue[location as Location]).toBe(intrigue);
  }
  if (expected.spentOncePerLoop?.mastermind) {
    expect(state.loop.spentOncePerLoop.mastermind).toEqual(
      expected.spentOncePerLoop.mastermind,
    );
  }
  if (expected.spentOncePerLoop?.protagonists) {
    expect(state.loop.spentOncePerLoop.protagonists).toEqual(
      expected.spentOncePerLoop.protagonists,
    );
  }
}

function expectedSpentCards(
  placed: readonly PlacedCard[],
): LoopState["spentOncePerLoop"] {
  const spent: LoopState["spentOncePerLoop"] = {
    mastermind: [],
    protagonists: [[], [], []],
  };
  const protagonistCards = new Set<ActionCard>([
    "goodwillPlus2",
    "paranoiaMinus1",
    "forbidMove",
  ]);
  const mastermindCards = new Set<ActionCard>([
    "moveDiagonal",
    "intriguePlus2",
  ]);

  for (const placedCard of placed) {
    if (
      placedCard.owner === "mastermind" &&
      mastermindCards.has(placedCard.card)
    ) {
      spent.mastermind.push(placedCard.card);
    } else if (
      placedCard.owner !== "mastermind" &&
      protagonistCards.has(placedCard.card)
    ) {
      spent.protagonists[placedCard.owner].push(placedCard.card);
    }
  }
  return spent;
}

describe("manual resolution examples", () => {
  for (const testCase of manualExamples.cases) {
    if (testCase.id === "incident-trigger-condition") {
      continue;
    }
    if (!EXECUTABLE_CASE_IDS.has(testCase.id)) {
      it.todo(testCase.id);
      continue;
    }

    it(testCase.id, () => {
      if (!testCase.placed || !testCase.expect) {
        throw new Error(`fixture "${testCase.id}" is incomplete`);
      }
      const expectedSpent = expectedSpentCards(testCase.placed);
      const state = createFixtureState(testCase);

      expect(resolveActions(state)).toBe(state);

      expectFixtureResult(state, testCase.expect);
      expect(state.loop.spentOncePerLoop).toEqual(expectedSpent);
      expect(state.loop.placed).toEqual([]);
    });
  }

  const incidentTriggerFixture = manualExamples.cases.find(
    (testCase) => testCase.id === "incident-trigger-condition",
  );
  for (const [index, triggerCase] of
    (incidentTriggerFixture?.cases ?? []).entries()) {
    it(`incident-trigger-condition ${index + 1}`, () => {
      const scenario: Scenario = {
        tragedySet: "basicTragedy",
        mainPlot: "",
        subPlots: [],
        cast: { [triggerCase.culprit]: "person" },
        incidents: [{
          day: 1,
          incident: "foulEvil",
          culprit: triggerCase.culprit,
        }],
        loops: 1,
        daysPerLoop: 1,
      };
      const state: GameState = {
        scenario,
        loop: initLoop(scenario),
        history: [],
      };
      state.loop.board[triggerCase.culprit].alive = triggerCase.alive;
      state.loop.charCounters[triggerCase.culprit].paranoia =
        triggerCase.paranoia;

      expect(characterDataOf(triggerCase.culprit).paranoiaLimit).toBe(
        triggerCase.paranoiaLimit,
      );
      const result = resolveIncident(state);

      expect(result.fired).toBe(triggerCase.expectFires);
      expect(result.effectApplied).toBe(triggerCase.expectFires);
    });
  }

  it("tracks the mastermind's once-per-loop cards", () => {
    const sourceCase = manualExamples.cases.find(
      (testCase) => testCase.id === "resolve-basic",
    );
    if (!sourceCase) throw new Error("resolve-basic fixture is missing");
    const state = createFixtureState(sourceCase);
    state.loop.placed = [
      {
        owner: "mastermind",
        card: "moveDiagonal",
        target: { kind: "character", id: "policeOfficer" },
      },
      {
        owner: "mastermind",
        card: "intriguePlus2",
        target: { kind: "location", at: "School" },
      },
    ];

    resolveActions(state);

    expect(state.loop.spentOncePerLoop.mastermind).toEqual([
      "moveDiagonal",
      "intriguePlus2",
    ]);
    expect(state.loop.locIntrigue.School).toBe(2);
  });

  it("ignores goodwill and paranoia effects forbidden on the same target", () => {
    const sourceCase = manualExamples.cases.find(
      (testCase) => testCase.id === "resolve-basic",
    );
    if (!sourceCase) throw new Error("resolve-basic fixture is missing");
    const state = createFixtureState(sourceCase);
    state.loop.placed = [
      {
        owner: "mastermind",
        card: "goodwillPlus1",
        target: { kind: "character", id: "girlStudent" },
      },
      {
        owner: 0,
        card: "forbidGoodwill",
        target: { kind: "character", id: "girlStudent" },
      },
      {
        owner: "mastermind",
        card: "paranoiaPlus1",
        target: { kind: "character", id: "boyStudent" },
      },
      {
        owner: 1,
        card: "forbidParanoia",
        target: { kind: "character", id: "boyStudent" },
      },
    ];

    resolveActions(state);

    expect(state.loop.charCounters.girlStudent.goodwill).toBe(0);
    expect(state.loop.charCounters.boyStudent.paranoia).toBe(0);
  });
});
