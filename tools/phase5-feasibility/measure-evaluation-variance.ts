import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
} from "../../src/engine/game";
import { distanceToLoss } from "../../src/engine/loss";
import { loadScenarioCatalog } from "../../src/scenario-catalog";
import type { GameState, PlacedCard } from "../../src/types";
import { canonicalStringify, engineStateKey } from "./canonical-state";
import {
  advancePassPathToNextDay,
  applyJointAction,
  closedSuccessorKey,
  decisionContext,
  deterministicResponse,
  mastermindActions,
  protagonistResponses,
  sha256,
} from "./measure-action-equivalence";

const SAMPLE_SIZE = 100;

interface AxisRange {
  key: string;
  ko: string;
  distinctValues: number[];
  minimum: number;
  maximum: number;
  width: number;
}

interface CandidateMeasurement {
  sampleIndex: number;
  profileIndex: number;
  candidateHash: string;
  p4ClosedResponseClasses: number;
  distinctEvaluationVectors: number;
  responseChangesEvaluation: boolean;
  axisRanges: AxisRange[];
}

interface RepresentativePathStep {
  fromDay: number;
  mastermindActionHash: string;
  protagonistResponseHash: string;
  nextStateHash: string;
  survivingCandidates: number;
  nextDistanceVector: Array<{ key: string; remaining: number }>;
}

