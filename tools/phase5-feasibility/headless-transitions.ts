import {
  goodwillResponseAvailability,
  resolveGoodwillAbility,
  type GoodwillDeclaration,
  type GoodwillResponse,
  type GoodwillUse,
} from "../../src/engine/goodwill";
import { advanceGame } from "../../src/engine/game";
import { incidentFires } from "../../src/engine/incident";
import { validatePlacement } from "../../src/engine/legal";
import { distanceToLoss, setOptionalLossActivation } from "../../src/engine/loss";
import { applyHookEffect, collectHooks } from "../../src/engine/phases";
import { withDeathBatch } from "../../src/engine/death";
import {
  isCharacterAlive,
  LOCATIONS,
  type CharacterId,
  type GameState,
  type Hook,
  type IncidentChoice,
  type IncidentCounter,
  type IncidentResult,
  type Location,
  type Phase,
  type PlacedCard,
  type Target,
} from "../../src/types";
import {
  MASTERMIND_HAND,
  PROTAGONIST_HAND,
  handCardIsPlaced,
  nextProtagonist,
  placementsForOwner,
} from "../../src/ui/action-cards";
import {
  aiIncidentChoiceFields,
  goodwillAbilityViews,
  subplotRevealOptions,
  type GoodwillAbilityView,
  type GoodwillChoice,
  type AiIncidentChoiceField,
} from "../../src/ui/goodwill-abilities";
import { canonicalStringify } from "./canonical-state";
import {
  PublicEventCollector,
  canonicalizePublicEventTrace,
  type PublicEvent,
} from "./public-events";

export interface HeadlessNode {
  state: GameState;
  publicTrace: PublicEvent[];
}

export interface OptionalHookChoice {
  hookId: string;
  self: CharacterId;
  target?: Target;
}

export type HeadlessAction =
  | { kind: "P2_PROFILE"; placements: PlacedCard[] }
  | { kind: "P3_PROFILE"; placements: PlacedCard[] }
  | { kind: "P4_RESOLVE"; placements: PlacedCard[] }
  | { kind: "P5_SEQUENCE"; hooks: OptionalHookChoice[] }
  | { kind: "P6_SEQUENCE"; uses: GoodwillUse[] }
  | {
    kind: "P7_INCIDENT";
    choice?: IncidentChoice;
    result: IncidentResult;
  }
  | {
    kind: "P9_SEQUENCE";
    mandatoryResolved: boolean;
    hooks: OptionalHookChoice[];
    optionalLossKey?: string;
  };

export interface HeadlessTransition {
  action: HeadlessAction;
  node: HeadlessNode;
}

export function headlessNode(
  state: GameState,
  publicTrace: readonly PublicEvent[] = [],
): HeadlessNode {
  return {
    state: structuredClone(state),
    publicTrace: canonicalizePublicEventTrace(publicTrace),
  };
}

function cloneNode(node: HeadlessNode): HeadlessNode {
  return headlessNode(node.state, node.publicTrace);
}

function allTargets(state: GameState): Target[] {
  return [
    ...Object.keys(state.loop.board).map(
      (id): Target => ({ kind: "character", id }),
    ),
    ...LOCATIONS.map((at): Target => ({ kind: "location", at })),
  ];
}

function assertRoundPhase(state: GameState, phase: Phase): void {
  if (state.gamePhase !== "ROUND" || state.loop.phase !== phase) {
    throw new Error(
      `headless ${phase} enumerator received ${state.gamePhase}/${state.loop.phase}`,
    );
  }
}

/** P2의 순서 없는 완성 3장 프로필을 스트리밍한다. */
export function* enumerateP2Transitions(
  input: HeadlessNode,
): Generator<HeadlessTransition> {
  assertRoundPhase(input.state, "P2_MASTERMIND_ACTION");
  if (placementsForOwner(input.state, "mastermind").length > 3) {
    throw new Error("P2 has more than three mastermind placements");
  }
  yield* enumerateP2Placements(cloneNode(input));
}

