import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
} from "../../src/engine/game";
import { distanceToLoss } from "../../src/engine/loss";
import { loadScenarioCatalog } from "../../src/scenario-catalog";
import {
  characterLocation,
  effectiveRole,
  isCharacterAlive,
  type GameState,
  type PlacedCard,
} from "../../src/types";
import { canonicalStringify, engineStateKey } from "./canonical-state";
import { representativeStateForDay } from "./evaluation-variance-shared";
import {
  applyJointAction,
  closedCharacterProjections,
  closedSuccessorKey,
  decisionContext,
  mastermindActions,
  protagonistResponses,
  sha256,
  type ClosedCharacterProjection,
  type DecisionContext,
} from "./measure-action-equivalence";

const RELEVANCE_P2_HASH =
  "0a415dfcfef8120dd26295943602ea9ce154ef76fe52ea35b3ac81fc7b1ff12e";
const ONE_PLY_REFERENCE_P2_HASH =
  "0005930f56af6d5a1ca841fc466b581bc8af8827a07eab7debb3f2863b3918de";

const AXIS_IDS = [
  "keyPersonIntrigue",
  "killerDependencies",
  "serialKillerOccupancy",
] as const;
type AxisId = typeof AXIS_IDS[number];

interface ResponseClass {
  response: PlacedCard[];
  predicted: ClosedCharacterProjection[];
  relevant: Record<AxisId, boolean>;
}

interface AxisVerification {
  axis: AxisId;
  relevantClasses: number;
  irrelevantClasses: number;
  exactExecutionClasses: number;
  irrelevantDistinctActualSignatures: number;
  allDistinctActualSignatures: number;
  reducedDistinctActualSignatures: number;
  reducedCoversAllActualSignatures: boolean;
}

