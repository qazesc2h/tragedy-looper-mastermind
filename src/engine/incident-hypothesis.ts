import { characterDataOf } from "../data";
import { DIAGONAL, LOCATIONS } from "../types";
import type {
  CharacterId,
  GameState,
  IncidentId,
  Location,
  ScheduledIncident,
  ScheduledIncidentInput,
} from "../types";
import { publicCharacterCounter } from "../types";
import {
  collectProtagonistObservations,
  evaluateStateRoleTableHypotheses,
  type ProtagonistObservation,
} from "./hypothesis";
import { incidentDefinition } from "./incident-definition";
import {
  incidentOccurrenceId,
  normalizeIncidentCulprit,
  normalizeIncidentSchedule,
} from "./incident-model";

export type IncidentPossibilityStatus =
  | "possible"
  | "impossible"
  | "confirmed";

export interface IncidentHypothesisColumn extends ScheduledIncident {
  id: string;
  index: number;
}

export type IncidentPossibilityReason =
  | {
    code: "culpritRevealed";
    observation: Extract<
      ProtagonistObservation,
      { kind: "incidentCulpritRevealed" }
    >;
  }
  | {
    code: "suicideDeathIdentified";
    observation: Extract<
      ProtagonistObservation,
      { kind: "incidentOccurred" }
    >;
  }
  | {
    code: "missingPersonMovementIdentified";
    observation: Extract<
      ProtagonistObservation,
      { kind: "incidentOccurred" }
    >;
  }
  | {
    code: "fakedSuicideCardIdentified";
    observation: Extract<
      ProtagonistObservation,
      { kind: "incidentOccurred" }
    >;
  }
  | {
    code: "incidentTraceLocationMismatch";
    observation: Extract<
      ProtagonistObservation,
      { kind: "incidentOccurred" }
    >;
  }
  | {
    code: "murderVictimCannotBeCulprit";
    observation: Extract<
      ProtagonistObservation,
      { kind: "incidentOccurred" }
    >;
  }
  | {
    code: "onlyRemainingCandidate";
    column: string;
  }
  | {
    code: "otherCulpritConfirmed";
    column: string;
  }
  | {
    code: "culpritAlreadyAssigned";
    column: string;
  }
  | {
    code: "firedBelowParanoia";
    observation: Extract<
      ProtagonistObservation,
      { kind: "incidentOccurred" }
    >;
  }
  | {
    code: "firedWhileUnavailable";
    observation: Extract<
      ProtagonistObservation,
      { kind: "incidentOccurred" }
    >;
  }
  | {
    code: "didNotFireDespiteConditions";
    observation: Extract<
      ProtagonistObservation,
      { kind: "incidentOccurred" }
    >;
  };

export interface IncidentPossibilityCell {
  character: CharacterId;
  column: string;
  status: IncidentPossibilityStatus;
  reasons: IncidentPossibilityReason[];
}

export interface IncidentPossibilityTable {
  characters: CharacterId[];
  columns: IncidentHypothesisColumn[];
  cells: Record<CharacterId, Record<string, IncidentPossibilityCell>>;
  propagationPasses: number;
}

interface IncidentConfirmation {
  character: CharacterId;
  reason: IncidentPossibilityReason;
}

function incidentColumnId(
  scheduled: ScheduledIncident,
): string {
  return incidentOccurrenceId(scheduled);
}

function matchingColumns(
  columns: readonly IncidentHypothesisColumn[],
  day: number,
  incident: IncidentId,
): IncidentHypothesisColumn[] {
  return columns.filter((column) =>
    column.day === day && column.incident === incident
  );
}

function servantSubstitutionObserved(
  incident: Extract<ProtagonistObservation, { kind: "incidentOccurred" }>,
): boolean {
  return incident.servantSubstitutionObserved === true;
}