function* enumerateP2Placements(
  node: HeadlessNode,
  minimumPlacementKey?: string,
): Generator<HeadlessTransition> {
  const currentCount = placementsForOwner(node.state, "mastermind").length;
  if (currentCount === 3) {
    const completed = cloneNode(node);
    const placements = placementsForOwner(completed.state, "mastermind")
      .map((placement) => structuredClone(placement))
      .sort((left, right) => canonicalStringify(left).localeCompare(
        canonicalStringify(right),
      ));
    completed.state.loop.placed = placements;
    const collector = new PublicEventCollector(completed.publicTrace);
    collector.recordFaceDownPlacements(completed.state, placements);
    completed.publicTrace = collector.trace;
    advanceGame(completed.state, undefined, { deferSettlement: true });
    yield {
      action: {
        kind: "P2_PROFILE",
        placements: structuredClone(placements),
      },
      node: completed,
    };
    return;
  }

  const seenCardsAtThisDepth = new Set<string>();
  for (let handIndex = 0; handIndex < MASTERMIND_HAND.length; handIndex += 1) {
    const handCard = MASTERMIND_HAND[handIndex];
    if (handCard === undefined) continue;
    if (
      seenCardsAtThisDepth.has(handCard.card) ||
      handCardIsPlaced(
        node.state,
        "mastermind",
        MASTERMIND_HAND,
        handIndex,
      )
    ) continue;
    seenCardsAtThisDepth.add(handCard.card);

    for (const target of allTargets(node.state)) {
      const placement: PlacedCard = {
        owner: "mastermind",
        card: handCard.card,
        target,
      };
      const placementKey = canonicalStringify(placement);
      if (
        minimumPlacementKey !== undefined &&
        placementKey <= minimumPlacementKey
      ) continue;
      if (!validatePlacement(node.state, placement).ok) continue;
      const next = cloneNode(node);
      const legal = validatePlacement(next.state, placement);
      if (!legal.ok) {
        throw new Error(legal.reason ?? "P2 placement became illegal after clone");
      }
      next.state.loop.placed.push(structuredClone(placement));
      yield* enumerateP2Placements(next, placementKey);
    }
  }
}

/** P3의 리더 순서 3장 프로필을 순서대로 스트리밍한다. */
export function* enumerateP3Transitions(
  input: HeadlessNode,
): Generator<HeadlessTransition> {
  assertRoundPhase(input.state, "P3_PROTAGONIST_ACTION");
  if (placementsForOwner(input.state, "mastermind").length !== 3) {
    throw new Error("P3 requires exactly three mastermind placements");
  }
  yield* enumerateP3Placements(cloneNode(input));
}

function* enumerateP3Placements(
  node: HeadlessNode,
): Generator<HeadlessTransition> {
  const owner = nextProtagonist(node.state);
  if (owner === undefined) {
    const completed = cloneNode(node);
    const protagonistPlacements = completed.state.loop.placed
      .filter((placement) => placement.owner !== "mastermind")
      .map((placement) => structuredClone(placement))
      .sort((left, right) => canonicalStringify(left).localeCompare(
        canonicalStringify(right),
      ));
    completed.state.loop.placed = [
      ...completed.state.loop.placed.filter(
        (placement) => placement.owner === "mastermind",
      ),
      ...protagonistPlacements,
    ];
    const collector = new PublicEventCollector(completed.publicTrace);
    collector.recordFaceDownPlacements(completed.state, protagonistPlacements);
    completed.publicTrace = collector.trace;
    advanceGame(completed.state, undefined, { deferSettlement: true });
    yield {
      action: {
        kind: "P3_PROFILE",
        placements: structuredClone(protagonistPlacements),
      },
      node: completed,
    };
    return;
  }

  for (let handIndex = 0; handIndex < PROTAGONIST_HAND.length; handIndex += 1) {
    const handCard = PROTAGONIST_HAND[handIndex];
    if (handCard === undefined) continue;
    if (handCardIsPlaced(node.state, owner, PROTAGONIST_HAND, handIndex)) {
      continue;
    }
    for (const target of allTargets(node.state)) {
      const placement: PlacedCard = { owner, card: handCard.card, target };
      if (!validatePlacement(node.state, placement).ok) continue;
      const next = cloneNode(node);
      const legal = validatePlacement(next.state, placement);
      if (!legal.ok) {
        throw new Error(legal.reason ?? "P3 placement became illegal after clone");
      }
      next.state.loop.placed.push(structuredClone(placement));
      yield* enumerateP3Placements(next);
    }
  }
}

