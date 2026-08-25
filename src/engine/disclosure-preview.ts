import { withDeathBatch } from "./death";
import {
  goodwillResponseAvailability,
  resolveGoodwillAbility,
  type GoodwillDeclaration,
} from "./goodwill";
import {
  collectProtagonistObservations,
  evaluateRoleTableHypotheses,
  evaluateStateRoleTableHypotheses,
  explainableLossConditions,
  hypotheticalLossObservation,
  type ExplainableLossCondition,
  type RoleTableHypothesisEvaluation,
  type RuleCombination,
} from "./hypothesis";
import { distanceToLoss, setOptionalLossActivation } from "./loss";
import { applyHookEffect } from "./phases";
import { ROLE_IMPL } from "../impl/roles";
import type {
  CharacterId,
  GameState,
  Hook,
  LoopEndReason,
  PlotId,
  RoleId,
  Target,
} from "../types";

export type DisclosureRisk = "critical" | "danger" | "caution" | "safe";

export interface DisclosureCandidateCounts {
  ruleCombinations: number;
  mainPlots: number;
}

export interface ConfirmedRoleDisclosure {
  character: CharacterId;
  role: RoleId;
}

export interface P5DisclosurePreview {
  risk: DisclosureRisk;
  before: DisclosureCandidateCounts;
  after: DisclosureCandidateCounts;
  newlyConfirmedRoles: ConfirmedRoleDisclosure[];
  newlyImpossibleRoleCells: number;
}

export interface P6DisclosurePreview extends P5DisclosurePreview {
  character: CharacterId;
  /** UI의 역할 후보 수는 기본 역할인 엑스트라를 제외한다. */
  roleCandidatesBefore: RoleId[];
  roleCandidatesAfter: RoleId[];
  goodwillIgnoreFamilyConfirmed: boolean;
}

export interface P9DisclosurePreview extends P5DisclosurePreview {
  explainableConditions: ExplainableLossCondition[];
  newlyFixedPlots: PlotId[];
}

function sameTarget(left: Target, right: Target): boolean {
  return left.kind === right.kind && (
    left.kind === "character"
      ? left.id === (right.kind === "character" ? right.id : undefined)
      : left.at === (right.kind === "location" ? right.at : undefined)
  );
}

function candidateCounts(
  remaining: readonly RuleCombination[],
): DisclosureCandidateCounts {
  return {
    ruleCombinations: remaining.length,
    mainPlots: new Set(remaining.map(({ mainPlot }) => mainPlot)).size,
  };
}

function comparison(
  beforeEvaluation: RoleTableHypothesisEvaluation,
  afterEvaluation: RoleTableHypothesisEvaluation,
): P5DisclosurePreview {
  const newlyConfirmedRoles = afterEvaluation.table.characters.flatMap(
    (character) => afterEvaluation.table.roles.flatMap((role) =>
      afterEvaluation.table.cells[character]?.[role]?.status === "confirmed" &&
        beforeEvaluation.table.cells[character]?.[role]?.status !== "confirmed"
        ? [{ character, role }]
        : []
    ),
  );
  const newlyImpossibleRoleCells = afterEvaluation.table.characters.reduce(
    (count, character) => count + afterEvaluation.table.roles.filter((role) =>
      afterEvaluation.table.cells[character]?.[role]?.status === "impossible" &&
      beforeEvaluation.table.cells[character]?.[role]?.status !== "impossible"
    ).length,
    0,
  );
  const before = candidateCounts(beforeEvaluation.remaining);
  const after = candidateCounts(afterEvaluation.remaining);
  const ruleYNewlyFixed = before.mainPlots > 1 && after.mainPlots === 1;
  const candidatesNarrowed =
    after.ruleCombinations < before.ruleCombinations ||
    newlyImpossibleRoleCells > 0;
  const risk: DisclosureRisk = newlyConfirmedRoles.length > 0
    ? "critical"
    : ruleYNewlyFixed
    ? "danger"
    : candidatesNarrowed
    ? "caution"
    : "safe";

  return {
    risk,
    before,
    after,
    newlyConfirmedRoles,
    newlyImpossibleRoleCells,
  };
}

