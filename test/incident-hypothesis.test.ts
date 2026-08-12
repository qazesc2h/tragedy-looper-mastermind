import { describe, expect, it } from "vitest";

import { advanceGame, createGameState } from "../src/engine/game";
import {
  evaluateIncidentHypotheses,
  evaluateStateIncidentHypotheses,
} from "../src/engine/incident-hypothesis";
import type { ProtagonistObservation } from "../src/engine/hypothesis";
import type {
  CharacterId,
  PublicObservationContext,
  ScheduledIncident,
  Scenario,
} from "../src/types";

const incidents: ScheduledIncident[] = [
  { day: 1, incident: "murder", culprit: "doctor" },
  { day: 3, incident: "suicide", culprit: "girlStudent" },
];

function publicCharacter(
  status: "absent" | "alive" | "dead",
  paranoia: number,
): NonNullable<PublicObservationContext["characters"]>[CharacterId] {
  return {
    status,
    ...(status === "absent"
      ? {}
      : { location: "Hospital" as const, abilityLocations: ["Hospital" as const] }),
    goodwill: 0,
    paranoia,
    intrigue: 0,
  };
}

function incidentObserved(
  occurred: boolean,
  characters?: NonNullable<PublicObservationContext["characters"]>,
): Extract<ProtagonistObservation, { kind: "incidentOccurred" }> {
  return {
    kind: "incidentOccurred",
    loop: 1,
    day: 1,
    incident: "murder",
    occurred,
    ...(characters === undefined
      ? {}
      : {
        context: {
          locationIntrigue: {
            Hospital: 0,
            Shrine: 0,
            City: 0,
            School: 0,
          },
          characters,
        },
      }),
  };
}

