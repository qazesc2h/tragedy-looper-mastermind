import { describe, expect, it } from "vitest";

import { killCharacter } from "../src/engine/death";
import { advanceGame } from "../src/engine/game";
import { resolveGoodwillAbility } from "../src/engine/goodwill";
import { evaluateStateIncidentHypotheses } from "../src/engine/incident-hypothesis";
import { resolveHooks } from "../src/engine/phases";
import {
  currentServantFollowOptions,
  resolveActions,
  setServantMovementChoice,
} from "../src/engine/resolve";
import { initLoop } from "../src/engine/setup";
import { goodwillAbilityViews } from "../src/ui/goodwill-abilities";
import type {
  CharacterId,
  GameState,
  PlacedCard,
  RoleId,
  Scenario,
} from "../src/types";
import {
  boardIsAlive,
  boardLocation,
  setBoardLife,
  setBoardLocation,
} from "./helpers";

function servantState(
  roles: Record<CharacterId, RoleId> = {
    servant: "person",
    richStudent: "person",
    boss: "person",
    girlStudent: "person",
  },
): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "",
    subPlots: [],
    cast: roles,
    incidents: [],
    loops: 2,
    daysPerLoop: 3,
    scriptSpecified: {
      "startLocation:servant": "City",
      ...("boss" in roles ? { "Turf:boss": "School" } : {}),
    },
  };
  const loop = initLoop(scenario);
  for (const character of Object.keys(roles)) {
    setBoardLocation(loop, character, "City");
  }
  loop.phase = "P4_RESOLVE";
  return {
    scenario,
    gamePhase: "ROUND",
    loop,
    history: [],
    loopOutcomes: [],
  };
}

function place(
  owner: PlacedCard["owner"],
  card: PlacedCard["card"],
  character: CharacterId,
): PlacedCard {
  return { owner, card, target: { kind: "character", id: character } };
}

