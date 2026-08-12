import {
  effectiveRole,
  type CharacterId,
  type FinalGuessAttempt,
  type GameState,
  type IncidentChoice,
  type IncidentCounter,
  type IncidentFailureReason,
  type IncidentResult,
  type Location,
  type LoopOutcome,
  type Phase,
  type RecordedLoss,
  type RoleId,
  type Scenario,
} from "../types";
import { tragedySetDefinition } from "../tragedy-sets";
import { requestLoopEnd } from "./flow";
import { incidentFailureReasons } from "./incident";
import { evaluateLoss, type LossCondition } from "./loss";
import { advance, collectHooks, resolveHooks } from "./phases";
import { recordPhaseLog } from "./phase-log";
import { publicObservationContext } from "./public-observation";
import { initLoop } from "./setup";

const TIME_GAP_SECONDS = 10 * 60;

function resetTimeGapTimer(state: GameState): void {
  state.timeGapTimer = { remainingSeconds: TIME_GAP_SECONDS };
}

/** 현재 루프 준비에 필요한 캐릭터 특성 선택을 모두 받았는지 확인한다. */
export function loopStartTraitChoicesComplete(state: GameState): boolean {
  const scientistComplete = !("scientist" in state.scenario.cast) ||
    state.loop.loopStartTraitCounterChoices?.scientist !== undefined;
  const henchmanComplete = !("henchman" in state.scenario.cast) ||
    state.loop.loopStartTraitLocationChoices?.henchman !== undefined;
  return scientistComplete && henchmanComplete;
}

/** 루프 시작 전에 각본가가 고르는 캐릭터 특성 카운터를 기록한다. */
export function setLoopStartTraitCounterChoice(
  state: GameState,
  character: CharacterId,
  counter: IncidentCounter | undefined,
): void {
  if (state.gamePhase !== "LOOP_TIME_GAP") {
    throw new Error(
      `loop-start trait choice cannot change during ${state.gamePhase}`,
    );
  }
  if (character !== "scientist" || !(character in state.scenario.cast)) {
    throw new Error(`character "${character}" has no loop-start counter choice`);
  }

  if (counter === undefined) {
    if (!state.loop.loopStartTraitCounterChoices) return;
    delete state.loop.loopStartTraitCounterChoices[character];
    if (Object.keys(state.loop.loopStartTraitCounterChoices).length === 0) {
      delete state.loop.loopStartTraitCounterChoices;
    }
    return;
  }

  const choices = state.loop.loopStartTraitCounterChoices ??= {};
  choices[character] = counter;
}

/** 루프 시작 전에 각본가가 고르는 캐릭터 시작 장소를 기록한다. */
export function setLoopStartTraitLocationChoice(
  state: GameState,
  character: CharacterId,
  location: Location | undefined,
): void {
  if (state.gamePhase !== "LOOP_TIME_GAP") {
    throw new Error(
      `loop-start trait choice cannot change during ${state.gamePhase}`,
    );
  }
  if (character !== "henchman" || !(character in state.scenario.cast)) {
    throw new Error(`character "${character}" has no loop-start location choice`);
  }

  if (location === undefined) {
    if (!state.loop.loopStartTraitLocationChoices) return;
    delete state.loop.loopStartTraitLocationChoices[character];
    if (Object.keys(state.loop.loopStartTraitLocationChoices).length === 0) {
      delete state.loop.loopStartTraitLocationChoices;
    }
    return;
  }

  const choices = state.loop.loopStartTraitLocationChoices ??= {};
  choices[character] = location;
}

