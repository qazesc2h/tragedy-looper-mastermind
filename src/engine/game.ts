import {
  effectiveRole,
  type CharacterId,
  type FinalGuessAttempt,
  type GameState,
  type IncidentChoice,
  type IncidentResult,
  type LoopOutcome,
  type RecordedLoss,
  type RoleId,
  type Scenario,
} from "../types";
import { requestLoopEnd } from "./flow";
import { evaluateLoss, type LossCondition } from "./loss";
import { advance, resolveHooks } from "./phases";
import { initLoop } from "./setup";

const TIME_GAP_SECONDS = 10 * 60;

function resetTimeGapTimer(state: GameState): void {
  state.timeGapTimer = { remainingSeconds: TIME_GAP_SECONDS };
}

/** 새 게임을 만들고 자동 게임 준비 단계를 진행해 리더 선택에서 멈춘다. */
export function createGameState(scenario: Scenario): GameState {
  const state: GameState = {
    scenario,
    gamePhase: "SETUP_SCENARIO",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
  };
  advanceAutomaticGameSetup(state);
  return state;
}

export function advanceAutomaticGameSetup(state: GameState): void {
  if (state.gamePhase === "SETUP_SCENARIO") {
    state.gamePhase = "SETUP_REVEAL";
  }
  if (state.gamePhase === "SETUP_REVEAL") {
    state.gamePhase = "SETUP_STAGE";
  }
  if (state.gamePhase === "SETUP_STAGE") {
    state.gamePhase = "SETUP_LEADER";
  }
}

export function chooseInitialLeader(
  state: GameState,
  leader: 0 | 1 | 2,
): void {
  if (state.gamePhase !== "SETUP_LEADER") {
    throw new Error(`leader cannot be chosen during ${state.gamePhase}`);
  }
  state.loop.leader = leader;
  state.gamePhase = "LOOP_TIME_GAP";
  resetTimeGapTimer(state);
}

/** 시간의 틈 이후 자동 가능한 루프 준비 3단계를 순서대로 처리한다. */
export function continueFromTimeGap(state: GameState): void {
  if (state.gamePhase !== "LOOP_TIME_GAP") {
    throw new Error(`loop cannot start during ${state.gamePhase}`);
  }

  const loopNumber = state.loop.loop;
  const leader = state.loop.leader;

  state.gamePhase = "LOOP_CHARACTER_PLACEMENT";
  const prepared = initLoop(state.scenario);
  prepared.loop = loopNumber;
  prepared.leader = leader;
  state.loop = prepared;

  state.gamePhase = "LOOP_COUNTER_SETUP";
  resolveHooks(state, "LOOP_START");

  state.gamePhase = "LOOP_CARD_DISTRIBUTION";
  // initLoop()이 소진 카드·능력·배치 카드를 빈 상태로 만들었다.

  delete state.timeGapTimer;
  state.gamePhase = "ROUND";
}

function recordedLoss(condition: LossCondition): RecordedLoss {
  return {
    key: condition.key,
    id: condition.id,
    ko: condition.ko,
    label: condition.label,
  };
}

function uniqueActivatedLosses(
  conditions: readonly LossCondition[],
): LossCondition[] {
  const byKey = new Map<string, LossCondition>();
  for (const condition of conditions) {
    if (condition.activated) byKey.set(condition.key, condition);
  }
  return [...byKey.values()];
}

/** 종료 요청을 LOOP_END 훅·승패 판정·스냅샷으로 확정한다. */
export function finishLoop(state: GameState): LoopOutcome {
  const existing = state.loopOutcomes.find(
    ({ loop }) => loop === state.loop.loop,
  );
  if (existing) return existing;

  const request = state.pendingLoopEnd;
  if (!request) {
    throw new Error("loop cannot finish without an end request");
  }

  const atTrigger = evaluateLoss(state);
  state.gamePhase = "LOOP_JUDGMENT";

  // FAQ Q20: 즉시 종료가 걸려도 LOOP_END 훅(친구 역할 공개 등)은 해결한다.
  resolveHooks(state, "LOOP_END");
  const atLoopEnd = evaluateLoss(state);
  const losses = uniqueActivatedLosses([...atTrigger, ...atLoopEnd]);

  delete state.loop.optionalLossActivations;
  delete state.loop.roundEndMandatoryResolved;
  delete state.pendingLoopEnd;
  delete state.timeGapTimer;

  if (!state.history.some(({ loop }) => loop === state.loop.loop)) {
    state.history.push(structuredClone(state.loop));
  }

  const outcome: LoopOutcome = {
    loop: state.loop.loop,
    day: request.day,
    reason: request.reason,
    result: losses.length > 0 ? "protagonistsLost" : "protagonistsWon",
    losses: losses.map(recordedLoss),
  };
  state.loopOutcomes.push(outcome);

  if (outcome.result === "protagonistsWon") {
    state.result = { winner: "protagonists", reason: "loopVictory" };
    state.gamePhase = "GAME_OVER";
  }
  return outcome;
}

