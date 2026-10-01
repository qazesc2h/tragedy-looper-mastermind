import { totalCharacterCounters } from "../counters";
import { characterDataOf } from "../data";
import { INCIDENT_IMPL } from "../impl/incidents";
import { isCharacterAlive, isCharacterPresent } from "../types";
import type {
  CharacterId,
  GameState,
  IncidentChoice,
  IncidentChoiceInput,
  IncidentCulprit,
  IncidentFailureReason,
  IncidentResolutionResult,
  IncidentResult,
  PublicBoardChange,
  PublicObservationContext,
  ScheduledIncident,
  Target,
} from "../types";
import { withDeathBatch } from "./death";
import { incidentDefinition } from "./incident-definition";
import {
  characterCulprit,
  incidentChoiceTargets,
  incidentOccurrenceId,
  incidentSubIncidentDecision,
  normalizeIncidentChoice,
  normalizeIncidentCulprit,
  normalizeIncidentSchedule,
} from "./incident-model";
import {
  publicBoardChanges,
  publicObservationContext,
} from "./public-observation";

type IncidentEffectResult = {
  effectApplied: boolean;
  publicChanges?: PublicBoardChange[];
};

export interface ResolvedIncidentOccurrence extends IncidentResult {
  failureReasons: IncidentFailureReason[];
  targets?: Target[];
  publicContext: PublicObservationContext;
  publicChanges?: PublicBoardChange[];
  deaths?: CharacterId[];
  protagonistsDied?: boolean;
}

export interface ResolvedIncidentBatch extends IncidentResolutionResult {
  occurrences: ResolvedIncidentOccurrence[];
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
  return totalCharacterCounters(counters);
}

/** 예정 사건이 발생하지 않는 이유를 각본가 화면에 표시한다. */
export function incidentFailureReasons(
  state: GameState,
  culpritInput: IncidentCulprit | CharacterId,
  incident = "",
): IncidentFailureReason[] {
  const culprit = normalizeIncidentCulprit(culpritInput);
  const policy = incidentDefinition(incident).triggerPolicy;
  if (culprit.kind === "location") {
    if (policy.kind === "locationIntrigue") {
      return state.loop.locIntrigue[culprit.at] >= policy.required
        ? []
        : ["insufficientLocationIntrigue"];
    }
    if (policy.kind === "locationCorpseCount") {
      const corpses = Object.values(state.loop.board).filter(
        (position) => position.status === "dead" && position.at === culprit.at,
      ).length;
      return corpses >= policy.required ? [] : ["insufficientCorpses"];
    }
    throw new Error(`incident "${incident}" requires a character culprit`);
  }

  const character = culprit.id;
  const position = state.loop.board[character];
  const counters = state.loop.charCounters[character];
  if (!position || !counters) {
    throw new Error(`incident culprit "${character}" is not on the board`);
  }
  if (!isCharacterPresent(position)) return ["culpritAbsent"];

  const reasons: IncidentFailureReason[] = [];
  if (policy.kind === "deadCharacter") {
    if (isCharacterAlive(position)) reasons.push("culpritAlive");
  } else {
    if (!isCharacterAlive(position)) reasons.push("culpritDead");
    if (
      policy.kind === "characterParanoia" &&
      incidentParanoia(state, character) <
        characterDataOf(character).paranoiaLimit +
          policy.paranoiaLimitAdjustment
    ) {
      reasons.push("insufficientParanoia");
    }
    if (
      policy.kind === "characterIntrigue" &&
      counters.intrigue < policy.required
    ) {
      reasons.push("insufficientIntrigue");
    }
  }
  if (state.loop.incidentCulpritSuppressedFor?.includes(character)) {
    reasons.push("culpritSuppressed");
  }
  return reasons;
}

/** 지정한 사건의 효과만 해결한다. 발생 판정과 이력 기록은 호출자가 맡는다. */
export function resolveIncidentEffect(
  state: GameState,
  incident: string,
  culprit: IncidentCulprit | CharacterId,
  choiceInput?: IncidentChoiceInput,
): boolean {
  return resolveIncidentEffectResult(
    state,
    incident,
    normalizeIncidentCulprit(culprit),
    normalizeIncidentChoice(choiceInput),
  ).effectApplied;
}