/** P4의 공개·행동 해결과 P5 진입을 실제 엔진 두 입력으로 완료한다. */
export function resolveP4Transition(input: HeadlessNode): HeadlessTransition {
  assertRoundPhase(input.state, "P4_RESOLVE");
  const next = cloneNode(input);
  const placements = structuredClone(next.state.loop.placed);
  const collector = new PublicEventCollector(next.publicTrace);
  collector.recordCardsRevealed(next.state, placements);

  const beforeResolution = structuredClone(next.state);
  advanceGame(next.state, undefined, { deferSettlement: true });
  collector.recordStateDelta(
    beforeResolution,
    next.state,
    "public",
    "P4_RESOLVE",
  );
  if (
    next.state.gamePhase === "ROUND" &&
    next.state.loop.phase === "P4_RESOLVE" &&
    next.state.loop.actionResolutionComplete
  ) {
    advanceGame(next.state, undefined, { deferSettlement: true });
  }
  next.publicTrace = collector.trace;
  return {
    action: { kind: "P4_RESOLVE", placements },
    node: next,
  };
}

interface AvailableHook {
  id: string;
  self: CharacterId;
  hook: Hook;
}

function hookId(phase: Phase, self: CharacterId, hook: Hook): string {
  return canonicalStringify({
    phase,
    self,
    kind: hook.kind,
    source: hook.source,
  });
}

function optionalHooks(
  state: GameState,
  phase: "P5_MASTERMIND_ABILITY" | "P9_ROUND_END",
  used: ReadonlySet<string>,
): AvailableHook[] {
  return collectHooks(state, phase).flatMap(({ self, hook }) => {
    if (hook.kind !== "optional" || !hook.when(state, self)) return [];
    // UI는 시간 여행자의 같은 선택을 optional loss 컨트롤 한 곳에서만 받는다.
    if (phase === "P9_ROUND_END" && hook.source.description === "Loop ends") {
      return [];
    }
    const id = hookId(phase, self, hook);
    return used.has(id) ? [] : [{ id, self, hook }];
  });
}

function hookTargets(state: GameState, entry: AvailableHook): Array<Target | undefined> {
  if (entry.hook.selectableTargets === undefined) return [undefined];
  return entry.hook.selectableTargets(state, entry.self);
}

function applyOptionalHook(
  node: HeadlessNode,
  phase: "P5_MASTERMIND_ABILITY" | "P9_ROUND_END",
  entry: AvailableHook,
  target: Target | undefined,
): HeadlessNode {
  const next = cloneNode(node);
  const before = structuredClone(next.state);
  withDeathBatch(next.state, () => {
    applyHookEffect(
      next.state,
      phase,
      entry.hook,
      entry.self,
      target,
      undefined,
      phase === "P5_MASTERMIND_ABILITY",
    );
  });
  const collector = new PublicEventCollector(next.publicTrace);
  collector.recordStateDelta(before, next.state, "public-cause-masked", phase);
  next.publicTrace = collector.trace;
  return next;
}

function advanceChoicePhase(
  node: HeadlessNode,
  visibility: "public" | "public-cause-masked",
): HeadlessNode {
  const next = cloneNode(node);
  const before = structuredClone(next.state);
  advanceGame(next.state, undefined, { deferSettlement: true });
  const collector = new PublicEventCollector(next.publicTrace);
  collector.recordStateDelta(before, next.state, visibility, before.loop.phase);
  next.publicTrace = collector.trace;
  return next;
}

/** P5 선택 훅의 미발동, 대상, 발동 순서를 모두 스트리밍한다. */
export function* enumerateP5Transitions(
  input: HeadlessNode,
): Generator<HeadlessTransition> {
  assertRoundPhase(input.state, "P5_MASTERMIND_ABILITY");
  yield* enumerateP5Hooks(cloneNode(input), new Set(), []);
}

