import {
  collectProtagonistObservations,
  evaluateStateRoleTableHypotheses,
  type ProtagonistObservation,
  type RolePossibilityStatus,
} from "../../src/engine/hypothesis";
import {
  evaluateStateIncidentHypotheses,
  type IncidentPossibilityStatus,
} from "../../src/engine/incident-hypothesis";
import type {
  GameState,
  PlacedCard,
  PublicBoardChange,
  PublicObservationContext,
} from "../../src/types";

/**
 * Phase 5 상태 키 계약의 버전이다. 이 값을 바꾸지 않고 필드를 더하거나 빼면
 * 서로 다른 계측 결과가 같은 캐시를 공유하게 되므로 반드시 명시적으로 올린다.
 */
export const CANONICAL_DECISION_STATE_VERSION = "phase5-decision-v1" as const;

/**
 * Section 1에서 확정한 상태 분할. 실제 열거기는 이 목록의 각 항목을 투영한 뒤
 * canonical JSON으로 직렬화해야 한다. 가설 표는 knowledge에서 파생되는 캐시다.
 */
export const CANONICAL_DECISION_STATE_PARTITIONS = {
  provenance: [
    "canonicalVersion",
    "scenarioFingerprint",
    "engineTransitionVersion",
  ],
  decisionControl: [
    "gamePhase",
    "loop",
    "day",
    "phase",
    "leader",
    "placed",
    "actionResolutionComplete",
    "pendingLoopEnd",
    "optionalLossActivations",
    "roundEndMandatoryResolved",
    "pendingImmediateLossKeys",
    "finalGuess",
    "result",
  ],
  physical: [
    "board",
    "turfLocations",
    "charCounters",
    "locIntrigue",
    "specialGauge",
  ],
  resourcesAndEffects: [
    "spentOncePerLoop",
    "abilitiesUsedThisLoop",
    "abilitiesUsedThisRound",
    "locationRestrictionsRemoved",
    "cultistsIgnoringForbidIntrigue",
    "timeTravelersIgnoringForbidGoodwill",
    "incidentsFiredThisLoop",
    "incidentOccurrencesFiredThisLoop",
    "incidentCulpritSuppressedFor",
    "protagonistDeathPreventedBy",
    "loopStartTraitCounterChoices",
    "loopStartTraitLocationChoices",
    "extraLoopsPlayed",
  ],
  carryover: [
    "previousLoopAliveGoodwill",
    "revealedRoleEver",
    "currentLoopCompletedPhaseKeys",
    "currentLoopOutcome",
  ],
  knowledge: [
    "canonicalPublicEventTrace(loop/day/phase/sequence/visibility/payload)",
  ],
  derivedCompatibilityCaches: [
    "ProtagonistObservation[]",
    "ruleHypothesisTable",
    "rolePossibilityTable",
    "incidentPossibilityTable",
  ],
  evaluationOnly: [
    "targetLossCondition",
    "searchHorizon",
    "metricPreferenceVersion",
    "metricFormulaVersion",
  ],
  excludedRawOrDerived: [
    "GameState.history",
    "LoopState.phaseLog",
    "LoopState.publicInformationThisLoop",
    "GameState.runtimeErrors",
    "GameState.timeGapTimer",
  ],
} as const;

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

function canonicalJson(value: unknown): CanonicalJson {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (typeof value !== "object") {
    throw new Error(`unsupported canonical JSON value: ${typeof value}`);
  }

  const record = value as Record<string, unknown>;
  const result: { [key: string]: CanonicalJson } = {};
  for (const key of Object.keys(record).sort()) {
    const child = record[key];
    if (child === undefined) continue;
    result[key] = canonicalJson(child);
  }
  return result;
}

/** 객체 키 순서와 무관한 계측용 직렬화. 배열 순서는 호출자가 의미를 정규화한다. */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalJson(value));
}

function compareCanonicalKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * 완전 중복만 제거한다. 서로 다른 관측의 순서와 loop/day/timing/trigger/context,
 * 관측 내부 배열은 의미가 없다고 증명되지 않았으므로 그대로 보존한다.
 */
export function canonicalizeProtagonistObservations(
  observations: readonly ProtagonistObservation[],
): ProtagonistObservation[] {
  const seen = new Set<string>();
  const canonical: ProtagonistObservation[] = [];
  for (const observation of observations) {
    const key = canonicalStringify(observation);
    if (seen.has(key)) continue;
    seen.add(key);
    canonical.push(structuredClone(observation));
  }
  return canonical;
}

