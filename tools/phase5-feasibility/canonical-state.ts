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
  LoopOutcome,
  PlacedCard,
  PublicBoardChange,
  PublicObservationContext,
} from "../../src/types";
import type { PublicEvent } from "./public-events";

/**
 * Phase 5 상태 키 계약의 버전이다. 이 값을 바꾸지 않고 필드를 더하거나 빼면
 * 서로 다른 계측 결과가 같은 캐시를 공유하게 되므로 반드시 명시적으로 올린다.
 */
export const CANONICAL_ENGINE_STATE_VERSION = "phase5-engine-v2" as const;
export const PROTAGONIST_POLICY_STATE_VERSION = "phase5-policy-v1" as const;
export const CANONICAL_DECISION_STATE_VERSION = "phase5-decision-v4" as const;
export const ENGINE_TRANSITION_VERSION = "headless-transition-v3" as const;

export type ProtagonistPolicyModel =
  | "worst-legal-response"
  | "perfect-recall";

export const DEFAULT_PROTAGONIST_POLICY_MODEL: ProtagonistPolicyModel =
  "worst-legal-response";

/**
 * Section 1에서 확정한 상태 분할. 실제 열거기는 이 목록의 각 항목을 투영한 뒤
 * canonical JSON으로 직렬화해야 한다. 가설 표는 knowledge에서 파생되는 캐시다.
 */
export const CANONICAL_DECISION_STATE_PARTITIONS = {
  engineStateKey: [
    "canonicalEngineVersion",
    "scenarioFingerprint",
    "engineTransitionVersion",
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
    "board",
    "turfLocations",
    "charCounters",
    "locIntrigue",
    "specialGauge",
    "spentOncePerLoop",
    "abilitiesUsedThisLoop",
    "abilitiesUsedThisRound",
    "locationRestrictionsRemoved",
    "servantAdditionalServedCharacters",
    "servantMovementChoice",
    "cultistsIgnoringForbidIntrigue",
    "timeTravelersIgnoringForbidGoodwill",
    "incidentsFiredThisLoop",
    "incidentOccurrencesFiredThisLoop",
    "incidentCulpritSuppressedFor",
    "protagonistDeathPreventedBy",
    "loopStartTraitCounterChoices",
    "loopStartTraitLocationChoices",
    "extraLoopsPlayed",
    "previousLoopAliveGoodwill",
    "revealedRoleEver",
    "currentLoopCompletedPhaseKeys",
    "currentLoopOutcome",
  ],
  protagonistPolicyStateKey: [
    "worst-legal-response: omitted",
    "perfect-recall: canonicalPublicEventTrace(loop/day/phase/sequence/visibility/payload)",
  ],
  derivedCompatibilityCaches: [
    "ProtagonistObservation[]",
    "ruleHypothesisTable",
    "rolePossibilityTable",
    "incidentPossibilityTable",
  ],
  evaluationOnlyNotSearchState: [
    "targetLossCondition",
    "searchHorizon",
    "metricPreferenceVersion",
    "metricFormulaVersion",
    "disclosure-preview",
    "signaling analysis",
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

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalKeys);
}

function currentLoopCompletedPhaseKeys(state: GameState): string[] {
  return sortedUnique((state.loop.phaseLog ?? []).map((entry) =>
    `${entry.loop}:${entry.day}:${entry.phase}`
  ));
}

function revealedRoleEver(state: GameState): string[] {
  return sortedUnique([...state.history, state.loop].flatMap((loop) => [
    ...(loop.revealedRoleCharacters ?? []),
    ...(loop.publicInformationThisLoop ?? []).flatMap((information) =>
      information.kind === "roleReveal" ? [information.character] : []
    ),
  ]));
}

function previousLoopAliveGoodwill(state: GameState): string[] {
  const previous = state.history.at(-1);
  if (previous === undefined) return [];
  return Object.entries(previous.charCounters).flatMap(
    ([character, counters]) =>
      previous.board[character]?.status === "alive" && counters.goodwill >= 1
        ? [character]
        : [],
  ).sort(compareCanonicalKeys);
}