function* enumerateP5Hooks(
  node: HeadlessNode,
  used: ReadonlySet<string>,
  choices: readonly OptionalHookChoice[],
): Generator<HeadlessTransition> {
  yield {
    action: { kind: "P5_SEQUENCE", hooks: structuredClone([...choices]) },
    node: advanceChoicePhase(node, "public-cause-masked"),
  };

  if (
    node.state.pendingLoopEnd !== undefined ||
    (node.state.loop.pendingImmediateLossKeys?.length ?? 0) > 0
  ) return;

  for (const entry of optionalHooks(
    node.state,
    "P5_MASTERMIND_ABILITY",
    used,
  )) {
    for (const target of hookTargets(node.state, entry)) {
      const next = applyOptionalHook(
        node,
        "P5_MASTERMIND_ABILITY",
        entry,
        target,
      );
      const nextUsed = new Set(used);
      nextUsed.add(entry.id);
      yield* enumerateP5Hooks(next, nextUsed, [
        ...choices,
        {
          hookId: entry.id,
          self: entry.self,
          ...(target === undefined ? {} : { target: structuredClone(target) }),
        },
      ]);
    }
  }
}

function* incidentChoicesForFields(
  state: GameState,
  fields: readonly AiIncidentChoiceField[],
  index = 0,
  choice: IncidentChoice = {},
): Generator<IncidentChoice | undefined> {
  if (index === fields.length) {
    yield Object.keys(choice).length === 0 ? undefined : structuredClone(choice);
    return;
  }
  const field = fields[index];
  if (field === undefined) return;
  let values: readonly (string | undefined)[];
  if (field === "location") {
    values = [undefined, ...LOCATIONS];
  } else if (field === "counter") {
    values = [undefined, "goodwill", "paranoia", "intrigue"];
  } else {
    values = [
      undefined,
      ...Object.entries(state.loop.board).flatMap(([character, position]) =>
        isCharacterAlive(position) ? [character] : []
      ),
    ];
  }

  for (const value of values) {
    const next = structuredClone(choice);
    if (value !== undefined) {
      if (field === "location") next.location = value as Location;
      else if (field === "counter") next.counter = value as IncidentCounter;
      else if (field === "target") next.target = value;
      else next.otherTarget = value;
    }
    yield* incidentChoicesForFields(state, fields, index + 1, next);
  }
}

function* goodwillChoiceDeclarations(
  state: GameState,
  view: GoodwillAbilityView,
  target: Target | undefined,
): Generator<GoodwillDeclaration> {
  const base: GoodwillDeclaration = {
    user: view.character,
    rank: view.schema.rank,
    abilityIndex: view.abilityIndex,
    ...(target === undefined ? {} : { target: structuredClone(target) }),
  };
  const choice: GoodwillChoice = view.choice;
  switch (choice.kind) {
    case "none":
      yield base;
      return;
    case "paranoiaDelta":
      for (const paranoiaDelta of choice.options) {
        yield { ...base, paranoiaDelta };
      }
      return;
    case "spentCard":
      for (const card of choice.options) yield { ...base, card };
      return;
    case "incident":
    case "pastIncident":
      for (const incident of choice.options) {
        if (view.character !== "ai") {
          yield { ...base, incident: structuredClone(incident) };
          continue;
        }
        const fields = aiIncidentChoiceFields(incident.incident);
        for (const incidentChoice of incidentChoicesForFields(state, fields)) {
          yield {
            ...base,
            incident: structuredClone(incident),
            ...(incidentChoice === undefined ? {} : { incidentChoice }),
          };
        }
      }
      return;
    case "subplot":
      for (const declaredSubplot of choice.options) {
        for (const revealedSubplot of subplotRevealOptions(
          choice,
          declaredSubplot,
        )) {
          yield { ...base, declaredSubplot, revealedSubplot };
        }
      }
      return;
    case "counter":
      throw new Error(
        `enabled goodwill view ${view.key} has no GoodwillDeclaration counter field`,
      );
  }
}