function elapsedMilliseconds(started: bigint): number {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function characterWithRole(state: GameState, role: string): string {
  const character = Object.keys(state.scenario.cast).find(
    (candidate) => effectiveRole(state, candidate) === role,
  );
  if (character === undefined) throw new Error(`missing ${role}`);
  return character;
}

function candidateByHash(
  context: DecisionContext,
  hash: string,
): PlacedCard[] {
  for (const placements of mastermindActions(context)) {
    if (sha256(canonicalStringify(placements)) === hash) return placements;
  }
  throw new Error(`P2 candidate ${hash} is unavailable on day ${context.state.loop.day}`);
}

function keyPersonIntrigueCandidateHash(
  context: DecisionContext,
  keyPerson: string,
): string {
  const candidates = mastermindActions(context).flatMap((placements) =>
    placements.some((placement) =>
        placement.card === "intriguePlus1" &&
        placement.target.kind === "character" &&
        placement.target.id === keyPerson
      )
      ? [{ hash: sha256(canonicalStringify(placements)) }]
      : []
  ).sort((left, right) => left.hash.localeCompare(right.hash));
  const candidate = candidates[0];
  if (candidate === undefined) {
    throw new Error(`no key-person intrigue P2 on day ${context.state.loop.day}`);
  }
  return candidate.hash;
}

function projectionByCharacter(
  projection: readonly ClosedCharacterProjection[],
): Map<string, ClosedCharacterProjection> {
  return new Map(projection.map((item) => [item.character, item]));
}

function axisSignature(
  projection: readonly ClosedCharacterProjection[],
  axis: AxisId,
  keyPerson: string,
  killer: string,
): string {
  const byCharacter = projectionByCharacter(projection);
  const keyPersonProjection = byCharacter.get(keyPerson);
  const killerProjection = byCharacter.get(killer);
  if (keyPersonProjection === undefined || killerProjection === undefined) {
    throw new Error("axis projection is missing a required character");
  }

  switch (axis) {
    case "keyPersonIntrigue":
      return canonicalStringify({
        intrigue: keyPersonProjection.intrigue,
        remaining: Math.max(0, 2 - keyPersonProjection.intrigue),
      });
    case "killerDependencies":
      return canonicalStringify({
        keyPerson: {
          location: keyPersonProjection.location,
          intrigue: keyPersonProjection.intrigue,
        },
        killer: {
          location: killerProjection.location,
          intrigue: killerProjection.intrigue,
        },
      });
    case "serialKillerOccupancy":
      return canonicalStringify(projection.map(({ character, location }) => ({
        character,
        location,
      })).sort((left, right) => left.character.localeCompare(right.character)));
  }
}

function actualProjection(
  state: GameState,
  characters: readonly string[],
): ClosedCharacterProjection[] {
  return characters.map((character) => {
    const position = state.loop.board[character];
    const counters = state.loop.charCounters[character];
    if (!isCharacterAlive(position) || counters === undefined) {
      throw new Error(`actual P4 projection requires living ${character}`);
    }
    return {
      character,
      location: characterLocation(position, character),
      intrigue: counters.intrigue,
    };
  });
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function evaluationRemaining(state: GameState): Record<string, number> {
  return Object.fromEntries(distanceToLoss(state).map(({ key, remaining }) => [
    key,
    remaining,
  ]));
}

function measureCandidate(
  state: GameState,
  candidateHash: string,
  id: string,
) {
  const context = decisionContext(state);
  const candidate = candidateByHash(context, candidateHash);
  const keyPerson = characterWithRole(state, "keyPerson");
  const killer = characterWithRole(state, "killer");
  if (Object.values(state.scenario.cast).includes("cultist")) {
    throw new Error("firstSteps:2 relevance projection does not model cultist P4 choice");
  }
  const baseline = closedCharacterProjections(context, candidate, []);
  const baselineSignatures = Object.fromEntries(AXIS_IDS.map((axis) => [
    axis,
    axisSignature(baseline, axis, keyPerson, killer),
  ])) as Record<AxisId, string>;

  const classBuildStarted = process.hrtime.bigint();
  const classes = new Map<bigint, ResponseClass>();
  let rawResponses = 0;
  for (const response of protagonistResponses(context)) {
    const predicted = closedCharacterProjections(context, candidate, response);
    const relevant = Object.fromEntries(AXIS_IDS.map((axis) => [
      axis,
      axisSignature(predicted, axis, keyPerson, killer) !==
        baselineSignatures[axis],
    ])) as Record<AxisId, boolean>;
    const key = closedSuccessorKey(context, candidate, response);
    const existing = classes.get(key);
    if (existing === undefined) {
      classes.set(key, {
        response: structuredClone(response),
        predicted,
        relevant,
      });
    } else {
      for (const axis of AXIS_IDS) {
        if (existing.relevant[axis] !== relevant[axis]) {
          throw new Error(`one P4 class disagrees on ${axis} relevance`);
        }
      }
    }
    rawResponses += 1;
  }
  const classBuildMilliseconds = elapsedMilliseconds(classBuildStarted);

  const verificationStarted = process.hrtime.bigint();
  const allSignatures = Object.fromEntries(AXIS_IDS.map((axis) => [
    axis,
    new Set<string>(),
  ])) as Record<AxisId, Set<string>>;
  const reducedSignatures = Object.fromEntries(AXIS_IDS.map((axis) => [
    axis,
    new Set<string>(),
  ])) as Record<AxisId, Set<string>>;
  const irrelevantSignatures = Object.fromEntries(AXIS_IDS.map((axis) => [
    axis,
    new Set<string>(),
  ])) as Record<AxisId, Set<string>>;
  const irrelevantBaselineAdded = Object.fromEntries(AXIS_IDS.map((axis) => [
    axis,
    false,
  ])) as Record<AxisId, boolean>;
  const evaluationValues = new Map<string, Set<number>>();
  let staticPredictionMismatches = 0;

  for (const responseClass of classes.values()) {
    const successor = applyJointAction(
      state,
      candidate,
      responseClass.response,
      true,
    );
    const actual = actualProjection(successor, context.characters);
    if (
      canonicalStringify(actual) !==
        canonicalStringify(responseClass.predicted)
    ) staticPredictionMismatches += 1;

    for (const axis of AXIS_IDS) {
      const signature = axisSignature(actual, axis, keyPerson, killer);
      allSignatures[axis].add(signature);
      if (responseClass.relevant[axis]) {
        reducedSignatures[axis].add(signature);
      } else {
        irrelevantSignatures[axis].add(signature);
        if (!irrelevantBaselineAdded[axis]) {
          reducedSignatures[axis].add(signature);
          irrelevantBaselineAdded[axis] = true;
        }
      }
    }
    for (const [key, remaining] of Object.entries(evaluationRemaining(successor))) {
      const values = evaluationValues.get(key) ?? new Set<number>();
      values.add(remaining);
      evaluationValues.set(key, values);
    }
  }
  const verificationMilliseconds = elapsedMilliseconds(verificationStarted);

  const axes: AxisVerification[] = AXIS_IDS.map((axis) => {
    const relevantClasses = [...classes.values()].filter(
      (responseClass) => responseClass.relevant[axis],
    ).length;
    const irrelevantClasses = classes.size - relevantClasses;
    return {
      axis,
      relevantClasses,
      irrelevantClasses,
      exactExecutionClasses: relevantClasses + Number(irrelevantClasses > 0),
      irrelevantDistinctActualSignatures: irrelevantSignatures[axis].size,
      allDistinctActualSignatures: allSignatures[axis].size,
      reducedDistinctActualSignatures: reducedSignatures[axis].size,
      reducedCoversAllActualSignatures: sameSet(
        allSignatures[axis],
        reducedSignatures[axis],
      ),
    };
  });
  const relevantFor = (axis: AxisId, responseClass: ResponseClass): boolean =>
    responseClass.relevant[axis];
  const requestedUnion = [...classes.values()].filter((responseClass) =>
    relevantFor("keyPersonIntrigue", responseClass) ||
    relevantFor("killerDependencies", responseClass)
  ).length;
  const safetyUnion = [...classes.values()].filter((responseClass) =>
    AXIS_IDS.some((axis) => relevantFor(axis, responseClass))
  ).length;

  if (
    staticPredictionMismatches > 0 ||
    axes.some((axis) =>
      axis.irrelevantDistinctActualSignatures !== 1 ||
      !axis.reducedCoversAllActualSignatures
    )
  ) {
    throw new Error(`axis relevance verification failed for ${id}`);
  }

  return {
    id,
    day: state.loop.day,
    stateHash: sha256(engineStateKey(state)),
    candidate: { hash: candidateHash, placements: candidate },
    rawResponses,
    p4ClosedResponseClasses: classes.size,
    axes,
    unions: {
      keyPersonIntrigueOrKillerDependencies: {
        relevantClasses: requestedUnion,
        exactExecutionClasses: requestedUnion + Number(requestedUnion < classes.size),
      },
      includingSerialKillerOccupancy: {
        relevantClasses: safetyUnion,
        exactExecutionClasses: safetyUnion + Number(safetyUnion < classes.size),
      },
    },
    actualDistanceToLossValues: Object.fromEntries(
      [...evaluationValues].sort(([left], [right]) => left.localeCompare(right))
        .map(([key, values]) => [key, [...values].sort((a, b) => a - b)]),
    ),
    verification: {
      actualClassesExecuted: classes.size,
      staticPredictionMismatches,
      rule:
        "every statically irrelevant P4 class has exactly one actual dependency signature; relevant classes plus one irrelevant baseline reproduce every actual signature",
    },
    performance: { classBuildMilliseconds, verificationMilliseconds },
  };
}

function main(): void {
  const [outputDirectory] = process.argv.slice(2);
  if (outputDirectory === undefined) {
    throw new Error("usage: vite-node measure-axis-relevance.ts OUTPUT_DIR");
  }
  mkdirSync(outputDirectory, { recursive: true });
  const entry = loadScenarioCatalog().find(({ id }) => id === "firstSteps:2");
  if (entry === undefined) throw new Error("missing firstSteps:2");
  const initial = createGameState(structuredClone(entry.scenario));
  chooseInitialLeader(initial, 0);
  continueFromTimeGap(initial);

  const started = process.hrtime.bigint();
  const states = [1, 2, 3].map((day) =>
    representativeStateForDay(initial, day).state
  );
  const measured = states.map((state) => {
    return measureCandidate(
      state,
      RELEVANCE_P2_HASH,
      `loop1-day${state.loop.day}-relevance-sensitive-p2`,
    );
  });
  const measuredKeyPersonStress = states.map((state) => {
    const context = decisionContext(state);
    const keyPerson = characterWithRole(state, "keyPerson");
    return measureCandidate(
      state,
      keyPersonIntrigueCandidateHash(context, keyPerson),
      `loop1-day${state.loop.day}-key-person-intrigue-p2`,
    );
  });
  const measuredOnePlyReference = measureCandidate(
    initial,
    ONE_PLY_REFERENCE_P2_HASH,
    "loop1-day1-one-ply-reference-p2",
  );
  const measurements = measured.map(({ performance: _performance, ...result }) =>
    result
  );
  const keyPersonStressMeasurements = measuredKeyPersonStress.map(
    ({ performance: _performance, ...result }) => result,
  );
  const {
    performance: onePlyReferencePerformance,
    ...onePlyReference
  } = measuredOnePlyReference;
  const deterministic = {
    schema: "phase5-axis-relevance-v1",
    scenario: "firstSteps:2",
    scope:
      "P4 static physical dependency projections; P5-P9 choices are not expanded",
    axes: {
      keyPersonIntrigue:
        "key-person intrigue and its unsigned remaining-to-2 component",
      killerDependencies:
        "key-person and killer locations plus both intrigue counters",
      serialKillerOccupancy:
        "locations of every living character, conservatively preserving the exactly-one-other condition",
    },
    candidateSelection: {
      dateComparison:
        "same canonical P2 hash; lowest known deterministic variance-sample hash whose P3 responses vary on days 2 and 3",
      keyPersonStress:
        "on each day, the smallest canonical P2 hash containing intriguePlus1 on the key person",
      onePlyReference:
        "the previously committed 10,567-class foreground-search P2 hash",
    },
    measurements,
    keyPersonStressMeasurements,
    onePlyReference,
  };
  const deterministicHash = sha256(canonicalStringify(deterministic));
  const manifest = {
    deterministic,
    deterministicHash,
    performance: {
      milliseconds: elapsedMilliseconds(started),
      rssBytes: process.memoryUsage().rss,
      measurements: measured.map(({ id, performance }) => ({ id, ...performance })),
      keyPersonStressMeasurements: measuredKeyPersonStress.map(
        ({ id, performance }) => ({ id, ...performance }),
      ),
      onePlyReference: onePlyReferencePerformance,
    },
  };
  writeFileSync(
    join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(
    join(outputDirectory, "summary.json"),
    `${JSON.stringify({
      deterministicHash,
      measurements,
      keyPersonStressMeasurements,
      onePlyReference,
      performance: manifest.performance,
    }, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main();
