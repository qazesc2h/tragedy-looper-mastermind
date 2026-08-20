import { createHash } from "node:crypto";
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
import { canonicalStringify, engineStateKey } from "./canonical-state";
import {
  applyJointAction,
  closedSuccessorKey,
  decisionContext,
  mastermindActions,
  protagonistResponses,
  sha256,
} from "./measure-action-equivalence";

const FIXED_P2_HASH =
  "0005930f56af6d5a1ca841fc466b581bc8af8827a07eab7debb3f2863b3918de";

interface LossAxisWorst {
  key: string;
  ko: string;
  worstRemaining: number;
  bestRemaining: number;
  outcomes: number;
}

function elapsedMilliseconds(started: bigint): number {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function digestStrings(values: Iterable<string>): string {
  const hash = createHash("sha256");
  for (const value of [...values].sort()) hash.update(`${value}\n`);
  return hash.digest("hex");
}

function fixedP2Candidate(
  profiles: readonly PlacedCard[][],
): { placements: PlacedCard[]; hash: string } {
  for (const placements of profiles) {
    const hash = sha256(canonicalStringify(placements));
    if (hash === FIXED_P2_HASH) return { placements, hash };
  }
  throw new Error(`fixed P2 candidate ${FIXED_P2_HASH} is unavailable`);
}

function main(): void {
  const [outputDirectory] = process.argv.slice(2);
  if (outputDirectory === undefined) {
    throw new Error("usage: vite-node measure-one-ply-search.ts OUTPUT_DIR");
  }
  mkdirSync(outputDirectory, { recursive: true });

  const entry = loadScenarioCatalog().find(({ id }) => id === "firstSteps:2");
  if (entry === undefined) throw new Error("missing firstSteps:2");
  const state = createGameState(structuredClone(entry.scenario));
  chooseInitialLeader(state, 0);
  continueFromTimeGap(state);
  const context = decisionContext(state);

  // 후보를 찾는 비용은 실제 UI에서 사용자가 이미 고른 P2를 받는 경로가 아니므로
  // 측정에서 제외한다.
  const candidate = fixedP2Candidate(mastermindActions(context));

  const totalStarted = process.hrtime.bigint();
  const classBuildStarted = process.hrtime.bigint();
  const representatives = new Map<bigint, PlacedCard[]>();
  let rawResponses = 0;
  for (const response of protagonistResponses(context)) {
    const successor = closedSuccessorKey(
      context,
      candidate.placements,
      response,
    );
    if (!representatives.has(successor)) {
      representatives.set(successor, structuredClone(response));
    }
    rawResponses += 1;
  }
  const classBuildMilliseconds = elapsedMilliseconds(classBuildStarted);

  const transitionStarted = process.hrtime.bigint();
  let transitionNanoseconds = 0n;
  let evaluationNanoseconds = 0n;
  const actualStateKeys = new Set<string>();
  const lossAxes = new Map<string, LossAxisWorst>();
  for (const response of representatives.values()) {
    const oneTransitionStarted = process.hrtime.bigint();
    const successor = applyJointAction(
      state,
      candidate.placements,
      response,
      true,
    );
    transitionNanoseconds += process.hrtime.bigint() - oneTransitionStarted;
    actualStateKeys.add(engineStateKey(successor));

    const oneEvaluationStarted = process.hrtime.bigint();
    for (const condition of distanceToLoss(successor)) {
      const current = lossAxes.get(condition.key);
      if (current === undefined) {
        lossAxes.set(condition.key, {
          key: condition.key,
          ko: condition.ko,
          worstRemaining: condition.remaining,
          bestRemaining: condition.remaining,
          outcomes: 1,
        });
      } else {
        current.worstRemaining = Math.max(
          current.worstRemaining,
          condition.remaining,
        );
        current.bestRemaining = Math.min(
          current.bestRemaining,
          condition.remaining,
        );
        current.outcomes += 1;
      }
    }
    evaluationNanoseconds += process.hrtime.bigint() - oneEvaluationStarted;
  }
  const expandAndEvaluateMilliseconds = elapsedMilliseconds(transitionStarted);
  const totalMilliseconds = elapsedMilliseconds(totalStarted);
  if (actualStateKeys.size !== representatives.size) {
    throw new Error(
      `P4 projection classes ${representatives.size} != actual engine states ${actualStateKeys.size}`,
    );
  }

  const sortedLossAxes = [...lossAxes.values()].sort((left, right) =>
    left.key.localeCompare(right.key)
  );
  const deterministic = {
    schema: "phase5-one-ply-search-v1",
    scenario: "firstSteps:2",
    state: "loop 1 day 1 initial P2 decision, leader 0",
    candidateSelection: {
      rule: "fixed canonical P2 placement SHA-256",
      hash: candidate.hash,
      placements: candidate.placements,
    },
    equivalence: "owner-specific exact P4 physical/resource projection",
    rawResponses,
    p4ClosedResponseClasses: representatives.size,
    actualEngineSuccessorStates: actualStateKeys.size,
    actualStateDigest: digestStrings(actualStateKeys),
    evaluation: {
      lossDistance: {
        rule:
          "for each loss-condition axis, protagonist worst case maximizes remaining; axes are not summed",
        axes: sortedLossAxes,
      },
      disclosure: {
        measured: false,
        reason:
          "physical P4 equivalence omits revealed action/public trace and is not sufficient for exact disclosure comparison",
      },
    },
  };
  const deterministicHash = sha256(canonicalStringify(deterministic));
  const performance = {
    classBuildMilliseconds,
    expandAndEvaluateMilliseconds,
    transitionMilliseconds: Number(transitionNanoseconds) / 1_000_000,
    lossEvaluationMilliseconds: Number(evaluationNanoseconds) / 1_000_000,
    totalMilliseconds,
    projectedTenCandidatesMilliseconds: totalMilliseconds * 10,
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
      candidateHash: candidate.hash,
      rawResponses,
      p4ClosedResponseClasses: representatives.size,
      actualEngineSuccessorStates: actualStateKeys.size,
      actualStateDigest: deterministic.actualStateDigest,
      lossAxes: sortedLossAxes,
      performance,
    }, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main();
