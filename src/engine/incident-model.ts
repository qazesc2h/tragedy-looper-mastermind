import {
  characterLocation,
  DIAGONAL,
  effectiveRole,
  LOCATIONS,
} from "../types";
import type {
  CharacterId,
  GameState,
  IncidentChoice,
  IncidentChoiceInput,
  IncidentCounter,
  IncidentCulprit,
  IncidentDecision,
  Location,
  ScheduledIncident,
  ScheduledIncidentInput,
  Target,
} from "../types";

/** 사건 효과 해결 중 쌍둥이 범인을 대각선 반대 장소에 있는 것으로 취급한다. */
export function incidentEffectCulpritLocation(
  state: GameState,
  culprit: IncidentCulprit | CharacterId,
): Location {
  const normalized = normalizeIncidentCulprit(culprit);
  if (normalized.kind === "location") return normalized.at;
  const actual = characterLocation(
    state.loop.board[normalized.id],
    normalized.id,
  );
  return effectiveRole(state, normalized.id) === "twin"
    ? DIAGONAL[actual]
    : actual;
}

export function normalizeIncidentCulprit(
  culprit: IncidentCulprit | CharacterId,
): IncidentCulprit {
  return typeof culprit === "string"
    ? { kind: "character", id: culprit }
    : structuredClone(culprit);
}

export function declaredIncidentOf(
  incident: Pick<ScheduledIncidentInput, "incident" | "declaredIncident">,
): string {
  return incident.declaredIncident ?? incident.incident;
}

export function actualIncidentOf(
  incident: Pick<ScheduledIncidentInput, "incident" | "actualIncident">,
): string {
  return incident.actualIncident ?? incident.incident;
}

export function normalizeIncidentSchedule(
  incidents: readonly ScheduledIncidentInput[],
): ScheduledIncident[] {
  return incidents.map((incident) => {
    const declaredIncident = declaredIncidentOf(incident);
    const actualIncident = actualIncidentOf(incident);
    return {
      day: incident.day,
      incident: declaredIncident,
      declaredIncident,
      actualIncident,
      culprit: normalizeIncidentCulprit(incident.culprit),
    };
  });
}

export function incidentOccurrenceId(
  incident: Pick<
    ScheduledIncidentInput,
    "day" | "incident" | "declaredIncident"
  >,
): string {
  const declaredIncident = incident.declaredIncident ?? incident.incident;
  return `${incident.day}:${declaredIncident}`;
}

export function characterCulprit(
  culprit: IncidentCulprit | CharacterId,
): CharacterId | undefined {
  if (typeof culprit === "string") return culprit;
  return culprit.kind === "character" ? culprit.id : undefined;
}

export function sameIncidentCulprit(
  left: IncidentCulprit | CharacterId,
  right: IncidentCulprit | CharacterId,
): boolean {
  const a = normalizeIncidentCulprit(left);
  const b = normalizeIncidentCulprit(right);
  return a.kind === b.kind && (
    a.kind === "character"
      ? b.kind === "character" && a.id === b.id
      : b.kind === "location" && a.at === b.at
  );
}

function legacyDecisions(choice: Exclude<IncidentChoiceInput, IncidentChoice>): IncidentDecision[] {
  const decisions: IncidentDecision[] = [];
  if (choice.target !== undefined) {
    decisions.push({ kind: "character", key: "target", id: choice.target });
  }
  if (choice.otherTarget !== undefined) {
    decisions.push({
      kind: "character",
      key: "otherTarget",
      id: choice.otherTarget,
    });
  }
  if (choice.location !== undefined) {
    decisions.push({ kind: "location", key: "location", at: choice.location });
  }
  if (choice.destination !== undefined) {
    decisions.push({
      kind: "destination",
      key: "destination",
      at: choice.destination,
    });
  }
  if (choice.counter !== undefined) {
    decisions.push({ kind: "counter", key: "counter", counter: choice.counter });
  }
  if (choice.incident !== undefined) {
    decisions.push({ kind: "incident", key: "incident", incident: choice.incident });
  }
  if (choice.roleClaim !== undefined) {
    decisions.push({ kind: "role", key: "roleClaim", role: choice.roleClaim });
  }
  if (choice.secondResolution !== undefined) {
    decisions.push({
      kind: "subIncident",
      key: "secondResolution",
      decisions: legacyDecisions(choice.secondResolution),
    });
  }
  return decisions;
}

