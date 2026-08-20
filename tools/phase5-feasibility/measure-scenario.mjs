import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
} from "../../src/engine/game.ts";
import { validatePlacement } from "../../src/engine/legal.ts";
import { resolveActions } from "../../src/engine/resolve.ts";
import { loadScenarioCatalog } from "../../src/scenario-catalog.ts";
import {
  MASTERMIND_HAND,
  PROTAGONIST_HAND,
} from "../../src/ui/action-cards.ts";
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

function symmetricInitialRoots(entry) {
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

function physicalOutcome(state) {
  return canonicalStringify({
    board: state.loop.board,
    charCounters: state.loop.charCounters,
    locIntrigue: state.loop.locIntrigue,
    specialGauge: state.loop.specialGauge,
  });
}

function resolvedOutcome(state, placements) {
  const candidate = structuredClone(state);
  candidate.loop.placed = [];
  for (const placement of placements) {
    const legal = validatePlacement(candidate, placement);
    if (!legal.ok) return undefined;
    candidate.loop.placed.push(structuredClone(placement));
  }
  resolveActions(candidate);
  return physicalOutcome(candidate);
}

/** 실제 엔진으로 "어떤 합법 P3 대응에서라도 결과에 관여 가능한가"를 증명한다. */
function effectCapableMastermindPlacement(root, placement) {
  const emptyOutcome = resolvedOutcome(root.state, []);
  const mastermindOnly = resolvedOutcome(root.state, [placement]);
  if (mastermindOnly !== undefined && mastermindOnly !== emptyOutcome) return true;

  for (const { card } of PROTAGONIST_HAND) {
    const response = { owner: 0, card, target: structuredClone(placement.target) };
    const responseOnly = resolvedOutcome(root.state, [response]);
    const combined = resolvedOutcome(root.state, [placement, response]);
    if (
      responseOnly !== undefined &&
      combined !== undefined &&
      responseOnly !== combined
    ) return true;
  }
  return false;
}

function effectCapableProtagonistPlacement(root, placement) {
  const emptyOutcome = resolvedOutcome(root.state, []);
  const protagonistOnly = resolvedOutcome(root.state, [placement]);
  if (protagonistOnly !== undefined && protagonistOnly !== emptyOutcome) {
    return true;
  }

  const seenCards = new Set();
  for (const { card } of MASTERMIND_HAND) {
    if (seenCards.has(card)) continue;
    seenCards.add(card);
    const mastermind = {
      owner: "mastermind",
      card,
      target: structuredClone(placement.target),
    };
    const mastermindOnly = resolvedOutcome(root.state, [mastermind]);
    const combined = resolvedOutcome(root.state, [mastermind, placement]);
    if (
      mastermindOnly !== undefined &&
      combined !== undefined &&
      mastermindOnly !== combined
    ) return true;
  }
  return false;
}

function placementSetKey(placements, includeOwner) {
  return canonicalStringify(placements.map(({ owner, card, target }) =>
    includeOwner
      ? { owner, card, target }
      : { card, target }
  ).sort((left, right) => canonicalStringify(left).localeCompare(
    canonicalStringify(right),
  )));
}

function measureFirstStepsPilot(scenarioId, outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const runStartedAt = process.hrtime.bigint();
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const entry = scenarioEntry(scenarioId);
  const symmetricRoots = symmetricInitialRoots(entry);
  const symmetricRootHashes = new Set(symmetricRoots.map((node) =>
    sha256(canonicalDecisionStateKey(node.state, node.publicTrace))
  ));
  if (symmetricRootHashes.size !== 1) {
    throw new Error("cyclic initial-leader symmetry did not canonicalize to one root");
  }
  const root = symmetricRoots[0];
  if (root === undefined) throw new Error("missing initial root");
  const roots = [root];
  const peak = { rssBytes: process.memoryUsage().rss, diskBytes: 0 };
  const totals = { uniqueStates: 0, transitions: 0 };
  let sampleP2State;
  const effectCapablePlacements = new Map();
  const semanticMastermindPlacements = new Map();
  let p2ImmediateEffectProfiles = 0;
  let p2EffectCapableProfiles = 0;

  const rootHashes = symmetricRootHashes;
  totals.uniqueStates += rootHashes.size;

  const p2StartedAt = process.hrtime.bigint();
  const p2Hashes = new Set();
  const p2Terminals = {};
  let p2Generated = 0;
  for (const root of roots) {
    for (const transition of enumerateP2Transitions(root)) {
      p2Generated += 1;
      totals.transitions += 1;
      const stateHash = sha256(canonicalDecisionStateKey(
        transition.node.state,
        transition.node.publicTrace,
      ));
      p2Hashes.add(stateHash);
      addTerminal(p2Terminals, transition.node.state);
      sampleP2State ??= transition.node;
      if (transition.action.kind !== "P2_PROFILE") {
        throw new Error("P2 enumerator returned a non-P2 action");
      }
      let immediateEffect = false;
      const resolved = structuredClone(transition.node.state);
      const beforeOutcome = physicalOutcome(resolved);
      resolveActions(resolved);
      immediateEffect = physicalOutcome(resolved) !== beforeOutcome;
      if (immediateEffect) p2ImmediateEffectProfiles += 1;

      const effectCapable = transition.action.placements.some((placement) => {
        const key = canonicalStringify(placement);
        semanticMastermindPlacements.set(key, structuredClone(placement));
        const cached = effectCapablePlacements.get(key);
        if (cached !== undefined) return cached;
        const result = effectCapableMastermindPlacement(root, placement);
        effectCapablePlacements.set(key, result);
        return result;
      });
      if (effectCapable) {
        p2EffectCapableProfiles += 1;
      }
      for (const placement of transition.action.placements) {
        const key = canonicalStringify(placement);
        semanticMastermindPlacements.set(key, structuredClone(placement));
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
  {
    const leader = 0;
    const sample = sampleP2State;
    if (sample === undefined) throw new Error("missing P2 sample");
    const hashes = new Set();
    const actionSetHashes = new Set();
    const ownerlessActionSetHashes = new Set();
    const protagonistEffectCapablePlacements = new Map();
    let effectCapableProfiles = 0;
    const exampleProfile = [
      {
        owner: 0,
        card: "goodwillPlus1",
        target: { kind: "character", id: "shrineMaiden" },
      },
      {
        owner: 1,
        card: "paranoiaMinus1",
        target: { kind: "character", id: "doctor" },
      },
      {
        owner: 2,
        card: "forbidIntrigue",
        target: { kind: "character", id: "popIdol" },
      },
    ];
    const exampleProfileKey = placementSetKey(exampleProfile, true);
    let exampleMultiplicity = 0;
    const terminals = {};
    let generated = 0;
    const leaderStartedAt = process.hrtime.bigint();
    for (const transition of enumerateP3Transitions(sample)) {
      generated += 1;
      totals.transitions += 1;
      if (transition.action.kind !== "P3_PROFILE") {
        throw new Error("P3 enumerator returned a non-P3 action");
      }
      const actionSetKey = placementSetKey(
        transition.action.placements,
        true,
      );
      actionSetHashes.add(sha256(actionSetKey));
      ownerlessActionSetHashes.add(sha256(placementSetKey(
        transition.action.placements,
        false,
      )));
      if (actionSetKey === exampleProfileKey) exampleMultiplicity += 1;
      if (transition.action.placements.some((placement) => {
        const placementKey = canonicalStringify({
          card: placement.card,
          target: placement.target,
        });
        const cached = protagonistEffectCapablePlacements.get(placementKey);
        if (cached !== undefined) return cached;
        const result = effectCapableProtagonistPlacement(root, placement);
        protagonistEffectCapablePlacements.set(placementKey, result);
        return result;
      })) effectCapableProfiles += 1;
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
      actionSetAudit: {
        uniqueOwnerCardTargetSets: actionSetHashes.size,
        duplicateOwnerCardTargetSets: generated - actionSetHashes.size,
        uniqueCardTargetSetsWithoutOwner: ownerlessActionSetHashes.size,
        duplicatesIfOwnerIsErased:
          generated - ownerlessActionSetHashes.size,
        ownerErasureFactor:
          ownerlessActionSetHashes.size === 0
            ? 0
            : generated / ownerlessActionSetHashes.size,
        exampleProfile,
        exampleMultiplicity,
      },
      actionClassification: {
        N_allLegalProfiles: generated,
        M_effectCapableUnderAtLeastOneLegalP2Profile:
          effectCapableProfiles,
        whollyEffectIncapableProfiles: generated - effectCapableProfiles,
      },
      seconds,
      transitionsPerSecond: rate(generated, seconds),
      statesPerSecond: rate(hashes.size, seconds),
    });
  }
  const p3ProbeSeconds = elapsedSeconds(p3ProbeStartedAt);
  for (const [key, placement] of semanticMastermindPlacements) {
    if (effectCapablePlacements.has(key)) continue;
    effectCapablePlacements.set(
      key,
      effectCapableMastermindPlacement(root, placement),
    );
  }
  const incapableSemanticPlacements = [...effectCapablePlacements.entries()]
    .filter(([, capable]) => !capable)
    .map(([key]) => JSON.parse(key))
    .sort((left, right) => canonicalStringify(left).localeCompare(
      canonicalStringify(right),
    ));
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
    leaders: {
      generatedForSymmetryProof: [0, 1, 2],
      enumeratedRepresentative: 0,
      canonicalRoots: rootHashes.size,
    },
    actionClassification: {
      scope: "first-day mastermind P2 unordered profiles",
      N_allLegalProfiles: p2Generated,
      M_effectCapableUnderAtLeastOneLegalP3Response: p2EffectCapableProfiles,
      immediateBoardEffectWithoutP3Response: p2ImmediateEffectProfiles,
      K_includingConservativeBluffValue: p2Generated,
      semanticPlacementCount: semanticMastermindPlacements.size,
      effectIncapableSemanticPlacements: incapableSemanticPlacements,
      bluffRule: "No legal profile can be removed without an opponent-belief model: a distinct face-down target profile and later revealed card profile can be a signal.",
      effectProof: "For each semantic mastermind card-target placement, compare actual resolveActions outcomes without it and with it, both alone and paired with every legal protagonist card on the same target.",
    },
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
          method: "actual-enumerator on one symmetry-representative parent; legal.ts rejects only same-side target conflicts; canonical key retains owner/card/target sets but not submission order",
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
            actionSetAudit: sample.actionSetAudit,
            actionClassification: sample.actionClassification,
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