function currentLoopOutcome(state: GameState): LoopOutcome | undefined {
  return state.loopOutcomes.find(({ loop }) => loop === state.loop.loop);
}

type ProtagonistOwner = 0 | 1 | 2;

function canonicalOwner(
  owner: PlacedCard["owner"],
  leader: ProtagonistOwner,
): PlacedCard["owner"] {
  if (owner === "mastermind") return owner;
  return ((owner - leader + 3) % 3) as ProtagonistOwner;
}

function canonicalPlacements(
  placements: readonly PlacedCard[],
  leader: ProtagonistOwner,
): PlacedCard[] {
  return placements.map((placement): PlacedCard => ({
    ...structuredClone(placement),
    owner: canonicalOwner(placement.owner, leader),
  })).sort((left, right) => compareCanonicalKeys(
    canonicalStringify(left),
    canonicalStringify(right),
  ));
}

function canonicalPublicTrace(
  trace: readonly PublicEvent[],
  leader: ProtagonistOwner,
): PublicEvent[] {
  return trace.map((event): PublicEvent => {
    const result = structuredClone(event);
    if (result.payload.kind === "cardsPlacedFaceDown") {
      result.payload.placements = result.payload.placements.map(
        (placement) => ({
          ...placement,
          owner: canonicalOwner(placement.owner, leader),
        }),
      ).sort((left, right) => compareCanonicalKeys(
        canonicalStringify(left),
        canonicalStringify(right),
      ));
    } else if (result.payload.kind === "cardsRevealed") {
      result.payload.placements = canonicalPlacements(
        result.payload.placements,
        leader,
      );
    }
    return result;
  });
}

/**
 * 실제 엔진 전이의 Markov 충분통계만 투영한다. 공개 trace와 그 파생 가설 표는
 * 엔진의 합법 행동·효과를 바꾸지 않으므로 이 키에 넣지 않는다.
 */
export function projectCanonicalEngineState(state: GameState): unknown {
  const leader = state.loop.leader;
  return {
    provenance: {
      canonicalEngineVersion: CANONICAL_ENGINE_STATE_VERSION,
      scenarioFingerprint: canonicalStringify(state.scenario),
      engineTransitionVersion: ENGINE_TRANSITION_VERSION,
    },
    decisionControl: {
      gamePhase: state.gamePhase,
      loop: state.loop.loop,
      day: state.loop.day,
      phase: state.loop.phase,
      // 주인공 번호는 현재 리더를 0으로 둔 상대 좌표다. 전역 순환 치환은
      // 같은 상태지만, 리더 대비 누가 어떤 카드를 소진했는지는 유지한다.
      leader: 0,
      placed: canonicalPlacements(state.loop.placed, leader),
      actionResolutionComplete: state.loop.actionResolutionComplete,
      pendingLoopEnd: state.pendingLoopEnd,
      optionalLossActivations: state.loop.optionalLossActivations,
      roundEndMandatoryResolved: state.loop.roundEndMandatoryResolved,
      pendingImmediateLossKeys: state.loop.pendingImmediateLossKeys,
      finalGuess: state.finalGuess,
      result: state.result,
    },
    physical: {
      board: state.loop.board,
      turfLocations: state.loop.turfLocations,
      charCounters: state.loop.charCounters,
      locIntrigue: state.loop.locIntrigue,
      specialGauge: state.loop.specialGauge,
    },
    resourcesAndEffects: {
      spentOncePerLoop: {
        mastermind: [...state.loop.spentOncePerLoop.mastermind].sort(
          compareCanonicalKeys,
        ),
        protagonists: [0, 1, 2].map((offset) =>
          [...state.loop.spentOncePerLoop.protagonists[
            ((leader + offset) % 3) as ProtagonistOwner
          ]].sort(compareCanonicalKeys)
        ),
      },
      abilitiesUsedThisLoop: state.loop.abilitiesUsedThisLoop,
      abilitiesUsedThisRound: state.loop.abilitiesUsedThisRound,
      locationRestrictionsRemoved: state.loop.locationRestrictionsRemoved,
      servantAdditionalServedCharacters:
        state.loop.servantAdditionalServedCharacters,
      servantMovementChoice: state.loop.servantMovementChoice,
      cultistsIgnoringForbidIntrigue:
        state.loop.cultistsIgnoringForbidIntrigue,
      timeTravelersIgnoringForbidGoodwill:
        state.loop.timeTravelersIgnoringForbidGoodwill,
      incidentsFiredThisLoop: state.loop.incidentsFiredThisLoop,
      incidentOccurrencesFiredThisLoop:
        state.loop.incidentOccurrencesFiredThisLoop,
      incidentCulpritSuppressedFor:
        state.loop.incidentCulpritSuppressedFor,
      protagonistDeathPreventedBy: state.loop.protagonistDeathPreventedBy,
      loopStartTraitCounterChoices: state.loop.loopStartTraitCounterChoices,
      loopStartTraitLocationChoices: state.loop.loopStartTraitLocationChoices,
      extraLoopsPlayed: state.extraLoopsPlayed,
    },
    carryover: {
      previousLoopAliveGoodwill: previousLoopAliveGoodwill(state),
      revealedRoleEver: revealedRoleEver(state),
      currentLoopCompletedPhaseKeys: currentLoopCompletedPhaseKeys(state),
      currentLoopOutcome: currentLoopOutcome(state),
    },
  };
}

