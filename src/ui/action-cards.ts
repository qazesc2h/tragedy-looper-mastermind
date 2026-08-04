import { characterDataOf } from "../data";
import {
  intrigueForbidActive,
  isMoveCard,
  resolveMove,
  type MoveCard,
} from "../engine/movement";
import {
  type ActionCard,
  type GameState,
  type IncidentCounter,
  type Location,
  type Phase,
  type PlacedCard,
  type Target,
} from "../types";

export interface HandCard {
  key: string;
  card: ActionCard;
}

/** 규칙서의 각본가 행동 카드 10장. 불안 +1은 두 장이다. */
export const MASTERMIND_HAND: readonly HandCard[] = [
  { key: "paranoiaPlus1:a", card: "paranoiaPlus1" },
  { key: "paranoiaPlus1:b", card: "paranoiaPlus1" },
  { key: "paranoiaMinus1", card: "paranoiaMinus1" },
  { key: "forbidParanoia", card: "forbidParanoia" },
  { key: "forbidGoodwill", card: "forbidGoodwill" },
  { key: "intriguePlus1", card: "intriguePlus1" },
  { key: "intriguePlus2", card: "intriguePlus2" },
  { key: "moveVertical", card: "moveVertical" },
  { key: "moveHorizontal", card: "moveHorizontal" },
  { key: "moveDiagonal", card: "moveDiagonal" },
];

/** 규칙서의 주인공 행동 카드 8장. */
export const PROTAGONIST_HAND: readonly HandCard[] = [
  { key: "paranoiaPlus1", card: "paranoiaPlus1" },
  { key: "paranoiaMinus1", card: "paranoiaMinus1" },
  { key: "goodwillPlus1", card: "goodwillPlus1" },
  { key: "goodwillPlus2", card: "goodwillPlus2" },
  { key: "forbidIntrigue", card: "forbidIntrigue" },
  { key: "moveVertical", card: "moveVertical" },
  { key: "moveHorizontal", card: "moveHorizontal" },
  { key: "forbidMove", card: "forbidMove" },
];

export type CardOwner = PlacedCard["owner"];

export interface PlacementGroup {
  target: Target;
  placements: PlacedCard[];
}

/** 해결 선언 전에 같은 대상에 놓인 카드를 한 묶음으로 만든다. */
export function groupPlacementsByTarget(
  placed: readonly PlacedCard[],
): PlacementGroup[] {
  const groups = new Map<string, PlacementGroup>();
  for (const placement of placed) {
    const key = placement.target.kind === "character"
      ? `character:${placement.target.id}`
      : `location:${placement.target.at}`;
    const group = groups.get(key);
    if (group) {
      group.placements.push(placement);
    } else {
      groups.set(key, {
        target: structuredClone(placement.target),
        placements: [placement],
      });
    }
  }
  return [...groups.values()];
}

/** 각본가 카드는 항상, 주인공 카드는 P4 공개 뒤에만 이름을 보인다. */
export function placedCardShowsName(
  phase: Phase,
  owner: CardOwner,
  resolved: boolean,
): boolean {
  return owner === "mastermind" || resolved || phase === "P4_RESOLVE";
}

export function placementsForOwner(
  state: GameState,
  owner: CardOwner,
): PlacedCard[] {
  return state.loop.placed.filter((placement) => placement.owner === owner);
}

/** P4 공개 단계에 들어가기 전에는 놓인 카드를 회수할 수 있다. */
export function placedCardCanBeRecalled(
  phase: Phase,
  _placement: PlacedCard,
): boolean {
  return phase === "P2_MASTERMIND_ACTION" ||
    phase === "P3_PROTAGONIST_ACTION";
}

/** UI의 공개 전 회수 동작. 회수할 수 없으면 상태를 바꾸지 않는다. */
export function recallPlacedCard(
  state: GameState,
  placementIndex: number,
): PlacedCard | undefined {
  if (!Number.isInteger(placementIndex)) return undefined;
  const placement = state.loop.placed[placementIndex];
  if (
    placement === undefined ||
    !placedCardCanBeRecalled(state.loop.phase, placement)
  ) {
    return undefined;
  }
  return state.loop.placed.splice(placementIndex, 1)[0];
}