function elapsedMilliseconds(started: bigint): number {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function summary(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    minimum: sorted[0] ?? 0,
    median: sorted[Math.floor((sorted.length - 1) / 2)] ?? 0,
    maximum: sorted.at(-1) ?? 0,
    mean: sorted.length === 0
      ? 0
      : sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

function stratifiedCandidates(
  profiles: readonly PlacedCard[][],
): Array<{ profileIndex: number; hash: string; placements: PlacedCard[] }> {
  const sorted = profiles.map((placements) => ({
    hash: sha256(canonicalStringify(placements)),
    placements,
  })).sort((left, right) => left.hash.localeCompare(right.hash));
  if (sorted.length < SAMPLE_SIZE) {
    throw new Error(`only ${sorted.length} P2 profiles for sample ${SAMPLE_SIZE}`);
  }
  return Array.from({ length: SAMPLE_SIZE }, (_, sampleIndex) => {
    const profileIndex = Math.floor(
      sampleIndex * (sorted.length - 1) / (SAMPLE_SIZE - 1),
    );
    const candidate = sorted[profileIndex];
    if (candidate === undefined) throw new Error("missing stratified candidate");
    return { profileIndex, ...candidate };
  });
}

function evaluationVector(state: GameState) {
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

function measureCandidate(
  state: GameState,
  candidate: ReturnType<typeof stratifiedCandidates>[number],
  sampleIndex: number,
): CandidateMeasurement {
  const context = decisionContext(state);
  const representatives = new Map<bigint, PlacedCard[]>();
  for (const response of protagonistResponses(context)) {
    const successor = closedSuccessorKey(
      context,
      candidate.placements,
      response,
    );
    if (!representatives.has(successor)) {
      representatives.set(successor, structuredClone(response));
    }
  }

  const evaluationVectors = new Set<string>();
  const axisValues = new Map<string, { ko: string; values: Set<number> }>();
  for (const response of representatives.values()) {
    const successor = applyJointAction(
      state,
      candidate.placements,
      response,
      true,
    );
    const vector = evaluationVector(successor);
    evaluationVectors.add(canonicalStringify(vector.map(({ key, remaining }) =>
      [key, remaining]
    )));
    for (const { key, ko, remaining } of vector) {
      const axis = axisValues.get(key);
      if (axis === undefined) {
        axisValues.set(key, { ko, values: new Set([remaining]) });
      } else {
        axis.values.add(remaining);
      }
    }
  }

  const axisRanges = [...axisValues].map(([key, { ko, values }]) => {
    const distinctValues = [...values].sort((left, right) => left - right);
    const minimum = distinctValues[0] ?? 0;
    const maximum = distinctValues.at(-1) ?? 0;
    return {
      key,
      ko,
      distinctValues,
      minimum,
      maximum,
      width: maximum - minimum,
    };
  }).sort((left, right) => left.key.localeCompare(right.key));
  return {
    sampleIndex,
    profileIndex: candidate.profileIndex,
    candidateHash: candidate.hash,
    p4ClosedResponseClasses: representatives.size,
    distinctEvaluationVectors: evaluationVectors.size,
    responseChangesEvaluation: evaluationVectors.size > 1,
    axisRanges,
  };
}

function representativeStateForDay(
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

function representativeStateSummary(
  state: GameState,
  path: readonly RepresentativePathStep[],
) {
  return {
    loop: state.loop.loop,
    day: state.loop.day,
    phase: state.loop.phase,
    leader: state.loop.leader,
    stateHash: sha256(engineStateKey(state)),
    characters: Object.keys(state.loop.board).sort().map((character) => ({
      character,
      board: state.loop.board[character],
      counters: state.loop.charCounters[character],
    })),
    locationIntrigue: state.loop.locIntrigue,
    spentOncePerLoop: state.loop.spentOncePerLoop,
    path,
  };
}

function main(): void {
  const [outputDirectory, dayArgument, mode] = process.argv.slice(2);
  if (outputDirectory === undefined) {
    throw new Error(
      "usage: vite-node measure-evaluation-variance.ts OUTPUT_DIR [DAY] [--representative-only]",
    );
  }
  const targetDay = dayArgument === undefined ? 1 : Number(dayArgument);
  if (!Number.isInteger(targetDay) || targetDay < 1 || targetDay > 3) {
    throw new Error(`DAY must be 1, 2, or 3; received ${dayArgument}`);
  }
  mkdirSync(outputDirectory, { recursive: true });
  const entry = loadScenarioCatalog().find(({ id }) => id === "firstSteps:2");
  if (entry === undefined) throw new Error("missing firstSteps:2");
  const initial = createGameState(structuredClone(entry.scenario));
  chooseInitialLeader(initial, 0);
  continueFromTimeGap(initial);
  const representative = representativeStateForDay(initial, targetDay);
  const state = representative.state;
  if (mode === "--representative-only") {
    process.stdout.write(`${JSON.stringify(
      representativeStateSummary(state, representative.path),
      null,
      2,
    )}\n`);
    return;
  }
  if (mode !== undefined) throw new Error(`unknown mode: ${mode}`);
  const population = mastermindActions(decisionContext(state));
  const candidates = stratifiedCandidates(population);

  const started = process.hrtime.bigint();
  const measurements: CandidateMeasurement[] = [];
  for (const [sampleIndex, candidate] of candidates.entries()) {
    const candidateStarted = process.hrtime.bigint();
    measurements.push(measureCandidate(state, candidate, sampleIndex));
    if ((sampleIndex + 1) % 10 === 0) {
      process.stderr.write(
        `measured ${sampleIndex + 1}/${SAMPLE_SIZE} candidates in ${
          elapsedMilliseconds(started).toFixed(0)
        }ms; last=${elapsedMilliseconds(candidateStarted).toFixed(0)}ms\n`,
      );
    }
  }

  const varying = measurements.filter(({ responseChangesEvaluation }) =>
    responseChangesEvaluation
  );
  const axisKeys = [...new Set(measurements.flatMap(({ axisRanges }) =>
    axisRanges.map(({ key }) => key)
  ))].sort();
  const axes = axisKeys.map((key) => {
    const rows = measurements.flatMap(({ axisRanges }) =>
      axisRanges.filter((axis) => axis.key === key)
    );
    const varyingRows = rows.filter(({ width }) => width > 0);
    return {
      key,
      ko: rows[0]?.ko ?? key,
      candidatesMeasured: rows.length,
      candidatesVarying: varyingRows.length,
      varyingPercent: rows.length === 0 ? 0 : varyingRows.length / rows.length,
      widthAmongVarying: summary(varyingRows.map(({ width }) => width)),
      distinctValues: [...new Set(rows.flatMap(({ distinctValues }) =>
        distinctValues
      ))].sort((left, right) => left - right),
    };
  });
  const deterministic = {
    schema: "phase5-evaluation-variance-v1",
    scenario: "firstSteps:2",
    state: `loop ${state.loop.loop} day ${state.loop.day} P2 decision, leader ${state.loop.leader}`,
    ...(targetDay === 1 ? {} : {
      representativeState: {
        rule:
          "from each previous day, enumerate the same 100 inclusive SHA-256 P2 quantiles with SHA-derived legal P3 responses; among pass-optional survivors choose the lexicographically smallest sorted distanceToLoss remaining vector, then the smallest engine-state SHA-256",
        stateHash: sha256(engineStateKey(state)),
        path: representative.path,
      },
    }),
    candidateSelection: {
      population: population.length,
      sampleSize: SAMPLE_SIZE,
      rule:
        "sort all canonical P2 placement SHA-256 values, then select inclusive equal-index quantiles",
    },
    equivalence: "owner-specific exact P4 physical/resource projection",
    evaluation:
      "sorted distanceToLoss condition-key to remaining-value vector; no weighted sum",
    candidatesInvariant: measurements.length - varying.length,
    candidatesInvariantPercent:
      (measurements.length - varying.length) / measurements.length,
    candidatesVarying: varying.length,
    candidatesVaryingPercent: varying.length / measurements.length,
    p4ClosedResponseClasses: summary(measurements.map((measurement) =>
      measurement.p4ClosedResponseClasses
    )),
    distinctEvaluationVectors: summary(measurements.map((measurement) =>
      measurement.distinctEvaluationVectors
    )),
    distinctEvaluationVectorsAmongVarying: summary(varying.map((measurement) =>
      measurement.distinctEvaluationVectors
    )),
    axes,
    measurements,
  };
  const deterministicHash = sha256(canonicalStringify(deterministic));
  const performance = {
    milliseconds: elapsedMilliseconds(started),
    averageMillisecondsPerCandidate:
      elapsedMilliseconds(started) / measurements.length,
    rssBytes: process.memoryUsage().rss,
  };
  const manifest = { deterministic, deterministicHash, performance };
  writeFileSync(
    join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(
    join(outputDirectory, "summary.json"),
    `${JSON.stringify({
      deterministicHash,
      candidatesInvariant: deterministic.candidatesInvariant,
      candidatesInvariantPercent: deterministic.candidatesInvariantPercent,
      candidatesVarying: deterministic.candidatesVarying,
      candidatesVaryingPercent: deterministic.candidatesVaryingPercent,
      p4ClosedResponseClasses: deterministic.p4ClosedResponseClasses,
      distinctEvaluationVectors: deterministic.distinctEvaluationVectors,
      distinctEvaluationVectorsAmongVarying:
        deterministic.distinctEvaluationVectorsAmongVarying,
      axes,
      performance,
    }, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main();
