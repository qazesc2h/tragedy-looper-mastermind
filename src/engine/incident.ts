import { characterDataOf } from "../data";
import { INCIDENT_IMPL } from "../impl/incidents";
import type {
  CharacterId,
  GameState,
  IncidentChoice,
  IncidentResult,
} from "../types";

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
  const impl = INCIDENT_IMPL[incident];
  if (!impl) {
    throw new Error(`unknown incident "${incident}"`);
  }

  // 조건은 효과 적용 전에 모두 판정한다.
  const activeHooks = impl.hooks.filter((hook) => hook.when(state, culprit));
  let effectApplied = false;
  for (const hook of activeHooks) {
    effectApplied = hook.effect(state, culprit, choice) || effectApplied;
  }
  return effectApplied;
}

/** 사건의 공통 발생 조건 두 가지를 판정한다. */
export function incidentFires(
  state: GameState,
  culprit: CharacterId,
): boolean {
  const position = state.loop.board[culprit];
  const counters = state.loop.charCounters[culprit];
  if (!position || !counters) {
    throw new Error(`incident culprit "${culprit}" is not on the board`);
  }

  if (state.loop.incidentCulpritSuppressedFor?.includes(culprit)) {
    return false;
  }

  return position.alive &&
    counters.paranoia >= characterDataOf(culprit).paranoiaLimit;
}

/** 현재 날짜에 예정된 사건을 판정하고, 발생했다면 그 효과를 해결한다. */
export function resolveIncident(
  state: GameState,
  choice?: IncidentChoice,
): IncidentResult {
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
  const effectApplied = scheduled.culprit === "blackCat"
    ? false
    : resolveIncidentEffect(
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

  return { ...base, fired: true, effectApplied };
}
