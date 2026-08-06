import { describe, expect, it } from "vitest";

import { initLoop } from "../src/engine/setup";
import {
  incidentDayLabelsForCharacter,
  incidentDaysForCharacter,
  incidentScheduleRows,
  incidentScheduleRowsForCharacter,
} from "../src/ui/mastermind-panel";
import type { GameState, Scenario } from "../src/types";

function createState(): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "murderPlan",
    subPlots: ["circleFriends", "loveScene"],
    cast: {
      girlStudent: "friend",
      officeWorker: "killer",
      nurse: "person",
    },
    incidents: [
      { day: 1, incident: "foulEvil", culprit: "girlStudent" },
      { day: 2, incident: "suicide", culprit: "girlStudent" },
      { day: 4, incident: "murder", culprit: "officeWorker" },
      { day: 6, incident: "missingPerson", culprit: "nurse" },
    ],
    loops: 1,
    daysPerLoop: 6,
  };
  const loop = initLoop(scenario);
  loop.day = 4;
  loop.phase = "P7_INCIDENT";
  loop.charCounters.girlStudent.paranoia = 1;
  loop.charCounters.officeWorker.paranoia = 2;
  loop.charCounters.nurse.paranoia = 0;
  loop.phaseLog = [
    {
      loop: 1,
      day: 1,
      phase: "P7_INCIDENT",
      kind: "incidentJudged",
      incident: "foulEvil",
      culprit: "girlStudent",
      fired: true,
      effectApplied: true,
      failureReasons: [],
    },
    {
      loop: 1,
      day: 2,
      phase: "P7_INCIDENT",
      kind: "incidentJudged",
      incident: "suicide",
      culprit: "girlStudent",
      fired: false,
      effectApplied: false,
      failureReasons: ["insufficientParanoia"],
    },
  ];
  return { scenario, gamePhase: "ROUND", loop, history: [], loopOutcomes: [] };
}

describe("mastermind incident schedule", () => {
  it("distinguishes past outcomes, today's judgment, and future distance", () => {
    const rows = incidentScheduleRows(createState());

    expect(rows[0]).toMatchObject({
      day: 1,
      timing: "past",
      outcome: "fired",
      effectApplied: true,
      judgmentRecorded: true,
    });
    expect(rows[1]).toMatchObject({
      day: 2,
      timing: "past",
      outcome: "notFired",
      outcomeReasons: ["insufficientParanoia"],
      judgmentRecorded: true,
    });
    expect(rows[2]).toMatchObject({
      day: 4,
      timing: "today",
      daysUntil: 0,
      paranoia: 2,
      paranoiaLimit: 2,
      paranoiaNeeded: 0,
      conditionMet: true,
      outcome: undefined,
    });
    expect(rows[3]).toMatchObject({
      day: 6,
      timing: "future",
      daysUntil: 2,
      paranoia: 0,
      paranoiaLimit: 3,
      paranoiaNeeded: 3,
      conditionMet: false,
      outcome: undefined,
    });
  });

  it("keeps every culprit day when a character has multiple incidents", () => {
    expect(incidentDaysForCharacter(createState(), "girlStudent")).toEqual([
      1,
      2,
    ]);
    expect(incidentDayLabelsForCharacter(createState(), "girlStudent"))
      .toEqual(["1일", "2일"]);
    expect(incidentScheduleRowsForCharacter(createState(), "girlStudent"))
      .toMatchObject([
        { day: 1, outcome: "fired", judgmentRecorded: true },
        {
          day: 2,
          outcome: "notFired",
          outcomeReasons: ["insufficientParanoia"],
          judgmentRecorded: true,
        },
      ]);
  });
});