function initialConfirmations(
  columns: readonly IncidentHypothesisColumn[],
  observations: readonly ProtagonistObservation[],
): Map<string, IncidentConfirmation> {
  const confirmations = new Map<string, IncidentConfirmation>();
  for (const observation of observations) {
    if (observation.kind === "incidentCulpritRevealed") {
      const culprit = normalizeIncidentCulprit(observation.culprit);
      for (const column of matchingColumns(
        columns,
        observation.day,
        observation.incident,
      )) {
        if (culprit.kind !== "character") continue;
        confirmations.set(column.id, {
          character: culprit.id,
          reason: { code: "culpritRevealed", observation },
        });
      }
    } else if (
      observation.kind === "incidentOccurred" &&
      observation.occurred &&
      observation.incident === "suicide" &&
      !servantSubstitutionObserved(observation)
    ) {
      const directDeaths = observation.changes?.flatMap((change) =>
        change.kind === "status" &&
        change.from === "alive" &&
        change.to === "dead"
          ? [change.character]
          : []
      ) ?? [];
      if (directDeaths.length !== 1) continue;
      const culprit = directDeaths[0];
      if (culprit === undefined) continue;
      for (const column of matchingColumns(
        columns,
        observation.day,
        observation.incident,
      )) {
        confirmations.set(column.id, {
          character: culprit,
          reason: { code: "suicideDeathIdentified", observation },
        });
      }
    } else if (
      observation.kind === "incidentOccurred" &&
      observation.occurred &&
      observation.incident === "missingPerson"
    ) {
      const movements = observation.changes?.filter((change) =>
        change.kind === "movement"
      ) ?? [];
      const movement = movements[0];
      if (movements.length !== 1 || movement?.kind !== "movement") continue;
      for (const column of matchingColumns(
        columns,
        observation.day,
        observation.incident,
      )) {
        confirmations.set(column.id, {
          character: movement.character,
          reason: { code: "missingPersonMovementIdentified", observation },
        });
      }
    } else if (
      observation.kind === "incidentOccurred" &&
      observation.occurred &&
      observation.incident === "fakedSuicide"
    ) {
      const placedOn = observation.changes?.flatMap((change) =>
        change.kind === "extraCard" &&
          change.action === "placed" &&
          change.card.cardId === "fakedSuicide" &&
          change.card.target.kind === "character"
          ? [change.card.target.id]
          : []
      ) ?? [];
      if (placedOn.length !== 1 || placedOn[0] === undefined) continue;
      for (const column of matchingColumns(
        columns,
        observation.day,
        observation.incident,
      )) {
        confirmations.set(column.id, {
          character: placedOn[0],
          reason: { code: "fakedSuicideCardIdentified", observation },
        });
      }
    }
  }
  return confirmations;
}

