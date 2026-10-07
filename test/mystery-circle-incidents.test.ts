import { describe, expect, it } from "vitest";

import {
  incidentFires,
  resolveIncident,
  resolveIncidentEffect,
} from "../src/engine/incident";
import { evaluateStateIncidentHypotheses } from "../src/engine/incident-hypothesis";
import {
  moveCharacterIfAllowed,
  resolveMovementPlan,
} from "../src/engine/movement";
import { initLoop } from "../src/engine/setup";
import type { GameState, Scenario } from "../src/types";
import { setBoardLocation } from "./helpers";

function scenario(
  incident: string,
  cast: Scenario["cast"] = {
    boyStudent: "person",
    girlStudent: "person",
    officeWorker: "person",
  },
): Scenario {
  return {
    tragedySet: "mysteryCircle",
    mainPlot: "murderPlan",
    subPlots: ["hiddenFreak", "smellGunpowder"],
    cast,
    incidents: [{ day: 1, incident, culprit: "boyStudent" }],
    loops: 3,
    daysPerLoop: 5,
  };
}

function stateFor(
  incident: string,
  cast?: Scenario["cast"],
): GameState {
  const value = scenario(incident, cast);
  return {
    scenario: value,
    gamePhase: "ROUND",
    loop: initLoop(value),
    history: [],
    loopOutcomes: [],
  };
}

function recordOccurrence(
  state: GameState,
  occurrence: ReturnType<typeof resolveIncident>["occurrences"][number],
): void {
  state.loop.phaseLog = [{
    loop: state.loop.loop,
    day: state.loop.day,
    phase: "P7_INCIDENT",
    kind: "incidentJudged",
    occurrenceId: occurrence.occurrenceId,
    declaredIncident: occurrence.declaredIncident,
    actualIncident: occurrence.actualIncident,
    culprit: occurrence.culprit,
    fired: occurrence.fired,
    effectApplied: occurrence.effectApplied,
    failureReasons: occurrence.failureReasons,
    publicContext: occurrence.publicContext,
    publicChanges: occurrence.publicChanges,
    deaths: occurrence.deaths,
    culpritLocationRevealed: occurrence.culpritLocationRevealed,
  }];
}

