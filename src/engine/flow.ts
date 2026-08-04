import type {
  GameState,
  LoopEndReason,
} from "../types";

/**
 * 현재 효과 묶음이 끝난 직후 루프를 종료하도록 요청한다.
 * 실제 LOOP_END 훅·스냅샷·승패 판정은 game.ts의 settleGameFlow()가 담당한다.
 */
export function requestLoopEnd(
  state: GameState,
  reason: LoopEndReason,
  lossKeys: readonly string[] = [],
): void {
  if (state.gamePhase !== "ROUND") return;

  if (!state.pendingLoopEnd) {
    state.pendingLoopEnd = {
      reason,
      day: state.loop.day,
      phase: state.loop.phase,
      lossKeys: [...new Set(lossKeys)],
    };
    return;
  }

  for (const key of lossKeys) {
    if (!state.pendingLoopEnd.lossKeys.includes(key)) {
      state.pendingLoopEnd.lossKeys.push(key);
    }
  }

  // 실제 주인공 사망은 단순 효과 종료보다 더 구체적인 종료 사유다.
  if (reason === "protagonistDeath") {
    state.pendingLoopEnd.reason = reason;
  }
}
