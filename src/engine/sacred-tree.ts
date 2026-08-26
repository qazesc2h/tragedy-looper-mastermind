import { ROLE_IMPL } from "../impl/roles";
import {
  characterLocation,
  effectiveRole,
  isCharacterAlive,
  type CharacterId,
  type GameState,
  type SacredTreeCounter,
  type SacredTreeTransferCondition,
} from "../types";
import { recordPhaseLog } from "./phase-log";
import {
  publicBoardChanges,
  publicObservationContext,
} from "./public-observation";

export const SACRED_TREE_TRAIT_SOURCE =
  "Each turn, the Leader may move 1 counter on this character to another " +
  "character at this location. If this character has :goodwill: Refusel, " +
  "the Mastermind must also do this during the Mastermind's ability step.";

export const SACRED_TREE_COUNTERS: readonly SacredTreeCounter[] = [
  "goodwill",
  "paranoia",
  "intrigue",
  "protection",
];

export interface SacredTreeTransferSelection {
  counter: SacredTreeCounter;
  target: CharacterId;
}

function sacredTreeInScenario(state: GameState): boolean {
  return Object.hasOwn(state.scenario.cast, "sacredTree");
}

/** 발동 판정 직전 공개 상태에서 옮길 카운터와 동소 생존 대상을 계산한다. */
export function sacredTreeTransferCondition(
  state: GameState,
): SacredTreeTransferCondition {
  const position = state.loop.board.sacredTree;
  const counters = state.loop.charCounters.sacredTree;
  if (position === undefined || counters === undefined) {
    return {
      sacredTreeStatus: "missing",
      transferableCounters: [],
      eligibleTargets: [],
    };
  }
  if (!isCharacterAlive(position)) {
    return {
      sacredTreeStatus: position.status,
      transferableCounters: [],
      eligibleTargets: [],
    };
  }

  const location = characterLocation(position, "sacredTree");
  return {
    sacredTreeStatus: "alive",
    transferableCounters: SACRED_TREE_COUNTERS.filter(
      (counter) => counters[counter] > 0,
    ),
    eligibleTargets: Object.entries(state.loop.board).flatMap(
      ([character, targetPosition]) =>
        character !== "sacredTree" &&
          isCharacterAlive(targetPosition) &&
          characterLocation(targetPosition, character) === location
          ? [character]
          : [],
    ),
  };
}

export function sacredTreeTransferEligible(
  condition: SacredTreeTransferCondition,
): boolean {
  return condition.sacredTreeStatus === "alive" &&
    condition.transferableCounters.length > 0 &&
    condition.eligibleTargets.length > 0;
}

/** 공개된 신수에게 현재 유효한 우호 무시·절대 우호 무시 역할이 있는가. */
export function sacredTreeHasGoodwillRefusal(state: GameState): boolean {
  return sacredTreeInScenario(state) &&
    ROLE_IMPL[effectiveRole(state, "sacredTree")]?.goodwillRefusal !== undefined;
}

function resolvedThisRound(
  state: GameState,
  at: { loop: number; day: number } | undefined,
): boolean {
  return at?.loop === state.loop.loop && at.day === state.loop.day;
}

export function sacredTreeLeaderStepResolved(state: GameState): boolean {
  return resolvedThisRound(state, state.loop.sacredTreeLeaderResolvedAt);
}

export function sacredTreeMastermindStepResolved(state: GameState): boolean {
  return resolvedThisRound(state, state.loop.sacredTreeMastermindResolvedAt);
}

export function sacredTreeLeaderChoiceRequired(state: GameState): boolean {
  return state.gamePhase === "ROUND" &&
    state.loop.phase === "P4_RESOLVE" &&
    state.loop.actionResolutionComplete &&
    sacredTreeInScenario(state) &&
    sacredTreeTransferEligible(sacredTreeTransferCondition(state)) &&
    !sacredTreeLeaderStepResolved(state);
}

export function sacredTreeMastermindChoiceRequired(state: GameState): boolean {
  return state.gamePhase === "ROUND" &&
    state.loop.phase === "P5_MASTERMIND_ABILITY" &&
    sacredTreeHasGoodwillRefusal(state) &&
    sacredTreeTransferEligible(sacredTreeTransferCondition(state)) &&
    !sacredTreeMastermindStepResolved(state);
}