function possibleRolesForCharacter(
  evaluation: RoleTableHypothesisEvaluation,
  character: CharacterId,
): RoleId[] {
  return evaluation.table.roles.filter((role) =>
    evaluation.table.cells[character]?.[role]?.status !== "impossible"
  );
}

function fixedPlots(remaining: readonly RuleCombination[]): Set<PlotId> {
  const first = remaining[0];
  if (first === undefined) return new Set();
  return new Set(
    [first.mainPlot, ...first.subPlots].filter((plot) =>
      remaining.every((combination) =>
        combination.mainPlot === plot || combination.subPlots.includes(plot)
      )
    ),
  );
}

function previewLossAfterAssumption(
  baselineState: GameState,
  assumedState: GameState,
  timing: LoopEndReason,
): P9DisclosurePreview {
  const beforeEvaluation = evaluateStateRoleTableHypotheses(baselineState);
  const assumedObservations = collectProtagonistObservations(assumedState);
  const assumedEvaluation = evaluateRoleTableHypotheses(
    assumedState.scenario.tragedySet,
    Object.keys(assumedState.scenario.cast),
    assumedObservations,
  );
  const lossObservation = hypotheticalLossObservation(assumedState, timing);
  const explainableConditions = explainableLossConditions(
    assumedState,
    lossObservation,
    assumedEvaluation.remaining,
    assumedObservations,
  );
  const afterEvaluation = evaluateRoleTableHypotheses(
    assumedState.scenario.tragedySet,
    Object.keys(assumedState.scenario.cast),
    [...assumedObservations, lossObservation],
  );
  const result = comparison(beforeEvaluation, afterEvaluation);
  const beforeFixed = fixedPlots(beforeEvaluation.remaining);
  const newlyFixedPlots = [...fixedPlots(afterEvaluation.remaining)].filter(
    (plot) => !beforeFixed.has(plot),
  );
  return {
    ...result,
    risk: result.risk === "critical"
      ? "critical"
      : newlyFixedPlots.length > 0
      ? "danger"
      : result.risk,
    explainableConditions,
    newlyFixedPlots,
  };
}

/**
 * 실제 P5 훅 경로를 복제 상태에만 적용해 공개 관측 전후 추론을 비교한다.
 * 호출자가 건넨 GameState는 훅의 when/effect에도 전달하지 않는다.
 */
export function previewP5Disclosure(
  state: GameState,
  hook: Hook,
  self: CharacterId,
  target?: Target,
): P5DisclosurePreview {
  if (hook.phase !== "P5_MASTERMIND_ABILITY") {
    throw new Error("P5 disclosure preview requires a P5 hook");
  }

  const baselineState = structuredClone(state);
  const assumedState = structuredClone(state);
  if (!hook.when(assumedState, self)) {
    throw new Error("P5 disclosure preview requires an available hook");
  }
  const targets = hook.selectableTargets?.(assumedState, self) ?? [];
  if (
    targets.length > 0 &&
    (target === undefined || !targets.some((candidate) =>
      sameTarget(candidate, target)
    ))
  ) {
    throw new Error("P5 disclosure preview requires a selectable target");
  }

  const beforeEvaluation = evaluateStateRoleTableHypotheses(baselineState);
  withDeathBatch(assumedState, () => {
    applyHookEffect(
      assumedState,
      "P5_MASTERMIND_ABILITY",
      hook,
      self,
      target,
      undefined,
      true,
    );
  });
  const afterEvaluation = evaluateStateRoleTableHypotheses(assumedState);

  return comparison(beforeEvaluation, afterEvaluation);
}