export function engineStateKey(state: GameState): string {
  return canonicalStringify(projectCanonicalEngineState(state));
}

/**
 * 정책이 공개 이력을 읽는 경우에만 필요한 두 번째 키다. 기본 최악 대응 모델은
 * 현재 상태의 모든 합법 대응을 비교하므로 과거 이력을 읽지 않고 키가 없다.
 */
export function protagonistPolicyStateKey(
  model: ProtagonistPolicyModel,
  state: GameState,
  publicTrace: readonly PublicEvent[],
): string | undefined {
  if (model === "worst-legal-response") return undefined;
  return canonicalStringify({
    policyVersion: PROTAGONIST_POLICY_STATE_VERSION,
    model,
    publicTrace: canonicalPublicTrace(publicTrace, state.loop.leader),
  });
}

export interface StrategySearchCacheKeys {
  engineStateKey: string;
  protagonistPolicyStateKey?: string;
}

export function strategySearchCacheKeys(
  state: GameState,
  publicTrace: readonly PublicEvent[],
  model: ProtagonistPolicyModel = DEFAULT_PROTAGONIST_POLICY_MODEL,
): StrategySearchCacheKeys {
  const policyKey = protagonistPolicyStateKey(model, state, publicTrace);
  return {
    engineStateKey: engineStateKey(state),
    ...(policyKey === undefined
      ? {}
      : { protagonistPolicyStateKey: policyKey }),
  };
}

/**
 * Section 1의 정책 미지정 판정을 보존하는 perfect-recall 복합 상태다. 새 기본 검색은
 * 이 키가 아니라 strategySearchCacheKeys()의 worst-legal-response 결과를 사용한다.
 */
export function projectCanonicalDecisionState(
  state: GameState,
  publicTrace: readonly PublicEvent[],
): unknown {
  return {
    canonicalDecisionVersion: CANONICAL_DECISION_STATE_VERSION,
    engineState: projectCanonicalEngineState(state),
    protagonistPolicyState: protagonistPolicyStateKey(
      "perfect-recall",
      state,
      publicTrace,
    ),
  };
}

export function canonicalDecisionStateKey(
  state: GameState,
  publicTrace: readonly PublicEvent[],
): string {
  return canonicalStringify(projectCanonicalDecisionState(state, publicTrace));
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
  "public phase events outside ProtagonistObservation",
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