describe("servant forced accompanying movement", () => {
  it("automatically follows a single moving owner", () => {
    const state = servantState();
    state.loop.placed = [place("mastermind", "moveHorizontal", "richStudent")];

    expect(currentServantFollowOptions(state)).toEqual([
      { character: "richStudent", to: "School" },
    ]);
    resolveActions(state);

    expect(boardLocation(state.loop, "richStudent")).toBe("School");
    expect(boardLocation(state.loop, "servant")).toBe("School");
  });

  it("FAQ Q25: ignores the Servant's movement and Forbid Movement when following", () => {
    const state = servantState();
    state.loop.placed = [
      place("mastermind", "moveHorizontal", "richStudent"),
      place(1, "forbidMove", "servant"),
    ];
    resolveActions(state);

    expect(boardLocation(state.loop, "richStudent")).toBe("School");
    expect(boardLocation(state.loop, "servant")).toBe("School");
    expect(state.loop.servantMovementChoice).toBeUndefined();
  });

  it("ignores the Servant's own movement card when following", () => {
    const state = servantState();
    state.loop.placed = [
      place("mastermind", "moveHorizontal", "richStudent"),
      place(0, "moveVertical", "servant"),
    ];
    resolveActions(state);

    expect(boardLocation(state.loop, "richStudent")).toBe("School");
    expect(boardLocation(state.loop, "servant")).toBe("School");
  });

  it("lets the Leader choose either owner when both move in different directions", () => {
    const state = servantState();
    state.loop.placed = [
      place("mastermind", "moveHorizontal", "richStudent"),
      place(0, "moveVertical", "boss"),
      place(1, "moveDiagonal", "servant"),
    ];

    expect(currentServantFollowOptions(state)).toEqual([
      { character: "richStudent", to: "School" },
      { character: "boss", to: "Hospital" },
    ]);
    setServantMovementChoice(state, "boss");
    resolveActions(state);

    expect(boardLocation(state.loop, "richStudent")).toBe("School");
    expect(boardLocation(state.loop, "boss")).toBe("Hospital");
    expect(boardLocation(state.loop, "servant")).toBe("Hospital");
  });

  it("automatically follows when multiple owners have the same destination", () => {
    const state = servantState();
    state.loop.placed = [
      place("mastermind", "moveHorizontal", "richStudent"),
      place(0, "moveHorizontal", "boss"),
      place(1, "moveDiagonal", "servant"),
    ];

    expect(currentServantFollowOptions(state)).toEqual([
      { character: "richStudent", to: "School" },
    ]);
    resolveActions(state);

    expect(boardLocation(state.loop, "richStudent")).toBe("School");
    expect(boardLocation(state.loop, "boss")).toBe("School");
    expect(boardLocation(state.loop, "servant")).toBe("School");
  });

  it("resolves the Servant's own movement when no owner moves", () => {
    const state = servantState();
    state.loop.placed = [
      place(0, "moveVertical", "servant"),
    ];

    resolveActions(state);

    expect(boardLocation(state.loop, "richStudent")).toBe("City");
    expect(boardLocation(state.loop, "servant")).toBe("Hospital");
  });

  it("does not follow an owner whose movement is forbidden", () => {
    const state = servantState();
    state.loop.placed = [
      place("mastermind", "moveHorizontal", "richStudent"),
      place(1, "forbidMove", "richStudent"),
      place(0, "moveVertical", "servant"),
    ];

    expect(currentServantFollowOptions(state)).toEqual([]);
    resolveActions(state);

    expect(boardLocation(state.loop, "richStudent")).toBe("City");
    expect(boardLocation(state.loop, "servant")).toBe("Hospital");
  });

  it("does not follow an added owner whose destination is forbidden", () => {
    const state = servantState({
      servant: "person",
      richStudent: "person",
      boss: "person",
      officeWorker: "person",
    });
    state.loop.servantAdditionalServedCharacters.push("officeWorker");
    state.loop.placed = [
      place("mastermind", "moveHorizontal", "officeWorker"),
      place(0, "moveVertical", "servant"),
    ];

    expect(currentServantFollowOptions(state)).toEqual([]);
    resolveActions(state);

    expect(boardLocation(state.loop, "officeWorker")).toBe("City");
    expect(boardLocation(state.loop, "servant")).toBe("Hospital");
  });

  it("lets the Leader choose between split destinations with three served owners", () => {
    const state = servantState();
    state.loop.servantAdditionalServedCharacters.push("girlStudent");
    state.loop.placed = [
      place("mastermind", "moveHorizontal", "richStudent"),
      place(0, "moveHorizontal", "boss"),
      place(1, "moveVertical", "girlStudent"),
    ];

    expect(currentServantFollowOptions(state)).toEqual([
      { character: "richStudent", to: "School" },
      { character: "girlStudent", to: "Hospital" },
    ]);
    setServantMovementChoice(state, "girlStudent");
    resolveActions(state);

    expect(boardLocation(state.loop, "servant")).toBe("Hospital");
  });
});

describe("servant substitute death", () => {
  it("kills the living co-located Servant instead of an owner", () => {
    const state = servantState();

    expect(killCharacter(state, "richStudent")).toBe(true);

    expect(boardIsAlive(state.loop, "richStudent")).toBe(true);
    expect(boardIsAlive(state.loop, "servant")).toBe(false);
    expect(state.loop.phaseLog).toContainEqual(expect.objectContaining({
      kind: "abilityActivated",
      character: "servant",
      publicChanges: [{
        kind: "status",
        character: "servant",
        from: "alive",
        to: "dead",
      }],
    }));
  });

  it("FAQ Q24: produces no death when the owner is Unkillable", () => {
    const state = servantState({
      servant: "person",
      richStudent: "timeTraveler",
    });

    expect(killCharacter(state, "richStudent")).toBe(false);
    expect(boardIsAlive(state.loop, "richStudent")).toBe(true);
    expect(boardIsAlive(state.loop, "servant")).toBe(true);
  });

  it("consumes the owner's protection before considering substitution", () => {
    const state = servantState();
    state.loop.charCounters.richStudent.protection = 1;

    expect(killCharacter(state, "richStudent")).toBe(false);

    expect(state.loop.charCounters.richStudent.protection).toBe(0);
    expect(boardIsAlive(state.loop, "richStudent")).toBe(true);
    expect(boardIsAlive(state.loop, "servant")).toBe(true);
  });

  it("kills the owner when the Servant is already dead or elsewhere", () => {
    const deadServant = servantState();
    setBoardLife(deadServant.loop, "servant", false);
    expect(killCharacter(deadServant, "richStudent")).toBe(true);
    expect(boardIsAlive(deadServant.loop, "richStudent")).toBe(false);

    const distantServant = servantState();
    setBoardLocation(distantServant.loop, "servant", "Shrine");
    expect(killCharacter(distantServant, "richStudent")).toBe(true);
    expect(boardIsAlive(distantServant.loop, "richStudent")).toBe(false);
  });

  it("FAQ Q24: a Serial Killer Servant dies in her owner's place", () => {
    const state = servantState({
      servant: "serialKiller",
      richStudent: "person",
    });
    state.loop.phase = "P9_ROUND_END";

    resolveHooks(state, "P9_ROUND_END");

    expect(boardIsAlive(state.loop, "richStudent")).toBe(true);
    expect(boardIsAlive(state.loop, "servant")).toBe(false);
  });

  it("keeps the owner alive under the conservative pending ruling when the Servant is Unkillable", () => {
    const state = servantState({
      servant: "timeTraveler",
      richStudent: "person",
    });

    expect(killCharacter(state, "richStudent")).toBe(false);
    expect(boardIsAlive(state.loop, "richStudent")).toBe(true);
    expect(boardIsAlive(state.loop, "servant")).toBe(true);
  });
});

