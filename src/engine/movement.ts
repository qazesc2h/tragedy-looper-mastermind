// 이동 해결 — 구현 완료. 규칙이 명확하고 오구현 위험이 가장 높은 지점.
// 근거: 주인공 설명서 42~43p(카드 목록), 각본가 설명서 7p(무녀 예시), FAQ Q2.

import {
  characterLocation,
  isCharacterAlive,
  withCharacterLocation,
  type ActionCard, type CharacterId, type GameState, type Location,
  type PlacedCard,
  VERTICAL, HORIZONTAL, DIAGONAL,
} from "../types";
import { characterDataOf } from "../data";
import { servantServedCharacters } from "./servant";

export type MoveCard = "moveVertical" | "moveHorizontal" | "moveDiagonal";
const MOVE_CARDS: MoveCard[] = ["moveVertical", "moveHorizontal", "moveDiagonal"];

export function isMoveCard(c: ActionCard): c is MoveCard {
  return (MOVE_CARDS as ActionCard[]).includes(c);
}

/**
 * 같은 대상에 겹친 이동 카드를 하나의 순 이동으로 합성한다.
 *
 *   ↑↓ + ←→   = 대각
 *   대각 + ←→  = ↑↓
 *   대각 + ↑↓  = ←→
 *   ↑↓ + ↑↓    = ↑↓ 한 번   ← 두 번 이동시켜 제자리로 두지 않는다
 *
 * 3장 이상 겹치는 경우는 규칙상 발생하지 않는다(각본가 1장 + 주인공 1장이 상한).
 * 방어적으로 좌우 폴드 처리한다.
 */
export function composeMove(cards: MoveCard[]): MoveCard | undefined {
  if (cards.length === 0) return undefined;
  return cards.reduce((a, b) => {
    if (a === b) return a;                                    // 동일 → 한 번만
    const pair = [a, b].sort().join("|");
    if (pair === "moveHorizontal|moveVertical") return "moveDiagonal";
    if (pair === "moveDiagonal|moveHorizontal") return "moveVertical";
    if (pair === "moveDiagonal|moveVertical") return "moveHorizontal";
    return a;
  });
}

export function destinationOf(from: Location, m: MoveCard): Location {
  switch (m) {
    case "moveVertical": return VERTICAL[from];
    case "moveHorizontal": return HORIZONTAL[from];
    case "moveDiagonal": return DIAGONAL[from];
  }
}

export interface MoveInput {
  character: CharacterId;
  from: Location;
  cards: MoveCard[];
  /** 이동 금지 카드가 같은 대상에 놓였는가 */
  forbidden: boolean;
  /** 해당 캐릭터의 금지 장소 */
  forbiddenLocations: Location[];
}

export interface MoveResult {
  to: Location;
  moved: boolean;
  /** 왜 안 움직였는지 — 각본가 화면 디버깅용. 주인공에게 노출 금지. */
  reason?: "no-card" | "forbid-card" | "forbidden-location";
}

export interface ServantFollowOption {
  character: CharacterId;
  to: Location;
}

interface MovementPlan {
  results: Map<CharacterId, MoveResult>;
  servantFollowOptions: ServantFollowOption[];
}

/**
 * 해결 순서가 중요하다.
 *   ① 겹침 합성 → ② 이동 금지 검사 → ③ 금지 장소 검사
 *
 * "일단 옮기고 되돌리기"로 구현하면 틀린다. 각본가 설명서 7p의 무녀 예시:
 * 무녀에 ↑↓ + ←→ 가 겹쳐 대각 이동이 되어 도심으로 가야 하는데,
 * 도심은 무녀의 금지 장소이므로 이동 전체가 무시되고 신사에 남는다.
 * (FAQ Q2 — "두 카드 중 하나만 해결합니까?" → 아니오, 합성 후 통째로 무시)
 */
export function resolveMove(input: MoveInput): MoveResult {
  const net = composeMove(input.cards);
  if (!net) return { to: input.from, moved: false, reason: "no-card" };
  if (input.forbidden) {
    return { to: input.from, moved: false, reason: "forbid-card" };
  }
  const dest = destinationOf(input.from, net);
  if (input.forbiddenLocations.includes(dest)) {
    return { to: input.from, moved: false, reason: "forbidden-location" };
  }
  return { to: dest, moved: true };
}

function movementPlan(
  state: GameState,
  placed: readonly PlacedCard[],
): MovementPlan {
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

  const results = new Map<CharacterId, MoveResult>();
  for (const [character, cards] of cardsByCharacter) {
    const position = state.loop.board[character];
    if (!position) {
      throw new Error(
        `cannot resolve movement for unknown character "${character}"`,
      );
    }
    results.set(character, resolveMove({
      character,
      from: characterLocation(position, character),
      cards,
      forbidden: forbiddenCharacters.has(character),
      forbiddenLocations:
        state.loop.locationRestrictionsRemoved?.includes(character)
          ? []
          : [...characterDataOf(character).forbiddenLocation],
    }));
  }

  const servantPosition = state.loop.board.servant;
  const servantFollowOptions = servantPosition === undefined ||
      !isCharacterAlive(servantPosition)
    ? []
    : servantServedCharacters(state).flatMap((character) => {
      const position = state.loop.board[character];
      const result = results.get(character);
      if (
        !isCharacterAlive(position) ||
        result?.moved !== true ||
        characterLocation(position, character) !==
          characterLocation(servantPosition, "servant")
      ) {
        return [];
      }
      return [{ character, to: result.to }];
    });

  return { results, servantFollowOptions };
}

/** 카드 해결 전 리더에게 보여 줄 실제 이동 가능한 주인 목록. */
export function servantFollowOptions(
  state: GameState,
  placed: readonly PlacedCard[],
): ServantFollowOption[] {
  return movementPlan(state, placed).servantFollowOptions;
}

/**
 * 일반 이동을 모두 먼저 판정한 뒤 메이드 동행 선택을 적용한다.
 * 동행 시 메이드 자신의 이동 카드·이동 금지·금지 장소를 모두 무시한다.
 */
export function resolveMovementPlan(
  state: GameState,
  placed: readonly PlacedCard[],
): void {
  const plan = movementPlan(state, placed);
  const choice = state.loop.servantMovementChoice;
  if (plan.servantFollowOptions.length > 0 && choice === undefined) {
    throw new Error("servant movement choice is required");
  }

  if (choice !== undefined && choice !== "decline") {
    const selected = plan.servantFollowOptions.find(
      ({ character }) => character === choice,
    );
    if (selected === undefined) {
      throw new Error(`invalid servant movement choice "${choice}"`);
    }
    plan.results.set("servant", { to: selected.to, moved: true });
  }

  for (const [character, result] of plan.results) {
    const position = state.loop.board[character];
    if (position === undefined) {
      throw new Error(`cannot move unknown character "${character}"`);
    }
    state.loop.board[character] = withCharacterLocation(
      position,
      result.to,
      character,
    );
  }
  delete state.loop.servantMovementChoice;
}

/**
 * 음모 금지는 카드 단위가 아니라 라운드 단위로 집계한다.
 * 주인공 2명 이상이 같은 라운드에 내면 전부 무효화된다.
 * (주인공 설명서 42p / 각본가 설명서 7p)
 */
export function intrigueForbidActive(
  forbidCardsThisRound: { owner: "mastermind" | 0 | 1 | 2 }[],
): boolean {
  const byProtagonists = forbidCardsThisRound.filter((c) => c.owner !== "mastermind");
  return byProtagonists.length === 1;
}
