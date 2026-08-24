import { characterDataOf } from "../data";
import { INCIDENT_IMPL } from "../impl/incidents";
import { isCharacterAlive, isCharacterPresent } from "../types";
import type {
  CharacterId,
  GameState,
  IncidentChoice,
  IncidentFailureReason,
  IncidentResult,
} from "../types";
import { withDeathBatch } from "./death";
import { publicBoardChanges } from "./public-observation";

type IncidentEffectResult = {
  effectApplied: boolean;
  publicChanges?: ReturnType<typeof publicBoardChanges>;
};

const resolvedIncidentPublicChanges = new WeakMap<
  GameState,
  ReturnType<typeof publicBoardChanges>
>();

/** P7 로그 기록기가 방금 해결된 사건 본체의 공개 변화만 한 번 가져간다. */
export function takeResolvedIncidentPublicChanges(
  state: GameState,
): ReturnType<typeof publicBoardChanges> | undefined {
  const changes = resolvedIncidentPublicChanges.get(state);
  resolvedIncidentPublicChanges.delete(state);
  return changes;
}

/** AI만 사건 발생 판정에서 캐릭터 위의 모든 카운터를 불안으로 센다. */
export function incidentParanoia(
  state: GameState,
  culprit: CharacterId,
): number {
  const counters = state.loop.charCounters[culprit];
  if (!counters) {
    throw new Error(`incident culprit "${culprit}" has no counters`);
  }
  if (culprit !== "ai") return counters.paranoia;
  return counters.goodwill + counters.paranoia + counters.intrigue +
    counters.protection;
}

/** 예정 사건이 발생하지 않는 이유를 각본가 화면에 표시한다. */
export function incidentFailureReasons(
  state: GameState,
  culprit: CharacterId,
): IncidentFailureReason[] {
  const position = state.loop.board[culprit];
  const counters = state.loop.charCounters[culprit];
  if (!position || !counters) {
    throw new Error(`incident culprit "${culprit}" is not on the board`);
  }

  const reasons: IncidentFailureReason[] = [];
  if (!isCharacterPresent(position)) return ["culpritAbsent"];
  if (!isCharacterAlive(position)) reasons.push("culpritDead");
  if (incidentParanoia(state, culprit) < characterDataOf(culprit).paranoiaLimit) {
    reasons.push("insufficientParanoia");
  }
  if (state.loop.incidentCulpritSuppressedFor?.includes(culprit)) {
    reasons.push("culpritSuppressed");
  }
  return reasons;
}

/**
 * 지정한 사건의 효과만 해결한다.
 * 발생 조건 판정과 발생 이력 기록은 호출자가 별도로 담당한다.
 */
export function resolveIncidentEffect(
  state: GameState,
  incident: string,
  culprit: CharacterId,
  choice?: IncidentChoice,
): boolean {
  return resolveIncidentEffectResult(state, incident, culprit, choice)
    .effectApplied;
}

function resolveIncidentEffectResult(
  state: GameState,
  incident: string,
  culprit: CharacterId,
  choice?: IncidentChoice,
): IncidentEffectResult {
  const impl = INCIDENT_IMPL[incident];
  if (!impl) {
    throw new Error(`unknown incident "${incident}"`);
  }

  // 조건은 효과 적용 전에 모두 판정한다. 활성 훅 전체가 P7 사망 배치 하나다.
  const before = structuredClone(state.loop);
  const activeHooks = impl.hooks.filter((hook) => hook.when(state, culprit));
  return withDeathBatch(state, () => {
    let effectApplied = false;
    for (const hook of activeHooks) {
      effectApplied = hook.effect(state, culprit, choice) || effectApplied;
    }
    const publicChanges = publicBoardChanges(before, state.loop);
    return {
      effectApplied,
      ...(publicChanges.length === 0 ? {} : { publicChanges }),
    };
  });
}

/** 사건의 공통 발생 조건 두 가지를 판정한다. */
export function incidentFires(
  state: GameState,
  culprit: CharacterId,
): boolean {
  return incidentFailureReasons(state, culprit).length === 0;
}

/** 현재 날짜에 예정된 사건을 판정하고, 발생했다면 그 효과를 해결한다. */
export function resolveIncident(
  state: GameState,
  choice?: IncidentChoice,
): IncidentResult {
  resolvedIncidentPublicChanges.delete(state);
  const scheduled = state.scenario.incidents.find(
    ({ day }) => day === state.loop.day,
  );
  if (!scheduled) {
    return { fired: false, effectApplied: false };
  }

  const base = {
    incident: scheduled.incident,
    culprit: scheduled.culprit,
  };
  if (!incidentFires(state, scheduled.culprit)) {
    return { ...base, fired: false, effectApplied: false };
  }

  // 검은 고양이는 사건이 발생한 뒤 효과만 "효과 없음"으로 바꾼다.
  const effectResult = scheduled.culprit === "blackCat"
    ? { effectApplied: false }
    : resolveIncidentEffectResult(
      state,
      scheduled.incident,
      scheduled.culprit,
      choice,
    );

  const firedIncidents = state.loop.incidentsFiredThisLoop ??= [];
  if (!firedIncidents.includes(scheduled.incident)) {
    firedIncidents.push(scheduled.incident);
  }
  const firedOccurrences = state.loop.incidentOccurrencesFiredThisLoop ??= [];
  if (!firedOccurrences.some(({ day, incident, culprit }) =>
    day === scheduled.day &&
    incident === scheduled.incident &&
    culprit === scheduled.culprit
  )) {
    firedOccurrences.push({ ...scheduled });
  }

  if (effectResult.publicChanges !== undefined) {
    resolvedIncidentPublicChanges.set(state, effectResult.publicChanges);
  }

  return { ...base, fired: true, effectApplied: effectResult.effectApplied };
}