function traceExclusionReason(
  character: CharacterId,
  column: IncidentHypothesisColumn,
  observations: readonly ProtagonistObservation[],
  virtualLocationCouldExplain?: (
    character: CharacterId,
    traceLocation: Location,
    observation: Extract<ProtagonistObservation, { kind: "incidentOccurred" }>,
  ) => boolean,
): IncidentPossibilityReason | undefined {
  for (const observation of observations) {
    if (
      observation.kind !== "incidentOccurred" ||
      observation.day !== column.day ||
      observation.incident !== column.incident ||
      !observation.occurred ||
      observation.context === undefined
    ) continue;

    const observedCharacter = observation.context.characters?.[character];
    const locationOf = (target: CharacterId) =>
      observation.context?.characters?.[target]?.location;
    let traceLocations: Location[] = [];
    const changes = observation.changes ?? [];

    if (observation.culpritLocationRevealed !== undefined) {
      const revealed = observation.culpritLocationRevealed;
      if (
        observedCharacter?.location !== revealed &&
        !virtualLocationCouldExplain?.(character, revealed, observation)
      ) {
        return { code: "incidentTraceLocationMismatch", observation };
      }
    }

    if (column.incident === "missingPerson") {
      const movements = changes.filter((change) =>
        change.kind === "movement"
      );
      // 이동 흔적이 있으면 이동한 캐릭터가 이미 직접 확정된다. 제자리 이동만
      // 장소 음모 흔적으로 후보 위치를 좁힌다.
      if (movements.length > 0) continue;
      traceLocations = changes.flatMap((change) =>
        change.kind === "counter" &&
          change.target.kind === "location" &&
          change.counter === "intrigue" &&
          change.delta > 0
          ? [change.target.at]
          : []
      );
    } else if (
      column.incident === "murder" ||
      column.incident === "serialMurder" ||
      column.incident === "bestialMurder"
    ) {
      const victims = changes.flatMap((change) =>
        change.kind === "status" &&
          change.from === "alive" &&
          change.to === "dead"
          ? [change.character]
          : []
      );
      if (
        victims.includes(character) &&
        !servantSubstitutionObserved(observation)
      ) {
        return { code: "murderVictimCannotBeCulprit", observation };
      }
      traceLocations = victims.flatMap((victim) => {
        const location = locationOf(victim);
        return location === undefined ? [] : [location];
      });
    } else if (
      column.incident === "butterflyEffect" || column.incident === "portent"
    ) {
      const affected = changes.flatMap((change) =>
        change.kind === "counter" &&
          change.target.kind === "character" &&
          (column.incident !== "portent" || change.counter === "paranoia") &&
          change.delta > 0
          ? [change.target.id]
          : []
      );
      traceLocations = affected.flatMap((target) => {
        const location = locationOf(target);
        return location === undefined ? [] : [location];
      });
    } else if (column.incident === "suspiciousLetter") {
      traceLocations = changes.flatMap((change) =>
        change.kind === "movement" ? [change.from] : []
      );
    } else if (observation.culpritLocationRevealed === undefined) {
      // 나머지 기본편 사건 효과는 범인의 위치와 관계없는 대상을 고른다.
      continue;
    }

    const uniqueLocations = [...new Set(traceLocations)];
    if (
      uniqueLocations.length === 1 &&
      observedCharacter?.location !== uniqueLocations[0] &&
      !virtualLocationCouldExplain?.(
        character,
        uniqueLocations[0]!,
        observation,
      )
    ) {
      return { code: "incidentTraceLocationMismatch", observation };
    }
  }
  return undefined;
}

function outcomeExclusionReason(
  character: CharacterId,
  column: IncidentHypothesisColumn,
  observations: readonly ProtagonistObservation[],
  forcedBelowParanoiaCouldExplain?: (
    character: CharacterId,
    observation: Extract<ProtagonistObservation, { kind: "incidentOccurred" }>,
  ) => boolean,
  virtualLocationCouldExplain?: (
    character: CharacterId,
    traceLocation: Location,
    observation: Extract<ProtagonistObservation, { kind: "incidentOccurred" }>,
  ) => boolean,
): IncidentPossibilityReason | undefined {
  for (const observation of observations) {
    if (
      observation.kind !== "incidentOccurred" ||
      observation.day !== column.day ||
      observation.incident !== column.incident
    ) {
      continue;
    }
    const state = observation.context?.characters?.[character];
    if (state === undefined) continue;
    const policy = incidentDefinition(column.incident).triggerPolicy;
    const limit = characterDataOf(character).paranoiaLimit +
      (policy.kind === "characterParanoia"
        ? policy.paranoiaLimitAdjustment
        : 0);
    if (observation.occurred) {
      if (state.status !== "alive") {
        return { code: "firedWhileUnavailable", observation };
      }
      // AI는 사건 판정에서 모든 카운터를 불안으로 취급하므로 불안만 보고 배제하지 않는다.
      if (
        character !== "ai" &&
        (publicCharacterCounter(state, "paranoia") ?? 0) < limit &&
        !forcedBelowParanoiaCouldExplain?.(character, observation)
      ) {
        return { code: "firedBelowParanoia", observation };
      }
    } else if (
      character !== "henchman" &&
      state.status === "alive" &&
      (publicCharacterCounter(state, "paranoia") ?? 0) >= limit
    ) {
      return { code: "didNotFireDespiteConditions", observation };
    }
  }
  return undefined;
}