export function protagonistOrder(leader: 0 | 1 | 2): [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] {
  return [
    leader,
    ((leader + 1) % 3) as 0 | 1 | 2,
    ((leader + 2) % 3) as 0 | 1 | 2,
  ];
}

export function nextProtagonist(state: GameState): 0 | 1 | 2 | undefined {
  const ownersWithCards = new Set(
    state.loop.placed
      .filter((placement) => placement.owner !== "mastermind")
      .map((placement) => placement.owner),
  );
  return protagonistOrder(state.loop.leader).find(
    (owner) => !ownersWithCards.has(owner),
  );
}

export function handCardIsPlaced(
  state: GameState,
  owner: CardOwner,
  hand: readonly HandCard[],
  handIndex: number,
): boolean {
  const entry = hand[handIndex];
  if (!entry) return false;
  const earlierCopies = hand.slice(0, handIndex + 1).filter(
    ({ card }) => card === entry.card,
  ).length;
  const placedCopies = placementsForOwner(state, owner).filter(
    ({ card }) => card === entry.card,
  ).length;
  return earlierCopies <= placedCopies;
}

export type ResolutionChange =
  | {
    kind: "movement";
    character: string;
    before: Location;
    after: Location;
  }
  | {
    kind: "characterCounter";
    character: string;
    counter: IncidentCounter;
    before: number;
    after: number;
  }
  | {
    kind: "locationIntrigue";
    location: Location;
    before: number;
    after: number;
  };

export interface ResolutionNoEffect {
  placement: PlacedCard;
  blockedBy?: ActionCard;
  reason?: "forbiddenLocation" | "ineffectiveTarget";
}

export type ResolutionReportItem =
  | {
    audience: "protagonists";
    category: "movement" | "counter";
    change: ResolutionChange;
  }
  | {
    audience: "mastermind";
    category: "noEffect";
    noEffect: ResolutionNoEffect;
  };

export function collectResolutionChanges(
  before: GameState,
  after: GameState,
): ResolutionChange[] {
  const movements: ResolutionChange[] = [];
  const counters: ResolutionChange[] = [];
  for (const character of Object.keys(before.loop.board)) {
    const beforePosition = before.loop.board[character];
    const afterPosition = after.loop.board[character];
    if (beforePosition.at !== afterPosition.at) {
      movements.push({
        kind: "movement",
        character,
        before: beforePosition.at,
        after: afterPosition.at,
      });
    }

    for (const counter of ["goodwill", "paranoia", "intrigue"] as const) {
      const previous = before.loop.charCounters[character][counter];
      const current = after.loop.charCounters[character][counter];
      if (previous !== current) {
        counters.push({
          kind: "characterCounter",
          character,
          counter,
          before: previous,
          after: current,
        });
      }
    }
  }

  for (const location of ["Hospital", "Shrine", "City", "School"] as const) {
    const previous = before.loop.locIntrigue[location];
    const current = after.loop.locIntrigue[location];
    if (previous !== current) {
      counters.push({
        kind: "locationIntrigue",
        location,
        before: previous,
        after: current,
      });
    }
  }
  return [...movements, ...counters];
}

function sameTarget(left: Target, right: Target): boolean {
  return left.kind === right.kind && (
    left.kind === "character"
      ? left.id === (right as { kind: "character"; id: string }).id
      : left.at === (right as { kind: "location"; at: Location }).at
  );
}

function forbidOnTarget(
  placed: readonly PlacedCard[],
  placement: PlacedCard,
  card: ActionCard,
): boolean {
  return placed.some((candidate) =>
    candidate.card === card && sameTarget(candidate.target, placement.target)
  );
}

function intrigueIsIgnored(state: GameState, target: Target): boolean {
  for (const cultist of state.loop.cultistsIgnoringForbidIntrigue ?? []) {
    const location = state.loop.board[cultist]?.at;
    if (location === undefined) continue;
    if (target.kind === "location" && target.at === location) return true;
    if (
      target.kind === "character" &&
      state.loop.board[target.id]?.alive &&
      state.loop.board[target.id].at === location
    ) {
      return true;
    }
  }
  return false;
}