function* goodwillDeclarations(state: GameState): Generator<{
  declaration: GoodwillDeclaration;
  responses: GoodwillResponse[];
}> {
  const seen = new Set<string>();
  for (const view of goodwillAbilityViews(state)) {
    if (view.disabledReason !== undefined) continue;
    const targets: Array<Target | undefined> = view.targetRequired
      ? [...view.targets]
      : [undefined];
    const availability = goodwillResponseAvailability(
      state,
      view.character,
      view.schema.immuneToGoodwillRefusel ?? false,
    );
    const responses: GoodwillResponse[] = [
      ...(availability.resolveAllowed ? ["resolve" as const] : []),
      ...(availability.refuseAllowed ? ["refuse" as const] : []),
    ];
    for (const target of targets) {
      for (const declaration of goodwillChoiceDeclarations(state, view, target)) {
        const key = canonicalStringify(declaration);
        if (seen.has(key)) continue;
        seen.add(key);
        yield { declaration, responses };
      }
    }
  }
}

/** P6의 선언 순서, 선언 필드, 해결/거부와 더 이상 선언하지 않기를 모두 열거한다. */
export function* enumerateP6Transitions(
  input: HeadlessNode,
): Generator<HeadlessTransition> {
  assertRoundPhase(input.state, "P6_GOODWILL");
  yield* enumerateP6Uses(cloneNode(input), []);
}

function* enumerateP6Uses(
  node: HeadlessNode,
  uses: readonly GoodwillUse[],
): Generator<HeadlessTransition> {
  yield {
    action: { kind: "P6_SEQUENCE", uses: structuredClone([...uses]) },
    node: advanceChoicePhase(node, "public"),
  };

  if (
    node.state.pendingLoopEnd !== undefined ||
    (node.state.loop.pendingImmediateLossKeys?.length ?? 0) > 0
  ) return;

  for (const { declaration, responses } of goodwillDeclarations(node.state)) {
    for (const mastermindResponse of responses) {
      const next = cloneNode(node);
      const before = structuredClone(next.state);
      const collector = new PublicEventCollector(next.publicTrace);
      collector.recordGoodwillDeclaration(next.state, declaration);
      try {
        resolveGoodwillAbility(next.state, declaration, mastermindResponse);
      } catch {
        continue;
      }
      collector.recordStateDelta(before, next.state, "public", "P6_GOODWILL");
      next.publicTrace = collector.trace;
      yield* enumerateP6Uses(next, [
        ...uses,
        { ...structuredClone(declaration), mastermindResponse },
      ]);
    }
  }
}

/** P7 사건 선택 필드의 유효한 조합만 실제 advanceGame 결과로 스트리밍한다. */
export function* enumerateP7Transitions(
  input: HeadlessNode,
): Generator<HeadlessTransition> {
  assertRoundPhase(input.state, "P7_INCIDENT");
  const scheduled = input.state.scenario.incidents.find(
    ({ day }) => day === input.state.loop.day,
  );
  const fields = scheduled === undefined ||
      !incidentFires(input.state, scheduled.culprit)
    ? []
    : aiIncidentChoiceFields(scheduled.incident);
  const seen = new Set<string>();
  for (const choice of incidentChoicesForFields(input.state, fields)) {
    const choiceKey = canonicalStringify(choice ?? null);
    if (seen.has(choiceKey)) continue;
    seen.add(choiceKey);
    const next = cloneNode(input);
    const before = structuredClone(next.state);
    let result: IncidentResult | undefined;
    try {
      result = advanceGame(next.state, choice, { deferSettlement: true });
    } catch {
      continue;
    }
    if (result === undefined) {
      throw new Error("P7 actual engine transition returned no incident result");
    }
    const collector = new PublicEventCollector(next.publicTrace);
    if (scheduled !== undefined) {
      collector.recordIncidentOutcome(before, scheduled.incident, result.fired);
    }
    collector.recordStateDelta(before, next.state, "public", "P7_INCIDENT");
    next.publicTrace = collector.trace;
    yield {
      action: {
        kind: "P7_INCIDENT",
        ...(choice === undefined ? {} : { choice: structuredClone(choice) }),
        result: structuredClone(result),
      },
      node: next,
    };
  }
}

