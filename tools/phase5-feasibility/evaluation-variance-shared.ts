import { distanceToLoss } from "../../src/engine/loss";
import type { GameState, PlacedCard } from "../../src/types";
import { canonicalStringify, engineStateKey } from "./canonical-state";
import {
  advancePassPathToNextDay,
  applyJointAction,
  decisionContext,
  deterministicResponse,
  mastermindActions,
  sha256,
} from "./measure-action-equivalence";

export const EVALUATION_VARIANCE_SAMPLE_SIZE = 100;

export interface RepresentativePathStep {
  fromDay: number;
  mastermindActionHash: string;
  protagonistResponseHash: string;
  nextStateHash: string;
  survivingCandidates: number;
  nextDistanceVector: Array<{ key: string; remaining: number }>;
}

export function stratifiedCandidates(
  profiles: readonly PlacedCard[][],
): Array<{ profileIndex: number; hash: string; placements: PlacedCard[] }> {
  const sorted = profiles.map((placements) => ({
    hash: sha256(canonicalStringify(placements)),
    placements,
  })).sort((left, right) => left.hash.localeCompare(right.hash));
  if (sorted.length < EVALUATION_VARIANCE_SAMPLE_SIZE) {
    throw new Error(
      `only ${sorted.length} P2 profiles for sample ${EVALUATION_VARIANCE_SAMPLE_SIZE}`,
    );
  }
  return Array.from(
    { length: EVALUATION_VARIANCE_SAMPLE_SIZE },
    (_, sampleIndex) => {
      const profileIndex = Math.floor(
        sampleIndex * (sorted.length - 1) /
          (EVALUATION_VARIANCE_SAMPLE_SIZE - 1),
      );
      const candidate = sorted[profileIndex];
      if (candidate === undefined) throw new Error("missing stratified candidate");
      return { profileIndex, ...candidate };
    },
  );
}

export function evaluationVector(state: GameState) {
  return distanceToLoss(state).map((condition) => ({
    key: condition.key,
    ko: condition.ko,
    remaining: condition.remaining,
  })).sort((left, right) => left.key.localeCompare(right.key));
}

function compareEvaluationVectors(
  left: ReturnType<typeof evaluationVector>,
  right: ReturnType<typeof evaluationVector>,
): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftAxis = left[index];
    const rightAxis = right[index];
    if (leftAxis === undefined) return -1;
    if (rightAxis === undefined) return 1;
    const keyOrder = leftAxis.key.localeCompare(rightAxis.key);
    if (keyOrder !== 0) return keyOrder;
    if (leftAxis.remaining !== rightAxis.remaining) {
      return leftAxis.remaining - rightAxis.remaining;
    }
  }
  return 0;
}

export function representativeStateForDay(
  initial: GameState,
  targetDay: number,
): { state: GameState; path: RepresentativePathStep[] } {
  let state = structuredClone(initial);
  const path: RepresentativePathStep[] = [];
  while (state.loop.day < targetDay) {
    const context = decisionContext(state);
    const candidates = stratifiedCandidates(mastermindActions(context));
    let selected:
      | {
        state: GameState;
        candidateHash: string;
        responseHash: string;
        stateHash: string;
        vector: ReturnType<typeof evaluationVector>;
      }
      | undefined;
    let survivingCandidates = 0;
    for (const candidate of candidates) {
      const response = deterministicResponse(context, candidate.hash);
      const afterP4 = applyJointAction(
        state,
        candidate.placements,
        response,
        false,
      );
      const nextDay = advancePassPathToNextDay(afterP4);
      if (nextDay === undefined) continue;
      survivingCandidates += 1;
      const next = {
        state: nextDay,
        candidateHash: candidate.hash,
        responseHash: sha256(canonicalStringify(response)),
        stateHash: sha256(engineStateKey(nextDay)),
        vector: evaluationVector(nextDay),
      };
      if (
        selected === undefined ||
        compareEvaluationVectors(next.vector, selected.vector) < 0 ||
        (compareEvaluationVectors(next.vector, selected.vector) === 0 &&
          next.stateHash.localeCompare(selected.stateHash) < 0)
      ) selected = next;
    }
    if (selected === undefined) {
      throw new Error(`no deterministic surviving path from day ${state.loop.day}`);
    }
    path.push({
      fromDay: state.loop.day,
      mastermindActionHash: selected.candidateHash,
      protagonistResponseHash: selected.responseHash,
      nextStateHash: selected.stateHash,
      survivingCandidates,
      nextDistanceVector: selected.vector.map(({ key, remaining }) => ({
        key,
        remaining,
      })),
    });
    state = selected.state;
  }
  if (
    state.loop.day !== targetDay ||
    state.loop.phase !== "P2_MASTERMIND_ACTION"
  ) {
    throw new Error(`failed to reach day ${targetDay} P2 decision`);
  }
  return { state, path };
}
