import { describe, expect, it } from "vitest";

import { initLoop } from "../src/engine/setup";
import {
  incidentDayLabelsForCharacter,
  incidentDaysForCharacter,
  incidentScheduleSummary,
  incidentScheduleRows,
  incidentScheduleRowsForCharacter,
  lossDistanceSummary,
  ruleHypothesisSummary,
  spentCardsSummary,
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

  it("shows a delayed culprit's entry timing in the mastermind schedule", () => {
    const state = createState();
    state.scenario.cast.transferStudent = "person";
    state.scenario.scriptSpecified = {
      "enters on day:transferStudent": 4,
    };
    state.scenario.incidents = [{
      day: 5,
      incident: "murder",
      culprit: "transferStudent",
    }];
    state.loop.board.transferStudent = { status: "absent" };
    state.loop.charCounters.transferStudent = {
      goodwill: 0,
      paranoia: 0,
      intrigue: 0,
      protection: 0,
    };

    expect(incidentScheduleRows(state)).toMatchObject([{
      day: 5,
      incident: "murder",
      culprit: "transferStudent",
      culpritEntryLabel: "4일 등장",
      currentFailureReasons: ["culpritAbsent"],
    }]);
  });

  it("summarizes collapsed incident, loss, and spent-card panels", () => {
    const state = createState();
    expect(incidentScheduleSummary(state)).toBe("오늘 1건");

    state.scenario.mainPlot = "sealedItem";
    state.loop.locIntrigue.Shrine = 1;
    expect(lossDistanceSummary(state)).toBe("신사 음모 1/2");

    state.loop.spentOncePerLoop.mastermind.push("moveVertical");
    state.loop.spentOncePerLoop.protagonists[1].push("goodwillPlus2");
    expect(spentCardsSummary(state)).toBe("각본가 1 · 주인공 0/1/0");
  });
});

describe("mastermind rule hypothesis summary", () => {
  it("shows all 105 basic combinations before any observation narrows them", () => {
    const summary = ruleHypothesisSummary(createState());

    expect(summary).toMatchObject({
      totalCombinations: 105,
      mainPlotTotal: 5,
      subPlotTotal: 7,
      ruleYFixed: false,
      showEveryCombination: false,
    });
    expect(summary.remainingCombinations).toHaveLength(105);
    expect(summary.mainPlotCandidates).toHaveLength(5);
    expect(summary.subPlotCandidates).toHaveLength(7);
    expect(summary.observationImpacts).toEqual([]);
  });

  it("counts newly excluded combinations once in observation order", () => {
    const state = createState();
    state.loop.publicInformationThisLoop = [
      {
        kind: "roleReveal",
        character: "girlStudent",
        role: "brain",
        loop: 1,
        day: 1,
      },
      {
        kind: "roleReveal",
        character: "officeWorker",
        role: "keyPerson",
        loop: 1,
        day: 2,
      },
    ];

    const summary = ruleHypothesisSummary(state);

    expect(summary.mainPlotCandidates).toEqual(["murderPlan"]);
    expect(summary.ruleYFixed).toBe(true);
    expect(summary.remainingCombinations).toHaveLength(21);
    expect(summary.observationImpacts.map(({ excludedCount }) => excludedCount))
      .toEqual([63, 21]);
    expect(summary.observationImpacts.reduce(
      (sum, { excludedCount }) => sum + excludedCount,
      0,
    )).toBe(summary.totalCombinations - summary.remainingCombinations.length);
  });

  it("marks the nine-combination firstSteps set for a full list", () => {
    const state = createState();
    state.scenario.tragedySet = "firstSteps";

    const summary = ruleHypothesisSummary(state);

    expect(summary.totalCombinations).toBe(9);
    expect(summary.remainingCombinations).toHaveLength(9);
    expect(summary.showEveryCombination).toBe(true);
  });
});
