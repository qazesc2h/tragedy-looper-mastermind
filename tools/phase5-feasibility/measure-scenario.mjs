import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
} from "../../src/engine/game.ts";
import { loadScenarioCatalog } from "../../src/scenario-catalog.ts";
import {
  canonicalDecisionStateKey,
  canonicalStringify,
  CANONICAL_DECISION_STATE_VERSION,
  ENGINE_TRANSITION_VERSION,
} from "./canonical-state.ts";
import {
  enumerateP2Transitions,
  enumerateP3Transitions,
  headlessNode,
} from "./headless-transitions.ts";

const PILOT_LIMITS = {
  wallTimeMs: 30 * 60 * 1000,
  rssBytes: 4 * 1024 ** 3,
  diskBytes: 10 * 1024 ** 3,
  uniqueStates: 5_000_000,
  transitions: 50_000_000,
  p2p3LowerBound: 100_000_000,
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function digestHashes(hashes) {
  return sha256([...hashes].sort().join("\n"));
}

function directoryBytes(path) {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? directoryBytes(child) : statSync(child).size;
  }
  return total;
}

function elapsedSeconds(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
}

function rate(count, seconds) {
  return seconds === 0 ? 0 : count / seconds;
}

function terminalReason(state) {
  if (state.result !== undefined) {
    return `${state.result.winner}:${state.result.reason}`;
  }
  if (state.gamePhase !== "ROUND") return state.gamePhase;
  if (state.pendingLoopEnd !== undefined) {
    return `pending:${state.pendingLoopEnd.reason}`;
  }
  return undefined;
}

function addTerminal(terminals, state) {
  const reason = terminalReason(state);
  if (reason === undefined) return;
  terminals[reason] = (terminals[reason] ?? 0) + 1;
}

function requireWithinLimits(context, totals, startedAt, outputDirectory) {
  const elapsedMs = elapsedSeconds(startedAt) * 1000;
  const rssBytes = process.memoryUsage().rss;
  const diskBytes = directoryBytes(outputDirectory);
  if (elapsedMs >= PILOT_LIMITS.wallTimeMs) {
    throw new Error(`${context}: wall-time-cap`);
  }
  if (rssBytes >= PILOT_LIMITS.rssBytes) {
    throw new Error(`${context}: rss-cap`);
  }
  if (diskBytes >= PILOT_LIMITS.diskBytes) {
    throw new Error(`${context}: disk-cap`);
  }
  if (totals.uniqueStates >= PILOT_LIMITS.uniqueStates) {
    throw new Error(`${context}: unique-state-cap`);
  }
  if (totals.transitions >= PILOT_LIMITS.transitions) {
    throw new Error(`${context}: transition-cap`);
  }
  return { rssBytes, diskBytes };
}

function scenarioEntry(id) {
  const entry = loadScenarioCatalog().find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`missing scenario ${id}`);
  return entry;
}

function initialRoots(entry) {
  return [0, 1, 2].map((leader) => {
    const state = createGameState(structuredClone(entry.scenario));
    chooseInitialLeader(state, leader);
    continueFromTimeGap(state);
    if (state.gamePhase !== "ROUND" || state.loop.phase !== "P2_MASTERMIND_ACTION") {
      throw new Error(`unexpected root ${state.gamePhase}/${state.loop.phase}`);
    }
    return headlessNode(state);
  });
}