function goodwillIsIgnored(state: GameState, target: Target): boolean {
  return target.kind === "character" &&
    state.loop.timeTravelersIgnoringForbidGoodwill?.includes(target.id) === true;
}

function blockedBy(
  state: GameState,
  placed: readonly PlacedCard[],
  placement: PlacedCard,
): ActionCard | undefined {
  if (
    isMoveCard(placement.card) &&
    forbidOnTarget(placed, placement, "forbidMove")
  ) {
    return "forbidMove";
  }
  if (
    (placement.card === "goodwillPlus1" || placement.card === "goodwillPlus2") &&
    forbidOnTarget(placed, placement, "forbidGoodwill") &&
    !goodwillIsIgnored(state, placement.target)
  ) {
    return "forbidGoodwill";
  }
  if (
    (placement.card === "paranoiaPlus1" || placement.card === "paranoiaMinus1") &&
    forbidOnTarget(placed, placement, "forbidParanoia")
  ) {
    return "forbidParanoia";
  }
  if (
    (placement.card === "intriguePlus1" || placement.card === "intriguePlus2") &&
    intrigueForbidActive(
      placed.filter(({ card }) => card === "forbidIntrigue"),
    ) &&
    forbidOnTarget(placed, placement, "forbidIntrigue") &&
    !intrigueIsIgnored(state, placement.target)
  ) {
    return "forbidIntrigue";
  }
  return undefined;
}

/** 공개된 카드 중 금지 카드 때문에 효과가 없었던 카드를 설명한다. */
export function collectNoEffectCards(
  before: GameState,
  _after: GameState,
  placed: readonly PlacedCard[],
): ResolutionNoEffect[] {
  const noEffects: ResolutionNoEffect[] = [];
  for (const placement of placed) {
    const blocker = blockedBy(before, placed, placement);
    if (blocker) {
      noEffects.push({ placement, blockedBy: blocker });
      continue;
    }

    const needsCharacter = isMoveCard(placement.card) ||
      placement.card === "goodwillPlus1" ||
      placement.card === "goodwillPlus2" ||
      placement.card === "paranoiaPlus1" ||
      placement.card === "paranoiaMinus1";
    if (needsCharacter && placement.target.kind !== "character") {
      noEffects.push({ placement, reason: "ineffectiveTarget" });
    }
  }

  const movementByCharacter = new Map<string, PlacedCard[]>();
  for (const placement of placed) {
    if (placement.target.kind !== "character" || !isMoveCard(placement.card)) {
      continue;
    }
    const movements = movementByCharacter.get(placement.target.id) ?? [];
    movements.push(placement);
    movementByCharacter.set(placement.target.id, movements);
  }

  for (const [character, movements] of movementByCharacter) {
    if (movements.some((placement) =>
      noEffects.some((item) => item.placement === placement)
    )) {
      continue;
    }
    const position = before.loop.board[character];
    const result = resolveMove({
      character,
      from: position.at,
      cards: movements.map(({ card }) => card as MoveCard),
      forbidden: false,
      forbiddenLocations:
        before.loop.locationRestrictionsRemoved?.includes(character)
          ? []
          : [...characterDataOf(character).forbiddenLocation],
    });
    if (result.reason === "forbidden-location") {
      for (const placement of movements) {
        noEffects.push({ placement, reason: "forbiddenLocation" });
      }
    }
  }

  return noEffects;
}

/** 주인공에게 전달할 변동을 먼저, 원인을 숨길 무효 항목을 나중에 둔다. */
export function collectResolutionReport(
  before: GameState,
  after: GameState,
  placed: readonly PlacedCard[],
): ResolutionReportItem[] {
  const publicItems: ResolutionReportItem[] = collectResolutionChanges(
    before,
    after,
  ).map((change) => ({
    audience: "protagonists",
    category: change.kind === "movement" ? "movement" : "counter",
    change,
  }));
  const privateItems: ResolutionReportItem[] = collectNoEffectCards(
    before,
    after,
    placed,
  ).map((noEffect) => ({
    audience: "mastermind",
    category: "noEffect",
    noEffect,
  }));
  return [...publicItems, ...privateItems];
}