function resolveIncidentEffectResult(
  state: GameState,
  incident: string,
  culprit: IncidentCulprit,
  choice?: IncidentChoice,
): IncidentEffectResult {
  const impl = INCIDENT_IMPL[incident];
  if (!impl) throw new Error(`unknown incident "${incident}"`);

  const before = structuredClone(state.loop);
  const activeHooks = impl.hooks.filter((hook) => hook.when(state, culprit));
  return withDeathBatch(state, () => {
    let effectApplied = false;
    for (const hook of activeHooks) {
      effectApplied = hook.effect(state, culprit, choice) || effectApplied;
    }
    const changes = publicBoardChanges(before, state.loop);
    return {
      effectApplied,
      ...(changes.length === 0 ? {} : { publicChanges: changes }),
    };
  });
}

/** 사건 정의에 등록된 공통 발생 조건을 판정한다. */
export function incidentFires(
  state: GameState,
  culprit: IncidentCulprit | CharacterId,
  incident = "",
): boolean {
  return incidentFailureReasons(state, culprit, incident).length === 0;
}

function resolveScheduledIncident(
  state: GameState,
  scheduled: ScheduledIncident,
  choice: IncidentChoice | undefined,
): ResolvedIncidentOccurrence {
  const occurrenceId = incidentOccurrenceId(scheduled);
  const publicContext = publicObservationContext(state.loop);
  const livingBefore = new Set(Object.entries(state.loop.board)
    .filter(([, position]) => position.status === "alive")
    .map(([character]) => character));
  const failureReasons = incidentFailureReasons(
    state,
    scheduled.culprit,
    scheduled.incident,
  );
  const base = {
    occurrenceId,
    occurrenceIndex: scheduled.occurrenceIndex,
    incident: scheduled.incident,
    culprit: scheduled.culprit,
    publicContext,
    failureReasons,
  };
  if (failureReasons.length > 0) {
    return { ...base, fired: false, effectApplied: false };
  }

  const beforeEffects = structuredClone(state.loop);
  const culpritCharacter = characterCulprit(scheduled.culprit);
  const firstEffect = culpritCharacter === "blackCat"
    ? { effectApplied: false }
    : resolveIncidentEffectResult(
      state,
      scheduled.incident,
      scheduled.culprit,
      choice,
    );
  let effectApplied = firstEffect.effectApplied;
  if (culpritCharacter === "sectFounder" && firstEffect.effectApplied) {
    const secondEffect = resolveIncidentEffectResult(
      state,
      scheduled.incident,
      scheduled.culprit,
      incidentSubIncidentDecision(choice),
    );
    effectApplied = secondEffect.effectApplied || effectApplied;
  }
  const changes = publicBoardChanges(beforeEffects, state.loop);
  const deaths = [...livingBefore].filter(
    (character) => state.loop.board[character]?.status === "dead",
  );
  const targets = incidentChoiceTargets(choice);

  const firedIncidents = state.loop.incidentsFiredThisLoop ??= [];
  if (!firedIncidents.includes(scheduled.incident)) {
    firedIncidents.push(scheduled.incident);
  }
  const firedOccurrences = state.loop.incidentOccurrencesFiredThisLoop ??= [];
  if (!firedOccurrences.some((occurrence) =>
    incidentOccurrenceId(occurrence) === occurrenceId
  )) {
    firedOccurrences.push(structuredClone(scheduled));
  }

  return {
    ...base,
    fired: true,
    effectApplied,
    failureReasons: [],
    ...(targets.length === 0 ? {} : { targets }),
    ...(changes.length === 0 ? {} : { publicChanges: changes }),
    ...(deaths.length === 0 ? {} : { deaths }),
    ...(state.pendingLoopEnd?.reason === "protagonistDeath"
      ? { protagonistsDied: true }
      : {}),
  };
}

/** 현재 날짜의 모든 사건을 각본 기재 순서대로 독립 해결한다. */
export function resolveIncident(
  state: GameState,
  choiceInput?: IncidentChoiceInput | readonly IncidentChoiceInput[],
): ResolvedIncidentBatch {
  const scheduled = normalizeIncidentSchedule(state.scenario.incidents).filter(
    ({ day }) => day === state.loop.day,
  );
  const rawChoices = choiceInput === undefined
    ? []
    : Array.isArray(choiceInput)
    ? choiceInput
    : [choiceInput];
  const choices = rawChoices.map((choice) => normalizeIncidentChoice(choice));
  return {
    occurrences: scheduled.map((incident, index) =>
      resolveScheduledIncident(state, incident, choices[index])
    ),
  };
}