function measureFirstStepsPilot(scenarioId, outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const runStartedAt = process.hrtime.bigint();
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const entry = scenarioEntry(scenarioId);
  const roots = initialRoots(entry);
  const peak = { rssBytes: process.memoryUsage().rss, diskBytes: 0 };
  const totals = { uniqueStates: 0, transitions: 0 };
  const sampleStateByLeader = new Map();

  const rootHashes = new Set(roots.map((node) =>
    sha256(canonicalDecisionStateKey(node.state, node.publicTrace))
  ));
  totals.uniqueStates += rootHashes.size;

  const p2StartedAt = process.hrtime.bigint();
  const p2Hashes = new Set();
  const p2Terminals = {};
  let p2Generated = 0;
  for (const root of roots) {
    const leader = root.state.loop.leader;
    for (const transition of enumerateP2Transitions(root)) {
      p2Generated += 1;
      totals.transitions += 1;
      const stateHash = sha256(canonicalDecisionStateKey(
        transition.node.state,
        transition.node.publicTrace,
      ));
      p2Hashes.add(stateHash);
      addTerminal(p2Terminals, transition.node.state);
      if (!sampleStateByLeader.has(leader)) {
        sampleStateByLeader.set(leader, transition.node);
      }
      if (p2Generated % 50_000 === 0) {
        const usage = requireWithinLimits("P2", {
          uniqueStates: totals.uniqueStates + p2Hashes.size,
          transitions: totals.transitions,
        }, runStartedAt, outputDirectory);
        peak.rssBytes = Math.max(peak.rssBytes, usage.rssBytes);
        peak.diskBytes = Math.max(peak.diskBytes, usage.diskBytes);
        process.stdout.write(
          `P2 ${p2Generated.toLocaleString()} transitions, ` +
          `${p2Hashes.size.toLocaleString()} unique\n`,
        );
      }
    }
  }
  const p2Seconds = elapsedSeconds(p2StartedAt);
  totals.uniqueStates += p2Hashes.size;

  const p3ProbeStartedAt = process.hrtime.bigint();
  const p3Probe = [];
  for (const leader of [0, 1, 2]) {
    const sample = sampleStateByLeader.get(leader);
    if (sample === undefined) throw new Error(`missing P2 sample for leader ${leader}`);
    const hashes = new Set();
    const terminals = {};
    let generated = 0;
    const leaderStartedAt = process.hrtime.bigint();
    for (const transition of enumerateP3Transitions(sample)) {
      generated += 1;
      totals.transitions += 1;
      hashes.add(sha256(canonicalDecisionStateKey(
        transition.node.state,
        transition.node.publicTrace,
      )));
      addTerminal(terminals, transition.node.state);
      if (generated % 50_000 === 0) {
        const usage = requireWithinLimits(`P3-probe-leader-${leader}`, {
          uniqueStates: totals.uniqueStates + hashes.size,
          transitions: totals.transitions,
        }, runStartedAt, outputDirectory);
        peak.rssBytes = Math.max(peak.rssBytes, usage.rssBytes);
        peak.diskBytes = Math.max(peak.diskBytes, usage.diskBytes);
        process.stdout.write(
          `P3 leader ${leader} ${generated.toLocaleString()} transitions, ` +
          `${hashes.size.toLocaleString()} unique\n`,
        );
      }
    }
    const seconds = elapsedSeconds(leaderStartedAt);
    totals.uniqueStates += hashes.size;
    p3Probe.push({
      leader,
      generatedTransitions: generated,
      uniqueChildStates: hashes.size,
      duplicateChildren: generated - hashes.size,
      mergeRate: generated === 0 ? 0 : 1 - hashes.size / generated,
      terminalChildren: Object.values(terminals).reduce((sum, count) => sum + count, 0),
      terminals,
      stateHash: digestHashes(hashes),
      seconds,
      transitionsPerSecond: rate(generated, seconds),
      statesPerSecond: rate(hashes.size, seconds),
    });
  }
  const p3ProbeSeconds = elapsedSeconds(p3ProbeStartedAt);
  const branchCounts = new Set(p3Probe.map(({ generatedTransitions }) =>
    generatedTransitions
  ));
  if (branchCounts.size !== 1) {
    throw new Error(`P3 branch count differs by leader: ${[...branchCounts]}`);
  }
  const p3PerParent = p3Probe[0]?.generatedTransitions ?? 0;
  const p3ProjectedTransitions = p2Hashes.size * p3PerParent;
  const stopReason = p3ProjectedTransitions > PILOT_LIMITS.p2p3LowerBound
    ? "p2-p3-next-layer-lower-bound-over-100m"
    : p3ProjectedTransitions >= PILOT_LIMITS.transitions
    ? "transition-cap"
    : undefined;
  if (stopReason === undefined) {
    throw new Error("pilot did not reach an approved stop condition");
  }

  const finalUsage = requireWithinLimits("finalize", totals, runStartedAt, outputDirectory);
  peak.rssBytes = Math.max(peak.rssBytes, finalUsage.rssBytes);
  peak.diskBytes = Math.max(peak.diskBytes, finalUsage.diskBytes);
  const deterministic = {
    schema: "phase5-measurement-v1",
    commit,
    scenario: {
      id: entry.id,
      title: entry.rawTitle,
      difficultyIndex: entry.scenario.difficultyIndex ?? 0,
      loops: entry.scenario.loops,
      daysPerLoop: entry.scenario.daysPerLoop,
      cast: Object.keys(entry.scenario.cast).sort(),
    },
    canonicalVersion: CANONICAL_DECISION_STATE_VERSION,
    engineTransitionVersion: ENGINE_TRANSITION_VERSION,
    leaders: [0, 1, 2],
    layers: [
      {
        id: "root",
        uniqueStates: rootHashes.size,
        stateHash: digestHashes(rootHashes),
        terminals: {},
      },
      {
        id: "loop-1/day-1/P2",
        inputStates: roots.length,
        generatedTransitions: p2Generated,
        uniqueChildStates: p2Hashes.size,
        duplicateChildren: p2Generated - p2Hashes.size,
        mergeRate: p2Generated === 0 ? 0 : 1 - p2Hashes.size / p2Generated,
        terminalChildren: Object.values(p2Terminals).reduce((sum, count) => sum + count, 0),
        terminals: p2Terminals,
        stateHash: digestHashes(p2Hashes),
      },
      {
        id: "loop-1/day-1/P3",
        inputStates: p2Hashes.size,
        enumeration: "stopped-before-full-generation",
        exactTransitionsFromInvariant: p3ProjectedTransitions,
        exactUniqueChildrenFromInjectivePlacedProfiles: p3ProjectedTransitions,
        exactMergeRate: 0,
        terminalChildren: 0,
        branchProof: {
          method: "actual-enumerator-one-parent-per-leader; legal.ts ignores opposite-side target conflicts; canonical key retains ordered six-card placed profile",
          perParent: p3PerParent,
          samples: p3Probe.map((sample) => ({
            leader: sample.leader,
            generatedTransitions: sample.generatedTransitions,
            uniqueChildStates: sample.uniqueChildStates,
            duplicateChildren: sample.duplicateChildren,
            mergeRate: sample.mergeRate,
            terminalChildren: sample.terminalChildren,
            terminals: sample.terminals,
            stateHash: sample.stateHash,
          })),
        },
      },
    ],
    stop: {
      status: "infeasible-within-approved-profile",
      reason: stopReason,
      lastCompletedLayer: "loop-1/day-1/P2",
      nextLayerLowerBound: p3ProjectedTransitions,
      threshold: PILOT_LIMITS.p2p3LowerBound,
    },
  };
  const deterministicHash = sha256(canonicalStringify(deterministic));
  const performance = {
    runSeconds: elapsedSeconds(runStartedAt),
    p2: {
      seconds: p2Seconds,
      transitionsPerSecond: rate(p2Generated, p2Seconds),
      statesPerSecond: rate(p2Hashes.size, p2Seconds),
    },
    p3Probe: {
      seconds: p3ProbeSeconds,
      generatedTransitions: p3Probe.reduce(
        (sum, sample) => sum + sample.generatedTransitions,
        0,
      ),
      transitionsPerSecond: rate(
        p3Probe.reduce((sum, sample) => sum + sample.generatedTransitions, 0),
        p3ProbeSeconds,
      ),
      samples: p3Probe.map(({ stateHash: _stateHash, ...sample }) => sample),
    },
    sampledPeakRssBytes: peak.rssBytes,
    outputDiskBytesBeforeManifest: peak.diskBytes,
    verifiedTransitionsIncludingProofProbe: totals.transitions,
    retainedUniqueStatesThroughLastCompletedLayer: totals.uniqueStates,
  };
  const manifest = {
    deterministic,
    deterministicHash,
    performance,
    limits: PILOT_LIMITS,
  };
  writeFileSync(
    join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const finalDiskBytes = directoryBytes(outputDirectory);
  writeFileSync(
    join(outputDirectory, "summary.json"),
    `${JSON.stringify({
      deterministicHash,
      runSeconds: performance.runSeconds,
      sampledPeakRssBytes: performance.sampledPeakRssBytes,
      finalDiskBytes,
      stop: deterministic.stop,
    }, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify({
    deterministicHash,
    performance,
    finalDiskBytes: directoryBytes(outputDirectory),
    stop: deterministic.stop,
  }, null, 2)}\n`);
}

const [scenarioId, outputDirectory] = process.argv.slice(2);
if (scenarioId === undefined || outputDirectory === undefined) {
  throw new Error("usage: vite-node measure-scenario.mjs <scenario-id> <output-directory>");
}
if (scenarioId !== "firstSteps:2") {
  throw new Error("current runner gate supports firstSteps:2 only");
}
measureFirstStepsPilot(scenarioId, outputDirectory);
