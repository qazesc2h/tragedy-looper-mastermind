import {
  characterLocation,
  isCharacterAlive,
  type AttachmentTarget,
  type CharacterId,
  type ExtraCardInstance,
  type GameState,
  type Location,
  type RoundEndCurseResolution,
} from "../types";
import { killCharacter, withDeathBatch } from "./death";
import { moveExtraCard } from "./extra-cards";
import { recordPhaseLog } from "./phase-log";
import {
  publicBoardChanges,
  publicObservationContext,
} from "./public-observation";

export const CURSE_CARD_ID = "curse";

export const CURSE_ROUND_END_SOURCE =
  "At the end of Day, before everything else, each curse is handeld. " +
  "On a location the mastermind attaches a curse to any character in that " +
  "location. Characters may have more than one curse. Characters with curses " +
  "are killed (at the same time so a character that got a curse this step is " +
  "not killed.) and the curse moves to the location.";

export type RoundEndCurseStage = "character" | "location" | "complete";

export interface LocationCurseChoice {
  instanceId: string;
  at: Location;
  candidates: CharacterId[];
}

function isPrimeEvil(state: GameState): boolean {
  return state.scenario.tragedySet === "primeEvil";
}

function isCurrentDay(
  state: GameState,
  value: { loop: number; day: number } | undefined,
): boolean {
  return value?.loop === state.loop.loop && value.day === state.loop.day;
}

function curseCards(state: GameState): ExtraCardInstance[] {
  if (!isPrimeEvil(state)) return [];
  return state.loop.extraCards.filter(({ cardId }) => cardId === CURSE_CARD_ID);
}

function initialCurseResolution(state: GameState): RoundEndCurseResolution {
  return {
    loop: state.loop.loop,
    day: state.loop.day,
    curses: curseCards(state).map(({ instanceId, target }) => ({
      instanceId,
      target: structuredClone(target),
    })),
    characterCursesResolved: false,
  };
}

function currentResolution(
  state: GameState,
): RoundEndCurseResolution | undefined {
  const current = state.loop.roundEndCurseResolution;
  return isCurrentDay(state, current) ? current : undefined;
}

function resolutionForView(state: GameState): RoundEndCurseResolution {
  return currentResolution(state) ?? initialCurseResolution(state);
}

/** P8에서 P9으로 들어가는 순간의 저주 대상 상태를 고정한다. */
export function snapshotRoundEndCurses(state: GameState): void {
  if (!isPrimeEvil(state) ||
    isCurrentDay(state, state.loop.roundEndCurseResolvedAt) ||
    currentResolution(state) !== undefined) return;
  state.loop.roundEndCurseResolution = initialCurseResolution(state);
}

function livingCharactersAt(
  state: GameState,
  at: Location,
): CharacterId[] {
  return Object.entries(state.loop.board).flatMap(([character, position]) =>
    isCharacterAlive(position) && position.at === at ? [character] : []
  );
}

function cardById(
  state: GameState,
  instanceId: string,
): ExtraCardInstance | undefined {
  return state.loop.extraCards.find((card) => card.instanceId === instanceId);
}

/** P9 자동 통과 전에 저주 처리 입력 또는 공개 변화가 남았는지 판정한다. */
export function roundEndCurseNeedsAttention(state: GameState): boolean {
  return isPrimeEvil(state) &&
    !isCurrentDay(state, state.loop.roundEndCurseResolvedAt) &&
    resolutionForView(state).curses.length > 0;
}

/** 현재 P9 화면이 먼저 해결해야 할 저주 하위 단계를 반환한다. */
export function roundEndCurseStage(state: GameState): RoundEndCurseStage {
  if (!isPrimeEvil(state) ||
    isCurrentDay(state, state.loop.roundEndCurseResolvedAt)) {
    return "complete";
  }
  const resolution = resolutionForView(state);
  if (resolution.curses.length === 0) return "complete";
  if (
    !resolution.characterCursesResolved &&
    resolution.curses.some(({ target }) => target.kind === "character")
  ) {
    return "character";
  }
  return "location";
}

/** P9 진입 스냅샷에 장소 상태였던 저주별 현재 생존 빙의 후보. */
export function locationCurseChoices(
  state: GameState,
): LocationCurseChoice[] {
  if (roundEndCurseStage(state) !== "location") return [];
  return resolutionForView(state).curses.flatMap(({ instanceId, target }) => {
    if (target.kind !== "location") return [];
    const card = cardById(state, instanceId);
    if (card?.target.kind !== "location") return [];
    return [{
      instanceId,
      at: target.at,
      candidates: livingCharactersAt(state, target.at),
    }];
  });
}

