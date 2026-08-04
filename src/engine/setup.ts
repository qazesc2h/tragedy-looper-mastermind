import {
  startLocationOf,
  type CharacterId,
  type Counters,
  type LoopState,
  type Scenario,
} from "../types";

export function initLoop(scenario: Scenario): LoopState {
  const board: LoopState["board"] = {};
  const charCounters: Record<
    CharacterId,
    Counters & { protection: number }
  > = {};

  for (const character of Object.keys(scenario.cast)) {
    // TODO: comesInLater 캐릭터는 지정된 루프/날짜 전까지 board에서 제외해야 한다.
    // 현재 단계에서는 요구사항에 따라 다른 캐릭터와 동일하게 배치한다.
    board[character] = {
      at: startLocationOf(character, scenario),
      alive: true,
    };
    charCounters[character] = {
      goodwill: 0,
      paranoia: 0,
      intrigue: 0,
      protection: 0,
    };
  }

  return {
    loop: 1,
    day: 1,
    phase: "P1_ROUND_START",
    leader: 0,
    board,
    charCounters,
    locIntrigue: {
      Hospital: 0,
      Shrine: 0,
      City: 0,
      School: 0,
    },
    spentOncePerLoop: {
      mastermind: [],
      protagonists: [[], [], []],
    },
    abilitiesUsedThisLoop: [],
    placed: [],
    phaseLog: [],
  };
}
