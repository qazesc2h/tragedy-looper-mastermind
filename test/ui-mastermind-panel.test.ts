import { describe, expect, it } from "vitest";

import { initLoop } from "../src/engine/setup";
import {
  deductionTablesSummary,
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
      boyStudent: "person",
      classRep: "person",
      shrineMaiden: "person",
      doctor: "person",
      patient: "person",
      informer: "person",
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

  it("shows an AI effect resolution beside the still-pending scheduled incident", () => {
    const state = createState();
    state.loop.day = 2;
    state.loop.publicInformationThisLoop = [{
      kind: "incidentEffect",
      source: "ai",
      day: 4,
      resolvedOnDay: 2,
      incident: "murder",
      culprit: "ai",
      effectApplied: true,
    }];

    expect(incidentScheduleRows(state).find(({ day }) => day === 4))
      .toMatchObject({
        timing: "future",
        outcome: undefined,
        aiEffectResolvedOnDays: [2],
      });
  });

  it("labels AI's all-counter value separately from ordinary paranoia", () => {
    const state = createState();
    state.scenario.cast.ai = "killer";
    state.scenario.incidents.push({
      day: 5,
      incident: "murder",
      culprit: "ai",
    });
    state.loop.board.ai = { status: "alive", at: "City" };
    state.loop.charCounters.ai = {
      goodwill: 1,
      paranoia: 1,
      intrigue: 1,
      protection: 1,
    };

    expect(incidentScheduleRows(state).find(({ culprit }) => culprit === "ai"))
      .toMatchObject({
        paranoia: 4,
        paranoiaLimit: 4,
        allCountersCountAsParanoia: true,
        conditionMet: true,
      });
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
    expect(lossDistanceSummary(state)).toBe("위험 경로 3개");

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
      subPlotSlots: 2,
      fixedSubPlots: [],
      unresolvedSubPlotSlots: 2,
      ruleYFixed: false,
      showEveryCombination: false,
    });
    expect(summary.remainingCombinations).toHaveLength(105);
    expect(summary.mainPlotCandidates).toHaveLength(5);
    expect(summary.subPlotCandidates).toHaveLength(7);
    expect(summary.observationImpacts.map(({ excludedCount }) => excludedCount))
      .toEqual([0, 0]);
  });

  it("does not show a revealed friend's loop-start goodwill as another observation", () => {
    const state = createState();
    const revealedLoop = initLoop(state.scenario, 1);
    revealedLoop.publicInformationThisLoop = [{
      kind: "roleReveal",
      character: "girlStudent",
      role: "friend",
      loop: 1,
      day: 1,
    }];
    revealedLoop.revealedRoleCharacters = ["girlStudent"];
    state.history = [revealedLoop];
    state.loop = initLoop(state.scenario, 2);
    state.loop.phaseLog?.push({
      loop: 2,
      day: 1,
      phase: "P1_ROUND_START",
      kind: "abilityActivated",
      timing: "LOOP_START",
      character: "girlStudent",
      description: "This character gets 1 goodwill.",
      publicChanges: [{
        kind: "counter",
        target: { kind: "character", id: "girlStudent" },
        counter: "goodwill",
        delta: 1,
      }],
    });

    const summary = ruleHypothesisSummary(state);
    expect(summary.observationImpacts.map(({ observation }) =>
      observation.kind
    )).toEqual(["roleRevealed"]);
  });

  it("attributes a newly fixed sealedItem rule to the observed defeat", () => {
    const state = createState();
    delete state.scenario.cast.shrineMaiden;
    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";
    state.loop.locIntrigue.Shrine = 2;
    for (const counters of Object.values(state.loop.charCounters)) {
      counters.goodwill = 3;
    }
    state.history = [structuredClone(state.loop)];
    state.loopOutcomes = [{
      loop: 1,
      day: state.loop.day,
      reason: "lastDay",
      result: "protagonistsLost",
      losses: [{
        key: "plot:sealedItem",
        id: "sealedItem",
        ko: "봉인된 것",
        label: "hidden exact cause",
      }],
    }];

    const summary = ruleHypothesisSummary(state);

    expect(summary.mainPlotCandidates).toEqual(["sealedItem"]);
    expect(summary.lossDeductions).toEqual([expect.objectContaining({
      observation: expect.objectContaining({ kind: "lossObserved" }),
      fixedPlots: ["sealedItem"],
      fixedRoles: [],
    })]);
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
      .toEqual([63, 21, 0, 0]);
    expect(summary.observationImpacts.reduce(
      (sum, { excludedCount }) => sum + excludedCount,
      0,
    )).toBe(summary.totalCombinations - summary.remainingCombinations.length);
  });

  it("shows zero-impact observations instead of dropping them", () => {
    const state = createState();
    state.scenario.tragedySet = "firstSteps";
    state.loop.phaseLog?.push({
      loop: 1,
      day: 1,
      phase: "P5_MASTERMIND_ABILITY",
      kind: "abilityActivated",
      character: "girlStudent",
      description: "hidden ability",
      publicChanges: [{
        kind: "counter",
        target: { kind: "character", id: "girlStudent" },
        counter: "paranoia",
        delta: 1,
      }],
      publicContext: {
        locationIntrigue: {
          Hospital: 0,
          Shrine: 0,
          City: 0,
          School: 0,
        },
      },
    });

    const summary = ruleHypothesisSummary(state);

    expect(summary.remainingCombinations).toHaveLength(9);
    expect(summary.observationImpacts).toHaveLength(3);
    expect(summary.observationImpacts.at(-1)).toMatchObject({
      excludedCount: 0,
      observation: { kind: "mastermindAbilityResult" },
    });
  });

  it("derives both rule axes from unique plots in remaining combinations", () => {
    const state = createState();
    state.loop.phaseLog?.push({
      loop: 1,
      day: 1,
      phase: "P5_MASTERMIND_ABILITY",
      kind: "abilityActivated",
      character: "girlStudent",
      description: "hidden ability",
      publicChanges: [{
        kind: "counter",
        target: { kind: "character", id: "girlStudent" },
        counter: "paranoia",
        delta: 1,
      }],
      publicContext: {
        locationIntrigue: {
          Hospital: 0,
          Shrine: 0,
          City: 0,
          School: 0,
        },
      },
    });

    const summary = ruleHypothesisSummary(state);

    expect(summary.remainingCombinations).toHaveLength(75);
    expect(summary.mainPlotCandidates).toHaveLength(5);
    expect(summary.subPlotCandidates).toHaveLength(7);
    expect(summary.observationImpacts.map(({ excludedCount }) => excludedCount))
      .toEqual([0, 0, 30]);
  });

  it("reports sequential impact for the two fixed C-2 subplot observations", () => {
    const state = createState();
    state.loop.phaseLog?.push(
      {
        loop: 1,
        day: 2,
        phase: "P7_INCIDENT",
        kind: "abilityActivated",
        timing: "ON_DEATH",
        description: "hidden source",
        publicTrigger: {
          kind: "death",
          deadCharacters: ["girlStudent"],
        },
        publicChanges: [{
          kind: "counter",
          target: { kind: "character", id: "officeWorker" },
          counter: "paranoia",
          delta: 6,
        }],
      },
      {
        loop: 1,
        day: 1,
        phase: "P1_ROUND_START",
        kind: "abilityActivated",
        timing: "LOOP_START",
        description: "hidden source",
        publicChanges: ["girlStudent", "officeWorker"].map((id) => ({
          kind: "counter" as const,
          target: { kind: "character" as const, id },
          counter: "paranoia" as const,
          delta: 2,
        })),
      },
    );

    const summary = ruleHypothesisSummary(state);

    expect(summary.remainingCombinations).toHaveLength(5);
    expect(summary.mainPlotCandidates).toHaveLength(5);
    expect(summary.subPlotCandidates).toEqual(["loveAffair", "threadsFate"]);
    expect(summary.fixedSubPlots).toEqual(["loveAffair", "threadsFate"]);
    expect(summary.unresolvedSubPlotCandidates).toEqual([]);
    expect(summary.unresolvedSubPlotSlots).toBe(0);
    expect(summary.observationImpacts.map(({ excludedCount }) => excludedCount))
      .toEqual([0, 0, 75, 25]);
  });

  it("treats basic subplots as an unordered pair with a shared fixed member", () => {
    const state = createState();
    state.loop.phaseLog?.push({
      loop: 1,
      day: 2,
      phase: "P7_INCIDENT",
      kind: "abilityActivated",
      timing: "ON_DEATH",
      description: "hidden source",
      publicTrigger: {
        kind: "death",
        deadCharacters: ["girlStudent"],
      },
      publicChanges: [{
        kind: "counter",
        target: { kind: "character", id: "officeWorker" },
        counter: "paranoia",
        delta: 6,
      }],
    });

    const summary = ruleHypothesisSummary(state);

    expect(summary.remainingCombinations).toHaveLength(30);
    expect(summary.fixedSubPlots).toEqual(["loveAffair"]);
    expect(summary.unresolvedSubPlotCandidates).toEqual([
      "circleFriends",
      "hiddenFreak",
      "unsettlingRumor",
      "paranoiaVirus",
      "threadsFate",
      "unknownFactor",
    ]);
    expect(summary.unresolvedSubPlotSlots).toBe(1);
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

describe("mastermind deduction table summary", () => {
  it("summarizes confirmed and narrowed role and culprit rows", () => {
    const state = createState();
    state.loop.publicInformationThisLoop = [
      {
        kind: "roleReveal",
        character: "nurse",
        role: "person",
        loop: 1,
        day: 1,
      },
      {
        kind: "goodwillRefusal",
        character: "officeWorker",
        rank: 3,
        abilityIndex: 0,
        loop: 1,
        day: 2,
      },
      {
        kind: "incidentCulprit",
        source: "godlyBeing",
        day: 1,
        incident: "foulEvil",
        culprit: "girlStudent",
      },
    ];

    const summary = deductionTablesSummary(state);
    const nurse = summary.roleRows.find(({ character }) =>
      character === "nurse"
    );
    const officeWorker = summary.roleRows.find(({ character }) =>
      character === "officeWorker"
    );
    const girlStudent = summary.incidentRows.find(({ character }) =>
      character === "girlStudent"
    );

    expect(nurse).toMatchObject({
      confirmedRole: "person",
      possibleRoles: ["person"],
      narrowed: true,
    });
    expect(officeWorker?.narrowed).toBe(true);
    expect(officeWorker?.possibleRoles).not.toContain("person");
    expect(girlStudent?.confirmedColumn).toMatchObject({
      day: 1,
      incident: "foulEvil",
    });
    expect(girlStudent?.possibleColumns).toHaveLength(1);
  });
});
