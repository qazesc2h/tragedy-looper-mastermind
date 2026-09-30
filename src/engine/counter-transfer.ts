import type {
  CharacterId,
  GameState,
  SacredTreeCounter,
} from "../types";
import { TRANSFERABLE_CHARACTER_COUNTERS } from "../counters";

/** 신수와 감식관이 공통으로 옮길 수 있는 공개 캐릭터 카운터. */
export { TRANSFERABLE_CHARACTER_COUNTERS } from "../counters";

/** 검증이 끝난 두 캐릭터 사이에서 카운터 하나를 원자적으로 옮긴다. */
export function transferCharacterCounter(
  state: GameState,
  source: CharacterId,
  target: CharacterId,
  counter: SacredTreeCounter,
): void {
  if (source === target) {
    throw new Error("counter transfer requires two different characters");
  }
  if (!TRANSFERABLE_CHARACTER_COUNTERS.includes(counter)) {
    throw new Error(`invalid transferable counter "${counter}"`);
  }
  const sourceCounters = state.loop.charCounters[source];
  const targetCounters = state.loop.charCounters[target];
  if (sourceCounters === undefined || targetCounters === undefined) {
    throw new Error("counter transfer characters are missing");
  }
  if (sourceCounters[counter] < 1) {
    throw new Error(`counter transfer source has no ${counter} counter`);
  }
  sourceCounters[counter] -= 1;
  targetCounters[counter] += 1;
}