describe("servant public death observation", () => {
  it("does not identify the Servant as a suicide culprit after substitution", () => {
    const state = servantState({
      servant: "person",
      richStudent: "person",
    });
    state.scenario.incidents = [{
      day: 1,
      incident: "suicide",
      culprit: "richStudent",
    }];
    state.loop.phase = "P7_INCIDENT";
    state.loop.charCounters.richStudent.paranoia = 3;

    advanceGame(state);

    const table = evaluateStateIncidentHypotheses(state);
    const column = table.columns[0];
    expect(column).toBeDefined();
    expect(table.cells.servant[column.id].reasons).not.toContainEqual(
      expect.objectContaining({ code: "suicideDeathIdentified" }),
    );
  });

  it("does not exclude a murder culprit merely because substitution killed the Servant", () => {
    const state = servantState({
      servant: "person",
      richStudent: "person",
    });
    state.scenario.incidents = [{
      day: 1,
      incident: "murder",
      culprit: "servant",
    }];
    state.loop.phase = "P7_INCIDENT";
    state.loop.charCounters.servant.paranoia = 3;

    advanceGame(state, { target: "richStudent" });

    const table = evaluateStateIncidentHypotheses(state);
    const column = table.columns[0];
    expect(column).toBeDefined();
    expect(table.cells.servant[column.id].reasons).not.toContainEqual(
      expect.objectContaining({ code: "murderVictimCannotBeCulprit" }),
    );
  });
});

describe("servant rank 4 goodwill", () => {
  it("adds a living target for movement and substitute death until loop end", () => {
    const state = servantState();
    state.loop.phase = "P6_GOODWILL";
    state.loop.charCounters.servant.goodwill = 4;

    const view = goodwillAbilityViews(state).find(
      ({ character }) => character === "servant",
    );
    expect(view?.targets).toContainEqual({
      kind: "character",
      id: "girlStudent",
    });
    expect(view?.disabledReason).toBeUndefined();

    expect(resolveGoodwillAbility(state, {
      user: "servant",
      rank: 4,
      abilityIndex: 1,
      target: "girlStudent",
    }, "resolve").effectApplied).toBe(true);
    expect(state.loop.servantAdditionalServedCharacters).toEqual([
      "girlStudent",
    ]);

    expect(killCharacter(state, "girlStudent")).toBe(true);
    expect(boardIsAlive(state.loop, "girlStudent")).toBe(true);
    expect(boardIsAlive(state.loop, "servant")).toBe(false);

    const nextLoop = initLoop(state.scenario, 2);
    expect(nextLoop.servantAdditionalServedCharacters).toEqual([]);
  });

  it("lets an added owner trigger accompanying movement", () => {
    const state = servantState();
    state.loop.servantAdditionalServedCharacters.push("girlStudent");
    state.loop.placed = [
      place("mastermind", "moveDiagonal", "girlStudent"),
    ];

    expect(currentServantFollowOptions(state)).toEqual([
      { character: "girlStudent", to: "Shrine" },
    ]);
    resolveActions(state);
    expect(boardLocation(state.loop, "servant")).toBe("Shrine");
  });
});