function recordCurseChanges(
  state: GameState,
  before: GameState["loop"],
): void {
  const publicChanges = publicBoardChanges(before, state.loop);
  if (publicChanges.length === 0) return;
  recordPhaseLog(state, {
    loop: state.loop.loop,
    day: state.loop.day,
    phase: "P9_ROUND_END",
    kind: "abilityActivated",
    timing: "P9_ROUND_END",
    systemEffect: "primeEvilCurse",
    description: CURSE_ROUND_END_SOURCE,
    publicChanges,
    publicContext: publicObservationContext(before),
  });
}

function resolveCharacterCurses(
  state: GameState,
  resolution: RoundEndCurseResolution,
): void {
  const characterCurses = resolution.curses.flatMap(({ instanceId, target }) =>
    target.kind === "character" ? [{ instanceId, character: target.id }] : []
  );
  if (characterCurses.length === 0) {
    resolution.characterCursesResolved = true;
    return;
  }

  const before = structuredClone(state.loop);
  const livingAtEntry = [...new Set(characterCurses.flatMap(({ character }) =>
    isCharacterAlive(state.loop.board[character]) ? [character] : []
  ))];
  const detachTargets = characterCurses.map(({ instanceId, character }) => ({
    instanceId,
    at: characterLocation(state.loop.board[character], character),
  }));

  // 원문의 "at the same time"을 기존 강제 효과와 같은 사망 배치로 닫는다.
  withDeathBatch(state, () => {
    for (const character of livingAtEntry) killCharacter(state, character);
    for (const { instanceId, at } of detachTargets) {
      moveExtraCard(state.loop, instanceId, { kind: "location", at });
    }
  });
  resolution.characterCursesResolved = true;
  recordCurseChanges(state, before);
}

function selectedLocationTargets(
  state: GameState,
  resolution: RoundEndCurseResolution,
  selections: Readonly<Record<string, CharacterId | undefined>>,
): Array<{ instanceId: string; target: AttachmentTarget }> {
  const selected: Array<{ instanceId: string; target: AttachmentTarget }> = [];
  for (const { instanceId, target } of resolution.curses) {
    if (target.kind !== "location") continue;
    const card = cardById(state, instanceId);
    if (card?.target.kind !== "location") continue;
    const candidates = livingCharactersAt(state, target.at);
    if (candidates.length === 0) continue;
    const character = candidates.length === 1
      ? candidates[0]
      : selections[instanceId];
    if (character === undefined || !candidates.includes(character)) {
      throw new Error(`curse "${instanceId}" requires a living character target`);
    }
    selected.push({
      instanceId,
      target: { kind: "character", id: character },
    });
  }
  return selected;
}

/**
 * Prime Evil의 P9 최우선 저주 처리를 진행한다.
 * 장소 저주 선택이 부족하면 예외로 전체 입력을 거부하며 부분 적용하지 않는다.
 */
export function resolveRoundEndCurses(
  state: GameState,
  selections: Readonly<Record<string, CharacterId | undefined>> = {},
): RoundEndCurseStage {
  if (!isPrimeEvil(state)) return "complete";
  if (isCurrentDay(state, state.loop.roundEndCurseResolvedAt)) {
    return "complete";
  }

  let resolution = currentResolution(state);
  if (resolution === undefined) {
    resolution = initialCurseResolution(state);
    state.loop.roundEndCurseResolution = resolution;
  }
  if (!resolution.characterCursesResolved) {
    const hadCharacterCurses = resolution.curses.some(
      ({ target }) => target.kind === "character",
    );
    resolveCharacterCurses(state, resolution);
    if (
      hadCharacterCurses &&
      resolution.curses.some(({ target }) => target.kind === "location")
    ) {
      return "location";
    }
  }

  const targets = selectedLocationTargets(state, resolution, selections);
  const before = structuredClone(state.loop);
  for (const { instanceId, target } of targets) {
    moveExtraCard(state.loop, instanceId, target);
  }
  recordCurseChanges(state, before);

  state.loop.roundEndCurseResolvedAt = {
    loop: state.loop.loop,
    day: state.loop.day,
  };
  delete state.loop.roundEndCurseResolution;
  return "complete";
}
