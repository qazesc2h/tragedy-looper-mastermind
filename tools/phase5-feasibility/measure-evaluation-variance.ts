import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
} from "../../src/engine/game";
import { distanceToLoss } from "../../src/engine/loss";
import { loadScenarioCatalog } from "../../src/scenario-catalog";
import type { PlacedCard } from "../../src/types";
import { canonicalStringify } from "./canonical-state";
import {
  applyJointAction,
  closedSuccessorKey,
  decisionContext,
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

function measureCandidate(
  state: Parameters<typeof decisionContext>[0],
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
    const vector = distanceToLoss(successor).map((condition) => ({
      key: condition.key,
      ko: condition.ko,
      remaining: condition.remaining,
    })).sort((left, right) => left.key.localeCompare(right.key));
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

function main(): void {
  const [outputDirectory] = process.argv.slice(2);
  if (outputDirectory === undefined) {
    throw new Error("usage: vite-node measure-evaluation-variance.ts OUTPUT_DIR");
  }
  mkdirSync(outputDirectory, { recursive: true });
  const entry = loadScenarioCatalog().find(({ id }) => id === "firstSteps:2");
  if (entry === undefined) throw new Error("missing firstSteps:2");
  const state = createGameState(structuredClone(entry.scenario));
  chooseInitialLeader(state, 0);
  continueFromTimeGap(state);
  const candidates = stratifiedCandidates(
    mastermindActions(decisionContext(state)),
  );

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
    state: "loop 1 day 1 initial P2 decision, leader 0",
    candidateSelection: {
      population: 63_360,
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
