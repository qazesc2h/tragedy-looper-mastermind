import type {
  GamePhase,
  GameState,
  LoopEndRequest,
  LoopState,
  Phase,
  RuntimeErrorRecord,
  Scenario,
} from "../types";
import { PHASE_ORDER } from "../types";
import {
  sacredTreeLeaderChoiceRequired,
  sacredTreeMastermindChoiceRequired,
} from "../engine/sacred-tree";
import { servantMovementChoiceRequired } from "../engine/resolve";
import { nextProtagonist, placementsForOwner } from "./action-cards";

export interface PhaseProgressDiagnostic {
  phase: Phase;
  status: "completed" | "ready" | "blocked" | "pending" | "inactive";
  canProgress: boolean | null;
  reasons: string[];
}

export interface CurrentStateDump {
  scenario: Pick<
    Scenario,
    "tragedySet" | "mainPlot" | "subPlots" | "cast" | "specialRuleIds"
  >;
  gamePhase: GamePhase;
  loop: number;
  day: number;
  phase: Phase;
  leader: 0 | 1 | 2;
  placed: LoopState["placed"];
  spentOncePerLoop: LoopState["spentOncePerLoop"];
  abilitiesUsedThisLoop: string[];
  abilitiesUsedThisRound: string[];
  board: LoopState["board"];
  counters: LoopState["charCounters"];
  locationIntrigue: LoopState["locIntrigue"];
  pendingLoopEnd: LoopEndRequest | null;
  pendingImmediateLossKeys: string[];
  phaseProgression: PhaseProgressDiagnostic[];
  errors: RuntimeErrorRecord[];
}

function currentPhaseBlockers(state: GameState): string[] {
  if (
    state.pendingLoopEnd !== undefined ||
    (state.loop.pendingImmediateLossKeys?.length ?? 0) > 0
  ) {
    return [];
  }
  switch (state.loop.phase) {
    case "P2_MASTERMIND_ACTION": {
      const count = placementsForOwner(state, "mastermind").length;
      return count === 3 ? [] : [`각본가 카드 3장 필요 (현재 ${count}장)`];
    }
    case "P3_PROTAGONIST_ACTION": {
      const reasons: string[] = [];
      const mastermindCount = placementsForOwner(state, "mastermind").length;
      if (mastermindCount !== 3) {
        reasons.push(`각본가 카드 3장 필요 (현재 ${mastermindCount}장)`);
      }
      const missingOwner = nextProtagonist(state);
      if (missingOwner !== undefined) {
        reasons.push(`주인공 ${missingOwner + 1} 카드 필요`);
      }
      return reasons;
    }
    case "P4_RESOLVE": {
      if (state.loop.actionResolutionComplete) {
        return sacredTreeLeaderChoiceRequired(state)
          ? ["신수 리더 카운터 이전 선택 필요"]
          : [];
      }
      const reasons: string[] = [];
      if (state.loop.placed.length !== 6) {
        reasons.push(`배치 카드 6장 필요 (현재 ${state.loop.placed.length}장)`);
      }
      if (servantMovementChoiceRequired(state)) {
        reasons.push("메이드 이동 방향 선택 필요");
      }
      return reasons;
    }
    case "P5_MASTERMIND_ABILITY":
      return sacredTreeMastermindChoiceRequired(state)
        ? ["신수 각본가 카운터 이전 선택 필요"]
        : [];
    default:
      return [];
  }
}

export function phaseProgressionDiagnostics(
  state: GameState,
): PhaseProgressDiagnostic[] {
  if (state.gamePhase !== "ROUND") {
    return PHASE_ORDER.map((phase) => ({
      phase,
      status: "inactive",
      canProgress: null,
      reasons: [`현재 게임 단계: ${state.gamePhase}`],
    }));
  }
  const currentIndex = PHASE_ORDER.indexOf(state.loop.phase);
  let blockers: string[];
  try {
    blockers = currentPhaseBlockers(state);
  } catch (error) {
    blockers = [
      `진행 가능 여부 계산 실패: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ];
  }
  return PHASE_ORDER.map((phase, index) => {
    if (index < currentIndex) {
      return { phase, status: "completed", canProgress: null, reasons: [] };
    }
    if (index > currentIndex) {
      return { phase, status: "pending", canProgress: null, reasons: [] };
    }
    return {
      phase,
      status: blockers.length === 0 ? "ready" : "blocked",
      canProgress: blockers.length === 0,
      reasons: blockers,
    };
  });
}

/** 문제 재현에 필요한 현재 루프 상태만 복사 가능한 형태로 추린다. */
export function currentStateDump(state: GameState): CurrentStateDump {
  return structuredClone({
    scenario: {
      tragedySet: state.scenario.tragedySet,
      mainPlot: state.scenario.mainPlot,
      subPlots: state.scenario.subPlots,
      cast: state.scenario.cast,
      specialRuleIds: state.scenario.specialRuleIds ?? [],
    },
    gamePhase: state.gamePhase,
    loop: state.loop.loop,
    day: state.loop.day,
    phase: state.loop.phase,
    leader: state.loop.leader,
    placed: state.loop.placed,
    spentOncePerLoop: state.loop.spentOncePerLoop,
    abilitiesUsedThisLoop: state.loop.abilitiesUsedThisLoop,
    abilitiesUsedThisRound: state.loop.abilitiesUsedThisRound,
    board: state.loop.board,
    counters: state.loop.charCounters,
    locationIntrigue: state.loop.locIntrigue,
    pendingLoopEnd: state.pendingLoopEnd ?? null,
    pendingImmediateLossKeys: state.loop.pendingImmediateLossKeys ?? [],
    phaseProgression: phaseProgressionDiagnostics(state),
    errors: state.runtimeErrors ?? [],
  });
}

export function serializeCurrentStateDump(state: GameState): string {
  return JSON.stringify(currentStateDump(state), null, 2);
}
