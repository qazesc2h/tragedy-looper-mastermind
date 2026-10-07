import { describe, expect, it } from "vitest";

import { killCharacter } from "../src/engine/death";
import { advanceGame } from "../src/engine/game";
import { resolveIncident } from "../src/engine/incident";
import { evaluateStateIncidentHypotheses } from "../src/engine/incident-hypothesis";
import { IMMORTAL_ROLE_IDS } from "../src/engine/role-properties";
import { initLoop } from "../src/engine/setup";
import { validateScenario } from "../src/engine/validate";
import { ROLE_IMPL } from "../src/impl/roles";
import type { GameState, RoleId, Scenario } from "../src/types";
import {
  boardIsAlive,
  boardLocation,
  setBoardLocation,
} from "./helpers";

function stateFor(
  cast: Record<string, RoleId>,
  incident = "serialMurder",
  culprit = "boyStudent",
): GameState {
  const scenario: Scenario = {
    tragedySet: "mysteryCircle",
    mainPlot: "murderPlan",
    subPlots: [],
    cast,
    incidents: [{ day: 1, incident, culprit }],
    loops: 3,
    daysPerLoop: 3,
  };
  const loop = initLoop(scenario);
  for (const character of Object.keys(loop.board)) {
    setBoardLocation(loop, character, "City");
  }
  loop.phase = "P7_INCIDENT";
  return {
    scenario,
    gamePhase: "ROUND",
    loop,
    history: [],
    loopOutcomes: [],
  };
}

describe("Mystery Circle role metadata and script constraints", () => {
  it("preserves the upstream Fool sources and maximum", () => {
    expect(ROLE_IMPL.fool).toMatchObject({ ko: "어리석은 자", max: 1 });
    expect(ROLE_IMPL.fool.hooks.map(({ source }) => source)).toEqual([
      {
        timing: "Script creation",
        description: "This character must be the culprit of an Incident",
      },
      {
        timing: "Incident step",
        description: "After this character has triggered an Incident, remove all :paranoia: counters from this card.",
      },
    ]);
  });

  it("keeps the shared immortality list aligned with role tags", () => {
    expect(IMMORTAL_ROLE_IDS).toContain("privateInvestigator");
    for (const role of IMMORTAL_ROLE_IDS) {
      expect(ROLE_IMPL[role].tags).toContain("immortal");
    }
  });

  it("requires Fool, Twin, and Obstinate culprits", () => {
    for (const [role, code] of [
      ["fool", "FOOL_NOT_INCIDENT_CULPRIT"],
      ["twin", "TWIN_NOT_INCIDENT_CULPRIT"],
      ["obstinate", "OBSTINATE_NOT_INCIDENT_CULPRIT"],
    ] as const) {
      expect(validateScenario({
        cast: { doctor: role },
        incidents: [],
      }).diagnostics).toContainEqual(expect.objectContaining({ code }));
    }
  });

  it("rejects Private Investigator as a culprit", () => {
    expect(validateScenario({
      cast: { doctor: "privateInvestigator" },
      incidents: [{ day: 1, incident: "serialMurder", culprit: "doctor" }],
    }).diagnostics).toContainEqual(expect.objectContaining({
      path: "incidents[0].culprit",
      code: "PRIVATE_INVESTIGATOR_IS_INCIDENT_CULPRIT",
    }));
  });

  it("rejects more than one Fool", () => {
    expect(validateScenario({
      tragedySet: "mysteryCircle",
      mainPlot: "murderPlan",
      subPlots: ["danceFools", "hiddenFreak"],
      cast: { doctor: "fool", patient: "fool" },
      incidents: [
        { day: 1, incident: "serialMurder", culprit: "doctor" },
        { day: 2, incident: "suicide", culprit: "patient" },
      ],
      loops: 1,
      daysPerLoop: 2,
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "ROLE_COUNT_EXCEEDED",
    }));
  });
});

describe("Fool incident resolution", () => {
  it("removes every paranoia counter only after its incident fires", () => {
    const state = stateFor({
      boyStudent: "fool",
      girlStudent: "person",
    });
    state.loop.charCounters.boyStudent.paranoia = 5;

    expect(resolveIncident(state, { target: "girlStudent" })).toMatchObject({
      occurrences: [{ fired: true }],
    });

    expect(state.loop.charCounters.boyStudent.paranoia).toBe(0);
    expect(boardIsAlive(state.loop, "girlStudent")).toBe(false);
  });

  it("does not remove paranoia when its incident does not fire", () => {
    const state = stateFor({
      boyStudent: "fool",
      girlStudent: "person",
    });
    state.loop.charCounters.boyStudent.paranoia = 1;

    expect(resolveIncident(state, { target: "girlStudent" })).toMatchObject({
      occurrences: [{ fired: false }],
    });

    expect(state.loop.charCounters.boyStudent.paranoia).toBe(1);
    expect(boardIsAlive(state.loop, "girlStudent")).toBe(true);
  });
});

describe("Twin incident black-box location", () => {
  it("uses the diagonal location for both trigger and effect without moving the Twin", () => {
    const state = stateFor({
      boyStudent: "twin",
      doctor: "privateInvestigator",
      girlStudent: "person",
    });
    state.loop.charCounters.boyStudent.paranoia = 0;
    setBoardLocation(state.loop, "boyStudent", "City");
    setBoardLocation(state.loop, "doctor", "Shrine");
    setBoardLocation(state.loop, "girlStudent", "Shrine");

    expect(resolveIncident(state, { target: "girlStudent" })).toMatchObject({
      occurrences: [{ fired: true, effectApplied: true }],
    });

    expect(boardLocation(state.loop, "boyStudent")).toBe("City");
    expect(boardIsAlive(state.loop, "girlStudent")).toBe(false);
  });

  it("does not use the Twin's physical location for Private Investigator", () => {
    const state = stateFor({
      boyStudent: "twin",
      doctor: "privateInvestigator",
      girlStudent: "person",
    });
    state.loop.charCounters.boyStudent.paranoia = 0;
    setBoardLocation(state.loop, "boyStudent", "City");
    setBoardLocation(state.loop, "doctor", "City");
    setBoardLocation(state.loop, "girlStudent", "Shrine");

    expect(resolveIncident(state, { target: "girlStudent" })).toMatchObject({
      occurrences: [{ fired: false }],
    });
    expect(boardLocation(state.loop, "boyStudent")).toBe("City");
  });

  it("keeps the Twin possible in the public culprit table after a diagonal trace", () => {
    const state = stateFor({
      boyStudent: "twin",
      doctor: "privateInvestigator",
      girlStudent: "person",
    });
    state.loop.charCounters.boyStudent.paranoia = 0;
    setBoardLocation(state.loop, "boyStudent", "City");
    setBoardLocation(state.loop, "doctor", "Shrine");
    setBoardLocation(state.loop, "girlStudent", "Shrine");

    expect(advanceGame(state, { target: "girlStudent" })).toMatchObject({
      occurrences: [{ fired: true }],
    });

    const table = evaluateStateIncidentHypotheses(state);
    expect(table.cells.boyStudent["1:serialMurder"].status).not.toBe(
      "impossible",
    );
  });
});

describe("Private Investigator immortality", () => {
  it("prevents death before protection is consumed", () => {
    const state = stateFor({ doctor: "privateInvestigator" }, "serialMurder", "doctor");
    state.loop.charCounters.doctor.protection = 1;

    expect(killCharacter(state, "doctor")).toBe(false);
    expect(boardIsAlive(state.loop, "doctor")).toBe(true);
    expect(state.loop.charCounters.doctor.protection).toBe(1);
  });
});