export function normalizeIncidentChoice(
  choice: IncidentChoiceInput | undefined,
): IncidentChoice | undefined {
  if (choice === undefined) return undefined;
  if ("decisions" in choice) return structuredClone(choice);
  return { decisions: legacyDecisions(choice) };
}

export function incidentCharacterDecision(
  choiceInput: IncidentChoiceInput | undefined,
  key: "target" | "otherTarget",
): CharacterId | undefined {
  const choice = normalizeIncidentChoice(choiceInput);
  return choice?.decisions.find(
    (decision): decision is Extract<IncidentDecision, { kind: "character" }> =>
      decision.kind === "character" && decision.key === key,
  )?.id;
}

export function incidentTypeDecision(
  choiceInput: IncidentChoiceInput | undefined,
): string | undefined {
  const choice = normalizeIncidentChoice(choiceInput);
  return choice?.decisions.find(
    (decision): decision is Extract<IncidentDecision, { kind: "incident" }> =>
      decision.kind === "incident" && decision.key === "incident",
  )?.incident;
}

export function incidentRoleDecision(
  choiceInput: IncidentChoiceInput | undefined,
): string | undefined {
  const choice = normalizeIncidentChoice(choiceInput);
  return choice?.decisions.find(
    (decision): decision is Extract<IncidentDecision, { kind: "role" }> =>
      decision.kind === "role" && decision.key === "roleClaim",
  )?.role;
}

export function incidentLocationDecision(
  choiceInput: IncidentChoiceInput | undefined,
  key: "location" | "destination",
): Location | undefined {
  const choice = normalizeIncidentChoice(choiceInput);
  const decision = choice?.decisions.find((candidate) =>
    candidate.kind === key && candidate.key === key
  );
  return decision?.kind === "location" || decision?.kind === "destination"
    ? decision.at
    : undefined;
}

export function incidentCounterDecision(
  choiceInput: IncidentChoiceInput | undefined,
): IncidentCounter | undefined {
  const choice = normalizeIncidentChoice(choiceInput);
  return choice?.decisions.find(
    (decision): decision is Extract<IncidentDecision, { kind: "counter" }> =>
      decision.kind === "counter" && decision.key === "counter",
  )?.counter;
}

export function incidentSubIncidentDecision(
  choiceInput: IncidentChoiceInput | undefined,
  key: Extract<IncidentDecision, { kind: "subIncident" }>["key"] =
    "secondResolution",
): IncidentChoice | undefined {
  const choice = normalizeIncidentChoice(choiceInput);
  const nested = choice?.decisions.find(
    (decision): decision is Extract<IncidentDecision, { kind: "subIncident" }> =>
      decision.kind === "subIncident" && decision.key === key,
  );
  return nested === undefined ? undefined : { decisions: nested.decisions };
}

export function incidentChoiceTargets(
  choiceInput: IncidentChoiceInput | undefined,
): Target[] {
  const choice = normalizeIncidentChoice(choiceInput);
  if (choice === undefined) return [];
  return choice.decisions.flatMap((decision): Target[] => {
    if (decision.kind === "character") {
      return [{ kind: "character", id: decision.id }];
    }
    if (decision.kind === "location" || decision.kind === "destination") {
      return [{ kind: "location", at: decision.at }];
    }
    if (decision.kind === "subIncident") {
      return incidentChoiceTargets({ decisions: decision.decisions });
    }
    return [];
  });
}

export function isIncidentCulprit(value: unknown): value is IncidentCulprit {
  if (typeof value !== "object" || value === null) return false;
  const culprit = value as Partial<IncidentCulprit>;
  return culprit.kind === "character" && typeof culprit.id === "string" ||
    culprit.kind === "location" &&
      typeof culprit.at === "string" &&
      LOCATIONS.includes(culprit.at as Location);
}
