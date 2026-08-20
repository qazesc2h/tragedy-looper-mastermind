import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { characterDataOf } from "../../src/data";
import {
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
} from "../../src/engine/game";
import { loadScenarioCatalog } from "../../src/scenario-catalog";
import type {
  ActionCard,
  GameState,
  Location,
  PlacedCard,
  Target,
} from "../../src/types";
import { canonicalStringify } from "./canonical-state";
import {
  enumerateP2Transitions,
  enumerateP3Transitions,
  headlessNode,
  resolveP4Transition,
  type HeadlessNode,
} from "./headless-transitions";

const LOCATIONS: Location[] = ["Hospital", "Shrine", "City", "School"];
const MASTERMIND_CARDS: ActionCard[] = [
  "paranoiaPlus1",
  "paranoiaMinus1",
  "forbidParanoia",
  "forbidGoodwill",
  "intriguePlus1",
  "intriguePlus2",
  "moveVertical",
  "moveHorizontal",
  "moveDiagonal",
];
const PROTAGONIST_CARDS: ActionCard[] = [
  "paranoiaPlus1",
  "paranoiaMinus1",
  "goodwillPlus1",
  "goodwillPlus2",
  "forbidIntrigue",
  "moveVertical",
  "moveHorizontal",
  "forbidMove",
];
const PHYSICAL_MASK = (1n << 56n) - 1n;

interface ModelContext {
  characters: string[];
  targets: Target[];
  startLocations: number[];
  forbiddenLocations: Array<ReadonlySet<Location>>;
}

interface CompactP2 {
  hash: string;
  placements: PlacedCard[];
  cardAt: Array<ActionCard | undefined>;
}

