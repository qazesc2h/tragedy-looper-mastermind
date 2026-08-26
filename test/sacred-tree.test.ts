import { describe, expect, it } from "vitest";

import { advanceGame } from "../src/engine/game";
import {
  buildRolePossibilityTable,
  collectProtagonistObservations,
  enumerateRuleCombinations,
} from "../src/engine/hypothesis";
import {
  resolveSacredTreeLeaderTransfer,
  resolveSacredTreeMastermindTransfer,
  SACRED_TREE_TRAIT_SOURCE,
  sacredTreeLeaderChoiceRequired,
  sacredTreeMastermindChoiceRequired,
  sacredTreeTransferCondition,
} from "../src/engine/sacred-tree";
import { initLoop } from "../src/engine/setup";
import { TRAIT_IMPL } from "../src/impl/traits";
import type {
  CharacterId,
  GameState,
  RoleId,
  Scenario,
} from "../src/types";
import { setBoardLife, setBoardLocation } from "./helpers";

function sacredTreeState(role: RoleId = "person"): GameState {
  const cast: Record<CharacterId, RoleId> = {
    sacredTree: role,
    girlStudent: "person",
    doctor: "person",
  };
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "murderPlan",
    subPlots: ["circleFriends", "threadsFate"],
    cast,
    incidents: [],
    loops: 2,
    daysPerLoop: 3,
    scriptSpecified: { "startLocation:sacredTree": "Shrine" },
  };
  const loop = initLoop(scenario);
  for (const character of Object.keys(cast)) {
    setBoardLocation(loop, character, "Shrine");
  }
  loop.phase = "P4_RESOLVE";
  loop.actionResolutionComplete = true;
  loop.charCounters.sacredTree.goodwill = 1;
  return {
    scenario,
    gamePhase: "ROUND",
    loop,
    history: [],
    loopOutcomes: [],
  };
}

it("preserves the Sacred Tree trait source verbatim", () => {
  expect(TRAIT_IMPL.sacredTree.hooks[0]?.source.description).toBe(
    SACRED_TREE_TRAIT_SOURCE,
  );
});

describe("sacred-tree Leader transfer after P4", () => {
  it("requires an optional Leader decision every eligible turn and allows decline", () => {
    const state = sacredTreeState();

    expect(sacredTreeLeaderChoiceRequired(state)).toBe(true);
    expect(() => advanceGame(state)).toThrow(
      "sacred-tree Leader choice is required",
    );

    resolveSacredTreeLeaderTransfer(state);
    expect(state.loop.charCounters.sacredTree.goodwill).toBe(1);
    expect(state.loop.charCounters.girlStudent.goodwill).toBe(0);
    expect(sacredTreeLeaderChoiceRequired(state)).toBe(false);
    expect(collectProtagonistObservations(state).some(
      ({ kind }) => kind === "sacredTreeMastermindTransferJudged",
    )).toBe(false);

    advanceGame(state);
    expect(state.loop.phase).toBe("P6_GOODWILL");

    state.loop.day = 2;
    state.loop.phase = "P4_RESOLVE";
    state.loop.actionResolutionComplete = true;
    expect(sacredTreeLeaderChoiceRequired(state)).toBe(true);
  });

  it.each([
    "goodwill",
    "paranoia",
    "intrigue",
    "protection",
  ] as const)("moves one %s counter to another living character", (counter) => {
    const state = sacredTreeState();
    state.loop.charCounters.sacredTree.goodwill = 0;
    state.loop.charCounters.sacredTree[counter] = 1;

    resolveSacredTreeLeaderTransfer(state, {
      counter,
      target: "girlStudent",
    });

    expect(state.loop.charCounters.sacredTree[counter]).toBe(0);
    expect(state.loop.charCounters.girlStudent[counter]).toBe(1);
  });

  it("does not activate without a counter or another co-located living character", () => {
    const noCounter = sacredTreeState();
    noCounter.loop.charCounters.sacredTree.goodwill = 0;
    expect(sacredTreeLeaderChoiceRequired(noCounter)).toBe(false);

    const noTarget = sacredTreeState();
    setBoardLife(noTarget.loop, "girlStudent", false);
    setBoardLife(noTarget.loop, "doctor", false);
    expect(sacredTreeLeaderChoiceRequired(noTarget)).toBe(false);

    const elsewhere = sacredTreeState();
    setBoardLocation(elsewhere.loop, "girlStudent", "City");
    setBoardLocation(elsewhere.loop, "doctor", "City");
    expect(sacredTreeLeaderChoiceRequired(elsewhere)).toBe(false);
  });

  it("does not activate while Sacred Tree is dead or absent", () => {
    const dead = sacredTreeState();
    setBoardLife(dead.loop, "sacredTree", false);
    expect(sacredTreeLeaderChoiceRequired(dead)).toBe(false);

    const absent = sacredTreeState();
    absent.loop.board.sacredTree = { status: "absent" };
    expect(sacredTreeLeaderChoiceRequired(absent)).toBe(false);
  });
});

