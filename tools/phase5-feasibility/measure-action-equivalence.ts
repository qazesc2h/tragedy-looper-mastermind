import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { characterDataOf } from "../../src/data";
import {
  advanceGame,
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
} from "../../src/engine/game";
import { validatePlacement } from "../../src/engine/legal";
import { resolveMove, type MoveCard } from "../../src/engine/movement";
import {
  MASTERMIND_ONCE_PER_LOOP,
  PROTAGONIST_ONCE_PER_LOOP,
} from "../../src/engine/resolve";
import { loadScenarioCatalog } from "../../src/scenario-catalog";
import type {
  ActionCard,
  GameState,
  Location,
  PlacedCard,
  Target,
} from "../../src/types";
import {
  MASTERMIND_HAND,
  PROTAGONIST_HAND,
  protagonistOrder,
} from "../../src/ui/action-cards";
import { canonicalStringify, engineStateKey } from "./canonical-state";

const LOCATIONS: Location[] = ["Hospital", "Shrine", "City", "School"];
const CHARACTER_BITS = 16n;
const LOCATION_BITS = 4n;
const RESOURCE_SHIFT = CHARACTER_BITS * 6n + LOCATION_BITS * 4n;

interface DecisionContext {
  state: GameState;
  characters: string[];
  targets: Target[];
  characterTargetIndexes: Map<string, number>;
  locationTargetIndexes: Map<Location, number>;
}

