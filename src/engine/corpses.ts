import {
  isCharacterDead,
  type GameState,
  type Location,
} from "../types";

/**
 * Prime Evil "Victims":
 * "Every :inrigue: on locations counts as a corpse with the role :person:."
 */
export function anonymousCorpseCountAt(
  state: GameState,
  location: Location,
): number {
  return state.scenario.tragedySet === "primeEvil"
    ? state.loop.locIntrigue[location]
    : 0;
}

/** 보드에 실제 카드로 남아 있는 사망 캐릭터 수. */
export function characterCorpseCountAt(
  state: GameState,
  location: Location,
): number {
  return Object.values(state.loop.board).filter(
    (position) => isCharacterDead(position) && position.at === location,
  ).length;
}

/** 사건 등에서 사용하는 장소의 전체 시체 수. */
export function corpseCountAt(
  state: GameState,
  location: Location,
): number {
  return characterCorpseCountAt(state, location) +
    anonymousCorpseCountAt(state, location);
}

/**
 * Prime Evil "Victims":
 * "If such a corpse is revived by the power of the :alien:, it is simply
 * removed from the board."
 */
export function removeAnonymousCorpseAt(
  state: GameState,
  location: Location,
): boolean {
  if (anonymousCorpseCountAt(state, location) < 1) return false;
  state.loop.locIntrigue[location] -= 1;
  return true;
}
