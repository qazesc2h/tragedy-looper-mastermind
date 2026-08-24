import { characterDataOf } from "../data";
import type {
  CharacterId,
  GameState,
  IncidentId,
  Location,
  ScheduledIncident,
} from "../types";
import {
  collectProtagonistObservations,
  type ProtagonistObservation,
} from "./hypothesis";

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
  index: number,
): string {
  return `${scheduled.day}:${scheduled.incident}:${index}`;
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

function initialConfirmations(
  columns: readonly IncidentHypothesisColumn[],
  observations: readonly ProtagonistObservation[],
): Map<string, IncidentConfirmation> {
  const confirmations = new Map<string, IncidentConfirmation>();
  for (const observation of observations) {
    if (observation.kind === "incidentCulpritRevealed") {
      for (const column of matchingColumns(
        columns,
        observation.day,
        observation.incident,
      )) {
        confirmations.set(column.id, {
          character: observation.culprit,
          reason: { code: "culpritRevealed", observation },
        });
      }
    } else if (
      observation.kind === "incidentOccurred" &&
      observation.occurred &&
      observation.incident === "suicide"
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
    }
  }
  return confirmations;
}

function traceExclusionReason(
  character: CharacterId,
  column: IncidentHypothesisColumn,
  observations: readonly ProtagonistObservation[],
): IncidentPossibilityReason | undefined {
  for (const observation of observations) {
    if (
      observation.kind !== "incidentOccurred" ||
      observation.day !== column.day ||
      observation.incident !== column.incident ||
      !observation.occurred ||
      observation.context === undefined ||
      observation.changes === undefined
    ) continue;

    const observedCharacter = observation.context.characters?.[character];
    const locationOf = (target: CharacterId) =>
      observation.context?.characters?.[target]?.location;
    let traceLocations: Location[] = [];

    if (column.incident === "missingPerson") {
      const movements = observation.changes.filter((change) =>
        change.kind === "movement"
      );
      // 이동 흔적이 있으면 이동한 캐릭터가 이미 직접 확정된다. 제자리 이동만
      // 장소 음모 흔적으로 후보 위치를 좁힌다.
      if (movements.length > 0) continue;
      traceLocations = observation.changes.flatMap((change) =>
        change.kind === "counter" &&
          change.target.kind === "location" &&
          change.counter === "intrigue" &&
          change.delta > 0
          ? [change.target.at]
          : []
      );
    } else if (column.incident === "murder") {
      const victims = observation.changes.flatMap((change) =>
        change.kind === "status" &&
          change.from === "alive" &&
          change.to === "dead"
          ? [change.character]
          : []
      );
      if (victims.includes(character)) {
        return { code: "murderVictimCannotBeCulprit", observation };
      }
      traceLocations = victims.flatMap((victim) => {
        const location = locationOf(victim);
        return location === undefined ? [] : [location];
      });
    } else if (column.incident === "butterflyEffect") {
      const affected = observation.changes.flatMap((change) =>
        change.kind === "counter" &&
          change.target.kind === "character" &&
          change.delta > 0
          ? [change.target.id]
          : []
      );
      traceLocations = affected.flatMap((target) => {
        const location = locationOf(target);
        return location === undefined ? [] : [location];
      });
    } else {
      // 나머지 기본편 사건 효과는 범인의 위치와 관계없는 대상을 고른다.
      continue;
    }

    const uniqueLocations = [...new Set(traceLocations)];
    if (
      uniqueLocations.length === 1 &&
      observedCharacter?.location !== uniqueLocations[0]
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
    const limit = characterDataOf(character).paranoiaLimit;
    if (observation.occurred) {
      if (state.status !== "alive") {
        return { code: "firedWhileUnavailable", observation };
      }
      // AI는 사건 판정에서 모든 카운터를 불안으로 취급하므로 불안만 보고 배제하지 않는다.
      if (character !== "ai" && state.paranoia < limit) {
        return { code: "firedBelowParanoia", observation };
      }
    } else if (
      character !== "henchman" &&
      state.status === "alive" &&
      state.paranoia >= limit
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
): Record<CharacterId, Record<string, IncidentPossibilityCell>> {
  const confirmedColumnByCharacter = new Map<CharacterId, string>();
  for (const [column, confirmation] of confirmations) {
    confirmedColumnByCharacter.set(confirmation.character, column);
  }

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
        ) ?? outcomeExclusionReason(character, column, observations);
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

      const assigned = confirmedColumnByCharacter.get(character);
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
      );
      const traceReason = traceExclusionReason(
        character,
        column,
        observations,
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
  scheduledIncidents: readonly ScheduledIncident[],
  observations: readonly ProtagonistObservation[],
): IncidentPossibilityTable {
  const columns = scheduledIncidents.map((scheduled, index) => ({
    ...scheduled,
    id: incidentColumnId(scheduled, index),
    index,
  }));
  const confirmations = initialConfirmations(columns, observations);
  let cells = buildCells(
    publicCast,
    columns,
    observations,
    confirmations,
  );
  let propagationPasses = 0;

  while (true) {
    propagationPasses += 1;
    cells = buildCells(
      publicCast,
      columns,
      observations,
      confirmations,
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

export function evaluateStateIncidentHypotheses(
  state: GameState,
): IncidentPossibilityTable {
  return evaluateIncidentHypotheses(
    Object.keys(state.scenario.cast),
    state.scenario.incidents,
    collectProtagonistObservations(state),
  );
}