describe("incident culprit possibility table", () => {
  it("excludes living characters below their limit when an incident fires", () => {
    const table = evaluateIncidentHypotheses(
      ["doctor", "girlStudent", "officeWorker", "ai"],
      [incidents[0]],
      [incidentObserved(true, {
        doctor: publicCharacter("alive", 1),
        girlStudent: publicCharacter("alive", 3),
        officeWorker: publicCharacter("dead", 3),
        ai: publicCharacter("alive", 0),
      })],
    );
    const column = table.columns[0].id;

    expect(table.cells.doctor[column]).toMatchObject({
      status: "impossible",
      reasons: [{ code: "firedBelowParanoia" }],
    });
    expect(table.cells.girlStudent[column].status).toBe("possible");
    expect(table.cells.officeWorker[column]).toMatchObject({
      status: "impossible",
      reasons: [{ code: "firedWhileUnavailable" }],
    });
    expect(table.cells.ai[column].status).toBe("possible");
  });

  it("excludes a living maximum-paranoia character when an incident does not fire", () => {
    const table = evaluateIncidentHypotheses(
      ["doctor", "girlStudent", "henchman"],
      [incidents[0]],
      [incidentObserved(false, {
        doctor: publicCharacter("alive", 2),
        girlStudent: publicCharacter("alive", 2),
        henchman: publicCharacter("alive", 1),
      })],
    );
    const column = table.columns[0].id;

    expect(table.cells.doctor[column]).toMatchObject({
      status: "impossible",
      reasons: [{ code: "didNotFireDespiteConditions" }],
    });
    expect(table.cells.girlStudent[column].status).toBe("possible");
    expect(table.cells.henchman[column].status).toBe("possible");
  });

  it("keeps old incident records without a judgment snapshot possible", () => {
    const table = evaluateIncidentHypotheses(
      ["doctor", "girlStudent"],
      [incidents[0]],
      [incidentObserved(true)],
    );
    const column = table.columns[0].id;

    expect(table.cells.doctor[column].status).toBe("possible");
    expect(table.cells.girlStudent[column].status).toBe("possible");
  });

  it("confirms a revealed culprit and excludes that character from other incidents", () => {
    const revealed: ProtagonistObservation = {
      kind: "incidentCulpritRevealed",
      loop: 1,
      day: 1,
      incident: "murder",
      culprit: "doctor",
    };
    const table = evaluateIncidentHypotheses(
      ["doctor", "girlStudent", "officeWorker"],
      incidents,
      [revealed],
    );
    const murder = table.columns[0].id;
    const suicide = table.columns[1].id;

    expect(table.cells.doctor[murder].status).toBe("confirmed");
    expect(table.cells.girlStudent[murder].status).toBe("impossible");
    expect(table.cells.doctor[suicide]).toMatchObject({
      status: "impossible",
      reasons: [{ code: "culpritAlreadyAssigned", column: murder }],
    });
  });

  it("uses one observed suicide death as the culprit confirmation", () => {
    const observation: ProtagonistObservation = {
      kind: "incidentOccurred",
      loop: 1,
      day: 3,
      incident: "suicide",
      occurred: true,
      deaths: ["girlStudent"],
    };
    const table = evaluateIncidentHypotheses(
      ["doctor", "girlStudent", "officeWorker"],
      incidents,
      [observation],
    );
    const suicide = table.columns[1].id;

    expect(table.cells.girlStudent[suicide]).toMatchObject({
      status: "confirmed",
      reasons: [{ code: "suicideDeathIdentified" }],
    });
  });

  it("confirms the only candidate after independent exclusions", () => {
    const table = evaluateIncidentHypotheses(
      ["doctor", "girlStudent", "officeWorker"],
      [incidents[0]],
      [incidentObserved(true, {
        doctor: publicCharacter("alive", 1),
        girlStudent: publicCharacter("alive", 1),
        officeWorker: publicCharacter("alive", 3),
      })],
    );
    const column = table.columns[0].id;

    expect(table.cells.officeWorker[column]).toMatchObject({
      status: "confirmed",
      reasons: [{ code: "onlyRemainingCandidate" }],
    });
    expect(table.propagationPasses).toBe(2);
  });

  it("never confirms one character as the culprit of two incidents", () => {
    const table = evaluateIncidentHypotheses(
      ["doctor"],
      incidents,
      [],
    );
    const murder = table.columns[0].id;
    const suicide = table.columns[1].id;

    expect(table.cells.doctor[murder].status).toBe("confirmed");
    expect(table.cells.doctor[suicide]).toMatchObject({
      status: "impossible",
      reasons: [{ code: "culpritAlreadyAssigned", column: murder }],
    });
  });

  it("derives the table from the real P7 judgment snapshot", () => {
    const scenario: Scenario = {
      tragedySet: "basicTragedy",
      mainPlot: "murderPlan",
      subPlots: ["unsettlingRumor"],
      cast: { boyStudent: "killer", doctor: "person" },
      incidents: [{ day: 1, incident: "foulEvil", culprit: "boyStudent" }],
      loops: 3,
      daysPerLoop: 1,
    };
    const state = createGameState(scenario);
    state.gamePhase = "ROUND";
    state.loop.phase = "P7_INCIDENT";
    state.loop.charCounters.boyStudent.paranoia = 2;
    state.loop.charCounters.doctor.paranoia = 0;

    expect(advanceGame(state)).toMatchObject({ fired: true });
    expect(state.loop.phaseLog).toContainEqual(expect.objectContaining({
      kind: "incidentJudged",
      publicContext: expect.objectContaining({
        characters: expect.objectContaining({
          doctor: expect.objectContaining({ paranoia: 0 }),
        }),
      }),
    }));

    const table = evaluateStateIncidentHypotheses(state);
    const column = table.columns[0].id;
    expect(table.cells.doctor[column]).toMatchObject({
      status: "impossible",
      reasons: [{ code: "otherCulpritConfirmed" }],
    });
    expect(table.cells.boyStudent[column]).toMatchObject({
      status: "confirmed",
      reasons: [{ code: "onlyRemainingCandidate" }],
    });
  });
});
