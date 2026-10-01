import { LOCATIONS } from "../types";
import type {
  CharacterId,
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

export function normalizeIncidentCulprit(
  culprit: IncidentCulprit | CharacterId,
): IncidentCulprit {
  return typeof culprit === "string"
    ? { kind: "character", id: culprit }
    : structuredClone(culprit);
}

export function normalizeIncidentSchedule(
  incidents: readonly ScheduledIncidentInput[],
): ScheduledIncident[] {
  const occurrenceCounts = new Map<string, number>();
  return incidents.map((incident) => {
    const key = `${incident.day}:${incident.incident}`;
    const occurrenceIndex = occurrenceCounts.get(key) ?? 0;
    occurrenceCounts.set(key, occurrenceIndex + 1);
    return {
      day: incident.day,
      incident: incident.incident,
      culprit: normalizeIncidentCulprit(incident.culprit),
      occurrenceIndex,
    };
  });
}

export function incidentOccurrenceId(
  incident: Pick<ScheduledIncidentInput, "day" | "incident" | "occurrenceIndex">,
): string {
  return `${incident.day}:${incident.incident}:${incident.occurrenceIndex ?? 0}`;
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
  if (choice.counter !== undefined) {
    decisions.push({ kind: "counter", key: "counter", counter: choice.counter });
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
): IncidentChoice | undefined {
  const choice = normalizeIncidentChoice(choiceInput);
  const nested = choice?.decisions.find(
    (decision): decision is Extract<IncidentDecision, { kind: "subIncident" }> =>
      decision.kind === "subIncident" && decision.key === "secondResolution",
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