describe("sacred-tree mandatory Mastermind transfer at P5", () => {
  const basicGoodwillRefusalRoles = [
    "killer",
    "brain",
    "factor",
    "cultist",
    "witch",
  ] as const;

  it.each(basicGoodwillRefusalRoles)(
    "appears and blocks progression for the %s role",
    (role) => {
      const state = sacredTreeState(role);
      state.loop.phase = "P5_MASTERMIND_ABILITY";
      state.loop.actionResolutionComplete = false;

      expect(sacredTreeMastermindChoiceRequired(state)).toBe(true);
      expect(() => advanceGame(state)).toThrow(
        "sacred-tree Mastermind transfer is mandatory",
      );
    },
  );

  it("does not appear for a role without Goodwill Refusal", () => {
    const state = sacredTreeState("person");
    state.loop.phase = "P5_MASTERMIND_ABILITY";
    state.loop.actionResolutionComplete = false;

    expect(sacredTreeMastermindChoiceRequired(state)).toBe(false);
    advanceGame(state);
    expect(state.loop.phase).toBe("P6_GOODWILL");
    expect(collectProtagonistObservations(state)).toContainEqual(
      expect.objectContaining({
        kind: "sacredTreeMastermindTransferJudged",
        eligible: true,
        performed: false,
      }),
    );
  });

  it("moves the selected counter and records the public result and precondition", () => {
    const state = sacredTreeState("killer");
    state.loop.phase = "P5_MASTERMIND_ABILITY";
    state.loop.actionResolutionComplete = false;

    resolveSacredTreeMastermindTransfer(state, {
      counter: "goodwill",
      target: "doctor",
    });

    expect(state.loop.charCounters.sacredTree.goodwill).toBe(0);
    expect(state.loop.charCounters.doctor.goodwill).toBe(1);
    expect(collectProtagonistObservations(state)).toContainEqual(
      expect.objectContaining({
        kind: "sacredTreeMastermindTransferJudged",
        eligible: true,
        performed: true,
        condition: expect.objectContaining({
          sacredTreeStatus: "alive",
          transferableCounters: ["goodwill"],
          eligibleTargets: ["girlStudent", "doctor"],
        }),
        changes: expect.arrayContaining([
          expect.objectContaining({
            kind: "counter",
            target: { kind: "character", id: "sacredTree" },
            counter: "goodwill",
            delta: -1,
          }),
          expect.objectContaining({
            kind: "counter",
            target: { kind: "character", id: "doctor" },
            counter: "goodwill",
            delta: 1,
          }),
        ]),
      }),
    );
  });

  it("records an ineligible non-activation without treating it as refusal evidence", () => {
    const state = sacredTreeState("killer");
    state.loop.phase = "P5_MASTERMIND_ABILITY";
    state.loop.actionResolutionComplete = false;
    state.loop.charCounters.sacredTree.goodwill = 0;

    expect(sacredTreeMastermindChoiceRequired(state)).toBe(false);
    advanceGame(state);
    const observation = collectProtagonistObservations(state).find(
      ({ kind }) => kind === "sacredTreeMastermindTransferJudged",
    );
    expect(observation).toEqual(expect.objectContaining({
      eligible: false,
      performed: false,
      condition: expect.objectContaining({ transferableCounters: [] }),
    }));

    const table = buildRolePossibilityTable(
      "basicTragedy",
      ["sacredTree", "doctor", "patient", "girlStudent", "officeWorker",
        "informer", "boyStudent", "classRep", "shrineMaiden"],
      enumerateRuleCombinations("basicTragedy"),
      observation === undefined ? [] : [observation],
    );
    expect(table.cells.sacredTree.killer.status).toBe("possible");
    expect(table.cells.sacredTree.person.status).toBe("possible");
  });

  it.each(["noTarget", "dead", "absent"] as const)(
    "does not require the Mastermind transfer when Sacred Tree is %s",
    (condition) => {
      const state = sacredTreeState("killer");
      state.loop.phase = "P5_MASTERMIND_ABILITY";
      state.loop.actionResolutionComplete = false;
      if (condition === "noTarget") {
        setBoardLife(state.loop, "girlStudent", false);
        setBoardLife(state.loop, "doctor", false);
      } else if (condition === "dead") {
        setBoardLife(state.loop, "sacredTree", false);
      } else {
        state.loop.board.sacredTree = { status: "absent" };
      }

      expect(sacredTreeMastermindChoiceRequired(state)).toBe(false);
      expect(sacredTreeTransferCondition(state)).toEqual(
        expect.objectContaining({
          transferableCounters: condition === "noTarget" ? ["goodwill"] : [],
          eligibleTargets: [],
        }),
      );
      advanceGame(state);
      expect(collectProtagonistObservations(state)).toContainEqual(
        expect.objectContaining({
          kind: "sacredTreeMastermindTransferJudged",
          eligible: false,
          performed: false,
        }),
      );
    },
  );
});

