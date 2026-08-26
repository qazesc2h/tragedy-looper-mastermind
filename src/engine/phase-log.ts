import type { GameState, PhaseLogEntry } from "../types";
import { nextPublicObservationAt } from "./public-information";

function isPublicObservation(entry: PhaseLogEntry): boolean {
  switch (entry.kind) {
    case "cardsPlaced":
    case "actionResolved":
    case "goodwillUsed":
    case "incidentJudged":
    case "leaderPassed":
    case "roundEnded":
    case "sacredTreeTransferJudged":
      return true;
    case "abilityActivated":
      return (entry.publicChanges?.length ?? 0) > 0;
    case "notApplicable":
    case "phaseCompleted":
    case "abilitySkipped":
    case "goodwillSkipped":
      return false;
  }
}

/** 현재 루프의 회고 기록에 한 항목을 추가한다. */
export function recordPhaseLog(
  state: GameState,
  entry: PhaseLogEntry,
): void {
  (state.loop.phaseLog ??= []).push(
    entry.observedAt !== undefined || !isPublicObservation(entry)
      ? entry
      : {
        ...entry,
        observedAt: nextPublicObservationAt(state, entry.phase),
      },
  );
}
