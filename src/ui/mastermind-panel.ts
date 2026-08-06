import { characterDataOf } from "../data";
import { incidentFailureReasons, incidentFires } from "../engine/incident";
import type {
  CharacterId,
  GameState,
  IncidentFailureReason,
  ScheduledIncident,
} from "../types";

export type IncidentScheduleTiming = "past" | "today" | "future";
export type IncidentScheduleOutcome = "fired" | "notFired";

export interface IncidentScheduleRow extends ScheduledIncident {
  timing: IncidentScheduleTiming;
  daysUntil: number;
  paranoia: number;
  paranoiaLimit: number;
  paranoiaNeeded: number;
  conditionMet: boolean;
  currentFailureReasons: IncidentFailureReason[];
  outcome?: IncidentScheduleOutcome;
  effectApplied?: boolean;
  outcomeReasons: IncidentFailureReason[];
  /** false면 이전 저장 데이터라 정확한 미발생 사유가 남아 있지 않다. */
  judgmentRecorded: boolean;
}

function occurrenceFired(
  state: GameState,
  scheduled: ScheduledIncident,
): boolean {
  return state.loop.incidentOccurrencesFiredThisLoop?.some(
    ({ day, incident, culprit }) =>
      day === scheduled.day &&
      incident === scheduled.incident &&
      culprit === scheduled.culprit,
  ) === true;
}

/** 과거 판정과 현재 조건을 합쳐 전체 사건 일정 표의 행을 만든다. */
export function incidentScheduleRows(
  state: GameState,
): IncidentScheduleRow[] {
  return state.scenario.incidents
    .map((scheduled, index) => ({ scheduled, index }))
    .sort((left, right) =>
      left.scheduled.day - right.scheduled.day || left.index - right.index
    )
    .map(({ scheduled }) => {
      const paranoia = state.loop.charCounters[scheduled.culprit].paranoia;
      const paranoiaLimit = characterDataOf(scheduled.culprit).paranoiaLimit;
      const daysUntil = scheduled.day - state.loop.day;
      const timing: IncidentScheduleTiming = daysUntil < 0
        ? "past"
        : daysUntil === 0
        ? "today"
        : "future";
      const currentFailureReasons = incidentFailureReasons(
        state,
        scheduled.culprit,
      );
      const judgment = state.loop.phaseLog?.find((entry) =>
        entry.kind === "incidentJudged" &&
        entry.day === scheduled.day &&
        entry.incident === scheduled.incident &&
        entry.culprit === scheduled.culprit
      );

      let outcome: IncidentScheduleOutcome | undefined;
      let effectApplied: boolean | undefined;
      let outcomeReasons: IncidentFailureReason[] = [];
      if (judgment?.kind === "incidentJudged") {
        outcome = judgment.fired ? "fired" : "notFired";
        effectApplied = judgment.effectApplied;
        outcomeReasons = [...judgment.failureReasons];
      } else if (timing === "past") {
        outcome = occurrenceFired(state, scheduled) ? "fired" : "notFired";
      } else if (timing === "today" && occurrenceFired(state, scheduled)) {
        outcome = "fired";
      }

      return {
        ...scheduled,
        timing,
        daysUntil,
        paranoia,
        paranoiaLimit,
        paranoiaNeeded: Math.max(0, paranoiaLimit - paranoia),
        conditionMet: incidentFires(state, scheduled.culprit),
        currentFailureReasons,
        outcome,
        effectApplied,
        outcomeReasons,
        judgmentRecorded: judgment?.kind === "incidentJudged",
      };
    });
}

export function incidentScheduleRowsForCharacter(
  state: GameState,
  character: CharacterId,
): IncidentScheduleRow[] {
  return incidentScheduleRows(state).filter(
    ({ culprit }) => culprit === character,
  );
}

export function incidentDaysForCharacter(
  state: GameState,
  character: CharacterId,
): number[] {
  return state.scenario.incidents
    .filter(({ culprit }) => culprit === character)
    .map(({ day }) => day)
    .sort((left, right) => left - right);
}

export function incidentDayLabelsForCharacter(
  state: GameState,
  character: CharacterId,
): string[] {
  return incidentDaysForCharacter(state, character).map((day) => `${day}일`);
}
