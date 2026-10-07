import { totalCharacterCounters } from "../counters";
import { characterDataOf } from "../data";
import { INCIDENT_IMPL } from "../impl/incidents";
import {
  abilityLocationsOf,
  isCharacterAlive,
  isCharacterPresent,
} from "../types";
import { effectiveRole, characterLocation } from "../types";
import { effectiveAbilityRoles } from "../impl/roles";
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
  adjustSpecialGauge,
  incidentTriggeredGaugeDelta,
  specialGaugeDefinition,
} from "./special-gauge";
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
  const obstinate = isCharacterAlive(position) &&
    effectiveAbilityRoles(state, character).includes("obstinate");
  const privateInvestigator = incidentForcedByPrivateInvestigator(
    state,
    character,
  );
  if (policy.kind === "deadCharacter") {
    if (isCharacterAlive(position)) reasons.push("culpritAlive");
  } else {
    if (!isCharacterAlive(position)) reasons.push("culpritDead");
    if (
      !obstinate &&
      !privateInvestigator &&
      policy.kind === "characterParanoia" &&
      incidentParanoia(state, character) <
        characterDataOf(character).paranoiaLimit +
          policy.paranoiaLimitAdjustment +
          worshippersParanoiaAdjustment(state, character)
    ) {
      reasons.push("insufficientParanoia");
    }
    if (
      !obstinate &&
      policy.kind === "characterIntrigue" &&
      counters.intrigue < (
        policy.required === "paranoiaLimit"
          ? characterDataOf(character).paranoiaLimit
          : policy.required
      )
    ) {
      reasons.push("insufficientIntrigue");
    }
  }
  if (state.loop.incidentCulpritSuppressedFor?.includes(character)) {
    reasons.push("culpritSuppressed");
  }
  if (
    reasons.length === 0 &&
    incidentSuppressedByProphet(state, character)
  ) {
    reasons.push("culpritSuppressed");
  }
  return reasons;
}

function livingCharactersWithAbilityRole(
  state: GameState,
  role: string,
): CharacterId[] {
  return Object.entries(state.loop.board)
    .filter(([character, position]) =>
      isCharacterAlive(position) &&
      effectiveAbilityRoles(state, character).includes(role)
    )
    .map(([character]) => character);
}

function worshippersParanoiaAdjustment(
  state: GameState,
  culprit: CharacterId,
): number {
  if (!state.scenario.subPlots.includes("worshippersApocalypse")) return 0;
  if (effectiveRole(state, culprit) !== "person") return 0;
  return livingCharactersWithAbilityRole(state, "prophet").length > 0 ? -1 : 0;
}

function incidentSuppressedByProphet(
  state: GameState,
  culprit: CharacterId,
): boolean {
  const culpritPosition = state.loop.board[culprit];
  if (!isCharacterAlive(culpritPosition)) return false;
  const culpritLocation = characterLocation(culpritPosition, culprit);
  return livingCharactersWithAbilityRole(state, "prophet").some(
    (prophet) =>
      characterLocation(state.loop.board[prophet], prophet) !== culpritLocation,
  );
}

function incidentForcedByPrivateInvestigator(
  state: GameState,
  culprit: CharacterId,
): boolean {
  if (state.loop.specialGauge?.value !== 0) return false;
  const culpritPosition = state.loop.board[culprit];
  if (!isCharacterAlive(culpritPosition)) return false;
  const culpritLocation = characterLocation(culpritPosition, culprit);
  return livingCharactersWithAbilityRole(state, "privateInvestigator").some(
    (investigator) =>
      abilityLocationsOf(state, investigator).includes(culpritLocation),
  );
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
    scheduled.actualIncident,
  );
  const base = {
    occurrenceId,
    declaredIncident: scheduled.declaredIncident,
    actualIncident: scheduled.actualIncident,
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
      scheduled.actualIncident,
      scheduled.culprit,
      choice,
    );
  let effectApplied = firstEffect.effectApplied;
  if (culpritCharacter === "sectFounder" && firstEffect.effectApplied) {
    const secondEffect = resolveIncidentEffectResult(
      state,
      scheduled.actualIncident,
      scheduled.culprit,
      incidentSubIncidentDecision(choice),
    );
    effectApplied = secondEffect.effectApplied || effectApplied;
  }
  const definition = incidentDefinition(scheduled.actualIncident);
  const gaugeDelta = incidentTriggeredGaugeDelta(
    state.scenario.tragedySet,
    definition.increasesSpecialGauge,
    definition.additionalSpecialGaugeIncrease,
  );
  if (gaugeDelta > 0) {
    const gauge = state.loop.specialGauge;
    if (gauge === undefined) {
      throw new Error("incident gauge increase requires a special gauge");
    }
    for (let step = 0; step < gaugeDelta; step += 1) {
      adjustSpecialGauge(gauge, 1);
    }
  }
  const gaugeTracksIncidents =
    specialGaugeDefinition(state.scenario.tragedySet)?.incidentTriggeredDelta !==
      undefined;
  const observedChanges = publicBoardChanges(beforeEffects, state.loop);
  if (
    gaugeTracksIncidents &&
    !observedChanges.some((change) => change.kind === "specialGauge")
  ) {
    const beforeValue = beforeEffects.specialGauge?.value;
    const afterValue = state.loop.specialGauge?.value;
    if (beforeValue === undefined || afterValue === undefined) {
      throw new Error("incident gauge observation requires a special gauge");
    }
    observedChanges.push({
      kind: "specialGauge",
      beforeValue,
      afterValue,
      delta: afterValue - beforeValue,
    });
  }
  const changes = observedChanges.map((change) =>
    change.kind !== "specialGauge"
      ? change
      : {
        ...change,
        incident: {
          declaredIncident: scheduled.declaredIncident,
          occurrenceId,
        },
      }
  );
  const deaths = [...livingBefore].filter(
    (character) => state.loop.board[character]?.status === "dead",
  );
  const targets = incidentChoiceTargets(choice);

  const firedIncidents = state.loop.incidentsFiredThisLoop ??= [];
  if (!firedIncidents.includes(scheduled.actualIncident)) {
    firedIncidents.push(scheduled.actualIncident);
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

/** 현재 날짜에 예정된 단일 사건을 해결한다. */
export function resolveIncident(
  state: GameState,
  choiceInput?: IncidentChoiceInput,
): ResolvedIncidentBatch {
  const scheduled = normalizeIncidentSchedule(state.scenario.incidents).find(
    ({ day }) => day === state.loop.day,
  );
  if (scheduled === undefined) return { occurrences: [] };
  return {
    occurrences: [resolveScheduledIncident(
      state,
      scheduled,
      normalizeIncidentChoice(choiceInput),
    )],
  };
}