function buildCells(
  characters: readonly CharacterId[],
  columns: readonly IncidentHypothesisColumn[],
  observations: readonly ProtagonistObservation[],
  confirmations: ReadonlyMap<string, IncidentConfirmation>,
  forcedBelowParanoiaCouldExplain?: (
    character: CharacterId,
    observation: Extract<ProtagonistObservation, { kind: "incidentOccurred" }>,
  ) => boolean,
  virtualLocationCouldExplain?: (
    character: CharacterId,
    traceLocation: Location,
    observation: Extract<ProtagonistObservation, { kind: "incidentOccurred" }>,
  ) => boolean,
): Record<CharacterId, Record<string, IncidentPossibilityCell>> {
  const cells: Record<
    CharacterId,
    Record<string, IncidentPossibilityCell>
  > = {};
  for (const character of characters) {
    const row: Record<string, IncidentPossibilityCell> = {};
    for (const column of columns) {
      const confirmation = confirmations.get(column.id);
      if (confirmation !== undefined) {
        const independentReason = traceExclusionReason(
          character,
          column,
          observations,
          virtualLocationCouldExplain,
        ) ?? outcomeExclusionReason(
          character,
          column,
          observations,
          forcedBelowParanoiaCouldExplain,
        );
        row[column.id] = confirmation.character === character
          ? {
            character,
            column: column.id,
            status: "confirmed",
            reasons: [confirmation.reason],
          }
          : {
            character,
            column: column.id,
            status: "impossible",
            reasons: [
              {
                code: "otherCulpritConfirmed",
                column: column.id,
              },
              ...(independentReason === undefined ? [] : [independentReason]),
            ],
          };
        continue;
      }

      const assigned = [...confirmations.entries()].find(
        ([assignedColumn, assignedConfirmation]) => {
          if (assignedConfirmation.character !== character) return false;
          const other = columns.find(({ id }) => id === assignedColumn);
          return other !== undefined && !(
            incidentDefinition(other.incident).allowsRepeatedCulprit &&
            incidentDefinition(column.incident).allowsRepeatedCulprit
          );
        },
      )?.[0];
      if (assigned !== undefined) {
        row[column.id] = {
          character,
          column: column.id,
          status: "impossible",
          reasons: [{ code: "culpritAlreadyAssigned", column: assigned }],
        };
        continue;
      }
      const outcomeReason = outcomeExclusionReason(
        character,
        column,
        observations,
        forcedBelowParanoiaCouldExplain,
      );
      const traceReason = traceExclusionReason(
        character,
        column,
        observations,
        virtualLocationCouldExplain,
      );
      const reason = traceReason ?? outcomeReason;
      row[column.id] = reason === undefined
        ? {
          character,
          column: column.id,
          status: "possible",
          reasons: [],
        }
        : {
          character,
          column: column.id,
          status: "impossible",
          reasons: [reason],
        };
    }
    cells[character] = row;
  }
  return cells;
}

