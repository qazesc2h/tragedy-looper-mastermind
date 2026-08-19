import type {
  GameState,
  HookPoint,
  PublicInformation,
  PublicObservationAt,
} from "../types";

/** phaseLog와 PublicInformation에 같은 단조 증가 순번을 부여한다. */
export function nextPublicObservationAt(
  state: GameState,
  phase: HookPoint = state.loop.phase,
): PublicObservationAt {
  const sequence = state.loop.nextPublicObservationSequence ?? 0;
  state.loop.nextPublicObservationSequence = sequence + 1;
  return {
    loop: state.loop.loop,
    day: state.loop.day,
    phase,
    sequence,
  };
}

/** 공개 정보와 그 실제 발생 시점을 한 번에 기록한다. */
export function recordPublicInformation(
  state: GameState,
  information: PublicInformation,
  phase: HookPoint = state.loop.phase,
): void {
  const records = state.loop.publicInformationThisLoop ??= [];
  records.push({
    ...information,
    observedAt: information.observedAt ?? nextPublicObservationAt(state, phase),
  });
}
