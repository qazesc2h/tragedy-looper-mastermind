import { describe, expect, it } from "vitest";

import { corpseCountAt } from "../src/engine/corpses";
import { characterDataOf } from "../src/data";
import {
  incidentFailureReasons,
  resolveIncident,
  resolveIncidentEffect,
} from "../src/engine/incident";
import { incidentDefinition } from "../src/engine/incident-definition";
import { evaluateIncidentHypotheses } from "../src/engine/incident-hypothesis";
import { madnessSpellActive } from "../src/engine/cosmic-spells";
import { initLoop } from "../src/engine/setup";
import { INCIDENT_IMPL } from "../src/impl/incidents";
import type { GameState, IncidentId, Scenario } from "../src/types";
import type { ProtagonistObservation } from "../src/engine/hypothesis";
import { setBoardLocation } from "./helpers";

function cosmicScenario(incident: IncidentId): Scenario {
  return {
    tragedySet: "cosmicMythology",
    mainPlot: "kingYellow",
    subPlots: ["resistance", "peopleWhoSaw"],
    cast: {
      boyStudent: "person",
      girlStudent: "person",
      officeWorker: "person",
    },
    incidents: [{ day: 1, incident, culprit: "boyStudent" }],
    loops: 3,
    daysPerLoop: 4,
  };
}

function cosmicState(incident: IncidentId): GameState {
  const scenario = cosmicScenario(incident);
  const state: GameState = {
    scenario,
    gamePhase: "ROUND",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
  };
  for (const character of Object.keys(scenario.cast)) {
    setBoardLocation(state.loop, character, "City");
  }
  state.loop.phase = "P7_INCIDENT";
  return state;
}

describe("Cosmic Mythology incident sources", () => {
  it("registers all eight new-set incidents with the upstream effects", () => {
    expect([
      "insaneMurder",
      "massSuicide",
      "evilContamination",
      "uproar",
      "fireDemise",
      "houndDogScent",
      "discovery",
      "executioner",
    ].map((incident) => INCIDENT_IMPL[incident].hooks.map((hook) =>
      hook.source.description
    ))).toEqual([
      ["Kill any one character (including culprit) in the same location as the culprit."],
      ["All characters in the culprit’s location are killed."],
      ["Place 2 :intrigue: on the Shrine."],
      [
        "Everyone in the School dies.",
        "Everyone in the City dies.",
      ],
      ["All characters and the Protagonists are killed."],
      ["When determinig whether this incident occours or not, count :intrigue: instead of :paranoia:. For the rest of the loop, if another Incident occours, the Protagonists are killed after the Incident step."],
      ["Increase the Extra Gauge 1 step."],
      ["The leader chooses one character. That charcter is killed."],
    ]);
  });
});

describe("Cosmic Mythology death incidents", () => {
  it("kills any living target in the culprit location, including the culprit", () => {
    const other = cosmicState("insaneMurder");
    expect(resolveIncidentEffect(
      other,
      "insaneMurder",
      "boyStudent",
      { target: "girlStudent" },
    )).toBe(true);
    expect(other.loop.board.girlStudent.status).toBe("dead");

    const culprit = cosmicState("insaneMurder");
    expect(resolveIncidentEffect(
      culprit,
      "insaneMurder",
      "boyStudent",
      { target: "boyStudent" },
    )).toBe(true);
    expect(culprit.loop.board.boyStudent.status).toBe("dead");

    const remote = cosmicState("insaneMurder");
    setBoardLocation(remote.loop, "girlStudent", "School");
    expect(() => resolveIncidentEffect(
      remote,
      "insaneMurder",
      "boyStudent",
      { target: "girlStudent" },
    )).toThrow("target is not eligible");
  });

  it("fires Mass Suicide at one culprit intrigue and kills only that location", () => {
    const below = cosmicState("massSuicide");
    expect(incidentFailureReasons(below, "boyStudent", "massSuicide"))
      .toContain("insufficientIntrigue");

    const state = cosmicState("massSuicide");
    state.loop.charCounters.boyStudent.intrigue = 1;
    setBoardLocation(state.loop, "officeWorker", "School");
    const result = resolveIncident(state).occurrences[0]!;
    expect(result.fired).toBe(true);
    expect(state.loop.board.boyStudent.status).toBe("dead");
    expect(state.loop.board.girlStudent.status).toBe("dead");
    expect(state.loop.board.officeWorker.status).toBe("alive");
  });

  it("applies Fire of Demise only on its first occurrence in the game", () => {
    const first = cosmicState("fireDemise");
    first.loop.charCounters.boyStudent.paranoia = 10;
    expect(resolveIncident(first).occurrences[0]).toEqual(expect.objectContaining({
      fired: true,
      effectApplied: true,
      protagonistsDied: true,
    }));
    expect(Object.values(first.loop.board).every(({ status }) => status === "dead"))
      .toBe(true);

    const second: GameState = {
      scenario: cosmicScenario("fireDemise"),
      gamePhase: "ROUND",
      loop: initLoop(cosmicScenario("fireDemise"), 2),
      history: [structuredClone(first.loop)],
      loopOutcomes: [],
    };
    for (const character of Object.keys(second.scenario.cast)) {
      setBoardLocation(second.loop, character, "City");
    }
    second.loop.charCounters.boyStudent.paranoia = 10;
    second.loop.phase = "P7_INCIDENT";
    expect(resolveIncident(second).occurrences[0]).toEqual(expect.objectContaining({
      fired: true,
      effectApplied: false,
    }));
    expect(Object.values(second.loop.board).every(({ status }) => status === "alive"))
      .toBe(true);
    expect(second.pendingLoopEnd).toBeUndefined();
  });
});

