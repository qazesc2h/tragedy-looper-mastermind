import type { GameState, PhaseLogEntry } from "../types";

/** 현재 루프의 회고 기록에 한 항목을 추가한다. */
export function recordPhaseLog(
  state: GameState,
  entry: PhaseLogEntry,
): void {
  (state.loop.phaseLog ??= []).push(entry);
}
