import {
  LOCATIONS,
  characterLocation,
  isCharacterPresent,
  type LoopState,
  type PublicBoardChange,
  type PublicObservationContext,
} from "../types";

/** 훅 하나의 발동 전후에서 공개 게임판 변화만 추출한다. */
export function publicBoardChanges(
  before: LoopState,
  after: LoopState,
): PublicBoardChange[] {
  const changes: PublicBoardChange[] = [];
  for (const at of LOCATIONS) {
    const delta = after.locIntrigue[at] - before.locIntrigue[at];
    if (delta !== 0) {
      changes.push({
        kind: "counter",
        target: { kind: "location", at },
        counter: "intrigue",
        delta,
      });
    }
  }

  for (const character of Object.keys(after.board)) {
    const beforePosition = before.board[character];
    const afterPosition = after.board[character];
    if (beforePosition === undefined || afterPosition === undefined) continue;
    if (beforePosition.status !== afterPosition.status) {
      changes.push({
        kind: "status",
        character,
        from: beforePosition.status,
        to: afterPosition.status,
      });
    }
    if (
      isCharacterPresent(beforePosition) &&
      isCharacterPresent(afterPosition) &&
      characterLocation(beforePosition, character) !==
        characterLocation(afterPosition, character)
    ) {
      changes.push({
        kind: "movement",
        character,
        from: characterLocation(beforePosition, character),
        to: characterLocation(afterPosition, character),
      });
    }

    const beforeCounters = before.charCounters[character];
    const afterCounters = after.charCounters[character];
    if (beforeCounters === undefined || afterCounters === undefined) continue;
    for (const counter of [
      "goodwill",
      "paranoia",
      "intrigue",
      "protection",
    ] as const) {
      const delta = afterCounters[counter] - beforeCounters[counter];
      if (delta !== 0) {
        changes.push({
          kind: "counter",
          target: { kind: "character", id: character },
          counter,
          delta,
        });
      }
    }
  }
  return changes;
}

/** 능력 발동 직전의 공개 장소 음모 상태를 복사한다. */
export function publicObservationContext(
  loop: LoopState,
): PublicObservationContext {
  return {
    locationIntrigue: {
      Hospital: loop.locIntrigue.Hospital,
      Shrine: loop.locIntrigue.Shrine,
      City: loop.locIntrigue.City,
      School: loop.locIntrigue.School,
    },
  };
}