describe("Cosmic Mythology gauge incidents", () => {
  it("uses culprit intrigue, not paranoia, for Hound Dog Scent", () => {
    const state = cosmicState("houndDogScent");
    state.loop.charCounters.boyStudent.paranoia = 10;
    expect(incidentFailureReasons(state, "boyStudent", "houndDogScent"))
      .toContain("insufficientIntrigue");
    state.loop.charCounters.boyStudent.intrigue = 3;
    state.loop.charCounters.boyStudent.paranoia = 0;
    expect(incidentFailureReasons(state, "boyStudent", "houndDogScent"))
      .toEqual([]);
  });

  it("kills the Protagonists after a later incident, after that effect", () => {
    const state = cosmicState("houndDogScent");
    state.scenario.incidents = [
      { day: 1, incident: "houndDogScent", culprit: "boyStudent" },
      { day: 2, incident: "discovery", culprit: "girlStudent" },
    ];
    state.loop.charCounters.boyStudent.intrigue = 3;
    state.loop.charCounters.girlStudent.paranoia = 10;
    expect(resolveIncident(state).occurrences[0]?.protagonistsDied).toBeUndefined();

    state.loop.day = 2;
    const later = resolveIncident(state).occurrences[0]!;
    expect(state.loop.specialGauge?.value).toBe(1);
    expect(later.protagonistsDied).toBe(true);
    expect(state.pendingLoopEnd?.reason).toBe("protagonistDeath");
  });

  it("raises the gauge only for Discovery and immediately unlocks spell four", () => {
    const discovery = cosmicState("discovery");
    discovery.loop.charCounters.boyStudent.paranoia = 10;
    discovery.loop.specialGauge!.value = 3;
    const result = resolveIncident(discovery).occurrences[0]!;
    expect(discovery.loop.specialGauge).toEqual({
      value: 4,
      increasedThisLoop: true,
    });
    expect(result.publicChanges).toContainEqual(expect.objectContaining({
      kind: "specialGauge",
      beforeValue: 3,
      afterValue: 4,
      delta: 1,
    }));
    expect(madnessSpellActive(discovery)).toBe(true);

    const ordinary = cosmicState("insaneMurder");
    ordinary.loop.charCounters.boyStudent.paranoia = 10;
    resolveIncident(ordinary, { target: "girlStudent" });
    expect(ordinary.loop.specialGauge?.value).toBe(0);
  });

  it("runs CM mandatory death abilities caused by an incident", () => {
    const state = cosmicState("insaneMurder");
    state.scenario.cast.boyStudent = "deepOne";
    state.loop.charCounters.boyStudent.paranoia = 10;
    resolveIncident(state, { target: "boyStudent" });
    expect(state.loop.specialGauge).toEqual({
      value: 1,
      increasedThisLoop: true,
    });
    expect(state.loop.publicInformationThisLoop).toContainEqual(
      expect.objectContaining({
        kind: "roleClaim",
        character: "boyStudent",
        claimedRole: "deepOne",
      }),
    );
  });

  it("uses the printed limit minus one for Executioner", () => {
    const state = cosmicState("executioner");
    const limit = characterDataOf("boyStudent").paranoiaLimit;
    state.loop.charCounters.boyStudent.paranoia = limit - 2;
    expect(incidentFailureReasons(state, "boyStudent", "executioner"))
      .toContain("insufficientParanoia");
    state.loop.charCounters.boyStudent.paranoia = limit - 1;
    expect(incidentFailureReasons(state, "boyStudent", "executioner"))
      .toEqual([]);
    expect(incidentDefinition("executioner").triggerPolicy).toEqual({
      kind: "characterParanoia",
      requiresAlive: true,
      paranoiaLimitAdjustment: -1,
    });
  });

  it("does not count Cosmic Mythology location intrigue as anonymous corpses", () => {
    const state = cosmicState("discovery");
    state.loop.locIntrigue.City = 3;
    expect(corpseCountAt(state, "City")).toBe(0);
  });
});