describe("Mystery Circle incidents without persistent movement effects", () => {
  it("triggers Portent one below the printed paranoia limit and adds paranoia in the effective culprit location", () => {
    const state = stateFor("portent");
    state.loop.charCounters.boyStudent.paranoia = 2;
    setBoardLocation(state.loop, "boyStudent", "City");
    setBoardLocation(state.loop, "girlStudent", "City");
    setBoardLocation(state.loop, "officeWorker", "School");

    expect(incidentFires(state, "boyStudent", "portent")).toBe(true);
    expect(resolveIncidentEffect(state, "portent", "boyStudent", {
      target: "girlStudent",
    })).toBe(true);
    expect(state.loop.charCounters.girlStudent.paranoia).toBe(1);
    expect(() => resolveIncidentEffect(state, "portent", "boyStudent", {
      target: "officeWorker",
    })).toThrow("portent target is not eligible");

    state.loop.charCounters.boyStudent.paranoia = 0;
    expect(incidentFires(state, "boyStudent", "portent")).toBe(false);
  });

  it("applies each Terrorism threshold independently", () => {
    const below = stateFor("terrorism");
    setBoardLocation(below.loop, "girlStudent", "City");
    expect(resolveIncidentEffect(below, "terrorism", "boyStudent")).toBe(false);
    expect(below.loop.board.girlStudent.status).toBe("alive");
    expect(below.pendingLoopEnd).toBeUndefined();

    const one = stateFor("terrorism");
    one.loop.locIntrigue.City = 1;
    setBoardLocation(one.loop, "girlStudent", "City");
    setBoardLocation(one.loop, "officeWorker", "School");
    expect(resolveIncidentEffect(one, "terrorism", "boyStudent")).toBe(true);
    expect(one.loop.board.girlStudent.status).toBe("dead");
    expect(one.loop.board.officeWorker.status).toBe("alive");
    expect(one.pendingLoopEnd).toBeUndefined();

    const two = stateFor("terrorism");
    two.loop.locIntrigue.City = 2;
    expect(resolveIncidentEffect(two, "terrorism", "boyStudent")).toBe(true);
    expect(two.pendingLoopEnd?.reason).toBe("protagonistDeath");
  });

  it("ends the loop for Silver Bullet without increasing the special gauge", () => {
    const state = stateFor("silverBullet");
    state.loop.phase = "P7_INCIDENT";
    state.loop.charCounters.boyStudent.paranoia = 3;

    const result = resolveIncident(state);

    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]).toMatchObject({
      fired: true,
      effectApplied: true,
      declaredIncident: "silverBullet",
    });
    expect(state.loop.specialGauge?.value).toBe(0);
    expect(result.occurrences[0]?.publicChanges).toContainEqual({
      kind: "specialGauge",
      beforeValue: 0,
      afterValue: 0,
      delta: 0,
      incident: {
        declaredIncident: "silverBullet",
        occurrenceId: "1:silverBullet",
      },
    });
    expect(state.pendingLoopEnd?.reason).toBe("effect");
  });

  it("resolves Bestial Murder as one occurrence with two ordered effects and gauge +2", () => {
    const state = stateFor("bestialMurder");
    state.loop.charCounters.boyStudent.paranoia = 3;
    setBoardLocation(state.loop, "boyStudent", "City");
    setBoardLocation(state.loop, "girlStudent", "City");
    setBoardLocation(state.loop, "officeWorker", "School");

    expect(incidentFires(state, "boyStudent", "bestialMurder")).toBe(true);
    state.loop.charCounters.boyStudent.paranoia = 2;
    expect(incidentFires(state, "boyStudent", "bestialMurder")).toBe(false);
    state.loop.charCounters.boyStudent.paranoia = 3;

    const result = resolveIncident(state, {
      decisions: [
        {
          kind: "subIncident",
          key: "serialMurder",
          decisions: [{
            kind: "character",
            key: "target",
            id: "girlStudent",
          }],
        },
        {
          kind: "subIncident",
          key: "increasingUnease",
          decisions: [
            { kind: "character", key: "target", id: "officeWorker" },
            {
              kind: "character",
              key: "otherTarget",
              id: "boyStudent",
            },
          ],
        },
      ],
    });

    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]).toMatchObject({
      occurrenceId: "1:bestialMurder",
      declaredIncident: "bestialMurder",
      fired: true,
      effectApplied: true,
      deaths: ["girlStudent"],
    });
    expect(state.loop.board.girlStudent.status).toBe("dead");
    expect(state.loop.charCounters.officeWorker.paranoia).toBe(2);
    expect(state.loop.charCounters.boyStudent.intrigue).toBe(1);
    expect(state.loop.specialGauge?.value).toBe(2);
    expect(state.loop.incidentsFiredThisLoop).toEqual(["bestialMurder"]);
    expect(state.loop.incidentOccurrencesFiredThisLoop).toHaveLength(1);
    expect(result.occurrences[0]?.publicChanges).toContainEqual({
      kind: "specialGauge",
      beforeValue: 0,
      afterValue: 2,
      delta: 2,
      incident: {
        declaredIncident: "bestialMurder",
        occurrenceId: "1:bestialMurder",
      },
    });
  });

  it("moves a Suspicious Letter target and blocks every movement only on the next day", () => {
    const state = stateFor("suspiciousLetter");
    state.loop.charCounters.boyStudent.paranoia = 2;
    setBoardLocation(state.loop, "boyStudent", "City");
    setBoardLocation(state.loop, "girlStudent", "City");

    expect(resolveIncidentEffect(state, "suspiciousLetter", "boyStudent", {
      target: "girlStudent",
      destination: "School",
    })).toBe(true);
    expect(state.loop.board.girlStudent).toEqual({
      status: "alive",
      at: "School",
    });
    expect(state.loop.movementRestrictions).toEqual([{
      kind: "character",
      character: "girlStudent",
      startDay: 2,
      throughDay: 2,
      source: "suspiciousLetter",
    }]);

    // 발생 당일에는 아직 제한되지 않는다.
    expect(moveCharacterIfAllowed(state, "girlStudent", "Hospital")).toBe(true);
    setBoardLocation(state.loop, "girlStudent", "School");

    state.loop.day = 2;
    resolveMovementPlan(state, [{
      owner: "mastermind",
      card: "moveHorizontal",
      target: { kind: "character", id: "girlStudent" },
    }]);
    expect(state.loop.board.girlStudent).toEqual({
      status: "alive",
      at: "School",
    });
    expect(moveCharacterIfAllowed(state, "girlStudent", "Hospital")).toBe(false);

    state.loop.day = 3;
    expect(moveCharacterIfAllowed(state, "girlStudent", "Hospital")).toBe(true);
  });

  it("does not create a next-day Suspicious Letter restriction without an actual move", () => {
    const state = stateFor("suspiciousLetter");
    state.loop.day = state.scenario.daysPerLoop;
    setBoardLocation(state.loop, "boyStudent", "City");
    setBoardLocation(state.loop, "girlStudent", "City");

    expect(resolveIncidentEffect(state, "suspiciousLetter", "boyStudent", {
      target: "girlStudent",
      destination: "City",
    })).toBe(false);
    expect(state.loop.movementRestrictions).toBeUndefined();

    expect(resolveIncidentEffect(state, "suspiciousLetter", "boyStudent", {
      target: "girlStudent",
      destination: "School",
    })).toBe(true);
    expect(state.loop.movementRestrictions).toBeUndefined();
  });

  it("does not add a Suspicious Letter restriction when another incident restriction nullifies the move", () => {
    const state = stateFor("suspiciousLetter");
    setBoardLocation(state.loop, "boyStudent", "City");
    setBoardLocation(state.loop, "girlStudent", "City");
    state.loop.movementRestrictions = [{
      kind: "locationBoundary",
      location: "City",
      startDay: 1,
      throughDay: 3,
      source: "closedCircle",
    }];

    expect(resolveIncidentEffect(state, "suspiciousLetter", "boyStudent", {
      target: "girlStudent",
      destination: "School",
    })).toBe(false);
    expect(state.loop.board.girlStudent).toEqual({
      status: "alive",
      at: "City",
    });
    expect(state.loop.movementRestrictions).toHaveLength(1);
  });

  it("blocks both entering and leaving a Closed Circle location through day +2", () => {
    const state = stateFor("closedCircle");
    state.loop.charCounters.boyStudent.paranoia = 2;
    setBoardLocation(state.loop, "boyStudent", "City");
    setBoardLocation(state.loop, "girlStudent", "City");
    setBoardLocation(state.loop, "officeWorker", "School");

    const result = resolveIncident(state);

    expect(result.occurrences[0]?.culpritLocationRevealed).toBe("City");
    expect(state.loop.movementRestrictions).toEqual([{
      kind: "locationBoundary",
      location: "City",
      startDay: 1,
      throughDay: 3,
      source: "closedCircle",
    }]);
    expect(state.loop.board.girlStudent).toEqual({
      status: "alive",
      at: "City",
    });

    for (const day of [1, 2, 3]) {
      state.loop.day = day;
      setBoardLocation(state.loop, "girlStudent", "City");
      setBoardLocation(state.loop, "officeWorker", "School");
      resolveMovementPlan(state, [
        {
          owner: "mastermind",
          card: "moveVertical",
          target: { kind: "character", id: "girlStudent" },
        },
        {
          owner: 0,
          card: "moveHorizontal",
          target: { kind: "character", id: "officeWorker" },
        },
      ]);
      expect(state.loop.board.girlStudent).toEqual({
        status: "alive",
        at: "City",
      });
      expect(state.loop.board.officeWorker).toEqual({
        status: "alive",
        at: "School",
      });
    }

    state.loop.day = 4;
    expect(moveCharacterIfAllowed(state, "girlStudent", "Hospital")).toBe(true);
    expect(moveCharacterIfAllowed(state, "officeWorker", "City")).toBe(true);

    const nextLoop = initLoop(state.scenario, 2, state.loop);
    expect(nextLoop.movementRestrictions).toBeUndefined();
  });

  it("clamps Closed Circle at the last day and reveals a Twin's virtual location", () => {
    const value = scenario("closedCircle", {
      boyStudent: "twin",
      girlStudent: "person",
    });
    value.incidents = [{
      day: value.daysPerLoop,
      incident: "closedCircle",
      culprit: "boyStudent",
    }];
    const state: GameState = {
      scenario: value,
      gamePhase: "ROUND",
      loop: initLoop(value),
      history: [],
      loopOutcomes: [],
    };
    state.loop.day = value.daysPerLoop;
    state.loop.charCounters.boyStudent.paranoia = 2;
    setBoardLocation(state.loop, "boyStudent", "Hospital");

    const result = resolveIncident(state);

    expect(result.occurrences[0]?.culpritLocationRevealed).toBe("School");
    expect(state.loop.movementRestrictions).toEqual([{
      kind: "locationBoundary",
      location: "School",
      startDay: value.daysPerLoop,
      throughDay: value.daysPerLoop,
      source: "closedCircle",
    }]);
    expect(state.loop.board.boyStudent).toEqual({
      status: "alive",
      at: "Hospital",
    });
  });

  it("suppresses both the Closed Circle restriction and location reveal for Black Cat while still recording occurrence", () => {
    const value = scenario("closedCircle", {
      blackCat: "person",
      girlStudent: "person",
    });
    value.incidents = [{
      day: 1,
      incident: "closedCircle",
      culprit: "blackCat",
    }];
    const state: GameState = {
      scenario: value,
      gamePhase: "ROUND",
      loop: initLoop(value),
      history: [],
      loopOutcomes: [],
    };
    state.loop.charCounters.blackCat.paranoia = 3;

    const result = resolveIncident(state);

    expect(result.occurrences[0]).toMatchObject({
      fired: true,
      effectApplied: false,
    });
    expect(result.occurrences[0]?.culpritLocationRevealed).toBeUndefined();
    expect(state.loop.movementRestrictions).toBeUndefined();
    expect(state.loop.specialGauge?.value).toBe(1);
  });

  it("uses Closed Circle's revealed location and Faked Suicide's card as culprit evidence", () => {
    const closed = stateFor("closedCircle");
    closed.loop.charCounters.boyStudent.paranoia = 2;
    setBoardLocation(closed.loop, "boyStudent", "City");
    setBoardLocation(closed.loop, "girlStudent", "City");
    setBoardLocation(closed.loop, "officeWorker", "School");
    closed.loop.phase = "P7_INCIDENT";
    const closedResult = resolveIncident(closed);
    const closedOccurrence = closedResult.occurrences[0];
    if (closedOccurrence === undefined) throw new Error("missing Closed Circle");
    recordOccurrence(closed, closedOccurrence);
    const closedTable = evaluateStateIncidentHypotheses(closed);
    expect(closedTable.cells.officeWorker["1:closedCircle"].status).toBe(
      "impossible",
    );
    expect(closedTable.cells.boyStudent["1:closedCircle"].status).toBe(
      "possible",
    );
    expect(closedTable.cells.girlStudent["1:closedCircle"].status).toBe(
      "possible",
    );

    const faked = stateFor("fakedSuicide");
    faked.loop.charCounters.boyStudent.paranoia = 2;
    faked.loop.phase = "P7_INCIDENT";
    const fakedResult = resolveIncident(faked);
    const fakedOccurrence = fakedResult.occurrences[0];
    if (fakedOccurrence === undefined) throw new Error("missing Faked Suicide");
    recordOccurrence(faked, fakedOccurrence);
    const fakedTable = evaluateStateIncidentHypotheses(faked);
    expect(fakedTable.cells.boyStudent["1:fakedSuicide"].status).toBe(
      "confirmed",
    );
    expect(fakedTable.cells.girlStudent["1:fakedSuicide"].status).toBe(
      "impossible",
    );
  });

  it.each([
    {
      incident: "portent",
      choice: { target: "girlStudent" },
      targetLocation: "City" as const,
    },
    {
      incident: "suspiciousLetter",
      choice: { target: "girlStudent", destination: "School" as const },
      targetLocation: "City" as const,
    },
    {
      incident: "bestialMurder",
      choice: {
        decisions: [
          {
            kind: "subIncident" as const,
            key: "serialMurder" as const,
            decisions: [{
              kind: "character" as const,
              key: "target" as const,
              id: "girlStudent",
            }],
          },
          {
            kind: "subIncident" as const,
            key: "increasingUnease" as const,
            decisions: [
              {
                kind: "character" as const,
                key: "target" as const,
                id: "officeWorker",
              },
              {
                kind: "character" as const,
                key: "otherTarget" as const,
                id: "boyStudent",
              },
            ],
          },
        ],
      },
      targetLocation: "City" as const,
    },
  ])("uses $incident's public effect trace to exclude a culprit at another location", ({
    incident,
    choice,
    targetLocation,
  }) => {
    const state = stateFor(incident);
    state.loop.charCounters.boyStudent.paranoia = incident === "bestialMurder"
      ? 3
      : 2;
    setBoardLocation(state.loop, "boyStudent", targetLocation);
    setBoardLocation(state.loop, "girlStudent", targetLocation);
    setBoardLocation(state.loop, "officeWorker", "Hospital");

    const result = resolveIncident(state, choice);
    const occurrence = result.occurrences[0];
    if (occurrence === undefined) throw new Error(`missing ${incident}`);
    recordOccurrence(state, occurrence);
    const table = evaluateStateIncidentHypotheses(state);

    expect(table.cells.officeWorker[`1:${incident}`].status).toBe("impossible");
    expect(table.cells.boyStudent[`1:${incident}`].status).not.toBe(
      "impossible",
    );
  });
});
