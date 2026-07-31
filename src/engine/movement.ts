// 이동 해결 — 구현 완료. 규칙이 명확하고 오구현 위험이 가장 높은 지점.
// 근거: 주인공 설명서 42~43p(카드 목록), 각본가 설명서 7p(무녀 예시), FAQ Q2.

import {
  type ActionCard, type CharacterId, type Location,
  VERTICAL, HORIZONTAL, DIAGONAL,
} from "../types";

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