export interface CanonicalPublicActionProfile {
  loop: number;
  day: number;
  placements: PlacedCard[];
  publicContext?: PublicObservationContext;
  publicChanges?: PublicBoardChange[];
}

/**
 * 해결되어 공개된 P4 행동 프로필을 원시 단계 로그에서 분리한다. 결과 설명 문자열과
 * P2/P3의 중복 기록은 키에 넣지 않는다. 카드 선택 순서와 공개 변화 배열은 의미가
 * 없다고 증명되지 않았으므로 보수적으로 보존한다.
 */
export function collectCanonicalPublicActionProfiles(
  state: GameState,
): CanonicalPublicActionProfile[] {
  const loops = new Map<number, GameState["loop"]>();
  for (const loop of [...state.history, state.loop]) {
    if (!loops.has(loop.loop)) loops.set(loop.loop, loop);
  }

  const byKey = new Map<string, CanonicalPublicActionProfile>();
  for (const loop of loops.values()) {
    for (const entry of loop.phaseLog ?? []) {
      if (entry.kind !== "actionResolved" || entry.placements === undefined) {
        continue;
      }
      const profile: CanonicalPublicActionProfile = {
        loop: entry.loop,
        day: entry.day,
        placements: structuredClone(entry.placements),
        ...(entry.publicContext === undefined
          ? {}
          : { publicContext: structuredClone(entry.publicContext) }),
        ...(entry.publicChanges === undefined
          ? {}
          : { publicChanges: structuredClone(entry.publicChanges) }),
      };
      byKey.set(canonicalStringify(profile), profile);
    }
  }

  return [...byKey.values()].sort((left, right) =>
    left.loop - right.loop ||
    left.day - right.day ||
    compareCanonicalKeys(canonicalStringify(left), canonicalStringify(right))
  );
}

export interface CanonicalHypothesisSupport {
  ruleCombinationIds: string[];
  roleCells: {
    character: string;
    role: string;
    status: RolePossibilityStatus;
  }[];
  incidentCells: {
    column: string;
    character: string;
    status: IncidentPossibilityStatus;
  }[];
}

/**
 * 현재 세 가설 표의 후보/상태만 투영한다. 반례 검증을 위한 함수이며 이 결과 자체를
 * 결정 상태 키로 사용해서는 안 된다.
 */
export function projectHypothesisSupport(
  state: GameState,
): CanonicalHypothesisSupport {
  const roleEvaluation = evaluateStateRoleTableHypotheses(state);
  const incidentEvaluation = evaluateStateIncidentHypotheses(state);
  const roleCells = roleEvaluation.table.characters.flatMap((character) =>
    roleEvaluation.table.roles.flatMap((role) => {
      const cell = roleEvaluation.table.cells[character]?.[role];
      return cell === undefined
        ? []
        : [{ character, role, status: cell.status }];
    })
  );
  const incidentCells = incidentEvaluation.columns.flatMap((column) =>
    incidentEvaluation.characters.flatMap((character) => {
      const cell = incidentEvaluation.cells[character]?.[column.id];
      return cell === undefined
        ? []
        : [{ column: column.id, character, status: cell.status }];
    })
  );

  return {
    ruleCombinationIds: roleEvaluation.remaining.map(({ id }) => id).sort(),
    roleCells: roleCells.sort((left, right) =>
      compareCanonicalKeys(
        canonicalStringify(left),
        canonicalStringify(right),
      )
    ),
    incidentCells: incidentCells.sort((left, right) =>
      compareCanonicalKeys(
        canonicalStringify(left),
        canonicalStringify(right),
      )
    ),
  };
}

export const CURRENT_KNOWLEDGE_PROBE_MISSING = [
  "P2 visible target with card identity masked",
  "public event sequence within a phase",
  "role reveal day retained from PublicInformation",
  "goodwill incident effect actual resolution day",
] as const;

export interface CurrentKnowledgeProbe {
  complete: false;
  missingEventClasses: typeof CURRENT_KNOWLEDGE_PROBE_MISSING;
  observations: ProtagonistObservation[];
  publicActionProfiles: CanonicalPublicActionProfile[];
}

/**
 * 현재 구조에서 추출 가능한 최소 의미 이력. 반례 탐지용이며 완전 canonical 키로
 * 사용하면 안 된다.
 */
export function projectCurrentKnowledgeProbe(
  state: GameState,
): CurrentKnowledgeProbe {
  return {
    complete: false,
    missingEventClasses: CURRENT_KNOWLEDGE_PROBE_MISSING,
    observations: canonicalizeProtagonistObservations(
      collectProtagonistObservations(state),
    ),
    publicActionProfiles: collectCanonicalPublicActionProfiles(state),
  };
}