describe("Cosmic Mythology incident hypotheses", () => {
  it("uses Insane Murder's public target location without excluding the victim", () => {
    const state = cosmicState("insaneMurder");
    setBoardLocation(state.loop, "officeWorker", "School");
    for (const character of Object.keys(state.scenario.cast)) {
      state.loop.charCounters[character].paranoia = 10;
    }
    const result = resolveIncident(state, { target: "girlStudent" })
      .occurrences[0]!;
    const observation: ProtagonistObservation = {
      kind: "incidentOccurred",
      loop: 1,
      day: 1,
      incident: "insaneMurder",
      occurred: true,
      context: result.publicContext,
      targets: result.targets,
      changes: result.publicChanges,
    };
    const table = evaluateIncidentHypotheses(
      ["boyStudent", "girlStudent", "officeWorker"],
      state.scenario.incidents,
      [observation],
    );
    const column = table.columns[0]!.id;
    expect(table.cells.girlStudent[column].status).toBe("possible");
    expect(table.cells.officeWorker[column]).toMatchObject({
      status: "impossible",
      reasons: [{ code: "incidentTraceLocationMismatch" }],
    });
  });

  it("uses Mass Suicide deaths as a location trace without confirming a culprit", () => {
    const state = cosmicState("massSuicide");
    setBoardLocation(state.loop, "officeWorker", "School");
    for (const character of Object.keys(state.scenario.cast)) {
      state.loop.charCounters[character].intrigue = 1;
    }
    const result = resolveIncident(state).occurrences[0]!;
    const observation: ProtagonistObservation = {
      kind: "incidentOccurred",
      loop: 1,
      day: 1,
      incident: "massSuicide",
      occurred: true,
      context: result.publicContext,
      changes: result.publicChanges,
      deaths: result.deaths,
    };
    const table = evaluateIncidentHypotheses(
      ["boyStudent", "girlStudent", "officeWorker"],
      state.scenario.incidents,
      [observation],
    );
    const column = table.columns[0]!.id;
    expect(table.cells.boyStudent[column].status).toBe("possible");
    expect(table.cells.girlStudent[column].status).toBe("possible");
    expect(table.cells.officeWorker[column]).toMatchObject({
      status: "impossible",
      reasons: [{ code: "incidentTraceLocationMismatch" }],
    });
  });

  it("evaluates Hound Dog Scent candidates from public intrigue", () => {
    const state = cosmicState("houndDogScent");
    state.loop.charCounters.boyStudent.intrigue = 3;
    state.loop.charCounters.boyStudent.paranoia = 0;
    state.loop.charCounters.girlStudent.intrigue = 0;
    state.loop.charCounters.girlStudent.paranoia = 10;
    const result = resolveIncident(state).occurrences[0]!;
    const observation: ProtagonistObservation = {
      kind: "incidentOccurred",
      loop: 1,
      day: 1,
      incident: "houndDogScent",
      occurred: true,
      context: result.publicContext,
    };
    const table = evaluateIncidentHypotheses(
      ["boyStudent", "girlStudent"],
      state.scenario.incidents,
      [observation],
    );
    const column = table.columns[0]!.id;
    expect(table.cells.boyStudent[column].status).toBe("confirmed");
    expect(table.cells.girlStudent[column]).toMatchObject({
      status: "impossible",
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "firedBelowParanoia" }),
      ]),
    });
  });
});
