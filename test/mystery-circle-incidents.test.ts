import { describe, expect, it } from "vitest";

import {
  incidentFires,
  resolveIncident,
  resolveIncidentEffect,
} from "../src/engine/incident";
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
});