function applyTransfer(
  state: GameState,
  condition: SacredTreeTransferCondition,
  selection: SacredTreeTransferSelection,
): void {
  if (!condition.transferableCounters.includes(selection.counter)) {
    throw new Error(`invalid sacred-tree counter "${selection.counter}"`);
  }
  if (!condition.eligibleTargets.includes(selection.target)) {
    throw new Error(`invalid sacred-tree target "${selection.target}"`);
  }
  const source = state.loop.charCounters.sacredTree;
  const target = state.loop.charCounters[selection.target];
  if (source === undefined || target === undefined) {
    throw new Error("sacred-tree transfer counters are missing");
  }
  source[selection.counter] -= 1;
  target[selection.counter] += 1;
}

function recordMastermindTransfer(
  state: GameState,
  condition: SacredTreeTransferCondition,
  before: GameState["loop"],
  selection?: SacredTreeTransferSelection,
): void {
  recordPhaseLog(state, {
    loop: state.loop.loop,
    day: state.loop.day,
    phase: "P5_MASTERMIND_ABILITY",
    kind: "sacredTreeTransferJudged",
    actor: "mastermind",
    eligible: sacredTreeTransferEligible(condition),
    performed: selection !== undefined,
    condition: structuredClone(condition),
    ...(selection === undefined
      ? {}
      : {
        counter: selection.counter,
        target: selection.target,
        publicChanges: publicBoardChanges(before, state.loop),
      }),
    publicContext: publicObservationContext(before),
  });
}

/** P4 행동 해결 뒤 리더의 선택(이전 또는 하지 않음)을 확정한다. */
export function resolveSacredTreeLeaderTransfer(
  state: GameState,
  selection?: SacredTreeTransferSelection,
): void {
  if (
    state.gamePhase !== "ROUND" ||
    state.loop.phase !== "P4_RESOLVE" ||
    !state.loop.actionResolutionComplete
  ) {
    throw new Error("sacred-tree Leader choice is only available after P4 resolve");
  }
  if (!sacredTreeInScenario(state)) {
    throw new Error("sacred-tree is not in this scenario");
  }
  if (sacredTreeLeaderStepResolved(state)) {
    throw new Error("sacred-tree Leader choice was already resolved this turn");
  }
  const condition = sacredTreeTransferCondition(state);
  if (!sacredTreeTransferEligible(condition)) {
    throw new Error("sacred-tree Leader transfer is not eligible");
  }
  if (selection !== undefined) applyTransfer(state, condition, selection);
  state.loop.sacredTreeLeaderResolvedAt = {
    loop: state.loop.loop,
    day: state.loop.day,
  };
}

/** P5에 표시된 신수의 강제 이전 대상을 확정하고 즉시 공개 결과를 적용한다. */
export function resolveSacredTreeMastermindTransfer(
  state: GameState,
  selection: SacredTreeTransferSelection,
): void {
  if (
    state.gamePhase !== "ROUND" ||
    state.loop.phase !== "P5_MASTERMIND_ABILITY"
  ) {
    throw new Error("sacred-tree Mastermind transfer is only available at P5");
  }
  if (!sacredTreeHasGoodwillRefusal(state)) {
    throw new Error("sacred-tree has no Goodwill Refusal ability");
  }
  if (sacredTreeMastermindStepResolved(state)) {
    throw new Error("sacred-tree Mastermind transfer was already resolved this turn");
  }
  const condition = sacredTreeTransferCondition(state);
  if (!sacredTreeTransferEligible(condition)) {
    throw new Error("sacred-tree Mastermind transfer is not eligible");
  }
  const before = structuredClone(state.loop);
  applyTransfer(state, condition, selection);
  state.loop.sacredTreeMastermindResolvedAt = {
    loop: state.loop.loop,
    day: state.loop.day,
  };
  recordMastermindTransfer(state, condition, before, selection);
}

/** P5 종료 직전에 강제 선택을 검사하고 미발동도 조건 스냅샷과 함께 기록한다. */
export function finalizeSacredTreeMastermindStep(state: GameState): void {
  if (!sacredTreeInScenario(state) || sacredTreeMastermindStepResolved(state)) {
    return;
  }
  const condition = sacredTreeTransferCondition(state);
  if (
    sacredTreeHasGoodwillRefusal(state) &&
    sacredTreeTransferEligible(condition)
  ) {
    throw new Error("sacred-tree Mastermind transfer is mandatory");
  }
  const before = structuredClone(state.loop);
  state.loop.sacredTreeMastermindResolvedAt = {
    loop: state.loop.loop,
    day: state.loop.day,
  };
  recordMastermindTransfer(state, condition, before);
}
