import { characterDataOf } from "../data";
import {
  evaluateRoleTableHypothesesFromRuleEvaluation,
  evaluateRoleTableHypotheses,
  evaluateRuleHypotheses,
  evaluateStateRoleTableHypotheses,
  ruleCompatibleCombinations,
  type EvaluatedRoleTableRuleCombination,
  type ProtagonistObservation,
  type RuleCombination,
  type RuleHypothesisEvaluation,
  type RolePossibilityTable,
  type RoleTableHypothesisEvaluation,
} from "../engine/hypothesis";
import {
  evaluateStateIncidentHypotheses,
  type IncidentHypothesisColumn,
  type IncidentPossibilityTable,
} from "../engine/incident-hypothesis";
import {
  incidentFailureReasons,
  incidentFires,
  incidentParanoia,
} from "../engine/incident";
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
  /** AI면 우호·불안·음모·보호를 합산한 사건 판정값이다. */
  allCountersCountAsParanoia: boolean;
  conditionMet: boolean;
  currentFailureReasons: IncidentFailureReason[];
  outcome?: IncidentScheduleOutcome;
  effectApplied?: boolean;
  outcomeReasons: IncidentFailureReason[];
  /** false면 이전 저장 데이터라 정확한 미발생 사유가 남아 있지 않다. */
  judgmentRecorded: boolean;
  /** FAQ Q5의 비공개 등장 정보를 각본가에게만 보여 주는 표기. */
  culpritEntryLabel?: string;
  /** 같은 사건 회차를 AI 우호 능력으로 미리 해결한 실제 날짜. */
  aiEffectResolvedOnDays: number[];
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
  subPlotSlots: number;
  fixedSubPlots: PlotId[];
  unresolvedSubPlotCandidates: PlotId[];
  unresolvedSubPlotSlots: number;
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
  observations: ProtagonistObservation[];
  remainingCombinations: RuleCombination[];
  roleTable: RolePossibilityTable;
  roleRows: RolePossibilitySummaryRow[];
  incidentTable: IncidentPossibilityTable;
  incidentRows: IncidentPossibilitySummaryRow[];
}

interface LossPrefixCacheNode {
  children: Map<string, LossPrefixCacheNode>;
  ruleEvaluations: Map<string, RuleHypothesisEvaluation>;
  roleEvaluations: Map<string, RoleTableHypothesisEvaluation>;
}

interface LossPrefixCache {
  contextKey: string;
  root: LossPrefixCacheNode;
  nodeCount: number;
}

const MAX_LOSS_PREFIX_CACHE_NODES = 512;
const MAX_LOSS_PREFIX_CACHE_CONTEXTS = 8;
const lossPrefixCaches = new Map<string, LossPrefixCache>();

function emptyLossPrefixCacheNode(): LossPrefixCacheNode {
  return {
    children: new Map(),
    ruleEvaluations: new Map(),
    roleEvaluations: new Map(),
  };
}

function lossPrefixCacheFor(
  state: GameState,
  publicCast: readonly CharacterId[],
): LossPrefixCache {
  const contextKey = JSON.stringify([
    state.scenario.tragedySet,
    publicCast,
  ]);
  const current = lossPrefixCaches.get(contextKey);
  if (
    current !== undefined &&
    current.nodeCount <= MAX_LOSS_PREFIX_CACHE_NODES
  ) {
    lossPrefixCaches.delete(contextKey);
    lossPrefixCaches.set(contextKey, current);
    return current;
  }

  const created: LossPrefixCache = {
    contextKey,
    root: emptyLossPrefixCacheNode(),
    nodeCount: 1,
  };
  lossPrefixCaches.set(contextKey, created);
  if (lossPrefixCaches.size > MAX_LOSS_PREFIX_CACHE_CONTEXTS) {
    const oldest = lossPrefixCaches.keys().next().value;
    if (oldest !== undefined) lossPrefixCaches.delete(oldest);
  }
  return created;
}