interface ActionEquivalenceMeasurement {
  id: string;
  loop: number;
  day: number;
  leader: number;
  stateHash: string;
  mastermind: {
    rawActions: number;
    literalSuccessorClasses: number;
    p4ClosedFunctionalClasses: number;
    averageActionsPerFunctionalClass: number;
    maximumClassSize: number;
  };
  protagonist: {
    sampledMastermindActions: number;
    samples: Array<{
      mastermindActionHash: string;
      rawResponses: number;
      p4ClosedClasses: number;
      averageResponsesPerClass: number;
    }>;
    rawResponses: {
      minimum: number;
      median: number;
      maximum: number;
      mean: number;
    };
    p4ClosedClasses: {
      minimum: number;
      median: number;
      maximum: number;
      mean: number;
    };
    averageResponsesPerClass: {
      minimum: number;
      median: number;
      maximum: number;
      mean: number;
    };
  };
  engineValidation: {
    checkedJointActions: number;
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function targetKey(target: Target): string {
  return canonicalStringify(target);
}

function targetIndex(
  context: DecisionContext,
  target: Target,
): number | undefined {
  return target.kind === "character"
    ? context.characterTargetIndexes.get(target.id)
    : context.locationTargetIndexes.get(target.at);
}

function semanticHandCapacities(
  hand: readonly { card: ActionCard }[],
): Map<ActionCard, number> {
  const capacities = new Map<ActionCard, number>();
  for (const { card } of hand) {
    capacities.set(card, (capacities.get(card) ?? 0) + 1);
  }
  return capacities;
}

function availableTargets(state: GameState): Target[] {
  return [
    ...Object.entries(state.loop.board).flatMap(([id, position]) =>
      position.status === "alive"
        ? [{ kind: "character" as const, id }]
        : []
    ),
    ...LOCATIONS.map((at): Target => ({ kind: "location", at })),
  ];
}

function decisionContext(state: GameState): DecisionContext {
  const characters = Object.keys(state.loop.board);
  if (characters.length !== 6) {
    throw new Error("firstSteps:2 action model expects six characters");
  }
  const targets = availableTargets(state);
  return {
    state,
    characters,
    targets,
    characterTargetIndexes: new Map(targets.flatMap((target, index) =>
      target.kind === "character" ? [[target.id, index]] : []
    )),
    locationTargetIndexes: new Map(targets.flatMap((target, index) =>
      target.kind === "location" ? [[target.at, index]] : []
    )),
  };
}

function mastermindCards(state: GameState): ActionCard[] {
  const capacities = semanticHandCapacities(MASTERMIND_HAND);
  return [...capacities.keys()].filter((card) =>
    !MASTERMIND_ONCE_PER_LOOP.has(card) ||
    !state.loop.spentOncePerLoop.mastermind.includes(card)
  );
}

function protagonistCards(state: GameState, owner: 0 | 1 | 2): ActionCard[] {
  const capacities = semanticHandCapacities(PROTAGONIST_HAND);
  return [...capacities.keys()].filter((card) =>
    !PROTAGONIST_ONCE_PER_LOOP.has(card) ||
    !state.loop.spentOncePerLoop.protagonists[owner].includes(card)
  );
}

function targetCombinations(targets: readonly Target[]): Target[][] {
  const result: Target[][] = [];
  for (let first = 0; first < targets.length; first += 1) {
    for (let second = first + 1; second < targets.length; second += 1) {
      for (let third = second + 1; third < targets.length; third += 1) {
        const selected = [targets[first], targets[second], targets[third]];
        if (selected.every((target) => target !== undefined)) {
          result.push(structuredClone(selected as Target[]));
        }
      }
    }
  }
  return result;
}

function mastermindActions(context: DecisionContext): PlacedCard[][] {
  const cards = mastermindCards(context.state);
  const capacities = semanticHandCapacities(MASTERMIND_HAND);
  const result: PlacedCard[][] = [];
  for (const targets of targetCombinations(context.targets)) {
    for (const first of cards) {
      for (const second of cards) {
        for (const third of cards) {
          const selected = [first, second, third];
          const counts = new Map<ActionCard, number>();
          for (const card of selected) {
            counts.set(card, (counts.get(card) ?? 0) + 1);
          }
          if ([...counts].some(([card, count]) =>
            count > (capacities.get(card) ?? 0)
          )) continue;
          const placements = targets.map((target, index): PlacedCard => ({
            owner: "mastermind",
            card: selected[index] ?? first,
            target: structuredClone(target),
          }));
          result.push(placements);
        }
      }
    }
  }
  return result;
}

function protagonistResponses(
  context: DecisionContext,
): Generator<PlacedCard[]> {
  const owners = protagonistOrder(context.state.loop.leader);
  const cards = owners.map((owner) => protagonistCards(context.state, owner));
  const targets = context.targets;
  return (function* (): Generator<PlacedCard[]> {
    for (let firstTarget = 0; firstTarget < targets.length; firstTarget += 1) {
      for (let secondTarget = 0; secondTarget < targets.length; secondTarget += 1) {
        if (secondTarget === firstTarget) continue;
        for (let thirdTarget = 0; thirdTarget < targets.length; thirdTarget += 1) {
          if (thirdTarget === firstTarget || thirdTarget === secondTarget) continue;
          const selectedTargets = [
            targets[firstTarget],
            targets[secondTarget],
            targets[thirdTarget],
          ];
          if (selectedTargets.some((target) => target === undefined)) continue;
          for (const firstCard of cards[0] ?? []) {
            for (const secondCard of cards[1] ?? []) {
              for (const thirdCard of cards[2] ?? []) {
                yield [
                  {
                    owner: owners[0],
                    card: firstCard,
                    target: selectedTargets[0] as Target,
                  },
                  {
                    owner: owners[1],
                    card: secondCard,
                    target: selectedTargets[1] as Target,
                  },
                  {
                    owner: owners[2],
                    card: thirdCard,
                    target: selectedTargets[2] as Target,
                  },
                ];
              }
            }
          }
        }
      }
    }
  })();
}

function placementByTarget(
  placements: readonly PlacedCard[],
): Map<string, PlacedCard> {
  return new Map(placements.map((placement) => [
    targetKey(placement.target),
    placement,
  ]));
}

function movementCards(
  mastermind: ActionCard | undefined,
  protagonist: ActionCard | undefined,
): MoveCard[] {
  return [mastermind, protagonist].flatMap((card): MoveCard[] =>
    card === "moveVertical" || card === "moveHorizontal" ||
      card === "moveDiagonal"
      ? [card]
      : []
  );
}

function localOutcome(
  context: DecisionContext,
  target: Target,
  mastermind?: ActionCard,
  protagonist?: ActionCard,
  intrigueForbidActive = false,
): number {
  if (target.kind === "location") {
    const before = context.state.loop.locIntrigue[target.at];
    const added = (
        mastermind === "intriguePlus1" || mastermind === "intriguePlus2"
      ) && !(intrigueForbidActive && protagonist === "forbidIntrigue")
      ? mastermind === "intriguePlus2" ? 2 : 1
      : 0;
    return before + added;
  }

  const position = context.state.loop.board[target.id];
  const counters = context.state.loop.charCounters[target.id];
  if (position === undefined || counters === undefined) {
    throw new Error(`invalid action target ${target.id}`);
  }
  if (position.status !== "alive") {
    if (mastermind !== undefined || protagonist !== undefined) {
      throw new Error(`action placed on unavailable target ${target.id}`);
    }
    const location = position.status === "absent"
      ? 0
      : LOCATIONS.indexOf(position.at);
    const status = position.status === "dead" ? 1 : 2;
    if (location < 0 || counters.goodwill > 15 ||
      counters.paranoia > 15 || counters.intrigue > 15) {
      throw new Error("action equivalence compact key range exceeded");
    }
    return location | (counters.goodwill << 2) |
      (counters.paranoia << 6) | (counters.intrigue << 10) |
      (status << 14);
  }
  const movement = resolveMove({
    character: target.id,
    from: position.at,
    cards: movementCards(mastermind, protagonist),
    forbidden: protagonist === "forbidMove",
    forbiddenLocations: characterDataOf(target.id).forbiddenLocation,
  });
  const paranoia = mastermind === "forbidParanoia"
    ? counters.paranoia
    : Math.max(
      0,
      counters.paranoia + Number(mastermind === "paranoiaPlus1") +
        Number(protagonist === "paranoiaPlus1") -
        Number(mastermind === "paranoiaMinus1") -
        Number(protagonist === "paranoiaMinus1"),
    );
  const goodwill = counters.goodwill + (mastermind === "forbidGoodwill"
    ? 0
    : protagonist === "goodwillPlus2"
    ? 2
    : protagonist === "goodwillPlus1"
    ? 1
    : 0);
  const intrigue = counters.intrigue + ((
      mastermind === "intriguePlus1" || mastermind === "intriguePlus2"
    ) && !(intrigueForbidActive && protagonist === "forbidIntrigue")
    ? mastermind === "intriguePlus2" ? 2 : 1
    : 0);
  const location = LOCATIONS.indexOf(movement.to);
  if (location < 0 || goodwill > 15 || paranoia > 15 || intrigue > 15) {
    throw new Error("action equivalence compact key range exceeded");
  }
  return location | (goodwill << 2) | (paranoia << 6) | (intrigue << 10);
}

function resourceBits(
  state: GameState,
  mastermind: readonly PlacedCard[],
  protagonists: readonly PlacedCard[],
): bigint {
  let result = 0n;
  const mastermindSpent = (card: ActionCard): boolean =>
    state.loop.spentOncePerLoop.mastermind.includes(card) ||
    mastermind.some((placement) => placement.card === card);
  if (mastermindSpent("moveDiagonal")) result |= 1n;
  if (mastermindSpent("intriguePlus2")) result |= 2n;
  for (let owner = 0; owner < 3; owner += 1) {
    const ownerSpent = (card: ActionCard): boolean =>
      state.loop.spentOncePerLoop.protagonists[
        owner as 0 | 1 | 2
      ].includes(card) || protagonists.some((placement) =>
        placement.owner === owner && placement.card === card
      );
    const shift = 2n + BigInt(owner * 3);
    if (ownerSpent("goodwillPlus2")) result |= 1n << shift;
    if (ownerSpent("paranoiaMinus1")) result |= 1n << (shift + 1n);
    if (ownerSpent("forbidMove")) result |= 1n << (shift + 2n);
  }
  return result;
}

function closedSuccessorKey(
  context: DecisionContext,
  mastermind: readonly PlacedCard[],
  protagonists: readonly PlacedCard[],
): bigint {
  const mastermindByTarget = new Array<ActionCard | undefined>(
    context.targets.length,
  );
  const protagonistByTarget = new Array<ActionCard | undefined>(
    context.targets.length,
  );
  for (const placement of mastermind) {
    const index = targetIndex(context, placement.target);
    if (index === undefined) throw new Error("unknown mastermind target");
    mastermindByTarget[index] = placement.card;
  }
  for (const placement of protagonists) {
    const index = targetIndex(context, placement.target);
    if (index === undefined) throw new Error("unknown protagonist target");
    protagonistByTarget[index] = placement.card;
  }
  const intrigueForbidActive = protagonists.filter(({ card }) =>
    card === "forbidIntrigue"
  ).length === 1;
  let result = 0n;
  let characterOffset = 0n;
  let locationOffset = CHARACTER_BITS * 6n;
  for (const character of context.characters) {
    const target: Target = { kind: "character", id: character };
    const targetIndex = context.characterTargetIndexes.get(character);
    const mastermindCard = targetIndex === undefined
      ? undefined
      : mastermindByTarget[targetIndex];
    const protagonistCard = targetIndex === undefined
      ? undefined
      : protagonistByTarget[targetIndex];
    result |= BigInt(localOutcome(
      context,
      target,
      mastermindCard,
      protagonistCard,
      intrigueForbidActive,
    )) << characterOffset;
    characterOffset += CHARACTER_BITS;
  }
  for (const location of LOCATIONS) {
    const target: Target = { kind: "location", at: location };
    const targetIndex = context.locationTargetIndexes.get(location);
    if (targetIndex === undefined) throw new Error("unknown location target");
    result |= BigInt(localOutcome(
      context,
      target,
      mastermindByTarget[targetIndex],
      protagonistByTarget[targetIndex],
      intrigueForbidActive,
    )) << locationOffset;
    locationOffset += LOCATION_BITS;
  }
  return result |
    (resourceBits(context.state, mastermind, protagonists) << RESOURCE_SHIFT);
}

function encodedResolvedState(state: GameState): bigint {
  return closedSuccessorKey(decisionContext(state), [], []);
}

function mastermindFunctionalSignature(
  context: DecisionContext,
  placements: readonly PlacedCard[],
): string {
  const byTarget = placementByTarget(placements);
  const responseCards = new Set<ActionCard>();
  for (const owner of [0, 1, 2] as const) {
    for (const card of protagonistCards(context.state, owner)) {
      responseCards.add(card);
    }
  }
  const responseOptions: Array<ActionCard | undefined> = [
    undefined,
    ...responseCards,
  ];
  return canonicalStringify({
    mastermindResources: Number(
      resourceBits(context.state, placements, []) & 3n,
    ),
    targets: context.targets.map((target) => ({
      target,
      outcomes: responseOptions.map((protagonist) => ({
        protagonist: protagonist ?? null,
        inactive: localOutcome(
          context,
          target,
          byTarget.get(targetKey(target))?.card,
          protagonist,
          false,
        ),
        active: localOutcome(
          context,
          target,
          byTarget.get(targetKey(target))?.card,
          protagonist,
          true,
        ),
      })),
    })),
  });
}

function summary(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const median = sorted.length === 0
    ? 0
    : sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
  return {
    minimum: sorted[0] ?? 0,
    median,
    maximum: sorted.at(-1) ?? 0,
    mean: sorted.length === 0
      ? 0
      : sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

function applyJointAction(
  state: GameState,
  mastermind: readonly PlacedCard[],
  protagonists: readonly PlacedCard[],
  deferSettlement: boolean,
): GameState {
  const result = structuredClone(state);
  for (const placement of mastermind) {
    const legal = validatePlacement(result, placement);
    if (!legal.ok) throw new Error(legal.reason ?? "illegal mastermind action");
    result.loop.placed.push(structuredClone(placement));
  }
  advanceGame(result, undefined, { deferSettlement: true });
  for (const placement of protagonists) {
    const legal = validatePlacement(result, placement);
    if (!legal.ok) throw new Error(legal.reason ?? "illegal protagonist response");
    result.loop.placed.push(structuredClone(placement));
  }
  advanceGame(result, undefined, { deferSettlement: true });
  advanceGame(result, undefined, { deferSettlement });
  if (
    result.gamePhase === "ROUND" &&
    result.loop.phase === "P4_RESOLVE" &&
    result.loop.actionResolutionComplete
  ) advanceGame(result, undefined, { deferSettlement });
  return result;
}

function advancePassPathToNextDay(state: GameState): GameState | undefined {
  const result = structuredClone(state);
  const startingDay = result.loop.day;
  let guard = 0;
  while (
    result.gamePhase === "ROUND" &&
    result.loop.day === startingDay &&
    result.pendingLoopEnd === undefined &&
    guard < 12
  ) {
    advanceGame(result);
    guard += 1;
  }
  return result.gamePhase === "ROUND" &&
      result.loop.day === startingDay + 1 &&
      result.loop.phase === "P2_MASTERMIND_ACTION"
    ? result
    : undefined;
}

function deterministicResponse(
  context: DecisionContext,
  seed: string,
): PlacedCard[] {
  const owners = protagonistOrder(context.state.loop.leader);
  const bytes = Buffer.from(seed, "hex");
  const available = [...context.targets];
  const result: PlacedCard[] = [];
  owners.forEach((owner, index) => {
    const targetIndex = (bytes[index] ?? index) % available.length;
    const [target] = available.splice(targetIndex, 1);
    const cards = protagonistCards(context.state, owner);
    const card = cards[(bytes[index + 3] ?? index) % cards.length];
    if (target === undefined || card === undefined) {
      throw new Error("cannot build deterministic response");
    }
    result.push({ owner, card, target: structuredClone(target) });
  });
  return result;
}

function representativeStates(initial: GameState): GameState[] {
  const initialContext = decisionContext(initial);
  const candidates = mastermindActions(initialContext)
    .map((placements) => ({
      placements,
      hash: sha256(canonicalStringify(placements)),
    }))
    .sort((left, right) => left.hash.localeCompare(right.hash));
  const states = [structuredClone(initial)];
  const seen = new Set([sha256(engineStateKey(initial))]);
  for (const candidate of candidates) {
    const response = deterministicResponse(initialContext, candidate.hash);
    const afterP4 = applyJointAction(
      initial,
      candidate.placements,
      response,
      false,
    );
    const nextDay = advancePassPathToNextDay(afterP4);
    if (nextDay === undefined) continue;
    const hash = sha256(engineStateKey(nextDay));
    if (seen.has(hash)) continue;
    seen.add(hash);
    states.push(nextDay);
    if (states.length === 10) break;
  }
  if (states.length !== 10) {
    throw new Error(`expected 10 representative states, got ${states.length}`);
  }
  return states;
}

function measureState(
  state: GameState,
  index: number,
): ActionEquivalenceMeasurement {
  const context = decisionContext(state);
  const mastermindProfiles = mastermindActions(context);
  const classSizes = new Map<string, number>();
  for (const placements of mastermindProfiles) {
    const signature = mastermindFunctionalSignature(context, placements);
    classSizes.set(signature, (classSizes.get(signature) ?? 0) + 1);
  }
  const sampledMastermind = mastermindProfiles
    .map((placements) => ({
      placements,
      hash: sha256(canonicalStringify(placements)),
    }))
    .sort((left, right) => left.hash.localeCompare(right.hash))
    .slice(0, 10);
  const rawResponses: number[] = [];
  const closedClasses: number[] = [];
  const compression: number[] = [];
  const protagonistSamples: ActionEquivalenceMeasurement["protagonist"]["samples"] = [];
  let checkedJointActions = 0;
  for (const sample of sampledMastermind) {
    const outcomes = new Set<bigint>();
    let raw = 0;
    for (const response of protagonistResponses(context)) {
      const predicted = closedSuccessorKey(
        context,
        sample.placements,
        response,
      );
      outcomes.add(predicted);
      if (checkedJointActions < 100) {
        const actual = applyJointAction(
          state,
          sample.placements,
          response,
          true,
        );
        if (encodedResolvedState(actual) !== predicted) {
          throw new Error(`engine mismatch in representative state ${index}`);
        }
        checkedJointActions += 1;
      }
      raw += 1;
    }
    rawResponses.push(raw);
    closedClasses.push(outcomes.size);
    compression.push(outcomes.size === 0 ? 0 : raw / outcomes.size);
    protagonistSamples.push({
      mastermindActionHash: sample.hash,
      rawResponses: raw,
      p4ClosedClasses: outcomes.size,
      averageResponsesPerClass: outcomes.size === 0 ? 0 : raw / outcomes.size,
    });
  }
  return {
    id: index === 0 ? "loop1-day1-initial" : `loop1-day2-sample-${index}`,
    loop: state.loop.loop,
    day: state.loop.day,
    leader: state.loop.leader,
    stateHash: sha256(engineStateKey(state)),
    mastermind: {
      rawActions: mastermindProfiles.length,
      literalSuccessorClasses: mastermindProfiles.length,
      p4ClosedFunctionalClasses: classSizes.size,
      averageActionsPerFunctionalClass:
        mastermindProfiles.length / classSizes.size,
      maximumClassSize: Math.max(...classSizes.values()),
    },
    protagonist: {
      sampledMastermindActions: sampledMastermind.length,
      samples: protagonistSamples,
      rawResponses: summary(rawResponses),
      p4ClosedClasses: summary(closedClasses),
      averageResponsesPerClass: summary(compression),
    },
    engineValidation: { checkedJointActions },
  };
}

function main(): void {
  const [outputDirectory] = process.argv.slice(2);
  if (outputDirectory === undefined) {
    throw new Error(
      "usage: vite-node measure-action-equivalence.ts OUTPUT_DIR",
    );
  }
  mkdirSync(outputDirectory, { recursive: true });
  const entry = loadScenarioCatalog().find(({ id }) => id === "firstSteps:2");
  if (entry === undefined) throw new Error("missing firstSteps:2");
  const initial = createGameState(structuredClone(entry.scenario));
  chooseInitialLeader(initial, 0);
  continueFromTimeGap(initial);
  const started = process.hrtime.bigint();
  const measurements = representativeStates(initial).map(measureState);
  const deterministic = {
    schema: "phase5-action-equivalence-v1",
    scenario: "firstSteps:2",
    equivalence: {
      literal:
        "canonical immediate successor, including unresolved placements",
      p4ClosedMastermind:
        "same P4 successor for every legal protagonist response",
      p4ClosedProtagonist:
        "same P4 successor for one fixed mastermind action",
    },
    representativeSelection: {
      initial: "loop 1 day 1 root",
      day2:
        "lowest SHA-256 P2 profiles, SHA-derived legal P3 response, pass optional P5/P6/P9 choices, first nine unique surviving engine states",
    },
    measurements,
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
      measurements,
      performance: manifest.performance,
    }, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main();
