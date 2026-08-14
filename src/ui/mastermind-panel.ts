import { characterDataOf } from "../data";
import {
  evaluateRoleTableHypotheses,
  evaluateStateRoleTableHypotheses,
  type EvaluatedRoleTableRuleCombination,
  type ProtagonistObservation,
  type RuleCombination,
  type RolePossibilityTable,
} from "../engine/hypothesis";
import {
  evaluateStateIncidentHypotheses,
  type IncidentHypothesisColumn,
  type IncidentPossibilityTable,
} from "../engine/incident-hypothesis";
import { incidentFailureReasons, incidentFires } from "../engine/incident";
import { distanceToLoss } from "../engine/loss";
import { tragedySetDefinition } from "../tragedy-sets";
import { characterEntryTiming } from "../types";
import type {
  CharacterId,
  GameState,
  IncidentFailureReason,
  PlotId,
  RoleId,
  ScheduledIncident,
} from "../types";

export type IncidentScheduleTiming = "past" | "today" | "future";
export type IncidentScheduleOutcome = "fired" | "notFired";

export interface IncidentScheduleRow extends ScheduledIncident {
  timing: IncidentScheduleTiming;
  daysUntil: number;
  paranoia: number;
  paranoiaLimit: number;
  paranoiaNeeded: number;
  conditionMet: boolean;
  currentFailureReasons: IncidentFailureReason[];
  outcome?: IncidentScheduleOutcome;
  effectApplied?: boolean;
  outcomeReasons: IncidentFailureReason[];
  /** false면 이전 저장 데이터라 정확한 미발생 사유가 남아 있지 않다. */
  judgmentRecorded: boolean;
  /** FAQ Q5의 비공개 등장 정보를 각본가에게만 보여 주는 표기. */
  culpritEntryLabel?: string;
}

export interface RuleHypothesisObservationImpact {
  observation: ProtagonistObservation;
  excludedCount: number;
}

export interface LossHypothesisDeduction {
  observation: Extract<ProtagonistObservation, { kind: "lossObserved" }>;
  fixedPlots: PlotId[];
  fixedRoles: { character: CharacterId; role: RoleId }[];
}

export interface RuleHypothesisSummary {
  totalCombinations: number;
  remainingCombinations: RuleCombination[];
  evaluatedCombinations: EvaluatedRoleTableRuleCombination[];
  mainPlotTotal: number;
  mainPlotCandidates: PlotId[];
  subPlotTotal: number;
  subPlotCandidates: PlotId[];
  ruleYFixed: boolean;
  observationImpacts: RuleHypothesisObservationImpact[];
  lossDeductions: LossHypothesisDeduction[];
  showEveryCombination: boolean;
  tableExcludedCount: number;
}

export interface RolePossibilitySummaryRow {
  character: CharacterId;
  possibleRoles: string[];
  confirmedRole?: string;
  impossibleCount: number;
  narrowed: boolean;
}

export interface IncidentPossibilitySummaryRow {
  character: CharacterId;
  possibleColumns: IncidentHypothesisColumn[];
  confirmedColumn?: IncidentHypothesisColumn;
  impossibleCount: number;
  narrowed: boolean;
}

export interface DeductionTablesSummary {
  roleTable: RolePossibilityTable;
  roleRows: RolePossibilitySummaryRow[];
  incidentTable: IncidentPossibilityTable;
  incidentRows: IncidentPossibilitySummaryRow[];
}