function lossPrefixCacheNodes(
  cache: LossPrefixCache,
  observations: readonly ProtagonistObservation[],
): LossPrefixCacheNode[] {
  const nodes = [cache.root];
  let node = cache.root;
  for (const observation of observations) {
    const key = JSON.stringify(observation);
    let child = node.children.get(key);
    if (child === undefined) {
      child = emptyLossPrefixCacheNode();
      node.children.set(key, child);
      cache.nodeCount += 1;
    }
    node = child;
    nodes.push(node);
  }
  return nodes;
}

function candidateCombinationKey(
  candidates: readonly RuleCombination[] | undefined,
): string {
  return candidates === undefined
    ? "all"
    : JSON.stringify(candidates.map(({ id }) => id));
}

function evaluateLossPrefix(
  state: GameState,
  publicCast: readonly CharacterId[],
  observations: readonly ProtagonistObservation[],
  prefixLength: number,
  candidates: readonly RuleCombination[] | undefined,
  cacheNode: LossPrefixCacheNode | undefined,
): RoleTableHypothesisEvaluation {
  if (cacheNode === undefined) {
    return evaluateRoleTableHypotheses(
      state.scenario.tragedySet,
      publicCast,
      observations.slice(0, prefixLength),
      candidates,
    );
  }

  const candidateKey = candidateCombinationKey(candidates);
  const cachedRoleEvaluation = cacheNode.roleEvaluations.get(candidateKey);
  if (cachedRoleEvaluation !== undefined) return cachedRoleEvaluation;

  let ruleEvaluation = cacheNode.ruleEvaluations.get(candidateKey);
  if (ruleEvaluation === undefined) {
    ruleEvaluation = evaluateRuleHypotheses(
      state.scenario.tragedySet,
      observations.slice(0, prefixLength),
      { publicCast, candidateCombinations: candidates },
    );
    cacheNode.ruleEvaluations.set(candidateKey, ruleEvaluation);
  }
  const roleEvaluation = evaluateRoleTableHypothesesFromRuleEvaluation(
    publicCast,
    ruleEvaluation,
  );
  cacheNode.roleEvaluations.set(candidateKey, roleEvaluation);
  return roleEvaluation;
}

/** 각본가 패널에 필요한 룰 후보와 관측별 순차 배제 수를 계산한다. */
function buildRuleHypothesisSummary(
  state: GameState,
  evaluation: RoleTableHypothesisEvaluation,
  reuseLossPrefixes: boolean,
): RuleHypothesisSummary {
  const definition = tragedySetDefinition(state.scenario.tragedySet);
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
  const fixedSubPlots = subPlotCandidates.filter((plot) =>
    evaluation.remaining.length > 0 &&
    evaluation.remaining.every(({ subPlots }) => subPlots.includes(plot))
  );
  const fixedSubPlotSet = new Set(fixedSubPlots);
  const unresolvedSubPlotCandidates = subPlotCandidates.filter((plot) =>
    !fixedSubPlotSet.has(plot)
  );
  const lossDeductions: LossHypothesisDeduction[] = [];
  const publicCast = Object.keys(state.scenario.cast);
  const prefixNodes = reuseLossPrefixes
    ? lossPrefixCacheNodes(
      lossPrefixCacheFor(state, publicCast),
      evaluation.observations,
    )
    : undefined;
  let prefixCandidates: readonly RuleCombination[] | undefined;
  for (let index = 0; index < evaluation.observations.length; index += 1) {
    const observation = evaluation.observations[index];
    if (observation?.kind !== "lossObserved") continue;
    const beforeEvaluation = evaluateLossPrefix(
      state,
      publicCast,
      evaluation.observations,
      index,
      prefixCandidates,
      prefixNodes?.[index],
    );
    const afterCandidates = ruleCompatibleCombinations(beforeEvaluation);
    const afterEvaluation = index + 1 === evaluation.observations.length
      ? evaluation
      : evaluateLossPrefix(
        state,
        publicCast,
        evaluation.observations,
        index + 1,
        afterCandidates,
        prefixNodes?.[index + 1],
      );
    if (index + 1 === evaluation.observations.length) {
      prefixNodes?.[index + 1]?.roleEvaluations.set(
        candidateCombinationKey(afterCandidates),
        evaluation,
      );
    }
    // 역할표 때문에 빠진 조합은 다음 prefix에서 다시 포함해야 한다.
    // 캐시된 remaining을 후보로 넘기면 비단조 추론이 깨진다.
    prefixCandidates = ruleCompatibleCombinations(afterEvaluation);
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
    subPlotSlots: definition.numberOfSubPlots,
    fixedSubPlots,
    unresolvedSubPlotCandidates,
    unresolvedSubPlotSlots: Math.max(
      0,
      definition.numberOfSubPlots - fixedSubPlots.length,
    ),
    ruleYFixed: mainPlotCandidates.length === 1,
    observationImpacts,
    lossDeductions,
    showEveryCombination: evaluation.combinations.length <= 9,
    tableExcludedCount: evaluation.combinations.filter(
      ({ tableContradictions }) => tableContradictions.length > 0
    ).length,
  };
}

