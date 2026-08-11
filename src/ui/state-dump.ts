import type {
  GamePhase,
  GameState,
  LoopEndRequest,
  LoopState,
  Phase,
  RuntimeErrorRecord,
} from "../types";

export interface CurrentStateDump {
  gamePhase: GamePhase;
  loop: number;
  day: number;
  phase: Phase;
  leader: 0 | 1 | 2;
  spentOncePerLoop: LoopState["spentOncePerLoop"];
  abilitiesUsedThisLoop: string[];
  abilitiesUsedThisRound: string[];
  board: LoopState["board"];
  counters: LoopState["charCounters"];
  locationIntrigue: LoopState["locIntrigue"];
  pendingLoopEnd?: LoopEndRequest;
  pendingImmediateLossKeys: string[];
  errors: RuntimeErrorRecord[];
}

/** 문제 재현에 필요한 현재 루프 상태만 복사 가능한 형태로 추린다. */
export function currentStateDump(state: GameState): CurrentStateDump {
  return structuredClone({
    gamePhase: state.gamePhase,
    loop: state.loop.loop,
    day: state.loop.day,
    phase: state.loop.phase,
    leader: state.loop.leader,
    spentOncePerLoop: state.loop.spentOncePerLoop,
    abilitiesUsedThisLoop: state.loop.abilitiesUsedThisLoop,
    abilitiesUsedThisRound: state.loop.abilitiesUsedThisRound,
    board: state.loop.board,
    counters: state.loop.charCounters,
    locationIntrigue: state.loop.locIntrigue,
    ...(state.pendingLoopEnd === undefined
      ? {}
      : { pendingLoopEnd: state.pendingLoopEnd }),
    pendingImmediateLossKeys: state.loop.pendingImmediateLossKeys ?? [],
    errors: state.runtimeErrors ?? [],
  });
}

export function serializeCurrentStateDump(state: GameState): string {
  return JSON.stringify(currentStateDump(state), null, 2);
}