/** 각본가 패널에 필요한 룰 후보와 관측별 순차 배제 수를 계산한다. */
export function ruleHypothesisSummary(
  state: GameState,
): RuleHypothesisSummary {
  const definition = tragedySetDefinition(state.scenario.tragedySet);
  const evaluation = evaluateStateRoleTableHypotheses(state);
  const remainingMainPlots = new Set(
    evaluation.remaining.map(({ mainPlot }) => mainPlot),
  );
  const remainingSubPlots = new Set(
    evaluation.remaining.flatMap(({ subPlots }) => subPlots),
  );
  const alreadyExcluded = new Set<string>();
  const observationImpacts = evaluation.observations.map((observation) => {
    const newlyExcluded = evaluation.combinations.filter(
      ({ combination, contradictions }) =>
        !alreadyExcluded.has(combination.id) &&
        contradictions.some((contradiction) =>
          contradiction.observation === observation
        ),
    );
    for (const { combination } of newlyExcluded) {
      alreadyExcluded.add(combination.id);
    }
    return { observation, excludedCount: newlyExcluded.length };
  });
  const mainPlotCandidates = definition.mainPlots.filter((plot) =>
    remainingMainPlots.has(plot)
  );
  const subPlotCandidates = definition.subPlots.filter((plot) =>
    remainingSubPlots.has(plot)
  );
  const lossDeductions: LossHypothesisDeduction[] = [];
  for (let index = 0; index < evaluation.observations.length; index += 1) {
    const observation = evaluation.observations[index];
    if (observation?.kind !== "lossObserved") continue;
    const beforePrefix = evaluation.observations.slice(0, index);
    const afterPrefix = evaluation.observations.slice(0, index + 1);
    const publicCast = Object.keys(state.scenario.cast);
    const beforeEvaluation = evaluateRoleTableHypotheses(
      state.scenario.tragedySet,
      publicCast,
      beforePrefix,
    );
    const afterEvaluation = evaluateRoleTableHypotheses(
      state.scenario.tragedySet,
      publicCast,
      afterPrefix,
    );
    const allPlots = [...definition.mainPlots, ...definition.subPlots];
    const fixedPlots = allPlots.filter((plot) =>
      afterEvaluation.remaining.length > 0 &&
      afterEvaluation.remaining.every(({ mainPlot, subPlots }) =>
        mainPlot === plot || subPlots.includes(plot)
      ) &&
      !beforeEvaluation.remaining.every(({ mainPlot, subPlots }) =>
        mainPlot === plot || subPlots.includes(plot)
      )
    );
    const fixedRoles = afterEvaluation.table.characters.flatMap((character) =>
      afterEvaluation.table.roles.flatMap((role) =>
        afterEvaluation.table.cells[character]?.[role]?.status === "confirmed" &&
          beforeEvaluation.table.cells[character]?.[role]?.status !== "confirmed"
          ? [{ character, role }]
          : []
      )
    );
    if (fixedPlots.length > 0 || fixedRoles.length > 0) {
      lossDeductions.push({ observation, fixedPlots, fixedRoles });
    }
  }

  return {
    totalCombinations: evaluation.combinations.length,
    remainingCombinations: evaluation.remaining,
    evaluatedCombinations: evaluation.combinations,
    mainPlotTotal: definition.mainPlots.length,
    mainPlotCandidates,
    subPlotTotal: definition.subPlots.length,
    subPlotCandidates,
    ruleYFixed: mainPlotCandidates.length === 1,
    observationImpacts,
    lossDeductions,
    showEveryCombination: evaluation.combinations.length <= 9,
    tableExcludedCount: evaluation.combinations.filter(
      ({ tableContradictions }) => tableContradictions.length > 0
    ).length,
  };
}

/** 역할표와 범인표를 같은 공개 관측 스냅샷에서 계산한다. */
export function deductionTablesSummary(
  state: GameState,
): DeductionTablesSummary {
  const roleEvaluation = evaluateStateRoleTableHypotheses(state);
  const roleTable = roleEvaluation.table;
  const incidentTable = evaluateStateIncidentHypotheses(state);
  const roleRows = roleTable.characters.map((character) => {
    const possibleRoles = roleTable.roles.filter((role) =>
      roleTable.cells[character]?.[role]?.status !== "impossible"
    );
    const confirmedRole = roleTable.roles.find((role) =>
      roleTable.cells[character]?.[role]?.status === "confirmed"
    );
    return {
      character,
      possibleRoles,
      ...(confirmedRole === undefined ? {} : { confirmedRole }),
      impossibleCount: roleTable.roles.length - possibleRoles.length,
      narrowed: possibleRoles.length < roleTable.roles.length,
    };
  });
  const incidentRows = incidentTable.characters.map((character) => {
    const possibleColumns = incidentTable.columns.filter((column) =>
      incidentTable.cells[character]?.[column.id]?.status !== "impossible"
    );
    const confirmedColumn = incidentTable.columns.find((column) =>
      incidentTable.cells[character]?.[column.id]?.status === "confirmed"
    );
    return {
      character,
      possibleColumns,
      ...(confirmedColumn === undefined ? {} : { confirmedColumn }),
      impossibleCount: incidentTable.columns.length - possibleColumns.length,
      narrowed: possibleColumns.length < incidentTable.columns.length,
    };
  });
  return { roleTable, roleRows, incidentTable, incidentRows };
}