/** 전체 범인 배정을 열거하지 않고 사건별 독립 가능성만 고정점까지 전파한다. */
export function evaluateIncidentHypotheses(
  publicCast: readonly CharacterId[],
  scheduledIncidents: readonly ScheduledIncidentInput[],
  observations: readonly ProtagonistObservation[],
  forcedBelowParanoiaCouldExplain?: (
    character: CharacterId,
    observation: Extract<ProtagonistObservation, { kind: "incidentOccurred" }>,
  ) => boolean,
  virtualLocationCouldExplain?: (
    character: CharacterId,
    traceLocation: Location,
    observation: Extract<ProtagonistObservation, { kind: "incidentOccurred" }>,
  ) => boolean,
): IncidentPossibilityTable {
  const columns = normalizeIncidentSchedule(scheduledIncidents)
    .filter(({ culprit }) => culprit.kind === "character")
    .map((scheduled, index) => ({
      ...scheduled,
      id: incidentColumnId(scheduled),
      index,
    }));
  const confirmations = initialConfirmations(columns, observations);
  let cells = buildCells(
    publicCast,
    columns,
    observations,
    confirmations,
    forcedBelowParanoiaCouldExplain,
    virtualLocationCouldExplain,
  );
  let propagationPasses = 0;

  while (true) {
    propagationPasses += 1;
    cells = buildCells(
      publicCast,
      columns,
      observations,
      confirmations,
      forcedBelowParanoiaCouldExplain,
      virtualLocationCouldExplain,
    );
    let changed = false;
    for (const column of columns) {
      if (confirmations.has(column.id)) continue;
      const candidates = publicCast.filter((character) =>
        cells[character]?.[column.id]?.status === "possible"
      );
      if (candidates.length !== 1) continue;
      const character = candidates[0];
      if (character === undefined) continue;
      confirmations.set(column.id, {
        character,
        reason: { code: "onlyRemainingCandidate", column: column.id },
      });
      changed = true;
      // 한 캐릭터는 여러 사건의 범인이 될 수 없다. 한 건씩 확정한 뒤
      // 표를 다시 만들어 그 캐릭터를 다른 사건에서 X로 전파한다.
      break;
    }
    if (!changed) break;
  }

  return {
    characters: [...publicCast],
    columns,
    cells,
    propagationPasses,
  };
}

export interface LocationIncidentPossibilityCell {
  location: Location;
  column: string;
  status: IncidentPossibilityStatus;
}

export interface LocationIncidentPossibilityTable {
  locations: Location[];
  columns: IncidentHypothesisColumn[];
  cells: Record<Location, Record<string, LocationIncidentPossibilityCell>>;
  propagationPasses: number;
}

function repeatedCulpritAllowed(
  left: IncidentHypothesisColumn,
  right: IncidentHypothesisColumn,
): boolean {
  return incidentDefinition(left.incident).allowsRepeatedCulprit &&
    incidentDefinition(right.incident).allowsRepeatedCulprit;
}

function buildLocationCells(
  columns: readonly IncidentHypothesisColumn[],
  confirmations: ReadonlyMap<string, Location>,
): LocationIncidentPossibilityTable["cells"] {
  return Object.fromEntries(LOCATIONS.map((location) => [
    location,
    Object.fromEntries(columns.map((column) => {
      const confirmed = confirmations.get(column.id);
      const assignedElsewhere = [...confirmations.entries()].some(
        ([assignedColumn, assignedLocation]) => {
          if (assignedColumn === column.id || assignedLocation !== location) {
            return false;
          }
          const other = columns.find(({ id }) => id === assignedColumn);
          return other !== undefined && !repeatedCulpritAllowed(other, column);
        },
      );
      const status: IncidentPossibilityStatus = confirmed === location
        ? "confirmed"
        : confirmed !== undefined || assignedElsewhere
        ? "impossible"
        : "possible";
      return [column.id, { location, column: column.id, status }];
    })),
  ])) as LocationIncidentPossibilityTable["cells"];
}