/** 세션 메모리에서 불변인 과거 관측 prefix의 룰 계층만 재사용한다. */
export function ruleHypothesisSummary(
  state: GameState,
  evaluation: RoleTableHypothesisEvaluation =
    evaluateStateRoleTableHypotheses(state),
): RuleHypothesisSummary {
  return buildRuleHypothesisSummary(state, evaluation, true);
}

/** 증분 결과와 전체 재계산을 대조하는 회귀 검증 기준선. */
export function ruleHypothesisSummaryFullRecalculation(
  state: GameState,
  evaluation: RoleTableHypothesisEvaluation =
    evaluateStateRoleTableHypotheses(state),
): RuleHypothesisSummary {
  return buildRuleHypothesisSummary(state, evaluation, false);
}

/** 역할표와 범인표를 같은 공개 관측 스냅샷에서 계산한다. */
export function deductionTablesSummary(
  state: GameState,
  roleEvaluation: RoleTableHypothesisEvaluation =
    evaluateStateRoleTableHypotheses(state),
): DeductionTablesSummary {
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
  return {
    observations: roleEvaluation.observations,
    remainingCombinations: roleEvaluation.remaining,
    roleTable,
    roleRows,
    incidentTable,
    incidentRows,
  };
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
      const paranoia = incidentParanoia(state, scheduled.culprit);
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
      const aiEffectResolvedOnDays = (state.loop.publicInformationThisLoop ?? [])
        .flatMap((information) =>
          information.kind === "incidentEffect" &&
            information.day === scheduled.day &&
            information.incident === scheduled.incident
            ? [information.resolvedOnDay ?? information.day]
            : []
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
        allCountersCountAsParanoia: scheduled.culprit === "ai",
        conditionMet: incidentFires(state, scheduled.culprit),
        currentFailureReasons,
        outcome,
        effectApplied,
        outcomeReasons,
        judgmentRecorded: judgment?.kind === "incidentJudged",
        culpritEntryLabel: entry === undefined
          ? undefined
          : `${entry.value}${entry.kind === "day" ? "일" : "루프"} 등장`,
        aiEffectResolvedOnDays,
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
  const routes = distanceToLoss(state).flatMap((condition) =>
    condition.routes.filter(({ available }) => available)
  );
  if (routes.length === 0) return "조건 없음";
  const ready = routes.filter(({ met }) => met).length;
  return ready === 0
    ? `위험 경로 ${routes.length}개`
    : `준비 완료 ${ready}/${routes.length}개`;
}

export function spentCardsSummary(state: GameState): string {
  const protagonists = state.loop.spentOncePerLoop.protagonists
    .map((cards) => cards.length).join("/");
  return `각본가 ${state.loop.spentOncePerLoop.mastermind.length} · 주인공 ${protagonists}`;
}
