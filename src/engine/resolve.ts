import {
  abilityLocationsOf,
  characterLocation,
  isCharacterAlive,
  type ActionCard,
  type CharacterId,
  type GameState,
  type PlacedCard,
  type Target,
} from "../types";
import {
  intrigueForbidActive,
  resolveMovementPlan,
  servantFollowOptions,
  type ServantFollowOption,
} from "./movement";

export const PROTAGONIST_ONCE_PER_LOOP: ReadonlySet<ActionCard> = new Set([
  "goodwillPlus2",
  "paranoiaMinus1",
  "forbidMove",
]);

export const MASTERMIND_ONCE_PER_LOOP: ReadonlySet<ActionCard> = new Set([
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

/** 살아 있는 환상의 장소에 놓인 카드는 종류와 진영에 관계없이 환상에도 적용된다. */
export function locationCardAppliesToIllusion(
  state: GameState,
  placedCard: PlacedCard,
): boolean {
  const illusion = state.loop.board.illusion;
  return placedCard.target.kind === "location" &&
    illusion !== undefined &&
    isCharacterAlive(illusion) &&
    illusion.at === placedCard.target.at;
}

export function placementsWithIllusionCopies(
  state: GameState,
  placed: readonly PlacedCard[],
): PlacedCard[] {
  return [
    ...placed,
    ...placed.filter((placedCard) =>
      locationCardAppliesToIllusion(state, placedCard)
    ).map((placedCard): PlacedCard => ({
      ...placedCard,
      target: { kind: "character", id: "illusion" },
    })),
  ];
}

export function resolveMovement(
  state: GameState,
  placed: readonly PlacedCard[],
): void {
  resolveMovementPlan(state, placed);
}

/** 현재 P4 카드 전체를 반영한 메이드 동행 후보. */
export function currentServantFollowOptions(
  state: GameState,
): ServantFollowOption[] {
  return servantFollowOptions(
    state,
    placementsWithIllusionCopies(state, state.loop.placed),
  );
}

/** P4 공개 전에 리더의 메이드 동행 선택을 검증해 저장한다. */
export function setServantMovementChoice(
  state: GameState,
  choice: CharacterId | "decline" | undefined,
): void {
  if (state.loop.phase !== "P4_RESOLVE" || state.loop.actionResolutionComplete) {
    throw new Error("servant movement choice can only change before P4 resolve");
  }
  if (choice === undefined) {
    delete state.loop.servantMovementChoice;
    return;
  }
  if (
    choice !== "decline" &&
    !currentServantFollowOptions(state).some(
      ({ character }) => character === choice,
    )
  ) {
    throw new Error(`invalid servant movement choice "${choice}"`);
  }
  state.loop.servantMovementChoice = choice;
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

function timeTravelerIgnoredGoodwillTargets(
  state: GameState,
): Set<string> {
  return new Set(
    (state.loop.timeTravelersIgnoringForbidGoodwill ?? [])
      .map((character) => targetKey({ kind: "character", id: character })),
  );
}

function cultistIgnoredIntrigueTargets(state: GameState): Set<string> {
  const ignored = new Set<string>();

  for (
    const cultist of state.loop.cultistsIgnoringForbidIntrigue ?? []
  ) {
    const locations = abilityLocationsOf(state, cultist);
    for (const location of locations) {
      ignored.add(targetKey({ kind: "location", at: location }));
    }

    for (const [character, position] of Object.entries(state.loop.board)) {
      if (
        isCharacterAlive(position) &&
        locations.includes(characterLocation(position, character))
      ) {
        ignored.add(targetKey({ kind: "character", id: character }));
      }
    }
  }

  return ignored;
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
  played: readonly PlacedCard[] = placed,
): void {
  const goodwillForbidden = forbiddenTargets(placed, "forbidGoodwill");
  for (const ignored of timeTravelerIgnoredGoodwillTargets(state)) {
    goodwillForbidden.delete(ignored);
  }
  const paranoiaForbidden = forbiddenTargets(placed, "forbidParanoia");

  // 환상에게 복사된 금지 카드는 적용 대상을 늘릴 뿐, 실제로 낸 카드 수를
  // 늘리지 않는다. 라운드 단위 상쇄 판정은 원래 배치만 센다.
  const playedIntrigueForbids = played.filter(
    (placedCard) => placedCard.card === "forbidIntrigue",
  );
  const intrigueForbids = placed.filter(
    (placedCard) => placedCard.card === "forbidIntrigue",
  );
  const intrigueForbidIsActive = intrigueForbidActive(playedIntrigueForbids);
  const intrigueForbidden = new Set<string>();
  if (intrigueForbidIsActive) {
    const ignoredTargets = cultistIgnoredIntrigueTargets(state);
    for (const placedCard of intrigueForbids) {
      if (placedCard.owner === "mastermind") continue;
      const key = targetKey(placedCard.target);
      if (!ignoredTargets.has(key)) {
        intrigueForbidden.add(key);
      }
    }
  }

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
  const applied = placementsWithIllusionCopies(state, placed);

  resolveMovement(state, applied);
  resolveCounters(state, applied, placed);
  recordSpentCards(state, placed);
  state.loop.placed = [];
  delete state.loop.cultistsIgnoringForbidIntrigue;
  delete state.loop.timeTravelersIgnoringForbidGoodwill;

  return state;
}