/** 장소 범인 열은 캐릭터 범인 배정 제약과 완전히 분리한다. */
export function evaluateLocationIncidentHypotheses(
  scheduledIncidents: readonly ScheduledIncidentInput[],
  observations: readonly ProtagonistObservation[],
): LocationIncidentPossibilityTable {
  const columns = normalizeIncidentSchedule(scheduledIncidents)
    .filter(({ culprit }) => culprit.kind === "location")
    .map((scheduled, index) => ({
      ...scheduled,
      id: incidentColumnId(scheduled),
      index,
    }));
  const revealed = new Map<string, Location>();
  for (const observation of observations) {
    if (
      observation.kind !== "incidentCulpritRevealed" ||
      normalizeIncidentCulprit(observation.culprit).kind !== "location"
    ) continue;
    const culprit = normalizeIncidentCulprit(observation.culprit);
    if (culprit.kind !== "location") continue;
    for (const column of matchingColumns(
      columns,
      observation.day,
      observation.incident,
    )) {
      revealed.set(column.id, culprit.at);
    }
  }
  let cells = buildLocationCells(columns, revealed);
  let propagationPasses = 0;
  while (true) {
    propagationPasses += 1;
    cells = buildLocationCells(columns, revealed);
    let changed = false;
    for (const column of columns) {
      if (revealed.has(column.id)) continue;
      const candidates = LOCATIONS.filter((location) =>
        cells[location][column.id]?.status === "possible"
      );
      if (candidates.length !== 1 || candidates[0] === undefined) continue;
      revealed.set(column.id, candidates[0]);
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return { locations: [...LOCATIONS], columns, cells, propagationPasses };
}

function stateIncidentHypothesisOverrides(
  state: GameState,
): {
  forcedBelowParanoiaCouldExplain: (
    character: CharacterId,
    observation: Extract<ProtagonistObservation, { kind: "incidentOccurred" }>,
  ) => boolean;
  virtualLocationCouldExplain: (
    character: CharacterId,
    traceLocation: Location,
    observation: Extract<ProtagonistObservation, { kind: "incidentOccurred" }>,
  ) => boolean;
} {
  const roleEvaluation = evaluateStateRoleTableHypotheses(state);
  const roleTable = roleEvaluation.table;
  const rolePossible = (character: CharacterId, role: string): boolean => {
    const cell = roleTable.cells[character]?.[role];
    return cell !== undefined && cell.status !== "impossible";
  };

  const forcedBelowParanoiaCouldExplain = (character: CharacterId, observation: Extract<ProtagonistObservation, { kind: "incidentOccurred" }>): boolean => {
    const observed = observation.context?.characters?.[character];
    if (observed === undefined || observed.status !== "alive") return false;
    const limit = characterDataOf(character).paranoiaLimit;
    if (
      (observation.incident === "serialMurder" ||
        observation.incident === "suicide") &&
      roleEvaluation.remaining.some(({ mainPlot }) =>
        mainPlot === "dropStrychnine"
      ) &&
      (publicCharacterCounter(observed, "paranoia") ?? 0) +
          (publicCharacterCounter(observed, "intrigue") ?? 0) >= limit
    ) return true;
    if (rolePossible(character, "obstinate")) return true;
    if (observation.context?.specialGauge?.value !== 0) return false;

    const locations = new Set(
      observed.location === undefined ? [] : [observed.location],
    );
    if (
      observed.location !== undefined &&
      rolePossible(character, "twin")
    ) {
      locations.add(DIAGONAL[observed.location]);
    }
    return Object.entries(observation.context?.characters ?? {}).some(
      ([candidate, investigator]) =>
        investigator.status === "alive" &&
        rolePossible(candidate, "privateInvestigator") &&
        (investigator.abilityLocations ?? (
          investigator.location === undefined ? [] : [investigator.location]
        )).some((location) => locations.has(location)),
    );
  };
  const virtualLocationCouldExplain = (
    character: CharacterId,
    traceLocation: Location,
    observation: Extract<ProtagonistObservation, { kind: "incidentOccurred" }>,
  ): boolean => {
    const physical = observation.context?.characters?.[character]?.location;
    return physical !== undefined &&
      rolePossible(character, "twin") &&
      DIAGONAL[physical] === traceLocation;
  };
  return { forcedBelowParanoiaCouldExplain, virtualLocationCouldExplain };
}

export function evaluateStateIncidentHypothesisTables(state: GameState): {
  character: IncidentPossibilityTable;
  location: LocationIncidentPossibilityTable;
} {
  const observations = collectProtagonistObservations(state);
  const overrides = stateIncidentHypothesisOverrides(state);
  return {
    character: evaluateIncidentHypotheses(
      Object.keys(state.scenario.cast),
      state.scenario.incidents,
      observations,
      overrides.forcedBelowParanoiaCouldExplain,
      overrides.virtualLocationCouldExplain,
    ),
    location: evaluateLocationIncidentHypotheses(
      state.scenario.incidents,
      observations,
    ),
  };
}

export function evaluateStateIncidentHypotheses(
  state: GameState,
): IncidentPossibilityTable {
  return evaluateStateIncidentHypothesisTables(state).character;
}