interface ResourceStratumResult {
  mastermind: number;
  protagonistCategories: [number, number, number];
  permutations: number;
  physicalStates: number;
  physicalDigest: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestBigints(values: ReadonlySet<bigint>): string {
  const hash = createHash("sha256");
  const sorted = [...values].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  for (const value of sorted) hash.update(`${value.toString(16)}\n`);
  return hash.digest("hex");
}

function moveDestination(from: number, card: ActionCard): number {
  const at = LOCATIONS[from];
  if (at === undefined) throw new Error("invalid location index");
  const destinations = {
    moveVertical: {
      Hospital: "Shrine",
      Shrine: "Hospital",
      City: "School",
      School: "City",
    },
    moveHorizontal: {
      Hospital: "City",
      Shrine: "School",
      City: "Hospital",
      School: "Shrine",
    },
    moveDiagonal: {
      Hospital: "School",
      Shrine: "City",
      City: "Shrine",
      School: "Hospital",
    },
  } satisfies Record<string, Record<Location, Location>>;
  if (
    card !== "moveVertical" &&
    card !== "moveHorizontal" &&
    card !== "moveDiagonal"
  ) return from;
  return LOCATIONS.indexOf(destinations[card][at]);
}

function composedMove(
  mastermind?: ActionCard,
  protagonist?: ActionCard,
): ActionCard | undefined {
  const mastermindMove = mastermind === "moveVertical" ||
      mastermind === "moveHorizontal" || mastermind === "moveDiagonal"
    ? mastermind
    : undefined;
  const protagonistMove = protagonist === "moveVertical" ||
      protagonist === "moveHorizontal"
    ? protagonist
    : undefined;
  if (mastermindMove === undefined) return protagonistMove;
  if (protagonistMove === undefined || mastermindMove === protagonistMove) {
    return mastermindMove;
  }
  if (
    (mastermindMove === "moveVertical" &&
      protagonistMove === "moveHorizontal") ||
    (mastermindMove === "moveHorizontal" &&
      protagonistMove === "moveVertical")
  ) return "moveDiagonal";
  if (
    mastermindMove === "moveDiagonal" &&
    protagonistMove === "moveHorizontal"
  ) return "moveVertical";
  return "moveHorizontal";
}

function targetShift(context: ModelContext, targetIndex: number): number {
  return targetIndex < context.characters.length
    ? targetIndex * 8
    : 48 + (targetIndex - context.characters.length) * 2;
}

function localPhysicalBits(
  context: ModelContext,
  targetIndex: number,
  mastermind?: ActionCard,
  protagonist?: ActionCard,
  intrigueForbidActive = false,
): bigint {
  const shift = targetShift(context, targetIndex);
  if (targetIndex >= context.characters.length) {
    const intrigue = (
        mastermind === "intriguePlus1" || mastermind === "intriguePlus2"
      ) && !(intrigueForbidActive && protagonist === "forbidIntrigue")
      ? mastermind === "intriguePlus2" ? 2 : 1
      : 0;
    return BigInt(intrigue) << BigInt(shift);
  }

  let location = context.startLocations[targetIndex] ?? 0;
  const move = composedMove(mastermind, protagonist);
  if (move !== undefined && protagonist !== "forbidMove") {
    const candidate = moveDestination(location, move);
    const candidateLocation = LOCATIONS[candidate];
    if (
      candidateLocation !== undefined &&
      !context.forbiddenLocations[targetIndex]?.has(candidateLocation)
    ) location = candidate;
  }

  const paranoia = mastermind === "forbidParanoia"
    ? 0
    : Math.max(
      0,
      Number(mastermind === "paranoiaPlus1") +
        Number(protagonist === "paranoiaPlus1") -
        Number(mastermind === "paranoiaMinus1") -
        Number(protagonist === "paranoiaMinus1"),
    );
  const goodwill = mastermind === "forbidGoodwill"
    ? 0
    : protagonist === "goodwillPlus2"
    ? 2
    : protagonist === "goodwillPlus1"
    ? 1
    : 0;
  const intrigue = (
      mastermind === "intriguePlus1" || mastermind === "intriguePlus2"
    ) && !(intrigueForbidActive && protagonist === "forbidIntrigue")
    ? mastermind === "intriguePlus2" ? 2 : 1
    : 0;
  const local = location | (goodwill << 2) | (paranoia << 4) |
    (intrigue << 6);
  return BigInt(local) << BigInt(shift);
}

function mastermindSpentBits(
  cards: readonly (ActionCard | undefined)[],
): bigint {
  let bits = 0n;
  if (cards.includes("moveDiagonal")) bits |= 1n << 56n;
  if (cards.includes("intriguePlus2")) bits |= 1n << 57n;
  return bits;
}

function protagonistSpentBits(owner: number, card: ActionCard): bigint {
  const base = 58n + BigInt(owner * 3);
  if (card === "goodwillPlus2") return 1n << base;
  if (card === "paranoiaMinus1") return 1n << (base + 1n);
  if (card === "forbidMove") return 1n << (base + 2n);
  return 0n;
}

function compactStateKey(context: ModelContext, state: GameState): bigint {
  let key = 0n;
  context.characters.forEach((character, index) => {
    const position = state.loop.board[character];
    if (position?.status !== "alive") {
      throw new Error(`unexpected P4 character status for ${character}`);
    }
    const counters = state.loop.charCounters[character];
    if (counters === undefined) throw new Error(`missing counters for ${character}`);
    const local = LOCATIONS.indexOf(position.at) |
      (counters.goodwill << 2) |
      (counters.paranoia << 4) |
      (counters.intrigue << 6);
    key |= BigInt(local) << BigInt(targetShift(context, index));
  });
  LOCATIONS.forEach((location, offset) => {
    key |= BigInt(state.loop.locIntrigue[location]) << BigInt(48 + offset * 2);
  });
  key |= mastermindSpentBits(state.loop.spentOncePerLoop.mastermind);
  state.loop.spentOncePerLoop.protagonists.forEach((cards, owner) => {
    for (const card of cards) key |= protagonistSpentBits(owner, card);
  });
  return key;
}

function compactP2(
  context: ModelContext,
  placements: readonly PlacedCard[],
): CompactP2 {
  const targetIndexes = new Map(context.targets.map((target, index) => [
    canonicalStringify(target),
    index,
  ]));
  const cardAt: Array<ActionCard | undefined> = Array(context.targets.length)
    .fill(undefined);
  for (const placement of placements) {
    const index = targetIndexes.get(canonicalStringify(placement.target));
    if (index === undefined) throw new Error("unknown P2 target");
    cardAt[index] = placement.card;
  }
  return {
    hash: sha256(canonicalStringify(placements)),
    placements: structuredClone(placements),
    cardAt,
  };
}

function protagonistCardsForCategory(category: number): ActionCard[] {
  if (category === 1) return ["goodwillPlus2"];
  if (category === 2) return ["paranoiaMinus1"];
  if (category === 3) return ["forbidMove"];
  return [
    "paranoiaPlus1",
    "goodwillPlus1",
    "forbidIntrigue",
    "moveVertical",
    "moveHorizontal",
  ];
}

type ConstraintBuckets = Map<number, Set<bigint>>;

function constraintKey(
  mastermindMask: number,
  plusCount: number,
  mastermindPlaced: number,
  protagonistMask: number,
  forbidCount: number,
): number {
  return mastermindMask | (plusCount << 9) | (mastermindPlaced << 11) |
    (protagonistMask << 13) | (forbidCount << 16);
}

function unpackConstraint(value: number) {
  return {
    mastermindMask: value & 0x1ff,
    plusCount: (value >> 9) & 3,
    mastermindPlaced: (value >> 11) & 3,
    protagonistMask: (value >> 13) & 7,
    forbidCount: (value >> 16) & 3,
  };
}

function exactPhysicalForResourceStratum(
  context: ModelContext,
  resource: number,
  intrigueForbidActive: boolean,
  reverseTargets: boolean,
): Set<bigint> {
  const desiredMastermind = resource & 3;
  const ownerCategories = [0, 1, 2].map((owner) =>
    (resource >> (2 + owner * 2)) & 3
  );
  let buckets: ConstraintBuckets = new Map([
    [constraintKey(0, 0, 0, 0, 0), new Set([0n])],
  ]);
  const targetOrder = [...context.targets.keys()];
  if (reverseTargets) targetOrder.reverse();

  for (let step = 0; step < targetOrder.length; step += 1) {
    const targetIndex = targetOrder[step];
    if (targetIndex === undefined) continue;
    const next: ConstraintBuckets = new Map();
    const remainingAfter = targetOrder.length - step - 1;
    for (const [constraint, partials] of buckets) {
      const unpacked = unpackConstraint(constraint);
      const mastermindOptions: Array<{
        card?: ActionCard;
        mask: number;
        plus: number;
      }> = [{
        mask: unpacked.mastermindMask,
        plus: unpacked.plusCount,
      }];
      if (unpacked.mastermindPlaced < 3) {
        MASTERMIND_CARDS.forEach((card, cardIndex) => {
          if (card === "intriguePlus2" && (desiredMastermind & 2) === 0) {
            return;
          }
          if (card === "moveDiagonal" && (desiredMastermind & 1) === 0) {
            return;
          }
          if (card === "paranoiaPlus1") {
            if (unpacked.plusCount < 2) {
              mastermindOptions.push({
                card,
                mask: unpacked.mastermindMask,
                plus: unpacked.plusCount + 1,
              });
            }
          } else if ((unpacked.mastermindMask & (1 << cardIndex)) === 0) {
            mastermindOptions.push({
              card,
              mask: unpacked.mastermindMask | (1 << cardIndex),
              plus: unpacked.plusCount,
            });
          }
        });
      }

      const protagonistOptions: Array<{
        card?: ActionCard;
        mask: number;
        forbids: number;
      }> = [{
        mask: unpacked.protagonistMask,
        forbids: unpacked.forbidCount,
      }];
      for (let owner = 0; owner < 3; owner += 1) {
        if ((unpacked.protagonistMask & (1 << owner)) !== 0) continue;
        for (const card of protagonistCardsForCategory(
          ownerCategories[owner] ?? 0,
        )) {
          const forbids = unpacked.forbidCount +
            Number(card === "forbidIntrigue");
          if (intrigueForbidActive && forbids > 1) continue;
          protagonistOptions.push({
            card,
            mask: unpacked.protagonistMask | (1 << owner),
            forbids,
          });
        }
      }

      for (const mastermind of mastermindOptions) {
        for (const protagonist of protagonistOptions) {
          const mastermindPlaced = unpacked.mastermindPlaced +
            Number(mastermind.card !== undefined);
          const protagonistPlaced = Number((protagonist.mask & 1) !== 0) +
            Number((protagonist.mask & 2) !== 0) +
            Number((protagonist.mask & 4) !== 0);
          if (
            mastermindPlaced > 3 ||
            mastermindPlaced + remainingAfter < 3 ||
            protagonistPlaced + remainingAfter < 3
          ) continue;
          const nextConstraint = constraintKey(
            mastermind.mask,
            mastermind.plus,
            mastermindPlaced,
            protagonist.mask,
            protagonist.forbids,
          );
          let output = next.get(nextConstraint);
          if (output === undefined) {
            output = new Set();
            next.set(nextConstraint, output);
          }
          const local = localPhysicalBits(
            context,
            targetIndex,
            mastermind.card,
            protagonist.card,
            intrigueForbidActive,
          ) & PHYSICAL_MASK;
          for (const partial of partials) output.add(partial | local);
        }
      }
    }
    buckets = next;
  }

  const result = new Set<bigint>();
  const diagonalIndex = MASTERMIND_CARDS.indexOf("moveDiagonal");
  const intrigueTwoIndex = MASTERMIND_CARDS.indexOf("intriguePlus2");
  for (const [constraint, states] of buckets) {
    const unpacked = unpackConstraint(constraint);
    const actualMastermind =
      Number((unpacked.mastermindMask & (1 << diagonalIndex)) !== 0) |
      (Number((unpacked.mastermindMask & (1 << intrigueTwoIndex)) !== 0) << 1);
    const forbidAccepted = intrigueForbidActive
      ? unpacked.forbidCount === 1
      : unpacked.forbidCount !== 1;
    if (
      unpacked.mastermindPlaced === 3 &&
      unpacked.protagonistMask === 7 &&
      actualMastermind === desiredMastermind &&
      forbidAccepted
    ) {
      for (const state of states) result.add(state);
    }
  }
  return result;
}

function categoryPermutations(categories: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const category of categories) {
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  let result = 6;
  for (const count of counts.values()) {
    if (count === 2) result /= 2;
    else if (count === 3) result /= 6;
  }
  return result;
}

function measureExactStrata(
  context: ModelContext,
  reverseTargets: boolean,
) {
  let ownerSpecific = 0;
  let aggregatedRemaining = 0;
  const globalPhysical = new Set<bigint>();
  const strata: ResourceStratumResult[] = [];
  for (let mastermind = 0; mastermind < 4; mastermind += 1) {
    for (let first = 0; first < 4; first += 1) {
      for (let second = first; second < 4; second += 1) {
        for (let third = second; third < 4; third += 1) {
          const categories: [number, number, number] = [first, second, third];
          const resource = mastermind | (first << 2) | (second << 4) |
            (third << 6);
          const physical = exactPhysicalForResourceStratum(
            context,
            resource,
            false,
            reverseTargets,
          );
          if (categories.includes(0)) {
            for (
              const state of exactPhysicalForResourceStratum(
                context,
                resource,
                true,
                reverseTargets,
              )
            ) physical.add(state);
          }
          const permutations = categoryPermutations(categories);
          ownerSpecific += physical.size * permutations;
          aggregatedRemaining += physical.size;
          for (const state of physical) globalPhysical.add(state);
          strata.push({
            mastermind,
            protagonistCategories: categories,
            permutations,
            physicalStates: physical.size,
            physicalDigest: digestBigints(physical),
          });
        }
      }
    }
  }
  return {
    ownerSpecific,
    aggregatedRemaining,
    physicalOnly: globalPhysical.size,
    physicalDigest: digestBigints(globalPhysical),
    strata,
  };
}

function buildContext(): { context: ModelContext; root: HeadlessNode } {
  const entry = loadScenarioCatalog().find(({ id }) => id === "firstSteps:2");
  if (entry === undefined) throw new Error("missing firstSteps:2");
  const state = createGameState(structuredClone(entry.scenario));
  chooseInitialLeader(state, 0);
  continueFromTimeGap(state);
  const characters = Object.keys(state.loop.board);
  const targets: Target[] = [
    ...characters.map((id): Target => ({ kind: "character", id })),
    ...LOCATIONS.map((at): Target => ({ kind: "location", at })),
  ];
  const startLocations = characters.map((character) => {
    const position = state.loop.board[character];
    if (position?.status !== "alive") {
      throw new Error(`unexpected initial status for ${character}`);
    }
    return LOCATIONS.indexOf(position.at);
  });
  return {
    context: {
      characters,
      targets,
      startLocations,
      forbiddenLocations: characters.map((character) =>
        new Set(characterDataOf(character).forbiddenLocation)
      ),
    },
    root: headlessNode(state),
  };
}

function enumerateP2(
  context: ModelContext,
  root: HeadlessNode,
): { profiles: CompactP2[]; firstNode: HeadlessNode } {
  const profiles: CompactP2[] = [];
  let firstNode: HeadlessNode | undefined;
  for (const transition of enumerateP2Transitions(root)) {
    if (transition.action.kind !== "P2_PROFILE") {
      throw new Error("unexpected P2 transition");
    }
    firstNode ??= transition.node;
    profiles.push(compactP2(context, transition.action.placements));
  }
  if (firstNode === undefined) throw new Error("missing P2 state");
  return { profiles, firstNode };
}

function targetTriples(targetCount: number): Array<[number, number, number]> {
  const result: Array<[number, number, number]> = [];
  for (let first = 0; first < targetCount; first += 1) {
    for (let second = 0; second < targetCount; second += 1) {
      for (let third = 0; third < targetCount; third += 1) {
        if (first !== second && first !== third && second !== third) {
          result.push([first, second, third]);
        }
      }
    }
  }
  return result;
}

function cardTriples() {
  const result: Array<{
    cards: [ActionCard, ActionCard, ActionCard];
    intrigueForbidActive: boolean;
    spent: bigint;
  }> = [];
  for (const first of PROTAGONIST_CARDS) {
    for (const second of PROTAGONIST_CARDS) {
      for (const third of PROTAGONIST_CARDS) {
        const cards: [ActionCard, ActionCard, ActionCard] = [
          first,
          second,
          third,
        ];
        result.push({
          cards,
          intrigueForbidActive:
            cards.filter((card) => card === "forbidIntrigue").length === 1,
          spent: protagonistSpentBits(0, first) |
            protagonistSpentBits(1, second) |
            protagonistSpentBits(2, third),
        });
      }
    }
  }
  return result;
}

const PROTAGONIST_CARD_TRIPLES = cardTriples();
const TARGET_TRIPLE_CACHE = new Map<
  number,
  Array<[number, number, number]>
>();

function cachedTargetTriples(
  targetCount: number,
): Array<[number, number, number]> {
  const cached = TARGET_TRIPLE_CACHE.get(targetCount);
  if (cached !== undefined) return cached;
  const result = targetTriples(targetCount);
  TARGET_TRIPLE_CACHE.set(targetCount, result);
  return result;
}

function outcomesForP2(
  context: ModelContext,
  p2: CompactP2,
): Set<bigint> {
  const results = new Set<bigint>();
  const mastermindSpent = mastermindSpentBits(p2.cardAt);
  for (
    const [first, second, third] of cachedTargetTriples(
      context.targets.length,
    )
  ) {
    let untouched = mastermindSpent;
    for (let index = 0; index < context.targets.length; index += 1) {
      if (index !== first && index !== second && index !== third) {
        untouched |= localPhysicalBits(context, index, p2.cardAt[index]);
      }
    }
    for (const combination of PROTAGONIST_CARD_TRIPLES) {
      results.add(
        untouched | combination.spent |
          localPhysicalBits(
            context,
            first,
            p2.cardAt[first],
            combination.cards[0],
            combination.intrigueForbidActive,
          ) |
          localPhysicalBits(
            context,
            second,
            p2.cardAt[second],
            combination.cards[1],
            combination.intrigueForbidActive,
          ) |
          localPhysicalBits(
            context,
            third,
            p2.cardAt[third],
            combination.cards[2],
            combination.intrigueForbidActive,
          ),
      );
    }
  }
  return results;
}

function validateAgainstEngine(
  context: ModelContext,
  firstP2: CompactP2,
  firstNode: HeadlessNode,
) {
  const predicted = outcomesForP2(context, firstP2);
  let checked = 0;
  for (const transition of enumerateP3Transitions(firstNode)) {
    const actual = compactStateKey(
      context,
      resolveP4Transition(transition.node).node.state,
    );
    if (!predicted.has(actual)) {
      throw new Error(`destination model misses engine state ${actual}`);
    }
    checked += 1;
    if (checked === 1_000) break;
  }
  return {
    checkedEngineTransitions: checked,
    firstP2OwnerSpecificStates: predicted.size,
    firstP2PhysicalStates: new Set(
      [...predicted].map((state) => state & PHYSICAL_MASK),
    ).size,
  };
}

function measureP2Sample(
  context: ModelContext,
  profiles: readonly CompactP2[],
  sampleSize: number,
  physicalTotal: number,
) {
  const selected = [...profiles]
    .sort((left, right) => left.hash.localeCompare(right.hash))
    .slice(0, sampleSize);
  const physical = new Set<bigint>();
  for (const profile of selected) {
    for (const state of outcomesForP2(context, profile)) {
      physical.add(state & PHYSICAL_MASK);
    }
  }
  return {
    sampleSelection: "lowest SHA-256 of canonical P2 placements",
    requested: sampleSize,
    selected: selected.length,
    physicalStates: physical.size,
    physicalCoverage: physicalTotal === 0 ? 0 : physical.size / physicalTotal,
    physicalDigest: digestBigints(physical),
  };
}

function main(): void {
  const [outputDirectory] = process.argv.slice(2).filter((arg) =>
    !arg.startsWith("--")
  );
  if (outputDirectory === undefined) {
    throw new Error(
      "usage: vite-node measure-p4-destinations.ts OUTPUT_DIR [--reverse]",
    );
  }
  mkdirSync(outputDirectory, { recursive: true });
  const started = process.hrtime.bigint();
  const { context, root } = buildContext();
  const { profiles, firstNode } = enumerateP2(context, root);
  const reverseTargets = process.argv.includes("--reverse");
  const exact = measureExactStrata(context, reverseTargets);
  const firstP2 = profiles[0];
  if (firstP2 === undefined) throw new Error("missing first P2 profile");
  const validation = validateAgainstEngine(context, firstP2, firstNode);
  const sample = measureP2Sample(context, profiles, 100, exact.physicalOnly);
  const deterministic = {
    schema: "phase5-p4-destination-v1",
    scenario: "firstSteps:2",
    horizon: "loop-1/day-1/after-P4",
    targetOrder: reverseTargets ? "reverse" : "forward",
    p2Profiles: profiles.length,
    rawP2P3Edges: profiles.length * 368_640,
    stateDefinitions: {
      physicalOnly: {
        count: exact.physicalOnly,
        fields: [
          "six character locations",
          "six character goodwill/paranoia/intrigue counters",
          "four location intrigue counters",
        ],
        excludes: [
          "mastermind once-per-loop resources",
          "protagonist once-per-loop resources and owners",
          "constant engine fields",
          "public trace",
        ],
        digest: exact.physicalDigest,
      },
      aggregatedRemainingApproximation: {
        count: exact.aggregatedRemaining,
        fields: [
          "physicalOnly",
          "mastermind two once-per-loop resource bits",
          "multiset counts of protagonist spent-card category",
        ],
        loses: [
          "which protagonist jointly owns the remaining once-per-loop cards",
        ],
      },
      ownerSpecificEngineProjection: {
        count: exact.ownerSpecific,
        fields: [
          "physicalOnly",
          "mastermind two once-per-loop resource bits",
          "three per-owner protagonist once-per-loop resource categories",
        ],
      },
    },
    validation,
    p2Sample100: sample,
    strata: exact.strata,
  };
  const deterministicHash = sha256(canonicalStringify(deterministic));
  const manifest = {
    deterministic,
    deterministicHash,
    performance: {
      seconds: Number(process.hrtime.bigint() - started) / 1_000_000_000,
      rssBytes: process.memoryUsage().rss,
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
      targetOrder: deterministic.targetOrder,
      p2Profiles: deterministic.p2Profiles,
      rawP2P3Edges: deterministic.rawP2P3Edges,
      physicalOnly: exact.physicalOnly,
      aggregatedRemainingApproximation: exact.aggregatedRemaining,
      ownerSpecificEngineProjection: exact.ownerSpecific,
      validation,
      p2Sample100: sample,
      seconds: manifest.performance.seconds,
      rssBytes: manifest.performance.rssBytes,
    }, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main();
