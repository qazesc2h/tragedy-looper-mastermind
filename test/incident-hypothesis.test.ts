import { describe, expect, it } from "vitest";

import { advanceGame, createGameState } from "../src/engine/game";
import { evaluateStateRoleTableHypotheses } from "../src/engine/hypothesis";
import {
  evaluateIncidentHypotheses,
  evaluateStateIncidentHypotheses,
} from "../src/engine/incident-hypothesis";
import type { ProtagonistObservation } from "../src/engine/hypothesis";
import type {
  CharacterId,
  GameState,
  IncidentChoice,
  IncidentId,
  PublicBoardChange,
  PublicObservationContext,
  ScheduledIncident,
  Scenario,
} from "../src/types";
import { withCharacterLocation } from "../src/types";

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

const traceCast = [
  "doctor",
  "patient",
  "officeWorker",
  "boyStudent",
  "girlStudent",
  "shrineMaiden",
  "policeOfficer",
  "journalist",
  "classRep",
] as const;

function createTraceState(
  incident: IncidentId,
  culprit: CharacterId = "doctor",
): GameState {
  const cast = Object.fromEntries(
    traceCast.map((character) => [character, "person"]),
  );
  if (!traceCast.includes(culprit as typeof traceCast[number])) {
    cast[culprit] = "person";
  }
  const state = createGameState({
    tragedySet: "basicTragedy",
    mainPlot: "murderPlan",
    subPlots: ["hiddenFreak"],
    cast,
    incidents: [{ day: 1, incident, culprit }],
    loops: 3,
    daysPerLoop: 3,
  });
  state.gamePhase = "ROUND";
  state.loop.phase = "P7_INCIDENT";
  for (const character of Object.keys(cast)) {
    state.loop.charCounters[character].paranoia = 10;
  }
  return state;
}

function place(
  state: GameState,
  character: CharacterId,
  location: "Hospital" | "Shrine" | "City" | "School",
): void {
  state.loop.board[character] = withCharacterLocation(
    state.loop.board[character],
    location,
    character,
  );
}

