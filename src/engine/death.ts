import { effectiveRole } from "../types";
import type { CharacterId, GameState } from "../types";
import { requestLoopEnd } from "./flow";
import {
  activatedImmediateLossKeys,
  reconcilePendingImmediateLosses,
  resolveHooks,
} from "./phases";

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
    return operation();
  } finally {
    batch.depth -= 1;
    if (batch.depth === 0) {
      closeDeathBatch(state, batch);
    }
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

/** 사망을 시도하고 실제로 사망 상태가 되었는지를 반환한다. */
export function killCharacter(
  state: GameState,
  character: CharacterId,
): boolean {
  return withDeathBatch(state, () => {
    const { position, counters } = characterState(state, character);

    // 형사 FAQ: 불사로 사망하지 않으면 보호 카운터를 제거하지 않는다.
    if (effectiveRole(state, character) === "timeTraveler") {
      return false;
    }
    if (!position.alive) {
      return false;
    }
    if (counters.protection > 0) {
      counters.protection -= 1;
      return false;
    }

    position.alive = false;
    const batch = deathBatches.get(state);
    if (batch === undefined) {
      throw new Error("death batch is not active");
    }
    batch.deadCharacters.push(character);
    return true;
  });
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
  if (position.alive) {
    return false;
  }

  position.alive = true;
  return true;
}
