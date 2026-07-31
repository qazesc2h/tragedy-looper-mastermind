import { characterDataOf } from "../data";
import {
  type ActionCard,
  type CharacterId,
  type GameState,
  type PlacedCard,
  type Target,
} from "../types";
import {
  intrigueForbidActive,
  isMoveCard,
  resolveMove,
  type MoveCard,
} from "./movement";

const PROTAGONIST_ONCE_PER_LOOP: ReadonlySet<ActionCard> = new Set([
  "goodwillPlus2",
  "paranoiaMinus1",
  "forbidMove",
]);

const MASTERMIND_ONCE_PER_LOOP: ReadonlySet<ActionCard> = new Set([
  "moveDiagonal",
  "intriguePlus2",
]);

function targetKey(target: Target): string {
  return target.kind === "character"
    ? `character:${target.id}`
    : `location:${target.at}`;
}

function characterCounters(state: GameState, character: CharacterId) {
  const counters = state.loop.charCounters[character];
  if (!counters) {
    throw new Error(`cannot resolve a card for unknown character "${character}"`);
  }
  return counters;
}

function resolveMovement(
  state: GameState,
  placed: readonly PlacedCard[],
): void {
  const cardsByCharacter = new Map<CharacterId, MoveCard[]>();
  const forbiddenCharacters = new Set<CharacterId>();

  for (const placedCard of placed) {
    if (placedCard.target.kind !== "character") continue;

    const character = placedCard.target.id;
    if (isMoveCard(placedCard.card)) {
      const cards = cardsByCharacter.get(character) ?? [];
      cards.push(placedCard.card);
      cardsByCharacter.set(character, cards);
    } else if (placedCard.card === "forbidMove") {
      forbiddenCharacters.add(character);
    }
  }

  for (const [character, cards] of cardsByCharacter) {
    const position = state.loop.board[character];
    if (!position) {
      throw new Error(
        `cannot resolve movement for unknown character "${character}"`,
      );
    }

    const result = resolveMove({
      character,
      from: position.at,
      cards,
      forbidden: forbiddenCharacters.has(character),
      forbiddenLocations: [...characterDataOf(character).forbiddenLocation],
    });
    position.at = result.to;
  }
}

function forbiddenTargets(
  placed: readonly PlacedCard[],
  forbidCard: ActionCard,
): Set<string> {
  return new Set(
    placed
      .filter((placedCard) => placedCard.card === forbidCard)
      .map((placedCard) => targetKey(placedCard.target)),
  );
}

function resolveCounterCard(
  state: GameState,
  placedCard: PlacedCard,
  goodwillForbidden: ReadonlySet<string>,
  paranoiaForbidden: ReadonlySet<string>,
  intrigueForbidden: ReadonlySet<string>,
): void {
  const key = targetKey(placedCard.target);

  switch (placedCard.card) {
    case "goodwillPlus1":
    case "goodwillPlus2": {
      if (
        placedCard.target.kind !== "character" ||
        goodwillForbidden.has(key)
      ) {
        return;
      }
      const amount = placedCard.card === "goodwillPlus1" ? 1 : 2;
      characterCounters(state, placedCard.target.id).goodwill += amount;
      return;
    }

    case "paranoiaPlus1": {
      if (
        placedCard.target.kind !== "character" ||
        paranoiaForbidden.has(key)
      ) {
        return;
      }
      characterCounters(state, placedCard.target.id).paranoia += 1;
      return;
    }

    case "paranoiaMinus1": {
      if (
        placedCard.target.kind !== "character" ||
        paranoiaForbidden.has(key)
      ) {
        return;
      }
      const counters = characterCounters(state, placedCard.target.id);
      counters.paranoia = Math.max(0, counters.paranoia - 1);
      return;
    }

    case "intriguePlus1":
    case "intriguePlus2": {
      if (intrigueForbidden.has(key)) return;
      const amount = placedCard.card === "intriguePlus1" ? 1 : 2;
      if (placedCard.target.kind === "character") {
        characterCounters(state, placedCard.target.id).intrigue += amount;
      } else {
        state.loop.locIntrigue[placedCard.target.at] += amount;
      }
      return;
    }

    default:
      return;
  }
}

function resolveCounters(
  state: GameState,
  placed: readonly PlacedCard[],
): void {
  const goodwillForbidden = forbiddenTargets(placed, "forbidGoodwill");
  const paranoiaForbidden = forbiddenTargets(placed, "forbidParanoia");

  const intrigueForbids = placed.filter(
    (placedCard) => placedCard.card === "forbidIntrigue",
  );
  const intrigueForbidden = intrigueForbidActive(intrigueForbids)
    ? new Set(
        intrigueForbids
          .filter((placedCard) => placedCard.owner !== "mastermind")
          .map((placedCard) => targetKey(placedCard.target)),
      )
    : new Set<string>();

  // 불안+1을 전부 판정한 다음 불안-1을 포함한 나머지 효과를 처리한다.
  for (const placedCard of placed) {
    if (placedCard.card !== "paranoiaPlus1") continue;
    resolveCounterCard(
      state,
      placedCard,
      goodwillForbidden,
      paranoiaForbidden,
      intrigueForbidden,
    );
  }
  for (const placedCard of placed) {
    if (placedCard.card === "paranoiaPlus1") continue;
    resolveCounterCard(
      state,
      placedCard,
      goodwillForbidden,
      paranoiaForbidden,
      intrigueForbidden,
    );
  }
}

function recordSpentCards(
  state: GameState,
  placed: readonly PlacedCard[],
): void {
  for (const placedCard of placed) {
    if (
      placedCard.owner === "mastermind" &&
      MASTERMIND_ONCE_PER_LOOP.has(placedCard.card)
    ) {
      state.loop.spentOncePerLoop.mastermind.push(placedCard.card);
    } else if (
      placedCard.owner !== "mastermind" &&
      PROTAGONIST_ONCE_PER_LOOP.has(placedCard.card)
    ) {
      state.loop.spentOncePerLoop.protagonists[placedCard.owner].push(
        placedCard.card,
      );
    }
  }
}

/** P4 행동 해결: 이동 → 나머지 효과 → 카드 회수 순으로 상태를 갱신한다. */
export function resolveActions(state: GameState): GameState {
  const placed = [...state.loop.placed];

  resolveMovement(state, placed);
  resolveCounters(state, placed);
  recordSpentCards(state, placed);
  state.loop.placed = [];

  return state;
}