/** 새 게임을 만들고 자동 게임 준비 단계를 진행해 리더 선택에서 멈춘다. */
export function createGameState(scenario: Scenario): GameState {
  const state: GameState = {
    scenario,
    gamePhase: "SETUP_SCENARIO",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
    extraLoopsPlayed: 0,
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
  if (!loopStartTraitChoicesComplete(state)) {
    if (
      "henchman" in state.scenario.cast &&
      state.loop.loopStartTraitLocationChoices?.henchman === undefined
    ) {
      throw new Error("henchman loop-start location choice is required");
    }
    throw new Error("scientist loop-start counter choice is required");
  }

  const loopNumber = state.loop.loop;
  const leader = state.loop.leader;
  const loopStartTraitCounterChoices =
    state.loop.loopStartTraitCounterChoices;
  const loopStartTraitLocationChoices =
    state.loop.loopStartTraitLocationChoices;

  state.gamePhase = "LOOP_CHARACTER_PLACEMENT";
  const prepared = initLoop(state.scenario, loopNumber);
  prepared.leader = leader;
  if (loopStartTraitCounterChoices !== undefined) {
    prepared.loopStartTraitCounterChoices = {
      ...loopStartTraitCounterChoices,
    };
  }
  if (loopStartTraitLocationChoices !== undefined) {
    prepared.loopStartTraitLocationChoices = {
      ...loopStartTraitLocationChoices,
    };
  }
  state.loop = prepared;
  resolveHooks(state, "LOOP_CHARACTER_PLACEMENT");

  state.gamePhase = "LOOP_COUNTER_SETUP";
  resolveHooks(state, "LOOP_START");

  state.gamePhase = "LOOP_CARD_DISTRIBUTION";
  // initLoop()이 소진 카드·능력·배치 카드를 빈 상태로 만들었다.

  delete state.timeGapTimer;
  state.gamePhase = "ROUND";
  advanceAutomaticRoundPhases(state);
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
  delete state.loop.pendingImmediateLossKeys;
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

  const immediateLossKeys = state.loop.pendingImmediateLossKeys ?? [];
  if (immediateLossKeys.length > 0) {
    requestLoopEnd(
      state,
      "effect",
      immediateLossKeys,
    );
  }

  return state.pendingLoopEnd ? finishLoop(state) : undefined;
}

function activeHookExists(state: GameState, phase: Phase): boolean {
  return collectHooks(state, phase).some(
    ({ hook, self }) => hook.when(state, self),
  );
}

function phaseAlreadyLogged(
  state: GameState,
  loop: number,
  day: number,
  phase: Phase,
): boolean {
  return state.loop.phaseLog?.some((entry) =>
    entry.loop === loop && entry.day === day && entry.phase === phase
  ) ?? false;
}

function roundEndNeedsAttention(state: GameState): boolean {
  if (state.loop.day === state.scenario.daysPerLoop) return true;
  if (activeHookExists(state, "P9_ROUND_END")) return true;
  return evaluateLoss(state).some(
    (condition) => condition.met && condition.blockedBy === undefined,
  );
}

function advanceRoundOnce(
  state: GameState,
  incidentChoice?: IncidentChoice,
  deferSettlement = false,
): IncidentResult | undefined {
  const phase = state.loop.phase;
  const loop = state.loop.loop;
  const day = state.loop.day;
  const leader = state.loop.leader;
  const scheduled = phase === "P7_INCIDENT"
    ? state.scenario.incidents.find((incident) => incident.day === day)
    : undefined;
  const failureReasons: IncidentFailureReason[] = scheduled
    ? incidentFailureReasons(state, scheduled.culprit)
    : [];
  const livingBeforeIncident = phase === "P7_INCIDENT"
    ? new Set(Object.entries(state.loop.board)
      .filter(([, position]) => position.status === "alive")
      .map(([character]) => character))
    : new Set<string>();
  const incidentContext = phase === "P7_INCIDENT"
    ? publicObservationContext(state.loop)
    : undefined;

  const result = advance(state, incidentChoice);

  if (phase === "P1_ROUND_START") {
    if (!phaseAlreadyLogged(state, loop, day, phase)) {
      recordPhaseLog(state, { loop, day, phase, kind: "phaseCompleted" });
    }
  } else if (phase === "P2_MASTERMIND_ACTION") {
    recordPhaseLog(state, {
      loop,
      day,
      phase,
      kind: "cardsPlaced",
      placements: structuredClone(
        state.loop.placed.filter(({ owner }) => owner === "mastermind"),
      ),
    });
  } else if (phase === "P3_PROTAGONIST_ACTION") {
    recordPhaseLog(state, {
      loop,
      day,
      phase,
      kind: "cardsPlaced",
      placements: structuredClone(
        state.loop.placed.filter(({ owner }) => owner !== "mastermind"),
      ),
    });
  } else if (phase === "P5_MASTERMIND_ABILITY") {
    if (!phaseAlreadyLogged(state, loop, day, phase)) {
      recordPhaseLog(state, { loop, day, phase, kind: "abilitySkipped" });
    }
  } else if (phase === "P6_GOODWILL") {
    if (!phaseAlreadyLogged(state, loop, day, phase)) {
      recordPhaseLog(state, { loop, day, phase, kind: "goodwillSkipped" });
    }
  } else if (phase === "P7_INCIDENT") {
    const deaths = [...livingBeforeIncident].filter(
      (character) => state.loop.board[character]?.status === "dead",
    );
    const protagonistsDied =
      state.pendingLoopEnd?.reason === "protagonistDeath";
    if (!scheduled) {
      recordPhaseLog(state, {
        loop,
        day,
        phase,
        kind: "notApplicable",
      });
    } else if (result) {
      recordPhaseLog(state, {
        loop,
        day,
        phase,
        kind: "incidentJudged",
        incident: scheduled.incident,
        culprit: scheduled.culprit,
        fired: result.fired,
        effectApplied: result.effectApplied,
        failureReasons: result.fired ? [] : failureReasons,
        ...(incidentContext === undefined
          ? {}
          : { publicContext: incidentContext }),
        ...(deaths.length > 0 ? { deaths } : {}),
        ...(protagonistsDied ? { protagonistsDied: true } : {}),
      });
    }
  } else if (phase === "P8_LEADER_PASS") {
    recordPhaseLog(state, {
      loop,
      day,
      phase,
      kind: "leaderPassed",
      from: leader,
      to: state.loop.leader,
    });
  } else if (
    phase === "P9_ROUND_END" &&
    !phaseAlreadyLogged(state, loop, day, phase) &&
    (
      state.pendingLoopEnd !== undefined ||
      state.loop.phase !== "P9_ROUND_END"
    )
  ) {
    recordPhaseLog(state, {
      loop,
      day,
      phase,
      kind: "roundEnded",
      loopEnded: state.pendingLoopEnd !== undefined,
    });
  }

  if (!deferSettlement) settleGameFlow(state);
  return result;
}

/** 내용이 없는 단계와 리더 교대를 연속 처리하고 각 단계를 기록한다. */
export function advanceAutomaticRoundPhases(
  state: GameState,
  deferSettlement = false,
): void {
  while (state.gamePhase === "ROUND") {
    const phase = state.loop.phase;
    const noActiveHook = (
      phase === "P1_ROUND_START" || phase === "P5_MASTERMIND_ABILITY"
    ) && !activeHookExists(state, phase);

    if (noActiveHook) {
      recordPhaseLog(state, {
        loop: state.loop.loop,
        day: state.loop.day,
        phase,
        kind: "notApplicable",
      });
      advanceRoundOnce(state, undefined, deferSettlement);
      continue;
    }

    if (
      phase === "P7_INCIDENT" &&
      !state.scenario.incidents.some(({ day }) => day === state.loop.day)
    ) {
      advanceRoundOnce(state, undefined, deferSettlement);
      continue;
    }

    if (phase === "P8_LEADER_PASS") {
      advanceRoundOnce(state, undefined, deferSettlement);
      continue;
    }

    if (phase === "P9_ROUND_END" && !roundEndNeedsAttention(state)) {
      recordPhaseLog(state, {
        loop: state.loop.loop,
        day: state.loop.day,
        phase,
        kind: "notApplicable",
      });
      advanceRoundOnce(state, undefined, deferSettlement);
      continue;
    }

    break;
  }
}

/** 기존 9단계 advance 뒤 자동 통과 가능한 후속 단계를 함께 실행한다. */
export function advanceGame(
  state: GameState,
  incidentChoice?: IncidentChoice,
  options: { deferSettlement?: boolean } = {},
): IncidentResult | undefined {
  if (state.gamePhase !== "ROUND") {
    throw new Error(`round phase cannot advance during ${state.gamePhase}`);
  }
  const deferSettlement = options.deferSettlement ?? false;
  const result = advanceRoundOnce(state, incidentChoice, deferSettlement);
  advanceAutomaticRoundPhases(state, deferSettlement);
  return result;
}

function requireCurrentLoopLoss(state: GameState): void {
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
}

function prepareNextLoop(state: GameState): void {
  const leader = state.loop.leader;
  const nextLoop = initLoop(state.scenario, state.loop.loop + 1);
  nextLoop.leader = leader;
  state.loop = nextLoop;
  state.gamePhase = "LOOP_TIME_GAP";
  resetTimeGapTimer(state);
}

/** 패배한 루프의 결과 화면에서 다음 루프 또는 최후의 싸움으로 이동한다. */
export function continueAfterLoopJudgment(state: GameState): void {
  requireCurrentLoopLoss(state);

  if (state.loop.loop >= state.scenario.loops) {
    if (tragedySetDefinition(state.scenario.tragedySet).hasFinalGuess) {
      prepareFinalGuess(state, "finalLoopLoss");
    } else {
      state.result = { winner: "mastermind", reason: "allLoopsLost" };
      state.gamePhase = "GAME_OVER";
    }
    return;
  }

  prepareNextLoop(state);
}

/**
 * 최종 루프 패배 뒤 공개 하우스 룰로 추가 루프를 시작한다.
 * BakaFire 공식 FAQ Ru07: 모든 참가자에게 알린 특수 규칙은 특정 각본에
 * 적용할 수 있다. 공식 각본의 loops 값은 바꾸지 않고 실제 진행만 연장한다.
 */
export function startHouseRuleExtraLoop(state: GameState): void {
  requireCurrentLoopLoss(state);
  if (state.loop.loop < state.scenario.loops) {
    throw new Error("an extra loop can start only after the final loop");
  }

  state.extraLoopsPlayed = (state.extraLoopsPlayed ?? 0) + 1;
  prepareNextLoop(state);
}

/** 최후의 싸움 판정 전에 보드·카운터를 반드시 초기 상태로 되돌린다. */
export function prepareFinalGuess(
  state: GameState,
  reason: "timeGap" | "finalLoopLoss",
): void {
  if (!tragedySetDefinition(state.scenario.tragedySet).hasFinalGuess) {
    throw new Error(
      `tragedy set "${state.scenario.tragedySet}" has no final guess`,
    );
  }
  if (
    reason === "timeGap" && state.gamePhase !== "LOOP_TIME_GAP" ||
    reason === "finalLoopLoss" && state.gamePhase !== "LOOP_JUDGMENT"
  ) {
    throw new Error(`final guess cannot start during ${state.gamePhase}`);
  }

  const loopNumber = state.loop.loop;
  const leader = state.loop.leader;
  const reset = initLoop(state.scenario, loopNumber);
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
