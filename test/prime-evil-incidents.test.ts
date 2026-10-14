import { describe, expect, it } from "vitest";

import {
  resolveIncident,
  resolveIncidentEffect,
} from "../src/engine/incident";
import { incidentDefinition } from "../src/engine/incident-definition";
import { evaluateIncidentHypotheses } from "../src/engine/incident-hypothesis";
import { initLoop } from "../src/engine/setup";
import { INCIDENT_IMPL } from "../src/impl/incidents";
import type {
  GameState,
  IncidentChoice,
  Scenario,
} from "../src/types";
import { setBoardLife, setBoardLocation } from "./helpers";

function primeScenario(incident: string): Scenario {
  return {
    tragedySet: "primeEvil",
    mainPlot: "OnesFromGrave",
    subPlots: ["zombieApocalypse", "deepHole"],
    cast: {
      boyStudent: "person",
      girlStudent: "person",
      officeWorker: "person",
      policeOfficer: "person",
    },
    incidents: [{ day: 1, incident, culprit: "boyStudent" }],
    loops: 3,
    daysPerLoop: 5,
  };
}

function primeState(incident: string): GameState {
  const scenario = primeScenario(incident);
  const state: GameState = {
    scenario,
    gamePhase: "ROUND",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
  };
  for (const character of Object.keys(state.loop.board)) {
    setBoardLocation(state.loop, character, "City");
  }
  state.loop.charCounters.boyStudent.paranoia = 10;
  state.loop.phase = "P7_INCIDENT";
  return state;
}

function observationOf(
  state: GameState,
  occurrence: ReturnType<typeof resolveIncident>["occurrences"][number],
) {
  return {
    kind: "incidentOccurred" as const,
    loop: state.loop.loop,
    day: state.loop.day,
    incident: occurrence.declaredIncident,
    occurrenceId: occurrence.occurrenceId,
    occurred: occurrence.fired,
    context: occurrence.publicContext,
    changes: occurrence.publicChanges,
    deaths: occurrence.deaths,
  };
}

describe("Prime Evil character incidents", () => {
  it("keeps the five upstream effect texts and decision schemas", () => {
    expect([
      "sacrilegiousMurder",
      "evilContamination",
      "executioner",
      "darkRumor",
      "barricade",
    ].map((incident) => INCIDENT_IMPL[incident].hooks[0]?.source.description))
      .toEqual([
        "Either kill another charcter in the same location as the culprit, or place an :intrigue: on the culprit’s location.",
        "Place 2 :intrigue: on the Shrine.",
        "The leader chooses one character. That charcter is killed.",
        "Attach a Curse on the culprit.",
        "For each other character in cluprit’s location, pick any other location and move the character there.",
      ]);
    expect(incidentDefinition("barricade").choiceSchema).toEqual([
      { kind: "characterDestinations", key: "movements" },
    ]);
  });

  it("resolves either branch of Sacrilegious Murder and rejects a remote victim", () => {
    const killing = primeState("sacrilegiousMurder");
    expect(resolveIncidentEffect(
      killing,
      "sacrilegiousMurder",
      "boyStudent",
      { target: "girlStudent" },
    )).toBe(true);
    expect(killing.loop.board.girlStudent.status).toBe("dead");
    expect(killing.loop.locIntrigue.City).toBe(0);

    const intrigue = primeState("sacrilegiousMurder");
    expect(resolveIncidentEffect(
      intrigue,
      "sacrilegiousMurder",
      "boyStudent",
    )).toBe(true);
    expect(intrigue.loop.locIntrigue.City).toBe(1);

    const invalid = primeState("sacrilegiousMurder");
    setBoardLocation(invalid.loop, "girlStudent", "School");
    expect(() => resolveIncidentEffect(
      invalid,
      "sacrilegiousMurder",
      "boyStudent",
      { target: "girlStudent" },
    )).toThrow("target is not eligible");
  });

  it("places two Shrine Intrigue for Evil Contamination", () => {
    const state = primeState("evilContamination");
    expect(resolveIncidentEffect(
      state,
      "evilContamination",
      "boyStudent",
    )).toBe(true);
    expect(state.loop.locIntrigue.Shrine).toBe(2);
    expect(state.loop.locIntrigue.City).toBe(0);
  });

  it("lets the leader execute one living character anywhere", () => {
    const state = primeState("executioner");
    setBoardLocation(state.loop, "policeOfficer", "Hospital");
    expect(resolveIncidentEffect(state, "executioner", "boyStudent", {
      target: "policeOfficer",
    })).toBe(true);
    expect(state.loop.board.policeOfficer.status).toBe("dead");

    const invalid = primeState("executioner");
    setBoardLife(invalid.loop, "policeOfficer", false);
    expect(() => resolveIncidentEffect(
      invalid,
      "executioner",
      "boyStudent",
      { target: "policeOfficer" },
    )).toThrow("target is not eligible");
  });

  it("attaches a public Curse to the Dark Rumor culprit and confirms that culprit", () => {
    const state = primeState("darkRumor");
    const occurrence = resolveIncident(state).occurrences[0]!;
    expect(state.loop.extraCards).toContainEqual(expect.objectContaining({
      cardId: "curse",
      source: { kind: "incident", id: "darkRumor" },
      target: { kind: "character", id: "boyStudent" },
      expiresAt: "loopEnd",
    }));
    expect(occurrence.publicChanges).toContainEqual(expect.objectContaining({
      kind: "extraCard",
      action: "placed",
      card: expect.objectContaining({
        cardId: "curse",
        target: { kind: "character", id: "boyStudent" },
      }),
    }));

    const table = evaluateIncidentHypotheses(
      Object.keys(state.scenario.cast),
      state.scenario.incidents,
      [observationOf(state, occurrence)],
    );
    const column = table.columns[0]!.id;
    expect(table.cells.boyStudent[column]?.status).toBe("confirmed");
    expect(table.cells.girlStudent[column]?.status).toBe("impossible");
  });

  it("moves every other character in the culprit location to independently chosen locations", () => {
    const state = primeState("barricade");
    setBoardLocation(state.loop, "policeOfficer", "Hospital");
    const choice: IncidentChoice = { decisions: [
      {
        kind: "characterDestination",
        key: "movements",
        id: "girlStudent",
        at: "School",
      },
      {
        kind: "characterDestination",
        key: "movements",
        id: "officeWorker",
        at: "Shrine",
      },
    ] };
    const occurrence = resolveIncident(state, choice).occurrences[0]!;
    expect(state.loop.board.girlStudent).toEqual({ status: "alive", at: "School" });
    expect(state.loop.board.officeWorker).toEqual({ status: "alive", at: "Shrine" });
    expect(state.loop.board.boyStudent).toEqual({ status: "alive", at: "City" });

    const table = evaluateIncidentHypotheses(
      Object.keys(state.scenario.cast),
      state.scenario.incidents,
      [observationOf(state, occurrence)],
    );
    const column = table.columns[0]!.id;
    expect(table.cells.boyStudent[column]?.status).toBe("confirmed");
    expect(table.cells.girlStudent[column]?.status).toBe("impossible");

    const invalid = primeState("barricade");
    expect(() => resolveIncidentEffect(
      invalid,
      "barricade",
      "boyStudent",
      { decisions: [{
        kind: "characterDestination",
        key: "movements",
        id: "girlStudent",
        at: "School",
      }] },
    )).toThrow("one other-location destination per character");
  });
});