/** P9 강제 묶음 뒤 선택 훅 순서와 선택 패배 조건을 모두 스트리밍한다. */
export function* enumerateP9Transitions(
  input: HeadlessNode,
): Generator<HeadlessTransition> {
  assertRoundPhase(input.state, "P9_ROUND_END");
  let prepared = cloneNode(input);
  let mandatoryResolved = false;
  if (!prepared.state.loop.roundEndMandatoryResolved) {
    const before = structuredClone(prepared.state);
    advanceGame(prepared.state, undefined, { deferSettlement: true });
    const collector = new PublicEventCollector(prepared.publicTrace);
    collector.recordStateDelta(
      before,
      prepared.state,
      "public-cause-masked",
      "P9_ROUND_END",
    );
    prepared.publicTrace = collector.trace;
    mandatoryResolved = true;
    if (
      prepared.state.gamePhase !== "ROUND" ||
      prepared.state.loop.phase !== "P9_ROUND_END" ||
      !prepared.state.loop.roundEndMandatoryResolved ||
      prepared.state.pendingLoopEnd !== undefined ||
      (prepared.state.loop.pendingImmediateLossKeys?.length ?? 0) > 0
    ) {
      yield {
        action: {
          kind: "P9_SEQUENCE",
          mandatoryResolved,
          hooks: [],
        },
        node: prepared,
      };
      return;
    }
  }
  yield* enumerateP9Choices(prepared, new Set(), [], mandatoryResolved);
}

function* enumerateP9Choices(
  node: HeadlessNode,
  used: ReadonlySet<string>,
  choices: readonly OptionalHookChoice[],
  mandatoryResolved: boolean,
): Generator<HeadlessTransition> {
  yield {
    action: {
      kind: "P9_SEQUENCE",
      mandatoryResolved,
      hooks: structuredClone([...choices]),
    },
    node: advanceChoicePhase(node, "public-cause-masked"),
  };

  if (
    node.state.pendingLoopEnd !== undefined ||
    (node.state.loop.pendingImmediateLossKeys?.length ?? 0) > 0
  ) return;

  for (const entry of optionalHooks(node.state, "P9_ROUND_END", used)) {
    for (const target of hookTargets(node.state, entry)) {
      const next = applyOptionalHook(node, "P9_ROUND_END", entry, target);
      const nextUsed = new Set(used);
      nextUsed.add(entry.id);
      yield* enumerateP9Choices(next, nextUsed, [
        ...choices,
        {
          hookId: entry.id,
          self: entry.self,
          ...(target === undefined ? {} : { target: structuredClone(target) }),
        },
      ], mandatoryResolved);
    }
  }

  for (const condition of distanceToLoss(node.state)) {
    if (
      condition.activation !== "optional" ||
      !condition.met ||
      condition.blockedBy !== undefined
    ) continue;
    const next = cloneNode(node);
    const before = structuredClone(next.state);
    try {
      setOptionalLossActivation(next.state, condition.key, true);
    } catch {
      continue;
    }
    const collector = new PublicEventCollector(next.publicTrace);
    collector.recordStateDelta(
      before,
      next.state,
      "public-cause-masked",
      "P9_ROUND_END",
    );
    next.publicTrace = collector.trace;
    yield {
      action: {
        kind: "P9_SEQUENCE",
        mandatoryResolved,
        hooks: structuredClone([...choices]),
        optionalLossKey: condition.key,
      },
      node: advanceChoicePhase(next, "public-cause-masked"),
    };
  }
}

/** 현재 선택 단계에 맞는 스트리밍 열거기를 고른다. */
export function enumerateHeadlessTransitions(
  input: HeadlessNode,
): Generator<HeadlessTransition> {
  switch (input.state.loop.phase) {
    case "P2_MASTERMIND_ACTION": return enumerateP2Transitions(input);
    case "P3_PROTAGONIST_ACTION": return enumerateP3Transitions(input);
    case "P5_MASTERMIND_ABILITY": return enumerateP5Transitions(input);
    case "P6_GOODWILL": return enumerateP6Transitions(input);
    case "P7_INCIDENT": return enumerateP7Transitions(input);
    case "P9_ROUND_END": return enumerateP9Transitions(input);
    default:
      throw new Error(`phase ${input.state.loop.phase} is not a choice gate`);
  }
}
