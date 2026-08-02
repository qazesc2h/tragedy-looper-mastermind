import { effectiveRole } from "../types";
import type { CharacterId, GameState } from "../types";

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