describe("sacred-tree role deductions", () => {
  const publicCast = [
    "sacredTree",
    "doctor",
    "patient",
    "girlStudent",
    "officeWorker",
    "informer",
    "boyStudent",
    "classRep",
    "shrineMaiden",
  ];
  const combinations = enumerateRuleCombinations("basicTragedy");

  function tableFor(performed: boolean) {
    return buildRolePossibilityTable(
      "basicTragedy",
      publicCast,
      combinations,
      [{
        kind: "sacredTreeMastermindTransferJudged",
        loop: 1,
        day: 1,
        eligible: true,
        performed,
        condition: {
          sacredTreeStatus: "alive",
          transferableCounters: ["goodwill"],
          eligibleTargets: ["doctor"],
        },
      }],
    );
  }

  it("a performed mandatory transfer leaves only Goodwill Refusal roles", () => {
    const table = tableFor(true);

    expect(table.cells.sacredTree.person.status).toBe("impossible");
    expect(table.cells.sacredTree.killer.status).toBe("possible");
    expect(table.cells.sacredTree.brain.status).toBe("possible");
    expect(table.cells.sacredTree.factor.status).toBe("possible");
    expect(table.cells.sacredTree.cultist.status).toBe("possible");
    expect(table.cells.sacredTree.witch.status).toBe("possible");
  });

  it("an eligible missing transfer excludes every Goodwill Refusal role", () => {
    const table = tableFor(false);

    for (const role of ["killer", "brain", "factor", "cultist", "witch"]) {
      expect(table.cells.sacredTree[role].status).toBe("impossible");
    }
    expect(table.cells.sacredTree.person.status).toBe("possible");
  });
});
