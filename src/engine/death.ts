import {
  effectiveRole,
  isCharacterAlive,
  isCharacterDead,
  withCharacterLife,
} from "../types";
import type { CharacterId, GameState } from "../types";
import { requestLoopEnd } from "./flow";
import {
  activatedImmediateLossKeys,
  reconcilePendingImmediateLosses,
  resolveHooks,
} from "./phases";
import { recordRoundDeathBatch } from "./round-evidence";
import { recordPhaseLog } from "./phase-log";
import {
  publicBoardChanges,
  publicObservationContext,
} from "./public-observation";
import {
  SERVANT_TRAIT_SOURCE,
  servantDeathReplacement,
} from "./servant";

export interface ProtagonistDeathResult {
  died: boolean;
  blockedBy?: CharacterId;
}

interface DeathBatch {
  depth: number;
  deadCharacters: CharacterId[];
  immediateLossKeysBefore: string[];
}

const deathBatches = new WeakMap<GameState, DeathBatch>();

function closeDeathBatch(state: GameState, batch: DeathBatch): void {
  deathBatches.delete(state);
  if (batch.deadCharacters.length > 0) {
    recordRoundDeathBatch(state, batch.deadCharacters);
    // 현재 배치를 먼저 닫아 ON_DEATH 효과가 새 사망을 만들면 별도 배치로
    // 처리한다. 이미 죽은 캐릭터는 killCharacter가 거부하므로 재귀도 끝난다.
    resolveHooks(state, "ON_DEATH", {
      kind: "death",
      deadCharacters: [...batch.deadCharacters],
    });
  }
  reconcilePendingImmediateLosses(state, batch.immediateLossKeysBefore);
}

/**
 * 하나의 원자적 효과 묶음에서 발생한 사망을 모은다.
 * 가장 바깥 호출이 끝날 때만 ON_DEATH를 한 번 해결한다.
 * 경계는 P4 행동 해결, P5/P9 강제 훅 묶음 또는 선택 훅 하나,
 * P6 우호 능력 선언 하나, P7 사건의 활성 훅 묶음이다.
 */
export function withDeathBatch<T>(
  state: GameState,
  operation: () => T,
): T {
  let batch = deathBatches.get(state);
  const outermost = batch === undefined;
  const rollback = outermost ? structuredClone(state) : undefined;
  if (batch === undefined) {
    batch = {
      depth: 0,
      deadCharacters: [],
      immediateLossKeysBefore: activatedImmediateLossKeys(state),
    };
    deathBatches.set(state, batch);
  }
  batch.depth += 1;

  try {
    const result = operation();
    batch.depth -= 1;
    if (batch.depth === 0) {
      closeDeathBatch(state, batch);
    }
    return result;
  } catch (error) {
    batch.depth -= 1;
    if (outermost && rollback !== undefined) {
      deathBatches.delete(state);
      const mutableState = state as unknown as Record<string, unknown>;
      for (const key of Object.keys(mutableState)) delete mutableState[key];
      Object.assign(mutableState, rollback);
    }
    throw error;
  }
}

/** 주인공 사망을 막는 현재 지속 효과를 부작용 없이 조회한다. */
export function protagonistDeathBlocker(
  state: GameState,
): CharacterId | undefined {
  return state.loop.protagonistDeathPreventedBy?.[0];
}

function characterState(state: GameState, character: CharacterId) {
  const position = state.loop.board[character];
  const counters = state.loop.charCounters[character];
  if (!position || !counters) {
    throw new Error(`unknown character "${character}"`);
  }
  return { position, counters };
}

function recordDeath(state: GameState, character: CharacterId): void {
  const position = state.loop.board[character];
  state.loop.board[character] = withCharacterLife(
    position,
    false,
    character,
  );
  const batch = deathBatches.get(state);
  if (batch === undefined) {
    throw new Error("death batch is not active");
  }
  batch.deadCharacters.push(character);
}

function killAfterDefenses(
  state: GameState,
  character: CharacterId,
  allowServantReplacement: boolean,
): boolean {
  const { position, counters } = characterState(state, character);

  // 형사 FAQ: 불사로 사망하지 않으면 보호 카운터를 제거하지 않는다.
  if (effectiveRole(state, character) === "timeTraveler") {
    return false;
  }
  if (!isCharacterAlive(position)) {
    return false;
  }
  if (counters.protection > 0) {
    counters.protection -= 1;
    return false;
  }

  const replacement = allowServantReplacement
    ? servantDeathReplacement(state, character)
    : undefined;
  if (replacement !== undefined) {
    const beforeReplacement = structuredClone(state.loop);
    // 원문은 메이드 자신이 불사일 때 원래 대상을 다시 죽이는지 설명하지
    // 않는다. QUESTIONS.md 확인 전에는 대체 후 메이드에게 통상 사망 방어를
    // 적용하되 원래 대상으로 되돌아가지 않는 보수적 처리를 사용한다.
    const died = killAfterDefenses(state, replacement, false);
    const publicChanges = publicBoardChanges(beforeReplacement, state.loop);
    if (publicChanges.length > 0) {
      recordPhaseLog(state, {
        loop: state.loop.loop,
        day: state.loop.day,
        phase: state.loop.phase,
        kind: "abilityActivated",
        timing: state.loop.phase,
        character: replacement,
        description: SERVANT_TRAIT_SOURCE,
        publicChanges,
        publicContext: publicObservationContext(beforeReplacement),
      });
    }
    return died;
  }

  recordDeath(state, character);
  return true;
}

/**
 * 사망을 시도하고 실제 사망자가 생겼는지를 반환한다.
 * 순서: 대상 불사 → 대상 보호 → 메이드 대체 → 실제 사망.
 */
export function killCharacter(
  state: GameState,
  character: CharacterId,
): boolean {
  return withDeathBatch(state, () =>
    killAfterDefenses(
      state,
      character,
      character !== "servant",
    )
  );
}

/**
 * 주인공 사망을 시도한다. 모든 주인공 사망 효과는 이 진입점을 사용한다.
 * 주인공 패배·보호 대상 캐릭터 사망은 이 함수의 범위가 아니다.
 */
export function attemptProtagonistDeath(
  state: GameState,
): ProtagonistDeathResult {
  const blockedBy = protagonistDeathBlocker(state);
  if (blockedBy !== undefined) {
    return { died: false, blockedBy };
  }

  requestLoopEnd(state, "protagonistDeath");
  return { died: true };
}

/** 부활을 시도하고 실제로 생존 상태가 되었는지를 반환한다. */
export function reviveCharacter(
  state: GameState,
  character: CharacterId,
): boolean {
  const { position } = characterState(state, character);
  if (!isCharacterDead(position)) {
    return false;
  }

  state.loop.board[character] = withCharacterLife(position, true, character);
  return true;
}
