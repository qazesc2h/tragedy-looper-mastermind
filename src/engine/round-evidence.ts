import {
  LOCATIONS,
  isCharacterAlive,
  type CharacterId,
  type GameState,
  type LoopEndRequest,
  type RoundEvidence,
  type RoundEndPairEvidence,
} from "../types";

function currentRoundEvidence(state: GameState): RoundEvidence {
  const records = state.loop.roundEvidence ??= [];
  const existing = records.find(({ day }) => day === state.loop.day);
  if (existing !== undefined) return existing;

  const created: RoundEvidence = { day: state.loop.day };
  records.push(created);
  return created;
}

/** 원자적 효과 묶음의 실제 사망자만 기록한다. 빈 묶음은 저장하지 않는다. */
export function recordRoundDeathBatch(
  state: GameState,
  characters: readonly CharacterId[],
): void {
  if (characters.length === 0) return;
  const record = currentRoundEvidence(state);
  (record.deathBatches ??= []).push({
    phase: state.loop.phase,
    characters: [...characters],
  });
}

/** P9 강제 효과 판정 직전의 단둘 장소와 두 캐릭터의 불안만 저장한다. */
export function recordRoundEndPairs(state: GameState): void {
  const pairs: RoundEndPairEvidence[] = [];
  for (const location of LOCATIONS) {
    const characters = Object.entries(state.loop.board)
      .filter(([, position]) =>
        isCharacterAlive(position) && position.at === location
      )
      .map(([character]) => character)
      .sort();
    const first = characters[0];
    const second = characters[1];
    if (characters.length !== 2 || first === undefined || second === undefined) {
      continue;
    }
    pairs.push({
      location,
      characters: [first, second],
      paranoia: [
        state.loop.charCounters[first].paranoia,
        state.loop.charCounters[second].paranoia,
      ],
    });
  }
  const record = currentRoundEvidence(state);
  // P9 재진입은 같은 판정 경계를 다시 기록하지 않는다.
  record.roundEndPairs ??= pairs;
}

/** 자연 종료를 제외한 최초 종료 요청 시점만 보존한다. */
export function recordImmediateLoopEnd(
  state: GameState,
  request: LoopEndRequest,
): void {
  if (request.reason === "lastDay") return;
  currentRoundEvidence(state).immediateLoopEnd = {
    phase: request.phase,
    reason: request.reason,
  };
}
