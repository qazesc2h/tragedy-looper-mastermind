import { withDeathBatch } from "./death";
import {
  evaluateStateRoleTableHypotheses,
  type RuleCombination,
} from "./hypothesis";
import { applyHookEffect } from "./phases";
import type {
  CharacterId,
  GameState,
  Hook,
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