/** 우호 능력 거부를 실제 P6 해결 경로로 복제 상태에만 적용한다. */
export function previewP6GoodwillRefusal(
  state: GameState,
  declaration: GoodwillDeclaration,
): P6DisclosurePreview {
  const baselineState = structuredClone(state);
  const assumedState = structuredClone(state);
  const availability = goodwillResponseAvailability(
    assumedState,
    declaration.user,
    false,
  );
  if (!availability.refuseAllowed) {
    throw new Error("P6 disclosure preview requires an allowed refusal");
  }
  const beforeEvaluation = evaluateStateRoleTableHypotheses(baselineState);
  resolveGoodwillAbility(assumedState, declaration, "refuse");
  const afterEvaluation = evaluateStateRoleTableHypotheses(assumedState);
  const roleCandidatesBefore = possibleRolesForCharacter(
    beforeEvaluation,
    declaration.user,
  ).filter((role) => role !== "person");
  const roleCandidatesAfter = possibleRolesForCharacter(
    afterEvaluation,
    declaration.user,
  );
  const goodwillIgnoreFamilyConfirmed = roleCandidatesAfter.length > 0 &&
    roleCandidatesAfter.every((role) =>
      ROLE_IMPL[role]?.goodwillRefusal !== undefined
    );
  const result = comparison(beforeEvaluation, afterEvaluation);
  return {
    ...result,
    risk: result.risk === "critical"
      ? "critical"
      : goodwillIgnoreFamilyConfirmed
      ? "danger"
      : result.risk,
    character: declaration.user,
    roleCandidatesBefore,
    roleCandidatesAfter,
    goodwillIgnoreFamilyConfirmed,
  };
}

/** 현재 대기 중인 종료 경로 또는 마지막 날 자연 종료의 공개 관측을 예고한다. */
export function previewCurrentLossDisclosure(
  state: GameState,
): P9DisclosurePreview {
  const timing = state.pendingLoopEnd?.reason ??
    ((state.loop.pendingImmediateLossKeys?.length ?? 0) > 0
      ? "effect"
      : "lastDay");
  return previewLossAfterAssumption(
    structuredClone(state),
    structuredClone(state),
    timing,
  );
}

/** 선택 P9 훅 적용 뒤 즉시 루프 패배가 관측된다고 가정한다. */
export function previewP9HookDisclosure(
  state: GameState,
  hook: Hook,
  self: CharacterId,
  target?: Target,
): P9DisclosurePreview {
  if (hook.phase !== "P9_ROUND_END") {
    throw new Error("P9 disclosure preview requires a P9 hook");
  }
  const baselineState = structuredClone(state);
  const assumedState = structuredClone(state);
  if (!hook.when(assumedState, self)) {
    throw new Error("P9 disclosure preview requires an available hook");
  }
  const targets = hook.selectableTargets?.(assumedState, self) ?? [];
  if (
    targets.length > 0 &&
    (target === undefined || !targets.some((candidate) =>
      sameTarget(candidate, target)
    ))
  ) {
    throw new Error("P9 disclosure preview requires a selectable target");
  }
  withDeathBatch(assumedState, () => {
    applyHookEffect(
      assumedState,
      "P9_ROUND_END",
      hook,
      self,
      target,
      undefined,
      true,
    );
  });
  return previewLossAfterAssumption(baselineState, assumedState, "effect");
}

/** 선택 패배 조건 발동 뒤 공개될 주인공 사망/루프 종료를 가정한다. */
export function previewP9OptionalLossDisclosure(
  state: GameState,
  key: string,
): P9DisclosurePreview {
  const baselineState = structuredClone(state);
  const assumedState = structuredClone(state);
  const condition = distanceToLoss(assumedState).find((item) => item.key === key);
  if (condition === undefined || condition.activation !== "optional") {
    throw new Error("P9 disclosure preview requires an optional loss condition");
  }
  setOptionalLossActivation(assumedState, key, true);
  return previewLossAfterAssumption(
    baselineState,
    assumedState,
    condition.category === "protagonistDeath" ? "protagonistDeath" : "effect",
  );
}