/** 효과 하나 또는 동시 강제 효과 묶음이 끝난 뒤 즉시 종료 여부를 확정한다. */
export function settleGameFlow(state: GameState): LoopOutcome | undefined {
  if (state.gamePhase !== "ROUND") return undefined;

  const immediate = evaluateLoss(state).filter(
    (condition) => condition.timing === "immediate" && condition.activated,
  );
  if (immediate.length > 0) {
    requestLoopEnd(
      state,
      "effect",
      immediate.map(({ key }) => key),
    );
  }

  return state.pendingLoopEnd ? finishLoop(state) : undefined;
}

/** 기존 9단계 advance를 게임 전체 상태 머신과 함께 실행한다. */
export function advanceGame(
  state: GameState,
  incidentChoice?: IncidentChoice,
): IncidentResult | undefined {
  if (state.gamePhase !== "ROUND") {
    throw new Error(`round phase cannot advance during ${state.gamePhase}`);
  }
  const result = advance(state, incidentChoice);
  settleGameFlow(state);
  return result;
}

/** 패배한 루프의 결과 화면에서 다음 루프 또는 최후의 싸움으로 이동한다. */
export function continueAfterLoopJudgment(state: GameState): void {
  if (state.gamePhase !== "LOOP_JUDGMENT") {
    throw new Error(`loop judgment cannot continue during ${state.gamePhase}`);
  }
  const outcome = state.loopOutcomes.at(-1);
  if (!outcome || outcome.loop !== state.loop.loop) {
    throw new Error("current loop outcome is missing");
  }
  if (outcome.result !== "protagonistsLost") {
    throw new Error("a protagonist victory cannot continue to another loop");
  }

  if (state.loop.loop >= state.scenario.loops) {
    prepareFinalGuess(state, "finalLoopLoss");
    return;
  }

  const leader = state.loop.leader;
  const nextLoop = initLoop(state.scenario);
  nextLoop.loop = state.loop.loop + 1;
  nextLoop.leader = leader;
  state.loop = nextLoop;
  state.gamePhase = "LOOP_TIME_GAP";
  resetTimeGapTimer(state);
}

/** 최후의 싸움 판정 전에 보드·카운터를 반드시 초기 상태로 되돌린다. */
export function prepareFinalGuess(
  state: GameState,
  reason: "timeGap" | "finalLoopLoss",
): void {
  if (
    reason === "timeGap" && state.gamePhase !== "LOOP_TIME_GAP" ||
    reason === "finalLoopLoss" && state.gamePhase !== "LOOP_JUDGMENT"
  ) {
    throw new Error(`final guess cannot start during ${state.gamePhase}`);
  }

  const loopNumber = state.loop.loop;
  const leader = state.loop.leader;
  const reset = initLoop(state.scenario);
  reset.loop = loopNumber;
  reset.leader = leader;
  state.loop = reset;

  delete state.pendingLoopEnd;
  delete state.timeGapTimer;
  state.finalGuess = { reason, attempts: [] };
  state.gamePhase = "FINAL_GUESS";
}

export function skipToFinalGuess(state: GameState): void {
  prepareFinalGuess(state, "timeGap");
}

/** 한 캐릭터의 역할 선언을 판정하고 모든 등장 캐릭터 정답 여부를 확인한다. */
export function submitFinalGuess(
  state: GameState,
  character: CharacterId,
  guessedRole: RoleId,
): FinalGuessAttempt {
  if (state.gamePhase !== "FINAL_GUESS" || !state.finalGuess) {
    throw new Error(`final guess is not active during ${state.gamePhase}`);
  }
  if (!(character in state.scenario.cast)) {
    throw new Error(`unknown scenario character "${character}"`);
  }
  if (state.finalGuess.attempts.some((attempt) =>
    attempt.character === character
  )) {
    throw new Error(`character "${character}" was already guessed`);
  }

  // prepareFinalGuess()가 카운터를 먼저 제거했으므로 망상 확대 바이러스의
  // 일시적 연쇄 살인마 변이는 여기서 성립하지 않는다. 변수는 계속 factor다.
  const actualRole = effectiveRole(state, character);
  const attempt: FinalGuessAttempt = {
    character,
    guessedRole,
    actualRole,
    correct: guessedRole === actualRole,
  };
  state.finalGuess.attempts.push(attempt);

  if (!attempt.correct) {
    state.result = { winner: "mastermind", reason: "finalGuessFailure" };
    state.gamePhase = "GAME_OVER";
    return attempt;
  }

  if (
    state.finalGuess.attempts.length ===
      Object.keys(state.scenario.cast).length
  ) {
    state.result = { winner: "protagonists", reason: "finalGuessSuccess" };
    state.gamePhase = "GAME_OVER";
  }
  return attempt;
}
