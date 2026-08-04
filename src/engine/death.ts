import { effectiveRole } from "../types";
import type { CharacterId, GameState } from "../types";
import { requestLoopEnd } from "./flow";

export interface ProtagonistDeathResult {
  died: boolean;
  blockedBy?: CharacterId;
}

/** 주인공 사망을 막는 현재 지속 효과를 부작용 없이 조회한다. */
export function protagonistDeathBlocker(
  state: GameState,
): CharacterId | undefined {
  return state.loop.protagonistDeathPreventedBy?.[0];
}

function characterState(state: GameState, character: CharacterId) {
  const position = state.loop.board[character];
  const counters = state.loop.charCounters[character];
  if (!position || !counters) {
    throw new Error(`unknown character "${character}"`);
  }
  return { position, counters };
}

/** 사망을 시도하고 실제로 사망 상태가 되었는지를 반환한다. */
export function killCharacter(
  state: GameState,
  character: CharacterId,
): boolean {
  const { position, counters } = characterState(state, character);

  // 형사 FAQ: 불사로 사망하지 않으면 보호 카운터를 제거하지 않는다.
  if (effectiveRole(state, character) === "timeTraveler") {
    return false;
  }
  if (!position.alive) {
    return false;
  }
  if (counters.protection > 0) {
    counters.protection -= 1;
    return false;
  }

  position.alive = false;
  return true;
}

/**
 * 주인공 사망을 시도한다. 모든 주인공 사망 효과는 이 진입점을 사용한다.
 * 주인공 패배·보호 대상 캐릭터 사망은 이 함수의 범위가 아니다.
 */
export function attemptProtagonistDeath(
  state: GameState,
): ProtagonistDeathResult {
  const blockedBy = protagonistDeathBlocker(state);
  if (blockedBy !== undefined) {
    return { died: false, blockedBy };
  }

  requestLoopEnd(state, "protagonistDeath");
  return { died: true };
}

/** 부활을 시도하고 실제로 생존 상태가 되었는지를 반환한다. */
export function reviveCharacter(
  state: GameState,
  character: CharacterId,
): boolean {
  const { position } = characterState(state, character);
  if (position.alive) {
    return false;
  }

  position.alive = true;
  return true;
}
