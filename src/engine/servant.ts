import {
  characterLocation,
  isCharacterAlive,
  type CharacterId,
  type GameState,
} from "../types";

export const SERVANT_TRAIT_SOURCE =
  "The :servant: serves the :richStudent: and the :boss:. If one of them " +
  "moves and she shares the location, the Leader moves her with one of them " +
  "ignoring her own movement. If any onf them dies at her location, she dies " +
  "instead.";

const BASE_SERVED_CHARACTERS: readonly CharacterId[] = [
  "richStudent",
  "boss",
];

/** 현재 루프에 메이드가 섬기는 기본·추가 대상을 중복 없이 반환한다. */
export function servantServedCharacters(state: GameState): CharacterId[] {
  return [...new Set([
    ...BASE_SERVED_CHARACTERS,
    ...(state.loop.servantAdditionalServedCharacters ?? []),
  ])].filter((character) => character in state.loop.board);
}

/** 사망이 결정된 주인을 대신할 수 있는 살아 있는 동소 메이드를 찾는다. */
export function servantDeathReplacement(
  state: GameState,
  protectedCharacter: CharacterId,
): CharacterId | undefined {
  if (!servantServedCharacters(state).includes(protectedCharacter)) {
    return undefined;
  }
  const servant = state.loop.board.servant;
  const protectedPosition = state.loop.board[protectedCharacter];
  if (
    servant === undefined ||
    protectedPosition === undefined ||
    !isCharacterAlive(servant) ||
    !isCharacterAlive(protectedPosition) ||
    characterLocation(servant, "servant") !==
      characterLocation(protectedPosition, protectedCharacter)
  ) {
    return undefined;
  }
  return "servant";
}