function resolveTraceIncident(
  state: GameState,
  choice?: IncidentChoice,
): void {
  expect(advanceGame(state, choice)).toMatchObject({
    fired: true,
    effectApplied: true,
  });
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
      changes: [{
        kind: "status",
        character: "girlStudent",
        from: "alive",
        to: "dead",
      }],
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

  it("does not treat a legacy aggregate death list as a direct suicide trace", () => {
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
      [incidents[1]],
      [observation],
    );
    const suicide = table.columns[0].id;

    expect(table.cells.girlStudent[suicide].status).toBe("possible");
  });

  it("uses a missing-person stay trace to restrict the culprit to that location", () => {
    const state = createTraceState("missingPerson");
    place(state, "doctor", "Hospital");
    place(state, "patient", "Hospital");
    place(state, "officeWorker", "City");
    state.loop.charCounters.patient.paranoia = 0;

    resolveTraceIncident(state, { location: "Hospital" });
    const judgment = state.loop.phaseLog?.find((entry) =>
      entry.kind === "incidentJudged"
    );
    expect(judgment).toMatchObject({
      kind: "incidentJudged",
      publicChanges: [{
        kind: "counter",
        target: { kind: "location", at: "Hospital" },
        counter: "intrigue",
        delta: 1,
      }],
    });

    const table = evaluateStateIncidentHypotheses(state);
    const column = table.columns[0].id;
    expect(table.cells.officeWorker[column]).toMatchObject({
      status: "impossible",
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "incidentTraceLocationMismatch" }),
      ]),
    });
    expect(table.cells.doctor[column].status).toBe("confirmed");
    expect(table.cells.patient[column].status).toBe("impossible");
  });

  it("confirms the character moved by missing person", () => {
    const state = createTraceState("missingPerson");
    place(state, "doctor", "Hospital");
    place(state, "officeWorker", "City");

    resolveTraceIncident(state, { location: "City" });
    const table = evaluateStateIncidentHypotheses(state);
    const column = table.columns[0].id;
    expect(table.cells.doctor[column]).toMatchObject({
      status: "confirmed",
      reasons: [{ code: "missingPersonMovementIdentified" }],
    });
  });

  it("uses a murder victim's location but never marks the victim as culprit", () => {
    const state = createTraceState("murder");
    place(state, "doctor", "Hospital");
    place(state, "patient", "Hospital");
    place(state, "boyStudent", "Hospital");
    place(state, "officeWorker", "City");

    resolveTraceIncident(state, { target: "patient" });
    const table = evaluateStateIncidentHypotheses(state);
    const column = table.columns[0].id;
    expect(table.cells.patient[column]).toMatchObject({
      status: "impossible",
      reasons: [{ code: "murderVictimCannotBeCulprit" }],
    });
    expect(table.cells.officeWorker[column]).toMatchObject({
      status: "impossible",
      reasons: [{ code: "incidentTraceLocationMismatch" }],
    });
    expect(table.cells.doctor[column].status).toBe("possible");
    expect(table.cells.boyStudent[column].status).toBe("possible");
  });

  it("uses a butterfly-effect counter target's location", () => {
    const state = createTraceState("butterflyEffect");
    place(state, "doctor", "Hospital");
    place(state, "patient", "Hospital");
    place(state, "officeWorker", "City");

    resolveTraceIncident(state, { target: "patient", counter: "intrigue" });
    const table = evaluateStateIncidentHypotheses(state);
    const column = table.columns[0].id;
    expect(table.cells.officeWorker[column]).toMatchObject({
      status: "impossible",
      reasons: [{ code: "incidentTraceLocationMismatch" }],
    });
    expect(table.cells.doctor[column].status).toBe("possible");
    expect(table.cells.patient[column].status).toBe("possible");
  });

  it("confirms a suicide culprit from the direct death and feeds the death to the role table", () => {
    const state = createTraceState("suicide");

    resolveTraceIncident(state);
    const incidentTable = evaluateStateIncidentHypotheses(state);
    const column = incidentTable.columns[0].id;
    expect(incidentTable.cells.doctor[column]).toMatchObject({
      status: "confirmed",
      reasons: [{ code: "suicideDeathIdentified" }],
    });

    const roleEvaluation = evaluateStateRoleTableHypotheses(state);
    expect(roleEvaluation.table.cells.doctor.timeTraveler).toMatchObject({
      status: "impossible",
      reasons: [{ code: "diedDespiteImmortality" }],
    });
  });

  it("records no trace when black cat nullifies its own incident effect", () => {
    const state = createTraceState("missingPerson", "blackCat");
    place(state, "blackCat", "Hospital");
    place(state, "doctor", "City");

    expect(advanceGame(state, { location: "School" })).toMatchObject({
      fired: true,
      effectApplied: false,
    });
    const judgment = state.loop.phaseLog?.find((entry) =>
      entry.kind === "incidentJudged"
    );
    expect(judgment).not.toHaveProperty("publicChanges");

    const table = evaluateStateIncidentHypotheses(state);
    const column = table.columns[0].id;
    expect(table.cells.blackCat[column].status).toBe("possible");
    expect(table.cells.doctor[column].status).toBe("possible");
  });

  it("keeps a suppressed henchman eligible without inventing an effect trace", () => {
    const state = createTraceState("missingPerson", "henchman");
    state.loop.incidentCulpritSuppressedFor = ["henchman"];

    expect(advanceGame(state)).toMatchObject({
      fired: false,
      effectApplied: false,
    });
    const judgment = state.loop.phaseLog?.find((entry) =>
      entry.kind === "incidentJudged"
    );
    expect(judgment).not.toHaveProperty("publicChanges");

    const table = evaluateStateIncidentHypotheses(state);
    const column = table.columns[0].id;
    expect(table.cells.henchman[column].status).not.toBe("impossible");
  });

  it.each<{
    incident: IncidentId;
    changes: PublicBoardChange[];
  }>([
    {
      incident: "farawayMurder",
      changes: [{
        kind: "status",
        character: "patient",
        from: "alive",
        to: "dead",
      }],
    },
    {
      incident: "increasingUnease",
      changes: [{
        kind: "counter",
        target: { kind: "character", id: "patient" },
        counter: "paranoia",
        delta: 2,
      }],
    },
    {
      incident: "spreading",
      changes: [{
        kind: "counter",
        target: { kind: "character", id: "patient" },
        counter: "goodwill",
        delta: 2,
      }],
    },
    {
      incident: "hospitalIncident",
      changes: [{
        kind: "status",
        character: "patient",
        from: "alive",
        to: "dead",
      }],
    },
    {
      incident: "foulEvil",
      changes: [{
        kind: "counter",
        target: { kind: "location", at: "Shrine" },
        counter: "intrigue",
        delta: 2,
      }],
    },
  ])("does not create a location constraint from $incident", ({
    incident,
    changes,
  }) => {
    const observation: ProtagonistObservation = {
      kind: "incidentOccurred",
      loop: 1,
      day: 1,
      incident,
      occurred: true,
      changes,
      context: {
        locationIntrigue: { Hospital: 0, Shrine: 0, City: 0, School: 0 },
        characters: {
          doctor: publicCharacter("alive", 10),
          officeWorker: {
            ...publicCharacter("alive", 10),
            location: "City",
            abilityLocations: ["City"],
          },
        },
      },
    };
    const table = evaluateIncidentHypotheses(
      ["doctor", "officeWorker"],
      [{ day: 1, incident, culprit: "doctor" }],
      [observation],
    );
    const column = table.columns[0].id;
    expect(table.cells.doctor[column].status).toBe("possible");
    expect(table.cells.officeWorker[column].status).toBe("possible");
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
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "otherCulpritConfirmed" }),
        expect.objectContaining({ code: "firedBelowParanoia" }),
      ]),
    });
    expect(table.cells.boyStudent[column]).toMatchObject({
      status: "confirmed",
      reasons: [{ code: "onlyRemainingCandidate" }],
    });
  });
});