function occurrenceFired(
  state: GameState,
  scheduled: ScheduledIncident,
): boolean {
  return state.loop.incidentOccurrencesFiredThisLoop?.some(
    ({ day, incident, culprit }) =>
      day === scheduled.day &&
      incident === scheduled.incident &&
      culprit === scheduled.culprit,
  ) === true;
}

/** 과거 판정과 현재 조건을 합쳐 전체 사건 일정 표의 행을 만든다. */
export function incidentScheduleRows(
  state: GameState,
): IncidentScheduleRow[] {
  return state.scenario.incidents
    .map((scheduled, index) => ({ scheduled, index }))
    .sort((left, right) =>
      left.scheduled.day - right.scheduled.day || left.index - right.index
    )
    .map(({ scheduled }) => {
      const paranoia = state.loop.charCounters[scheduled.culprit].paranoia;
      const paranoiaLimit = characterDataOf(scheduled.culprit).paranoiaLimit;
      const daysUntil = scheduled.day - state.loop.day;
      const timing: IncidentScheduleTiming = daysUntil < 0
        ? "past"
        : daysUntil === 0
        ? "today"
        : "future";
      const currentFailureReasons = incidentFailureReasons(
        state,
        scheduled.culprit,
      );
      const entry = characterEntryTiming(state.scenario, scheduled.culprit);
      const judgment = state.loop.phaseLog?.find((entry) =>
        entry.kind === "incidentJudged" &&
        entry.day === scheduled.day &&
        entry.incident === scheduled.incident &&
        entry.culprit === scheduled.culprit
      );

      let outcome: IncidentScheduleOutcome | undefined;
      let effectApplied: boolean | undefined;
      let outcomeReasons: IncidentFailureReason[] = [];
      if (judgment?.kind === "incidentJudged") {
        outcome = judgment.fired ? "fired" : "notFired";
        effectApplied = judgment.effectApplied;
        outcomeReasons = [...judgment.failureReasons];
      } else if (timing === "past") {
        outcome = occurrenceFired(state, scheduled) ? "fired" : "notFired";
      } else if (timing === "today" && occurrenceFired(state, scheduled)) {
        outcome = "fired";
      }

      return {
        ...scheduled,
        timing,
        daysUntil,
        paranoia,
        paranoiaLimit,
        paranoiaNeeded: Math.max(0, paranoiaLimit - paranoia),
        conditionMet: incidentFires(state, scheduled.culprit),
        currentFailureReasons,
        outcome,
        effectApplied,
        outcomeReasons,
        judgmentRecorded: judgment?.kind === "incidentJudged",
        culpritEntryLabel: entry === undefined
          ? undefined
          : `${entry.value}${entry.kind === "day" ? "일" : "루프"} 등장`,
      };
    });
}

export function incidentScheduleRowsForCharacter(
  state: GameState,
  character: CharacterId,
): IncidentScheduleRow[] {
  return incidentScheduleRows(state).filter(
    ({ culprit }) => culprit === character,
  );
}

export function incidentDaysForCharacter(
  state: GameState,
  character: CharacterId,
): number[] {
  return state.scenario.incidents
    .filter(({ culprit }) => culprit === character)
    .map(({ day }) => day)
    .sort((left, right) => left - right);
}

export function incidentDayLabelsForCharacter(
  state: GameState,
  character: CharacterId,
): string[] {
  return incidentDaysForCharacter(state, character).map((day) => `${day}일`);
}

export function incidentScheduleSummary(state: GameState): string {
  const todayCount = state.scenario.incidents.filter(
    ({ day }) => day === state.loop.day,
  ).length;
  return todayCount === 0 ? "오늘 없음" : `오늘 ${todayCount}건`;
}

export function lossDistanceSummary(state: GameState): string {
  const nearest = distanceToLoss(state)
    .map((condition, index) => ({ condition, index }))
    .sort((left, right) =>
      Number(right.condition.met) - Number(left.condition.met) ||
      left.condition.remaining - right.condition.remaining ||
      left.index - right.index
    )[0]?.condition;
  return nearest?.label ?? "조건 없음";
}

export function spentCardsSummary(state: GameState): string {
  const protagonists = state.loop.spentOncePerLoop.protagonists
    .map((cards) => cards.length).join("/");
  return `각본가 ${state.loop.spentOncePerLoop.mastermind.length} · 주인공 ${protagonists}`;
}
