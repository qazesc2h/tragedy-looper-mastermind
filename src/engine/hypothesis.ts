import { characterDataOf } from "../data";
import { PLOT_IMPL } from "../impl/plots";
import { ROLE_IMPL } from "../impl/roles";
import {
  effectiveRole,
  isCharacterDead,
  startLocationOf,
  type CharacterId,
  type GameState,
  type HookPoint,
  type IncidentId,
  type Location,
  type LoopState,
  type LoopEndReason,
  type Phase,
  type PlotId,
  type PublicAbilityTrigger,
  type PublicBoardChange,
  type PublicObservationContext,
  type PublicObservationAt,
  type RoundEvidence,
  type RoleId,
  type Target,
} from "../types";
import {
  rolesForTragedySet,
  tragedySetDefinition,
} from "../tragedy-sets";
import { publicObservationContext as snapshotPublicContext } from "./public-observation";

export {
  publicBoardChanges,
  publicObservationContext,
} from "./public-observation";

export interface RuleCombination {
  id: string;
  mainPlot: PlotId;
  subPlots: PlotId[];
}

export interface PublicLossObservationContext extends PublicObservationContext {
  phase: Phase;
  lastDay: boolean;
  startingLocations: Partial<Record<CharacterId, Location>>;
  firedIncidents: { day: number; incident: IncidentId }[];
}

export type ExplainableLossCondition =
  | { key: string; kind: "plot"; plot: PlotId }
  | { key: string; kind: "role"; role: RoleId }
  | { key: string; kind: "incident"; incident: IncidentId };

/** 주인공이 실제 플레이에서 알게 된 사실만을 담는다. */
export type ProtagonistObservation = (
  | {
    kind: "roleRevealed";
    loop: number;
    character: CharacterId;
    role: RoleId;
    /** false면 공개 순간 역할이 없는 구 저장을 루프 스냅샷으로 복원한 값이다. */
    confirmed?: boolean;
    /** 역할 공개 순간의 게임판. 없으면 동적 역할 판정에 쓰지 않는다. */
    context?: PublicObservationContext;
  }
  | {
    kind: "deadAtLoopEndWithoutRoleReveal";
    loop: number;
    character: CharacterId;
  }
  | {
    kind: "goodwillRefused";
    loop: number;
    day: number;
    character: CharacterId;
    rank: number;
    abilityIndex: number;
  }
  | {
    kind: "goodwillAccepted";
    loop: number;
    day: number;
    character: CharacterId;
    rank: number;
    abilityIndex: number;
  }
  | {
    kind: "incidentOccurred";
    loop: number;
    day: number;
    incident: IncidentId;
    occurred: boolean;
    context?: PublicObservationContext;
    deaths?: CharacterId[];
  }
  | {
    kind: "incidentCulpritRevealed";
    loop: number;
    day: number;
    incident: IncidentId;
    culprit: CharacterId;
  }
  | {
    kind: "subplotRevealed";
    loop: number;
    declaredSubplot: PlotId;
    revealedSubplot: PlotId;
  }
  | {
    kind: "lossObserved";
    loop: number;
    day: number;
    timing: LoopEndReason;
    /** 완료 시점 공개 상태. 구 저장처럼 없으면 배제 근거로 쓰지 않는다. */
    context?: PublicLossObservationContext;
  }
  | {
    kind: "mastermindAbilityResult";
    loop: number;
    day: number;
    changes: PublicBoardChange[];
    timing?: HookPoint;
    trigger?: PublicAbilityTrigger;
    context?: PublicObservationContext;
  }
  | {
    kind: "goodwillIncidentEffect";
    loop: number;
    day: number;
    incident: IncidentId;
    effectApplied: boolean;
  }
  | {
    kind: "intrigueForbidIgnored";
    loop: number;
    day: number;
    target: Target;
    context?: PublicObservationContext;
  }
  | {
    kind: "goodwillForbidApplied";
    loop: number;
    day: number;
    character: CharacterId;
  }
  | {
    kind: "roundEvidence";
    loop: number;
    record: RoundEvidence;
    context: PublicObservationContext;
    lastDay: boolean;
    /** P9 사망 시도에서 보호가 공개적으로 소비된 대상. */
    protectedAtRoundEnd: CharacterId[];
    /** 같은 사망 묶음 직후 불안 6이 공개적으로 증가한 대상. */
    deathReactions: {
      deadCharacters: CharacterId[];
      target: CharacterId;
    }[];
  }
  | {
    kind: "mandatoryEffectMissing";
    loop: number;
    day: number;
    effect: "threadsFate";
    character: CharacterId;
  }
) & {
  /** 서로 다른 공개 기록 저장소를 가로지르는 실제 관측 시점. */
  observedAt?: PublicObservationAt;
};

export type RuleContradictionCode =
  | "revealedRoleUnavailable"
  | "revealedDynamicRoleMismatch"
  | "outsiderRoleAssociated"
  | "goodwillRefusalUnavailable"
  | "revealedSubplotMissing"
  | "mastermindAbilityUnavailable"
  | "deathReactionUnavailable"
  | "loopStartEffectUnavailable"
  | "crossObservationRoleUnavailable"
  | "loopStartGoodwillUnavailable"
  | "intrigueForbidIgnoreUnavailable"
  | "mandatoryEffectMissing"
  | "lossConditionUnavailable";

export interface RuleContradiction {
  code: RuleContradictionCode;
  observation: ProtagonistObservation;
  reason: string;
}

export interface EvaluatedRuleCombination {
  combination: RuleCombination;
  excluded: boolean;
  contradictions: RuleContradiction[];
}

export interface RuleHypothesisEvaluation {
  tragedySet: string;
  observations: ProtagonistObservation[];
  combinations: EvaluatedRuleCombination[];
  remaining: RuleCombination[];
  excluded: EvaluatedRuleCombination[];
}

export type RolePossibilityStatus =
  | "possible"
  | "impossible"
  | "confirmed";

export type RolePossibilityReason =
  | {
    code: "roleRevealed";
    observation: Extract<ProtagonistObservation, { kind: "roleRevealed" }>;
  }
  | {
    code: "otherRoleConfirmed";
    observation: Extract<ProtagonistObservation, { kind: "roleRevealed" }>;
  }
  | {
    code: "effectiveRoleRevealed";
    observation: Extract<ProtagonistObservation, { kind: "roleRevealed" }>;
  }
  | {
    code: "otherRoleInferred";
    role: RoleId;
  }
  | {
    code: "onlyRemainingRole";
  }
  | {
    code: "requiredRoleForcedCandidate";
    minimum: number;
  }
  | {
    code: "roleMaximumReached";
    maximum: number;
    confirmedCharacters: CharacterId[];
  }
  | {
    code: "outsiderConstraint";
  }
  | {
    code: "characterConstraint";
    reason: string;
  }
  | {
    code: "ruleUnavailable";
  }
  | {
    code: "goodwillRefusalRequired";
    observation: Extract<ProtagonistObservation, { kind: "goodwillRefused" }>;
  }
  | {
    code: "mandatoryGoodwillRefusalMissing";
    observation: Extract<ProtagonistObservation, { kind: "goodwillAccepted" }>;
  }
  | {
    code: "abilityLocationIntersection";
    observations: Extract<
      ProtagonistObservation,
      { kind: "mastermindAbilityResult" }
    >[];
  }
  | {
    code: "loopEndRoleRevealMissing";
    observation: Extract<
      ProtagonistObservation,
      { kind: "deadAtLoopEndWithoutRoleReveal" }
    >;
  }
  | {
    code: "lossConditionOnlyCandidate";
    observation: Extract<ProtagonistObservation, { kind: "lossObserved" }>;
  }
  | {
    code: "diedDespiteImmortality";
    observation: Extract<ProtagonistObservation, { kind: "roundEvidence" }>;
  }
  | {
    code: "deathWithoutImmediateLoss";
    observation: Extract<ProtagonistObservation, { kind: "roundEvidence" }>;
  }
  | {
    code: "goodwillForbidApplied";
    observation: Extract<
      ProtagonistObservation,
      { kind: "goodwillForbidApplied" }
    >;
  }
  | {
    code: "causeConstraint";
    observations: ProtagonistObservation[];
  };

export interface RolePossibilityCell {
  character: CharacterId;
  role: RoleId;
  status: RolePossibilityStatus;
  reasons: RolePossibilityReason[];
}

/** 전체 배정을 열거하지 않는 캐릭터 x 역할 독립 가능성 표. */
export interface RolePossibilityTable {
  characters: CharacterId[];
  roles: RoleId[];
  cells: Record<CharacterId, Record<RoleId, RolePossibilityCell>>;
}

export type RoleTableRuleContradiction =
  | {
    code: "requiredRoleUnavailable";
    role: RoleId;
    reason: string;
  }
  | {
    code: "confirmedRoleCountExceedsMaximum";
    role: RoleId;
    confirmedCount: number;
    maximum: number;
    reason: string;
  };

export interface EvaluatedRoleTableRuleCombination {
  combination: RuleCombination;
  excluded: boolean;
  contradictions: RuleContradiction[];
  tableContradictions: RoleTableRuleContradiction[];
}

export interface RoleTableHypothesisEvaluation {
  tragedySet: string;
  observations: ProtagonistObservation[];
  table: RolePossibilityTable;
  combinations: EvaluatedRoleTableRuleCombination[];
  remaining: RuleCombination[];
  excluded: EvaluatedRoleTableRuleCombination[];
  /** 룰 -> 표 -> 룰을 적용해 고정점에 도달하기까지 계산한 표의 수. */
  propagationPasses: number;
}

interface EvaluationOptions {
  /** 캐릭터 정체는 공개 정보이므로 아웃사이더 역할 가능성에만 사용한다. */
  publicCast?: readonly CharacterId[];
}

interface RoleRange {
  min: number;
  max: number;
}

function choose<T>(items: readonly T[], count: number): T[][] {
  if (count === 0) return [[]];
  if (count > items.length) return [];

  const choices: T[][] = [];
  for (let index = 0; index <= items.length - count; index += 1) {
    for (const rest of choose(items.slice(index + 1), count - 1)) {
      choices.push([items[index], ...rest]);
    }
  }
  return choices;
}

export function enumerateRuleCombinations(
  tragedySet: string,
): RuleCombination[] {
  const definition = tragedySetDefinition(tragedySet);
  return definition.mainPlots.flatMap((mainPlot) =>
    choose(definition.subPlots, definition.numberOfSubPlots).map(
      (subPlots) => ({
        id: [mainPlot, ...subPlots].join("+"),
        mainPlot,
        subPlots,
      }),
    )
  );
}

function roleRanges(combination: RuleCombination): Map<RoleId, RoleRange> {
  const ranges = new Map<RoleId, RoleRange>();
  for (const plot of [combination.mainPlot, ...combination.subPlots]) {
    for (const [role, rawCount] of Object.entries(
      PLOT_IMPL[plot]?.addsRoles ?? {},
    )) {
      const [min, max] = Array.isArray(rawCount)
        ? rawCount
        : [rawCount, rawCount];
      const existing = ranges.get(role) ?? { min: 0, max: 0 };
      const roleLimit = ROLE_IMPL[role]?.max ?? Number.POSITIVE_INFINITY;
      ranges.set(role, {
        min: Math.min(existing.min + min, roleLimit),
        max: Math.min(existing.max + max, roleLimit),
      });
    }
  }
  return ranges;
}

function roleIsAssociated(
  ranges: ReadonlyMap<RoleId, RoleRange>,
  role: RoleId,
): boolean {
  return ranges.has(role);
}

function activeRoleIsPossible(
  ranges: ReadonlyMap<RoleId, RoleRange>,
  role: RoleId,
): boolean {
  return role === "person" || (ranges.get(role)?.max ?? 0) > 0;
}

function inactiveSetRoleIsPossible(
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  role: RoleId,
): boolean {
  return role !== "person" &&
    tragedySetRoles.includes(role) &&
    !roleIsAssociated(ranges, role);
}

function roleCanRefuseGoodwill(role: RoleId): boolean {
  return ROLE_IMPL[role]?.goodwillRefusal !== undefined;
}

function activeRefusalRoleExists(
  ranges: ReadonlyMap<RoleId, RoleRange>,
): boolean {
  return [...ranges.entries()].some(
    ([role, range]) => range.max > 0 && roleCanRefuseGoodwill(role),
  );
}

function inactiveRefusalRoleExists(
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
): boolean {
  return tragedySetRoles.some((role) =>
    inactiveSetRoleIsPossible(tragedySetRoles, ranges, role) &&
    roleCanRefuseGoodwill(role)
  );
}

function roleCouldAppear(
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  role: RoleId,
  publicCast: readonly CharacterId[],
): boolean {
  if (activeRoleIsPossible(ranges, role)) return true;
  return publicCast.some(
    (character) => characterDataOf(character).plotLessRole,
  ) && inactiveSetRoleIsPossible(tragedySetRoles, ranges, role);
}

function roleCouldBelongToCharacter(
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  role: RoleId,
  character: CharacterId,
): boolean {
  return characterDataOf(character).plotLessRole
    ? inactiveSetRoleIsPossible(tragedySetRoles, ranges, role)
    : activeRoleIsPossible(ranges, role);
}

function factorAbilityConditionMet(
  context: PublicObservationContext | undefined,
  abilityRole: "conspiracyTheorist" | "keyPerson",
): boolean {
  // 구 저장 로그에는 시점 스냅샷이 없다. 근거 없이 후보를 배제하지 않는다.
  if (context === undefined) return true;
  return abilityRole === "conspiracyTheorist"
    ? context.locationIntrigue.School >= 2
    : context.locationIntrigue.City >= 2;
}

function roleAbilityCouldAppear(
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  abilityRole: "conspiracyTheorist" | "keyPerson",
  publicCast: readonly CharacterId[],
  context: PublicObservationContext | undefined,
): boolean {
  if (roleCouldAppear(
    tragedySetRoles,
    ranges,
    abilityRole,
    publicCast,
  )) {
    return true;
  }
  return factorAbilityConditionMet(context, abilityRole) && roleCouldAppear(
    tragedySetRoles,
    ranges,
    "factor",
    publicCast,
  );
}

function roleObservationContradiction(
  observation: Extract<ProtagonistObservation, { kind: "roleRevealed" }>,
  combination: RuleCombination,
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
): RuleContradiction | undefined {
  // 공개 순간 역할이 없는 구 저장의 복원값은 확정 증거로 쓰지 않는다.
  if (observation.confirmed === false) return undefined;
  const plotLessRole = characterDataOf(observation.character).plotLessRole;
  const paranoia = observation.context?.characters?.[observation.character]
    ?.paranoia;
  const paranoiaVirusActive = !plotLessRole &&
    combination.subPlots.includes("paranoiaVirus");
  if (
    observation.role === "person" &&
    paranoiaVirusActive &&
    paranoia !== undefined &&
    paranoia >= 3
  ) {
    return {
      code: "revealedDynamicRoleMismatch",
      observation,
      reason: `${observation.character}는 역할 공개 시 불안이 ${paranoia}이므로 ` +
        "망상 확대 바이러스 아래에서는 연쇄 살인마여야 합니다.",
    };
  }
  // 연쇄 살인마 공개는 배정 역할이 아니라 공개 순간의 유효 역할일 수 있다.
  // 구 저장처럼 시점 상태가 없으면 바이러스 변이를 보수적으로 허용한다.
  const mutatedPersonCouldExplain = observation.role === "serialKiller" &&
    paranoiaVirusActive &&
    (paranoia === undefined || paranoia >= 3) &&
    activeRoleIsPossible(ranges, "person");
  const compatible = plotLessRole
    ? inactiveSetRoleIsPossible(tragedySetRoles, ranges, observation.role)
    : activeRoleIsPossible(ranges, observation.role) ||
      mutatedPersonCouldExplain;
  if (compatible) return undefined;

  return {
    code: plotLessRole
      ? "outsiderRoleAssociated"
      : "revealedRoleUnavailable",
    observation,
    reason: plotLessRole
      ? `${observation.character}에게 공개된 ${observation.role} 역할이 ` +
        "이 조합의 룰과 연관되어 있습니다."
      : `${observation.character}에게 공개된 ${observation.role} 역할이 ` +
        "이 조합의 룰에서 나올 수 없습니다.",
  };
}

function refusalObservationContradiction(
  observation: Extract<ProtagonistObservation, { kind: "goodwillRefused" }>,
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
): RuleContradiction | undefined {
  const plotLessRole = characterDataOf(observation.character).plotLessRole;
  const refusalPossible = plotLessRole
    ? inactiveRefusalRoleExists(tragedySetRoles, ranges)
    : activeRefusalRoleExists(ranges);
  if (refusalPossible) return undefined;
  return {
    code: "goodwillRefusalUnavailable",
    observation,
    reason: `${observation.character}의 우호 능력 거부를 설명할 ` +
      "우호 무시 역할이 이 조합에 없습니다.",
  };
}

function sameTarget(left: Target, right: Target): boolean {
  return left.kind === right.kind && (
    left.kind === "character"
      ? left.id === (right.kind === "character" ? right.id : undefined)
      : left.at === (right.kind === "location" ? right.at : undefined)
  );
}

function observedAbilityLocations(
  character: NonNullable<PublicObservationContext["characters"]>[CharacterId],
): readonly string[] {
  return character.abilityLocations ??
    (character.location === undefined ? [] : [character.location]);
}

interface RoleCauseRequirement {
  role: RoleId;
  candidates: CharacterId[];
}

interface RoleCauseExclusion {
  character: CharacterId;
  role: RoleId;
}

interface ObservationCauseAlternative {
  requirements: RoleCauseRequirement[];
  exclusions?: RoleCauseExclusion[];
  /** 같은 루프에서 한 번뿐인 룰 능력의 소비 단위. */
  oncePerLoopUse?: string;
}

interface ObservationCauseClause {
  observation: ProtagonistObservation;
  alternatives: ObservationCauseAlternative[];
}

function confirmedRoleByCharacter(
  observations: readonly ProtagonistObservation[],
  combination: RuleCombination,
): Map<CharacterId, RoleId> {
  const roles = new Map<CharacterId, RoleId>();
  for (const observation of observations) {
    if (
      observation.kind === "roleRevealed" &&
      observation.confirmed !== false
    ) {
      const paranoia = observation.context?.characters?.[observation.character]
        ?.paranoia;
      const mutatedPerson = observation.role === "serialKiller" &&
        !characterDataOf(observation.character).plotLessRole &&
        combination.subPlots.includes("paranoiaVirus") &&
        (paranoia === undefined || paranoia >= 3);
      if (
        mutatedPerson &&
        activeRoleIsPossible(roleRanges(combination), "serialKiller")
      ) {
        // 공개된 유효 역할만으로 기본 person/serialKiller를 구별할 수 없다.
        continue;
      }
      roles.set(
        observation.character,
        mutatedPerson ? "person" : observation.role,
      );
    }
  }
  return roles;
}

function roleAssignmentCompatible(
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  role: RoleId,
  character: CharacterId,
  confirmedRoles: ReadonlyMap<CharacterId, RoleId>,
): boolean {
  const confirmedRole = confirmedRoles.get(character);
  if (confirmedRole !== undefined && confirmedRole !== role) return false;
  if (role === "person" && character === "ai") return false;
  return roleCouldBelongToCharacter(
    tragedySetRoles,
    ranges,
    role,
    character,
  );
}

function roleActorsReachingLocation(
  context: PublicObservationContext,
  location: string,
  role: RoleId,
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  confirmedRoles: ReadonlyMap<CharacterId, RoleId>,
): CharacterId[] {
  return Object.entries(context.characters ?? {}).flatMap(
    ([character, state]) =>
      state.status !== "absent" &&
        observedAbilityLocations(state).includes(location) &&
        roleAssignmentCompatible(
          tragedySetRoles,
          ranges,
          role,
          character,
          confirmedRoles,
        )
        ? [character]
        : [],
  );
}

function roleCapacity(
  role: RoleId,
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  publicCast: readonly CharacterId[],
): number {
  if (role === "person") {
    return publicCast.filter((character) =>
      character !== "ai" && !characterDataOf(character).plotLessRole
    ).length;
  }

  const activeCount = ranges.get(role)?.max ?? 0;
  // 모방자는 활성 역할의 정원과 무관하게 한 역할을 복사할 수 있다. 복사 대상
  // 추론은 아직 미지원이므로 어떤 역할을 복사했는지 모를 때는 상한만 1 늘린다.
  const copycatAllowance = publicCast.includes("copycat") ? 1 : 0;
  if (activeCount > 0) return activeCount + copycatAllowance;
  if (!inactiveSetRoleIsPossible(tragedySetRoles, ranges, role)) return 0;

  const outsiderCount = publicCast.filter((character) =>
    characterDataOf(character).plotLessRole
  ).length;
  return Math.min(
    outsiderCount,
    ROLE_IMPL[role]?.max ?? Number.POSITIVE_INFINITY,
  );
}

function p5CauseClauses(
  observation: Extract<
    ProtagonistObservation,
    { kind: "mastermindAbilityResult" }
  >,
  combination: RuleCombination,
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  confirmedRoles: ReadonlyMap<CharacterId, RoleId>,
): ObservationCauseClause[] {
  if (
    observation.timing !== "P5_MASTERMIND_ABILITY" ||
    observation.context?.characters === undefined
  ) return [];

  const clauses: ObservationCauseClause[] = [];
  for (const change of observation.changes) {
    if (
      change.kind !== "counter" ||
      change.delta <= 0 ||
      (change.counter !== "paranoia" && change.counter !== "intrigue")
    ) continue;

    const targetLocation = change.target.kind === "location"
      ? change.target.at
      : observation.context.characters[change.target.id]?.status === "alive"
      ? observation.context.characters[change.target.id]?.location
      : undefined;
    if (targetLocation === undefined) continue;

    const alternatives: ObservationCauseAlternative[] = [];
    if (change.counter === "paranoia") {
      alternatives.push({
        requirements: [{
          role: "conspiracyTheorist",
          candidates: roleActorsReachingLocation(
            observation.context,
            targetLocation,
            "conspiracyTheorist",
            tragedySetRoles,
            ranges,
            confirmedRoles,
          ),
        }],
      });
      if (observation.context.locationIntrigue.School >= 2) {
        alternatives.push({
          requirements: [{
            role: "factor",
            candidates: roleActorsReachingLocation(
              observation.context,
              targetLocation,
              "factor",
              tragedySetRoles,
              ranges,
              confirmedRoles,
            ),
          }],
        });
      }
    } else {
      alternatives.push({
        requirements: [{
          role: "brain",
          candidates: roleActorsReachingLocation(
            observation.context,
            targetLocation,
            "brain",
            tragedySetRoles,
            ranges,
            confirmedRoles,
          ),
        }],
      });
      if (
        change.target.kind === "location" &&
        combination.subPlots.includes("unsettlingRumor")
      ) {
        alternatives.unshift({
          requirements: [],
          oncePerLoopUse: `unsettlingRumor:${observation.loop}`,
        });
      }
    }
    clauses.push({ observation, alternatives });
  }
  return clauses;
}

function roundEndDeathCauseClauses(
  observation: Extract<
    ProtagonistObservation,
    { kind: "mastermindAbilityResult" }
  >,
  combination: RuleCombination,
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  confirmedRoles: ReadonlyMap<CharacterId, RoleId>,
): ObservationCauseClause[] {
  if (
    observation.timing !== "P9_ROUND_END" ||
    observation.context?.characters === undefined
  ) return [];

  const clauses: ObservationCauseClause[] = [];
  for (const change of observation.changes) {
    if (
      change.kind !== "status" ||
      change.from !== "alive" ||
      change.to !== "dead"
    ) continue;

    const deceased = observation.context.characters[change.character];
    if (deceased?.status !== "alive" || deceased.location === undefined) {
      continue;
    }
    const deathLocation = deceased.location;
    const livingHere = Object.entries(observation.context.characters)
      .filter(([, state]) =>
        state.status === "alive" && state.location === deathLocation
      );
    const others = livingHere.filter(([character]) =>
      character !== change.character
    );
    const possibleKillers = Object.entries(observation.context.characters)
      .filter(([character, state]) =>
        character !== change.character &&
        state.status !== "absent" &&
        observedAbilityLocations(state).includes(deathLocation)
      )
      .map(([character]) => character);

    const alternatives: ObservationCauseAlternative[] = [];
    if (livingHere.length === 2 && others.length === 1) {
      const serialCandidates = others.flatMap(([character]) =>
        roleAssignmentCompatible(
            tragedySetRoles,
            ranges,
            "serialKiller",
            character,
            confirmedRoles,
          )
          ? [character]
          : []
      );
      alternatives.push({
        requirements: [{ role: "serialKiller", candidates: serialCandidates }],
      });

      if (combination.subPlots.includes("paranoiaVirus")) {
        const mutatedPersonCandidates = others.flatMap(([character, state]) =>
          state.paranoia >= 3 &&
            roleAssignmentCompatible(
              tragedySetRoles,
              ranges,
              "person",
              character,
              confirmedRoles,
            )
            ? [character]
            : []
        );
        alternatives.push({
          requirements: [{
            role: "person",
            candidates: mutatedPersonCandidates,
          }],
        });
      }
    }

    if (deceased.intrigue >= 2 && possibleKillers.length > 0) {
      alternatives.push({
        requirements: [
          {
            role: "killer",
            candidates: possibleKillers.filter((character) =>
              roleAssignmentCompatible(
                tragedySetRoles,
                ranges,
                "killer",
                character,
                confirmedRoles,
              )
            ),
          },
          {
            role: "keyPerson",
            candidates: roleAssignmentCompatible(
                tragedySetRoles,
                ranges,
                "keyPerson",
                change.character,
                confirmedRoles,
              )
              ? [change.character]
              : [],
          },
        ],
      });
    }

    // 공개 상태만으로 두 역할 능력 중 어느 패턴도 완성되지 않으면 보존만 한다.
    if (alternatives.length > 0) {
      clauses.push({ observation, alternatives });
    }
  }
  return clauses;
}

function compatibleRoleCandidates(
  candidates: readonly CharacterId[],
  role: RoleId,
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  confirmedRoles: ReadonlyMap<CharacterId, RoleId>,
): CharacterId[] {
  return candidates.filter((character) =>
    roleAssignmentCompatible(
      tragedySetRoles,
      ranges,
      role,
      character,
      confirmedRoles,
    )
  );
}

function roundEvidenceCauseClauses(
  observation: Extract<ProtagonistObservation, { kind: "roundEvidence" }>,
  combination: RuleCombination,
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  confirmedRoles: ReadonlyMap<CharacterId, RoleId>,
): ObservationCauseClause[] {
  const clauses: ObservationCauseClause[] = [];
  const deaths = observation.record.deathBatches?.flatMap(({ characters }) =>
    characters
  ) ?? [];

  if (
    observation.record.immediateLoopEnd?.reason === "effect" &&
    deaths.length > 0
  ) {
    const alternatives: ObservationCauseAlternative[] = [{
      requirements: [{
        role: "keyPerson",
        candidates: compatibleRoleCandidates(
          deaths,
          "keyPerson",
          tragedySetRoles,
          ranges,
          confirmedRoles,
        ),
      }],
    }];
    const factorDeaths = observation.record.deathBatches?.flatMap((batch) =>
      (batch.cityIntrigue ?? -1) >= 2 ? batch.characters : []
    ) ?? [];
    if (factorDeaths.length > 0) {
      alternatives.push({
        requirements: [{
          role: "factor",
          candidates: compatibleRoleCandidates(
            factorDeaths,
            "factor",
            tragedySetRoles,
            ranges,
            confirmedRoles,
          ),
        }],
      });
    }
    if (
      observation.lastDay &&
      observation.record.immediateLoopEnd.phase === "P9_ROUND_END"
    ) {
      const timeTravelers = Object.entries(
        observation.context.characters ?? {},
      ).flatMap(([character, state]) =>
        state.status === "alive" && state.goodwill <= 2 ? [character] : []
      );
      alternatives.push({
        requirements: [{
          role: "timeTraveler",
          candidates: compatibleRoleCandidates(
            timeTravelers,
            "timeTraveler",
            tragedySetRoles,
            ranges,
            confirmedRoles,
          ),
        }],
      });
    }
    clauses.push({ observation, alternatives });
  }

  const p9Deaths = new Set(
    observation.record.deathBatches?.flatMap((batch) =>
      batch.phase === "P9_ROUND_END" ? batch.characters : []
    ) ?? [],
  );
  const protectedTargets = new Set(observation.protectedAtRoundEnd);
  for (const pair of observation.record.roundEndPairs ?? []) {
    for (let actorIndex = 0; actorIndex < pair.characters.length; actorIndex += 1) {
      const actor = pair.characters[actorIndex];
      const target = pair.characters[actorIndex === 0 ? 1 : 0];
      if (actor === undefined || target === undefined) continue;

      if (!p9Deaths.has(target)) {
        if (protectedTargets.has(target)) continue;
        const effectiveSerialExclusions: RoleCauseExclusion[] = [{
          character: actor,
          role: "serialKiller",
        }];
        if (
          combination.subPlots.includes("paranoiaVirus") &&
          (pair.paranoia[actorIndex] ?? 0) >= 3
        ) {
          effectiveSerialExclusions.push({ character: actor, role: "person" });
        }
        clauses.push({
          observation,
          alternatives: [
            { requirements: [], exclusions: effectiveSerialExclusions },
            {
              requirements: [{
                role: "timeTraveler",
                candidates: compatibleRoleCandidates(
                  [target],
                  "timeTraveler",
                  tragedySetRoles,
                  ranges,
                  confirmedRoles,
                ),
              }],
            },
          ],
        });
        continue;
      }

      const alternatives: ObservationCauseAlternative[] = [{
        requirements: [{
          role: "serialKiller",
          candidates: compatibleRoleCandidates(
            [actor],
            "serialKiller",
            tragedySetRoles,
            ranges,
            confirmedRoles,
          ),
        }],
      }];
      if (
        combination.subPlots.includes("paranoiaVirus") &&
        (pair.paranoia[actorIndex] ?? 0) >= 3
      ) {
        alternatives.push({
          requirements: [{
            role: "person",
            candidates: compatibleRoleCandidates(
              [actor],
              "person",
              tragedySetRoles,
              ranges,
              confirmedRoles,
            ),
          }],
        });
      }
      if ((pair.intrigue?.[actorIndex === 0 ? 1 : 0] ?? -1) >= 2) {
        alternatives.push({
          requirements: [
            {
              role: "killer",
              candidates: compatibleRoleCandidates(
                [actor],
                "killer",
                tragedySetRoles,
                ranges,
                confirmedRoles,
              ),
            },
            {
              role: "keyPerson",
              candidates: compatibleRoleCandidates(
                [target],
                "keyPerson",
                tragedySetRoles,
                ranges,
                confirmedRoles,
              ),
            },
          ],
        });
      }
      clauses.push({ observation, alternatives });
    }
  }

  const allDeathBatches = observation.record.deathBatches ?? [];
  for (const batch of allDeathBatches) {
    const reactions = observation.deathReactions.filter((reaction) =>
      reaction.deadCharacters.some((character) =>
        batch.characters.includes(character)
      )
    );
    for (const reaction of reactions) {
      const alternatives: ObservationCauseAlternative[] = [];
      for (const dead of batch.characters) {
        alternatives.push({
          requirements: [
            {
              role: "lover",
              candidates: compatibleRoleCandidates(
                [reaction.target],
                "lover",
                tragedySetRoles,
                ranges,
                confirmedRoles,
              ),
            },
            {
              role: "lovedOne",
              candidates: compatibleRoleCandidates(
                [dead],
                "lovedOne",
                tragedySetRoles,
                ranges,
                confirmedRoles,
              ),
            },
          ],
        });
        alternatives.push({
          requirements: [
            {
              role: "lovedOne",
              candidates: compatibleRoleCandidates(
                [reaction.target],
                "lovedOne",
                tragedySetRoles,
                ranges,
                confirmedRoles,
              ),
            },
            {
              role: "lover",
              candidates: compatibleRoleCandidates(
                [dead],
                "lover",
                tragedySetRoles,
                ranges,
                confirmedRoles,
              ),
            },
          ],
        });
      }
      clauses.push({ observation, alternatives });
    }

    const reacted = new Set(reactions.map(({ target }) => target));
    // 구 저장에는 정확한 사망 직후 생존자 목록이 없다. 최종 보드 상태로
    // 역산하면 등장 전/부재 캐릭터를 잘못 배제하므로 그 경우 추론하지 않는다.
    const responders = (batch.aliveAfterDeaths ?? []).filter((character) =>
      !reacted.has(character)
    );
    for (const dead of batch.characters) {
      for (const responder of responders) {
        clauses.push({
          observation,
          alternatives: [
            {
              requirements: [],
              exclusions: [{ character: dead, role: "lovedOne" }],
            },
            {
              requirements: [{
                role: "lover",
                candidates: [...(batch.aliveAfterDeaths ?? [])],
              }],
              exclusions: [{ character: responder, role: "lover" }],
            },
          ],
        });
        clauses.push({
          observation,
          alternatives: [
            {
              requirements: [],
              exclusions: [{ character: dead, role: "lover" }],
            },
            {
              requirements: [{
                role: "lovedOne",
                candidates: [...(batch.aliveAfterDeaths ?? [])],
              }],
              exclusions: [{ character: responder, role: "lovedOne" }],
            },
          ],
        });
      }
    }
  }

  return clauses;
}

function causeClausesForObservation(
  observation: ProtagonistObservation,
  combination: RuleCombination,
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  confirmedRoles: ReadonlyMap<CharacterId, RoleId>,
): ObservationCauseClause[] {
  if (observation.kind === "roundEvidence") {
    return roundEvidenceCauseClauses(
      observation,
      combination,
      tragedySetRoles,
      ranges,
      confirmedRoles,
    );
  }
  if (observation.kind !== "mastermindAbilityResult") return [];
  return [
    ...p5CauseClauses(
      observation,
      combination,
      tragedySetRoles,
      ranges,
      confirmedRoles,
    ),
    ...roundEndDeathCauseClauses(
      observation,
      combination,
      tragedySetRoles,
      ranges,
      confirmedRoles,
    ),
  ];
}

function holderOptionsForRole(
  role: RoleId,
  requirements: readonly RoleCauseRequirement[],
  exclusions: ReadonlySet<CharacterId>,
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  publicCast: readonly CharacterId[],
  confirmedRoles: ReadonlyMap<CharacterId, RoleId>,
): Set<CharacterId>[] {
  const capacity = roleCapacity(role, tragedySetRoles, ranges, publicCast);
  const confirmedHolders = [...confirmedRoles.entries()].flatMap(
    ([character, confirmedRole]) => confirmedRole === role ? [character] : [],
  );
  if (
    confirmedHolders.length > capacity ||
    confirmedHolders.some((character) => exclusions.has(character))
  ) return [];

  const mandatory = new Set(confirmedHolders);
  const universe = [...new Set([
    ...confirmedHolders,
    ...requirements.flatMap(({ candidates }) => candidates),
  ])];
  const optional = universe.filter((character) =>
    !mandatory.has(character) && !exclusions.has(character)
  );
  const valid: Set<CharacterId>[] = [];
  for (
    let optionalCount = 0;
    optionalCount <= capacity - mandatory.size;
    optionalCount += 1
  ) {
    for (const selected of choose(optional, optionalCount)) {
      const holders = new Set([...mandatory, ...selected]);
      if (requirements.every(({ candidates }) =>
        candidates.some((character) => holders.has(character))
      )) {
        if (![...valid].some((existing) =>
          [...existing].every((character) => holders.has(character))
        )) {
          valid.push(holders);
        }
      }
    }
  }
  return valid;
}

function roleRequirementsCanCoexist(
  requirements: readonly RoleCauseRequirement[],
  exclusions: readonly RoleCauseExclusion[],
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  publicCast: readonly CharacterId[],
  confirmedRoles: ReadonlyMap<CharacterId, RoleId>,
): boolean {
  if (exclusions.some(({ character, role }) =>
    confirmedRoles.get(character) === role
  )) return false;

  const byRole = new Map<RoleId, RoleCauseRequirement[]>();
  for (const requirement of requirements) {
    const roleRequirements = byRole.get(requirement.role) ?? [];
    roleRequirements.push(requirement);
    byRole.set(requirement.role, roleRequirements);
  }
  for (const role of confirmedRoles.values()) {
    if (!byRole.has(role)) byRole.set(role, []);
  }

  const excludedByRole = new Map<RoleId, Set<CharacterId>>();
  for (const exclusion of exclusions) {
    const characters = excludedByRole.get(exclusion.role) ?? new Set();
    characters.add(exclusion.character);
    excludedByRole.set(exclusion.role, characters);
  }

  const roleOptions = [...byRole.entries()].map(([role, roleRequirements]) => ({
    role,
    options: holderOptionsForRole(
      role,
      roleRequirements,
      excludedByRole.get(role) ?? new Set(),
      tragedySetRoles,
      ranges,
      publicCast,
      confirmedRoles,
    ),
  })).sort((left, right) => left.options.length - right.options.length);
  if (roleOptions.some(({ options }) => options.length === 0)) return false;

  const assign = (index: number, occupied: ReadonlySet<CharacterId>): boolean => {
    const current = roleOptions[index];
    if (current === undefined) return true;
    return current.options.some((holders) => {
      if ([...holders].some((character) => occupied.has(character))) {
        return false;
      }
      return assign(index + 1, new Set([...occupied, ...holders]));
    });
  };
  return assign(0, new Set());
}

function causeClausesAreSatisfiable(
  clauses: readonly ObservationCauseClause[],
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  publicCast: readonly CharacterId[],
  confirmedRoles: ReadonlyMap<CharacterId, RoleId>,
  initialExclusions: readonly RoleCauseExclusion[] = [],
): boolean {
  const ordered = [...clauses].sort(
    (left, right) => left.alternatives.length - right.alternatives.length,
  );
  const search = (
    index: number,
    requirements: readonly RoleCauseRequirement[],
    exclusions: readonly RoleCauseExclusion[],
    uses: ReadonlySet<string>,
  ): boolean => {
    const clause = ordered[index];
    if (clause === undefined) return true;
    return clause.alternatives.some((alternative) => {
      if (
        alternative.oncePerLoopUse !== undefined &&
        uses.has(alternative.oncePerLoopUse)
      ) return false;
      const nextRequirements = [...requirements, ...alternative.requirements];
      const nextExclusions = [
        ...exclusions,
        ...(alternative.exclusions ?? []),
      ];
      const nextUses = alternative.oncePerLoopUse === undefined
        ? uses
        : new Set([...uses, alternative.oncePerLoopUse]);
      return roleRequirementsCanCoexist(
          nextRequirements,
          nextExclusions,
          tragedySetRoles,
          ranges,
          publicCast,
          confirmedRoles,
        ) && search(
          index + 1,
          nextRequirements,
          nextExclusions,
          nextUses,
        );
    });
  };
  return search(0, [], initialExclusions, new Set());
}

function observedRoleExclusions(
  observations: readonly ProtagonistObservation[],
  publicCast: readonly CharacterId[],
  tragedySetRoles: readonly RoleId[],
  combination: RuleCombination,
): RoleCauseExclusion[] {
  return publicCast.flatMap((character) =>
    tragedySetRoles.flatMap((role) =>
      observedRoleExclusionReason(
          observations,
          character,
          role,
          tragedySetRoles,
          [combination],
        ) === undefined
        ? []
        : [{ character, role }]
    )
  );
}

function crossObservationRoleContradiction(
  observations: readonly ProtagonistObservation[],
  combination: RuleCombination,
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  publicCast: readonly CharacterId[],
): RuleContradiction | undefined {
  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index];
    if (observation === undefined) continue;
    const prefix = observations.slice(0, index + 1);
    const confirmedRoles = confirmedRoleByCharacter(prefix, combination);
    const contextCharacters = prefix.flatMap((candidate) =>
      candidate.kind === "mastermindAbilityResult"
        ? Object.keys(candidate.context?.characters ?? {})
        : []
    );
    const knownCast = [...new Set([
      ...publicCast,
      ...contextCharacters,
      ...confirmedRoles.keys(),
    ])];
    const clauses = prefix.flatMap((candidate) =>
      causeClausesForObservation(
        candidate,
        combination,
        tragedySetRoles,
        ranges,
        confirmedRoles,
      )
    );
    if (
      clauses.length > 0 &&
      !causeClausesAreSatisfiable(
        clauses,
        tragedySetRoles,
        ranges,
        knownCast,
        confirmedRoles,
        observedRoleExclusions(
          prefix,
          knownCast,
          tragedySetRoles,
          combination,
        ),
      )
    ) {
      return {
        code: "crossObservationRoleUnavailable",
        observation,
        reason: "누적된 공개 관측의 원인 후보를 고정된 역할 배정과 역할 수 상한으로 동시에 설명할 수 없습니다.",
      };
    }
  }
  return undefined;
}

function loopStartGoodwillContradiction(
  observation: Extract<
    ProtagonistObservation,
    { kind: "mastermindAbilityResult" }
  >,
  observations: readonly ProtagonistObservation[],
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  publicCast: readonly CharacterId[],
): RuleContradiction | undefined {
  if (observation.timing !== "LOOP_START") return undefined;
  const eligibleCharacters = observation.changes.flatMap((change) => {
    if (
      change.kind !== "counter" ||
      change.target.kind !== "character" ||
      change.counter !== "goodwill" ||
      change.delta !== 1
    ) return [];
    const character = change.target.id;
    return observations.some((candidate) =>
        candidate.kind === "roleRevealed" &&
        candidate.confirmed !== false &&
        candidate.character === character &&
        candidate.role === "friend" &&
        candidate.loop < observation.loop
      )
      ? [character]
      : [];
  });
  if (eligibleCharacters.length === 0) return undefined;
  if (roleCouldAppear(tragedySetRoles, ranges, "friend", publicCast)) {
    return undefined;
  }
  return {
    code: "loopStartGoodwillUnavailable",
    observation,
    reason: "역할 공개 뒤 루프 시작 우호 1 증가를 설명할 친구 역할이 없습니다.",
  };
}

function intrigueForbidIgnoredContradiction(
  observation: Extract<
    ProtagonistObservation,
    { kind: "intrigueForbidIgnored" }
  >,
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  publicCast: readonly CharacterId[],
): RuleContradiction | undefined {
  const targetLocation = observation.target.kind === "location"
    ? observation.target.at
    : observation.context?.characters?.[observation.target.id]?.location;
  const contextCharacters = observation.context?.characters;
  const cultistPossible = targetLocation === undefined ||
      contextCharacters === undefined || publicCast.length === 0
    ? roleCouldAppear(tragedySetRoles, ranges, "cultist", publicCast)
    : publicCast.some((character) => {
      const publicState = contextCharacters[character];
      return publicState !== undefined &&
        publicState.status !== "absent" &&
        observedAbilityLocations(publicState).includes(targetLocation) &&
        roleCouldBelongToCharacter(
          tragedySetRoles,
          ranges,
          "cultist",
          character,
        );
    });
  if (cultistPossible) {
    return undefined;
  }
  return {
    code: "intrigueForbidIgnoreUnavailable",
    observation,
    reason: "유효한 음모 금지를 무시한 증가를 설명할 광신도 역할이 없습니다.",
  };
}

function abilityObservationContradiction(
  observation: Extract<
    ProtagonistObservation,
    { kind: "mastermindAbilityResult" }
  >,
  combination: RuleCombination,
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  publicCast: readonly CharacterId[],
  observations: readonly ProtagonistObservation[],
): RuleContradiction | undefined {
  const deathReaction = observation.timing === "ON_DEATH" &&
    observation.trigger?.kind === "death" &&
    observation.trigger.deadCharacters.length > 0 &&
    observation.changes.some((change) =>
      change.kind === "counter" &&
      change.target.kind === "character" &&
      !observation.trigger?.deadCharacters.includes(change.target.id) &&
      change.counter === "paranoia" &&
      change.delta === 6
    );
  if (deathReaction) {
    return combination.subPlots.includes("loveAffair")
      ? undefined
      : {
        code: "deathReactionUnavailable",
        observation,
        reason: "사망 직후 공개된 불안 6 증가를 이 조합으로 설명할 수 없습니다.",
      };
  }

  const loopStartParanoiaTargets = new Set(
    observation.timing === "LOOP_START"
      ? observation.changes.flatMap((change) =>
        change.kind === "counter" &&
          change.target.kind === "character" &&
          change.counter === "paranoia" &&
          change.delta === 2
          ? [change.target.id]
          : []
      )
      : [],
  );
  if (loopStartParanoiaTargets.size >= 2) {
    return combination.subPlots.includes("threadsFate")
      ? undefined
      : {
        code: "loopStartEffectUnavailable",
        observation,
        reason: "루프 시작에 공개된 복수 캐릭터 불안 2 증가를 이 조합으로 설명할 수 없습니다.",
      };
  }

  const loopStartGoodwill = loopStartGoodwillContradiction(
    observation,
    observations,
    tragedySetRoles,
    ranges,
    publicCast,
  );
  if (loopStartGoodwill !== undefined) return loopStartGoodwill;

  // C-1에서 넓힌 다른 훅 시점은 각 단계 전용 필터가 생기기 전까지 관측만 한다.
  // timing이 없는 구 저장 기록은 기존 P5 관측으로 보수적으로 호환한다.
  if (
    observation.timing !== undefined &&
    observation.timing !== "P5_MASTERMIND_ABILITY"
  ) {
    return undefined;
  }

  for (const change of observation.changes) {
    if (change.kind !== "counter" || change.delta <= 0) continue;

    let possible = true;
    if (change.counter === "paranoia") {
      possible = roleAbilityCouldAppear(
        tragedySetRoles,
        ranges,
        "conspiracyTheorist",
        publicCast,
        observation.context,
      );
    } else if (change.counter === "intrigue") {
      possible = change.target.kind === "location"
        ? combination.subPlots.includes("unsettlingRumor") ||
          roleCouldAppear(tragedySetRoles, ranges, "brain", publicCast)
        : roleCouldAppear(tragedySetRoles, ranges, "brain", publicCast);
    }
    if (!possible) {
      return {
        code: "mastermindAbilityUnavailable",
        observation,
        reason: "공개된 각본가 능력의 카운터 증가를 이 조합으로 설명할 수 없습니다.",
      };
    }
  }
  return undefined;
}

function characterCanHoldRoleForCombination(
  combination: RuleCombination,
  character: CharacterId,
  role: RoleId,
): boolean {
  return !(combination.mainPlot === "signWithMe" &&
    role === "keyPerson" &&
    !characterDataOf(character).tags.includes("girl"));
}

function lossRoleCandidates(
  tragedySet: string,
  combination: RuleCombination,
  role: RoleId,
  publicCast: readonly CharacterId[],
  observations: readonly ProtagonistObservation[],
): CharacterId[] {
  const tragedySetRoles = rolesForTragedySet(tragedySet);
  const ranges = roleRanges(combination);
  const confirmed = confirmedRoleByCharacter(observations, combination);
  return publicCast.filter((character) => {
    const confirmedRole = confirmed.get(character);
    if (confirmedRole !== undefined && confirmedRole !== role) return false;
    return characterCanHoldRoleForCombination(combination, character, role) &&
      roleCouldBelongToCharacter(
        tragedySetRoles,
        ranges,
        role,
        character,
      ) &&
      observedRoleExclusionReason(observations, character, role) === undefined;
  });
}

function publicCharacterAtLoss(
  context: PublicLossObservationContext,
  character: CharacterId,
): NonNullable<PublicObservationContext["characters"]>[CharacterId] | undefined {
  return context.characters?.[character];
}

function plotLossCouldExplain(
  tragedySet: string,
  combination: RuleCombination,
  plot: PlotId,
  context: PublicLossObservationContext,
  publicCast: readonly CharacterId[],
  observations: readonly ProtagonistObservation[],
): boolean {
  switch (plot) {
    case "lightAvenger":
      return lossRoleCandidates(
        tragedySet,
        combination,
        "brain",
        publicCast,
        observations,
      ).some((character) => {
        const start = context.startingLocations[character];
        return start !== undefined && context.locationIntrigue[start] >= 2;
      });
    case "placeProtect":
      return context.locationIntrigue.School >= 2;
    case "sealedItem":
      return context.locationIntrigue.Shrine >= 2;
    case "signWithMe":
      return lossRoleCandidates(
        tragedySet,
        combination,
        "keyPerson",
        publicCast,
        observations,
      ).some((character) =>
        (publicCharacterAtLoss(context, character)?.intrigue ?? 0) >= 2
      );
    case "changeOfFuture":
      return context.firedIncidents.some(({ incident }) =>
        incident === "butterflyEffect"
      );
    case "giantTimeBomb":
      return lossRoleCandidates(
        tragedySet,
        combination,
        "witch",
        publicCast,
        observations,
      ).some((character) => {
        const start = context.startingLocations[character];
        return start !== undefined && context.locationIntrigue[start] >= 2;
      });
    default:
      return false;
  }
}

function nonDeathLossCouldExplain(
  tragedySet: string,
  combination: RuleCombination,
  timing: LoopEndReason,
  context: PublicLossObservationContext,
  publicCast: readonly CharacterId[],
  observations: readonly ProtagonistObservation[],
): boolean {
  if (timing !== "effect" &&
    [combination.mainPlot, ...combination.subPlots].some((plot) =>
    plotLossCouldExplain(
      tragedySet,
      combination,
      plot,
      context,
      publicCast,
      observations,
    )
  )) return true;

  const keyPersonDied = lossRoleCandidates(
    tragedySet,
    combination,
    "keyPerson",
    publicCast,
    observations,
  ).some((character) =>
    publicCharacterAtLoss(context, character)?.status === "dead"
  );
  if (keyPersonDied) return true;

  if (context.locationIntrigue.City >= 2) {
    const factorWithKeyPersonAbilityDied = lossRoleCandidates(
      tragedySet,
      combination,
      "factor",
      publicCast,
      observations,
    ).some((character) =>
      publicCharacterAtLoss(context, character)?.status === "dead"
    );
    if (factorWithKeyPersonAbilityDied) return true;
  }

  const friendDied = timing !== "effect" && lossRoleCandidates(
    tragedySet,
    combination,
    "friend",
    publicCast,
    observations,
  ).some((character) =>
    publicCharacterAtLoss(context, character)?.status === "dead"
  );
  if (friendDied) return true;

  return context.lastDay && lossRoleCandidates(
    tragedySet,
    combination,
    "timeTraveler",
    publicCast,
    observations,
  ).some((character) =>
    (publicCharacterAtLoss(context, character)?.goodwill ?? 3) <= 2
  );
}

function protagonistDeathCouldExplain(
  tragedySet: string,
  combination: RuleCombination,
  observation: Extract<ProtagonistObservation, { kind: "lossObserved" }>,
  context: PublicLossObservationContext,
  publicCast: readonly CharacterId[],
  observations: readonly ProtagonistObservation[],
): boolean {
  const hospitalIncident = context.phase === "P7_INCIDENT" &&
    context.locationIntrigue.Hospital >= 2 &&
    context.firedIncidents.some(({ day, incident }) =>
      day === observation.day && incident === "hospitalIncident"
    );
  if (hospitalIncident) return true;
  if (context.phase !== "P9_ROUND_END") return false;

  const killerCouldAct = lossRoleCandidates(
    tragedySet,
    combination,
    "killer",
    publicCast,
    observations,
  ).some((character) =>
    (publicCharacterAtLoss(context, character)?.intrigue ?? 0) >= 4
  );
  if (killerCouldAct) return true;

  return lossRoleCandidates(
    tragedySet,
    combination,
    "lovedOne",
    publicCast,
    observations,
  ).some((character) => {
    const state = publicCharacterAtLoss(context, character);
    return (state?.paranoia ?? 0) >= 3 && (state?.intrigue ?? 0) >= 1;
  });
}

function lossObservationContradiction(
  observation: Extract<ProtagonistObservation, { kind: "lossObserved" }>,
  tragedySet: string,
  combination: RuleCombination,
  publicCast: readonly CharacterId[],
  observations: readonly ProtagonistObservation[],
): RuleContradiction | undefined {
  const context = observation.context;
  if (context === undefined) return undefined;
  const explained = observation.timing === "protagonistDeath"
    ? protagonistDeathCouldExplain(
      tragedySet,
      combination,
      observation,
      context,
      publicCast,
      observations,
    )
    : nonDeathLossCouldExplain(
      tragedySet,
      combination,
      observation.timing,
      context,
      publicCast,
      observations,
    );
  return explained
    ? undefined
    : {
      code: "lossConditionUnavailable",
      observation,
      reason: observation.timing === "protagonistDeath"
        ? "공개 상태에서 알려진 주인공 사망을 설명할 패배 조건이 이 조합에 없습니다."
        : "공개 상태에서 알려진 루프 종료 패배를 설명할 패배 조건이 이 조합에 없습니다.",
    };
}

function contradictionsForCombination(
  tragedySet: string,
  combination: RuleCombination,
  observations: readonly ProtagonistObservation[],
  options: EvaluationOptions,
): RuleContradiction[] {
  const ranges = roleRanges(combination);
  const tragedySetRoles = rolesForTragedySet(tragedySet);
  const contradictions: RuleContradiction[] = [];

  for (const observation of observations) {
    let contradiction: RuleContradiction | undefined;
    switch (observation.kind) {
      case "roleRevealed":
        contradiction = roleObservationContradiction(
          observation,
          combination,
          tragedySetRoles,
          ranges,
        );
        break;
      case "deadAtLoopEndWithoutRoleReveal":
        // 역할표에서 친구 후보만 배제한다. 다른 캐릭터가 친구일 수 있다.
        break;
      case "goodwillRefused":
        contradiction = refusalObservationContradiction(
          observation,
          tragedySetRoles,
          ranges,
        );
        break;
      case "subplotRevealed":
        if (!combination.subPlots.includes(observation.revealedSubplot)) {
          contradiction = {
            code: "revealedSubplotMissing",
            observation,
            reason: `공개된 룰 X ${observation.revealedSubplot}가 ` +
              "이 조합에 없습니다.",
          };
        }
        break;
      case "mastermindAbilityResult":
        contradiction = abilityObservationContradiction(
          observation,
          combination,
          tragedySetRoles,
          ranges,
          options.publicCast ?? [],
          observations,
        );
        break;
      case "intrigueForbidIgnored":
        contradiction = intrigueForbidIgnoredContradiction(
          observation,
          tragedySetRoles,
          ranges,
          options.publicCast ?? [],
        );
        break;
      case "incidentOccurred":
      case "incidentCulpritRevealed":
        // 역할 배정 없이 사건만으로는 룰 조합을 확정하지 않는다.
        break;
      case "lossObserved":
        contradiction = lossObservationContradiction(
          observation,
          tragedySet,
          combination,
          options.publicCast ?? [],
          observations,
        );
        break;
      case "goodwillIncidentEffect":
      case "goodwillAccepted":
      case "goodwillForbidApplied":
      case "roundEvidence":
        // 역할 배정 없이 룰 조합만으로 확정할 수 없으므로 보수적으로 유지한다.
        break;
      case "mandatoryEffectMissing":
        if (
          observation.effect === "threadsFate" &&
          combination.subPlots.includes("threadsFate")
        ) {
          contradiction = {
            code: "mandatoryEffectMissing",
            observation,
            reason: "직전 루프 우호 보유자에게 루프 시작 불안 2가 붙지 않았습니다.",
          };
        }
        break;
    }
    if (contradiction !== undefined) contradictions.push(contradiction);
  }
  const crossObservation = crossObservationRoleContradiction(
    observations,
    combination,
    tragedySetRoles,
    ranges,
    options.publicCast ?? [],
  );
  if (crossObservation !== undefined) contradictions.push(crossObservation);
  return contradictions;
}

export function evaluateRuleHypotheses(
  tragedySet: string,
  observations: readonly ProtagonistObservation[],
  options: EvaluationOptions = {},
): RuleHypothesisEvaluation {
  const combinations = enumerateRuleCombinations(tragedySet).map(
    (combination): EvaluatedRuleCombination => {
      const contradictions = contradictionsForCombination(
        tragedySet,
        combination,
        observations,
        options,
      );
      return {
        combination,
        excluded: contradictions.length > 0,
        contradictions,
      };
    },
  );
  return {
    tragedySet,
    observations: [...observations],
    combinations,
    remaining: combinations
      .filter(({ excluded }) => !excluded)
      .map(({ combination }) => combination),
    excluded: combinations.filter(({ excluded }) => excluded),
  };
}

function confirmedRoleObservations(
  observations: readonly ProtagonistObservation[],
  tragedySetRoles: readonly RoleId[],
  combinations: readonly RuleCombination[],
): Map<
  CharacterId,
  Extract<ProtagonistObservation, { kind: "roleRevealed" }>
> {
  const confirmed = new Map<
    CharacterId,
    Extract<ProtagonistObservation, { kind: "roleRevealed" }>
  >();
  for (const observation of observations) {
    if (
      observation.kind === "roleRevealed" &&
      observation.confirmed !== false
    ) {
      const baseRoles = revealedBaseRoleCandidates(
        observation,
        tragedySetRoles,
        combinations,
      );
      const onlyRole = [...baseRoles][0];
      if (baseRoles.size === 1 && onlyRole === observation.role) {
        confirmed.set(observation.character, observation);
      }
    }
  }
  return confirmed;
}

function revealedBaseRoleCandidates(
  observation: Extract<ProtagonistObservation, { kind: "roleRevealed" }>,
  tragedySetRoles: readonly RoleId[],
  combinations: readonly RuleCombination[],
): Set<RoleId> {
  const candidates = new Set<RoleId>();
  for (const combination of combinations) {
    const ranges = roleRanges(combination);
    if (roleCouldBelongToCharacter(
      tragedySetRoles,
      ranges,
      observation.role,
      observation.character,
    )) {
      candidates.add(observation.role);
    }
    const paranoia = observation.context?.characters?.[observation.character]
      ?.paranoia;
    if (
      observation.role === "serialKiller" &&
      !characterDataOf(observation.character).plotLessRole &&
      combination.subPlots.includes("paranoiaVirus") &&
      (paranoia === undefined || paranoia >= 3)
    ) {
      candidates.add("person");
    }
  }
  return candidates;
}

function roleColumnAppears(
  role: RoleId,
  combinations: readonly RuleCombination[],
): boolean {
  return role === "person" || combinations.some((combination) =>
    (roleRanges(combination).get(role)?.max ?? 0) > 0
  );
}

function rolePossibleForCharacter(
  tragedySetRoles: readonly RoleId[],
  combinations: readonly RuleCombination[],
  role: RoleId,
  character: CharacterId,
): boolean {
  if (role === "person" && character === "ai") return false;
  return combinations.some((combination) =>
    roleCouldBelongToCharacter(
      tragedySetRoles,
      roleRanges(combination),
      role,
      character,
    )
  );
}

function maximumRoleCapacity(
  tragedySetRoles: readonly RoleId[],
  combinations: readonly RuleCombination[],
  role: RoleId,
  publicCast: readonly CharacterId[],
): number {
  return combinations.reduce(
    (maximum, combination) => Math.max(
      maximum,
      roleCapacity(
        role,
        tragedySetRoles,
        roleRanges(combination),
        publicCast,
      ),
    ),
    0,
  );
}

interface AbilityLocationRoleConstraint {
  role: "brain" | "conspiracyTheorist";
  candidates: Set<CharacterId>;
  observations: Extract<
    ProtagonistObservation,
    { kind: "mastermindAbilityResult" }
  >[];
}

function observationTargetLocation(
  observation: Extract<
    ProtagonistObservation,
    { kind: "mastermindAbilityResult" }
  >,
  target: Target,
): string | undefined {
  return target.kind === "location"
    ? target.at
    : observation.context?.characters?.[target.id]?.status === "alive"
    ? observation.context.characters[target.id]?.location
    : undefined;
}

function livingActorsAtObservedLocation(
  publicCast: readonly CharacterId[],
  observation: Extract<
    ProtagonistObservation,
    { kind: "mastermindAbilityResult" }
  >,
  location: string,
): Set<CharacterId> {
  return new Set(publicCast.filter((character) => {
    const state = observation.context?.characters?.[character];
    return state?.status === "alive" &&
      observedAbilityLocations(state).includes(location);
  }));
}

function brainLocationConstraint(
  combinations: readonly RuleCombination[],
  publicCast: readonly CharacterId[],
  observations: readonly ProtagonistObservation[],
): AbilityLocationRoleConstraint | undefined {
  if (
    combinations.length === 0 ||
    publicCast.includes("copycat") ||
    combinations.some(({ subPlots }) => subPlots.includes("unsettlingRumor"))
  ) {
    return undefined;
  }

  let candidates: Set<CharacterId> | undefined;
  const evidence: Extract<
    ProtagonistObservation,
    { kind: "mastermindAbilityResult" }
  >[] = [];
  for (const observation of observations) {
    if (
      observation.kind !== "mastermindAbilityResult" ||
      (
        observation.timing !== undefined &&
        observation.timing !== "P5_MASTERMIND_ABILITY"
      ) ||
      observation.context?.characters === undefined
    ) {
      continue;
    }
    const locations = observation.changes.flatMap((change) =>
      change.kind === "counter" &&
        change.counter === "intrigue" &&
        change.delta > 0 &&
        change.target.kind === "location"
        ? [change.target.at]
        : []
    );
    for (const location of locations) {
      const atLocation = new Set(
        publicCast.filter((character) => {
          const state = observation.context?.characters?.[character];
          return state?.status === "alive" &&
            observedAbilityLocations(state).includes(location);
        }),
      );
      candidates = candidates === undefined
        ? atLocation
        : new Set([...candidates].filter((character) =>
          atLocation.has(character)
        ));
      if (!evidence.includes(observation)) evidence.push(observation);
    }
  }
  return candidates === undefined
    ? undefined
    : { role: "brain", candidates, observations: evidence };
}

function conspiracyTheoristLocationConstraint(
  tragedySet: string,
  combinations: readonly RuleCombination[],
  publicCast: readonly CharacterId[],
  observations: readonly ProtagonistObservation[],
): AbilityLocationRoleConstraint | undefined {
  if (combinations.length === 0 || publicCast.includes("copycat")) {
    return undefined;
  }

  const tragedySetRoles = rolesForTragedySet(tragedySet);
  let candidates: Set<CharacterId> | undefined;
  const evidence: Extract<
    ProtagonistObservation,
    { kind: "mastermindAbilityResult" }
  >[] = [];
  for (const observation of observations) {
    if (
      observation.kind !== "mastermindAbilityResult" ||
      observation.timing !== "P5_MASTERMIND_ABILITY" ||
      observation.context?.characters === undefined
    ) continue;

    for (const change of observation.changes) {
      if (
        change.kind !== "counter" ||
        change.counter !== "paranoia" ||
        change.delta <= 0 ||
        change.target.kind !== "character"
      ) continue;
      const location = observationTargetLocation(observation, change.target);
      if (location === undefined) continue;

      const factorCanExplain =
        observation.context.locationIntrigue.School >= 2 &&
        combinations.some((combination) =>
          roleCouldAppear(
            tragedySetRoles,
            roleRanges(combination),
            "factor",
            publicCast,
          )
        );
      // 변수가 같은 공개 결과를 낼 수 있으면 선동가의 위치를 단정하지 않는다.
      if (factorCanExplain) continue;

      const atLocation = livingActorsAtObservedLocation(
        publicCast,
        observation,
        location,
      );
      candidates = candidates === undefined
        ? atLocation
        : new Set([...candidates].filter((character) =>
          atLocation.has(character)
        ));
      if (!evidence.includes(observation)) evidence.push(observation);
    }
  }
  return candidates === undefined
    ? undefined
    : { role: "conspiracyTheorist", candidates, observations: evidence };
}

interface LossInferredRole {
  character: CharacterId;
  role: RoleId;
  observation: Extract<ProtagonistObservation, { kind: "lossObserved" }>;
}

function lossRoleCauseCandidates(
  tragedySet: string,
  combinations: readonly RuleCombination[],
  publicCast: readonly CharacterId[],
  observations: readonly ProtagonistObservation[],
): LossInferredRole[] {
  const inferred: LossInferredRole[] = [];
  for (const observation of observations) {
    if (observation.kind !== "lossObserved" || observation.context === undefined) {
      continue;
    }
    const context = observation.context;
    const causes = new Map<string, { character: CharacterId; role: RoleId }>();
    let nonRoleCauseExists = false;

    for (const combination of combinations) {
      if (observation.timing === "protagonistDeath") {
        if (
          context.phase === "P7_INCIDENT" &&
          context.locationIntrigue.Hospital >= 2 &&
          context.firedIncidents.some(({ day, incident }) =>
            day === observation.day && incident === "hospitalIncident"
          )
        ) {
          nonRoleCauseExists = true;
          continue;
        }
        if (context.phase !== "P9_ROUND_END") continue;
        for (const role of ["killer", "lovedOne"] as const) {
          for (const character of lossRoleCandidates(
            tragedySet,
            combination,
            role,
            publicCast,
            observations,
          )) {
            const state = publicCharacterAtLoss(context, character);
            const met = role === "killer"
              ? (state?.intrigue ?? 0) >= 4
              : (state?.paranoia ?? 0) >= 3 && (state?.intrigue ?? 0) >= 1;
            if (met) causes.set(`${character}:${role}`, { character, role });
          }
        }
        continue;
      }

      if (observation.timing !== "effect" &&
        [combination.mainPlot, ...combination.subPlots].some((plot) =>
        plotLossCouldExplain(
          tragedySet,
          combination,
          plot,
          context,
          publicCast,
          observations,
        )
      )) {
        nonRoleCauseExists = true;
      }

      for (const role of ["keyPerson", "friend", "timeTraveler"] as const) {
        if (role === "friend" && observation.timing === "effect") continue;
        if (role === "timeTraveler" && !context.lastDay) continue;
        for (const character of lossRoleCandidates(
          tragedySet,
          combination,
          role,
          publicCast,
          observations,
        )) {
          const state = publicCharacterAtLoss(context, character);
          const met = role === "timeTraveler"
            ? (state?.goodwill ?? 3) <= 2
            : state?.status === "dead";
          if (met) causes.set(`${character}:${role}`, { character, role });
        }
      }
      if (context.locationIntrigue.City >= 2) {
        for (const character of lossRoleCandidates(
          tragedySet,
          combination,
          "factor",
          publicCast,
          observations,
        )) {
          if (publicCharacterAtLoss(context, character)?.status === "dead") {
            causes.set(`${character}:factor`, { character, role: "factor" });
          }
        }
      }
    }

    if (!nonRoleCauseExists && causes.size === 1) {
      const cause = [...causes.values()][0];
      if (cause !== undefined) inferred.push({ ...cause, observation });
    }
  }
  return inferred;
}

function observedRoleExclusionReason(
  observations: readonly ProtagonistObservation[],
  character: CharacterId,
  role: RoleId,
  tragedySetRoles?: readonly RoleId[],
  combinations?: readonly RuleCombination[],
): RolePossibilityReason | undefined {
  for (const observation of observations) {
    if (
      observation.kind === "roleRevealed" &&
      observation.confirmed !== false &&
      observation.character === character &&
      tragedySetRoles !== undefined &&
      combinations !== undefined &&
      !revealedBaseRoleCandidates(
        observation,
        tragedySetRoles,
        combinations,
      ).has(role)
    ) {
      return { code: "effectiveRoleRevealed", observation };
    }
    if (
      observation.kind === "deadAtLoopEndWithoutRoleReveal" &&
      observation.character === character &&
      role === "friend"
    ) {
      return { code: "loopEndRoleRevealMissing", observation };
    }
    if (
      observation.kind === "goodwillRefused" &&
      observation.character === character &&
      !roleCanRefuseGoodwill(role)
    ) {
      return { code: "goodwillRefusalRequired", observation };
    }
    if (
      observation.kind === "goodwillAccepted" &&
      observation.character === character &&
      ROLE_IMPL[role]?.goodwillRefusal === "Mandatory"
    ) {
      return { code: "mandatoryGoodwillRefusalMissing", observation };
    }
    if (
      observation.kind === "goodwillForbidApplied" &&
      observation.character === character &&
      role === "timeTraveler"
    ) {
      return { code: "goodwillForbidApplied", observation };
    }
    if (observation.kind === "roundEvidence") {
      const deathBatches = observation.record.deathBatches ?? [];
      const died = deathBatches.some(({ characters }) =>
        characters.includes(character)
      );
      if (died && role === "timeTraveler") {
        return { code: "diedDespiteImmortality", observation };
      }
      const roundCompleted = observation.record.roundEndPairs !== undefined ||
        observation.record.immediateLoopEnd !== undefined;
      if (
        died &&
        roundCompleted &&
        observation.record.immediateLoopEnd === undefined &&
        role === "keyPerson"
      ) {
        return { code: "deathWithoutImmediateLoss", observation };
      }
      const factorDiedWithAbility = deathBatches.some((batch) =>
        batch.characters.includes(character) &&
        (batch.cityIntrigue ?? -1) >= 2
      );
      if (
        factorDiedWithAbility &&
        roundCompleted &&
        observation.record.immediateLoopEnd === undefined &&
        role === "factor"
      ) {
        return { code: "deathWithoutImmediateLoss", observation };
      }
    }
  }
  return undefined;
}

interface CauseConstraintCellResult {
  allowed: boolean;
  observations: ProtagonistObservation[];
}

function causeConstraintForCell(
  tragedySet: string,
  publicCast: readonly CharacterId[],
  combinations: readonly RuleCombination[],
  observations: readonly ProtagonistObservation[],
  character: CharacterId,
  role: RoleId,
): CauseConstraintCellResult {
  const tragedySetRoles = rolesForTragedySet(tragedySet);
  const evidence = new Map<string, ProtagonistObservation>();
  for (const combination of combinations) {
    const ranges = roleRanges(combination);
    const confirmedRoles = confirmedRoleByCharacter(observations, combination);
    const alreadyConfirmed = confirmedRoles.get(character);
    if (alreadyConfirmed !== undefined && alreadyConfirmed !== role) continue;
    if (!roleAssignmentCompatible(
      tragedySetRoles,
      ranges,
      role,
      character,
      confirmedRoles,
    )) continue;

    const assumedRoles = new Map(confirmedRoles);
    assumedRoles.set(character, role);
    // 기존 P5 위치 교집합은 별도 제약이 담당한다. 여기서는 기록층이 새로
    // 보존하는 라운드 사실만 캐릭터×역할 칸으로 투영한다.
    const clauses = observations.flatMap((observation) =>
      observation.kind === "roundEvidence"
        ? roundEvidenceCauseClauses(
          observation,
          combination,
          tragedySetRoles,
          ranges,
          assumedRoles,
        )
        : []
    );
    for (const clause of clauses) {
      evidence.set(observationKey(clause.observation), clause.observation);
    }
    if (causeClausesAreSatisfiable(
      clauses,
      tragedySetRoles,
      ranges,
      publicCast,
      assumedRoles,
      observedRoleExclusions(
        observations,
        publicCast,
        tragedySetRoles,
        combination,
      ),
    )) {
      return { allowed: true, observations: [...evidence.values()] };
    }
  }
  return { allowed: false, observations: [...evidence.values()] };
}

/**
 * 살아있는 룰 조합을 합집합으로 투영한다. 각 칸은 독립적으로 계산하며
 * 캐릭터 전체의 역할 배정을 만들거나 세지 않는다.
 */
export function buildRolePossibilityTable(
  tragedySet: string,
  publicCast: readonly CharacterId[],
  combinations: readonly RuleCombination[],
  observations: readonly ProtagonistObservation[],
): RolePossibilityTable {
  const tragedySetRoles = rolesForTragedySet(tragedySet);
  const confirmed = confirmedRoleObservations(
    observations,
    tragedySetRoles,
    combinations,
  );
  const abilityConstraints = [
    brainLocationConstraint(combinations, publicCast, observations),
    conspiracyTheoristLocationConstraint(
      tragedySet,
      combinations,
      publicCast,
      observations,
    ),
  ].filter(
    (constraint): constraint is AbilityLocationRoleConstraint =>
      constraint !== undefined,
  );
  const abilityInferences = abilityConstraints.flatMap((constraint) =>
    constraint.candidates.size === 1
      ? [{
        character: [...constraint.candidates][0],
        role: constraint.role,
        reason: {
          code: "abilityLocationIntersection" as const,
          observations: constraint.observations,
        },
      }]
      : []
  );
  const lossInferences = lossRoleCauseCandidates(
    tragedySet,
    combinations,
    publicCast,
    observations,
  ).map(({ character, role, observation }) => ({
    character,
    role,
    reason: { code: "lossConditionOnlyCandidate" as const, observation },
  }));
  const rawInferences = [...abilityInferences, ...lossInferences];
  const inferredRoles = rawInferences.filter((inferred) =>
    !rawInferences.some((other) =>
      other.character === inferred.character && other.role !== inferred.role
    )
  );
  const confirmedRoles = new Set(
    [...confirmed.values()].map(({ role }) => role),
  );
  for (const inferred of inferredRoles) confirmedRoles.add(inferred.role);
  const roles = tragedySetRoles.filter((role) =>
    roleColumnAppears(role, combinations) || confirmedRoles.has(role)
  );
  for (const role of confirmedRoles) {
    if (!roles.includes(role)) roles.push(role);
  }

  const maximumByRole = new Map<RoleId, number>();
  for (const role of roles) {
    maximumByRole.set(
      role,
      maximumRoleCapacity(
        tragedySetRoles,
        combinations,
        role,
        publicCast,
      ),
    );
  }

  const cells: Record<
    CharacterId,
    Record<RoleId, RolePossibilityCell>
  > = {};
  for (const character of publicCast) {
    const row: Record<RoleId, RolePossibilityCell> = {};
    const revealed = confirmed.get(character);
    for (const role of roles) {
      if (revealed !== undefined) {
        row[role] = revealed.role === role
          ? {
            character,
            role,
            status: "confirmed",
            reasons: [{ code: "roleRevealed", observation: revealed }],
          }
          : {
            character,
            role,
            status: "impossible",
            reasons: [{ code: "otherRoleConfirmed", observation: revealed }],
          };
        continue;
      }

      const inferred = inferredRoles.find((candidate) =>
        candidate.character === character
      );
      if (inferred !== undefined) {
        row[role] = role === inferred.role
          ? { character, role, status: "confirmed", reasons: [inferred.reason] }
          : { character, role, status: "impossible", reasons: [inferred.reason] };
        continue;
      }

      const observationReason = observedRoleExclusionReason(
        observations,
        character,
        role,
        tragedySetRoles,
        combinations,
      );
      if (observationReason !== undefined) {
        row[role] = {
          character,
          role,
          status: "impossible",
          reasons: [observationReason],
        };
        continue;
      }

      const excludingAbilityConstraint = abilityConstraints.find(
        (constraint) =>
          role === constraint.role && !constraint.candidates.has(character),
      );
      if (excludingAbilityConstraint !== undefined) {
        row[role] = {
          character,
          role,
          status: "impossible",
          reasons: [{
            code: "abilityLocationIntersection",
            observations: excludingAbilityConstraint.observations,
          }],
        };
        continue;
      }

      const possible = rolePossibleForCharacter(
        tragedySetRoles,
        combinations,
        role,
        character,
      );
      if (!possible) {
        const reason: RolePossibilityReason = character === "ai" &&
            role === "person"
          ? {
            code: "characterConstraint",
            reason: "AI는 엑스트라 역할을 가질 수 없습니다.",
          }
          : characterDataOf(character).plotLessRole
          ? { code: "outsiderConstraint" }
          : { code: "ruleUnavailable" };
        row[role] = {
          character,
          role,
          status: "impossible",
          reasons: [reason],
        };
        continue;
      }

      const causeConstraint = causeConstraintForCell(
        tragedySet,
        publicCast,
        combinations,
        observations,
        character,
        role,
      );
      if (!causeConstraint.allowed) {
        row[role] = {
          character,
          role,
          status: "impossible",
          reasons: [{
            code: "causeConstraint",
            observations: causeConstraint.observations,
          }],
        };
        continue;
      }

      row[role] = { character, role, status: "possible", reasons: [] };
    }
    cells[character] = row;
  }

  const minimumByRole = new Map<RoleId, number>();
  for (const role of roles) {
    minimumByRole.set(
      role,
      combinations.length === 0
        ? 0
        : Math.min(...combinations.map((combination) =>
          roleRanges(combination).get(role)?.min ?? 0
        )),
    );
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const character of publicCast) {
      const row = cells[character];
      const confirmedRole = roles.find((role) =>
        row?.[role]?.status === "confirmed"
      );
      if (confirmedRole !== undefined) {
        for (const role of roles) {
          const cell = row?.[role];
          if (role === confirmedRole || cell?.status !== "possible") continue;
          cell.status = "impossible";
          cell.reasons.push({ code: "otherRoleInferred", role: confirmedRole });
          changed = true;
        }
        continue;
      }

      const candidates = roles.filter((role) =>
        row?.[role]?.status === "possible"
      );
      if (candidates.length === 1) {
        const onlyRole = candidates[0];
        const cell = onlyRole === undefined ? undefined : row?.[onlyRole];
        if (cell !== undefined) {
          cell.status = "confirmed";
          cell.reasons.push({ code: "onlyRemainingRole" });
          changed = true;
        }
      }
    }

    for (const role of roles) {
      const confirmedCharacters = publicCast.filter((character) =>
        cells[character]?.[role]?.status === "confirmed"
      );
      const maximum = maximumByRole.get(role) ?? 0;
      if (maximum > 0 && confirmedCharacters.length >= maximum) {
        for (const character of publicCast) {
          const cell = cells[character]?.[role];
          if (cell?.status !== "possible") continue;
          cell.status = "impossible";
          cell.reasons.push({
            code: "roleMaximumReached",
            maximum,
            confirmedCharacters: [...confirmedCharacters],
          });
          changed = true;
        }
      }

      const minimum = minimumByRole.get(role) ?? 0;
      const requiredCandidates = minimum - confirmedCharacters.length;
      if (requiredCandidates <= 0) continue;
      const candidates = publicCast.filter((character) =>
        cells[character]?.[role]?.status === "possible"
      );
      if (candidates.length === requiredCandidates) {
        for (const character of candidates) {
          const cell = cells[character]?.[role];
          if (cell === undefined) continue;
          cell.status = "confirmed";
          cell.reasons.push({ code: "requiredRoleForcedCandidate", minimum });
          changed = true;
        }
      }
    }
  }

  return { characters: [...publicCast], roles, cells };
}

function tableContradictionsForCombination(
  tragedySet: string,
  combination: RuleCombination,
  publicCast: readonly CharacterId[],
  table: RolePossibilityTable,
): RoleTableRuleContradiction[] {
  const tragedySetRoles = rolesForTragedySet(tragedySet);
  const ranges = roleRanges(combination);
  const confirmedCounts = new Map<RoleId, number>();
  for (const character of table.characters) {
    for (const role of table.roles) {
      if (table.cells[character]?.[role]?.status === "confirmed") {
        confirmedCounts.set(role, (confirmedCounts.get(role) ?? 0) + 1);
      }
    }
  }

  const contradictions: RoleTableRuleContradiction[] = [];
  for (const [role, confirmedCount] of confirmedCounts) {
    const maximum = roleCapacity(
      role,
      tragedySetRoles,
      ranges,
      publicCast,
    );
    if (confirmedCount > maximum) {
      contradictions.push({
        code: "confirmedRoleCountExceedsMaximum",
        role,
        confirmedCount,
        maximum,
        reason: `${role} 확정 ${confirmedCount}명이 이 조합의 상한 ` +
          `${maximum}명을 넘습니다.`,
      });
    }
  }

  for (const [role, range] of ranges) {
    if (range.min === 0) continue;
    const available = table.characters.filter((character) => {
      const cell = table.cells[character]?.[role];
      return cell !== undefined && cell.status !== "impossible";
    }).length;
    if (available < range.min) {
      contradictions.push({
        code: "requiredRoleUnavailable",
        role,
        reason: `${role} 역할이 ${range.min}명 필요한 조합이지만 ` +
          `가능한 캐릭터는 ${available}명입니다.`,
      });
    }
  }
  return contradictions;
}

/** 룰과 역할 표의 양방향 전파를 더 이상 변화가 없을 때까지 반복한다. */
export function evaluateRoleTableHypotheses(
  tragedySet: string,
  publicCast: readonly CharacterId[],
  observations: readonly ProtagonistObservation[],
): RoleTableHypothesisEvaluation {
  const ruleEvaluation = evaluateRuleHypotheses(
    tragedySet,
    observations,
    { publicCast },
  );
  let remaining = [...ruleEvaluation.remaining];
  const tableContradictions = new Map<
    string,
    RoleTableRuleContradiction[]
  >();
  let table = buildRolePossibilityTable(
    tragedySet,
    publicCast,
    remaining,
    observations,
  );
  let propagationPasses = 0;

  while (true) {
    propagationPasses += 1;
    table = buildRolePossibilityTable(
      tragedySet,
      publicCast,
      remaining,
      observations,
    );
    const newlyExcluded = new Set<string>();
    for (const combination of remaining) {
      const contradictions = tableContradictionsForCombination(
        tragedySet,
        combination,
        publicCast,
        table,
      );
      if (contradictions.length === 0) continue;
      tableContradictions.set(combination.id, contradictions);
      newlyExcluded.add(combination.id);
    }
    if (newlyExcluded.size === 0) break;
    remaining = remaining.filter(({ id }) => !newlyExcluded.has(id));
  }

  const combinations = ruleEvaluation.combinations.map(
    ({ combination, contradictions }) => {
      const fromTable = tableContradictions.get(combination.id) ?? [];
      return {
        combination,
        excluded: contradictions.length > 0 || fromTable.length > 0,
        contradictions,
        tableContradictions: fromTable,
      };
    },
  );
  return {
    tragedySet,
    observations: [...observations],
    table,
    combinations,
    remaining,
    excluded: combinations.filter(({ excluded }) => excluded),
    propagationPasses,
  };
}

function observationKey(observation: ProtagonistObservation): string {
  return JSON.stringify(observation);
}

function publicLossObservationContext(
  state: GameState,
  loop: LoopState,
): PublicLossObservationContext {
  const startingLocations: Partial<Record<CharacterId, Location>> = {};
  for (const character of Object.keys(state.scenario.cast)) {
    startingLocations[character] =
      loop.loopStartTraitLocationChoices?.[character] ??
      startLocationOf(character, state.scenario);
  }

  const firedIncidents = (loop.phaseLog ?? []).flatMap((entry) =>
    entry.kind === "incidentJudged" && entry.fired
      ? [{ day: entry.day, incident: entry.incident }]
      : []
  );
  for (const occurrence of loop.incidentOccurrencesFiredThisLoop ?? []) {
    if (!firedIncidents.some(({ day, incident }) =>
      day === occurrence.day && incident === occurrence.incident
    )) {
      firedIncidents.push({
        day: occurrence.day,
        incident: occurrence.incident,
      });
    }
  }
  return {
    ...snapshotPublicContext(loop),
    phase: loop.phase,
    lastDay: loop.day === state.scenario.daysPerLoop,
    startingLocations,
    firedIncidents,
  };
}

/** 실제 종료 기록을 만들지 않고 현재 공개 상태의 가상 패배 관측을 만든다. */
export function hypotheticalLossObservation(
  state: GameState,
  timing: LoopEndReason,
): Extract<ProtagonistObservation, { kind: "lossObserved" }> {
  return {
    kind: "lossObserved",
    loop: state.loop.loop,
    day: state.loop.day,
    timing,
    context: publicLossObservationContext(state, state.loop),
  };
}

/**
 * 현재까지 남은 후보 전체에서 가상 패배를 설명할 수 있는 패배 조건 종류를
 * 합집합으로 반환한다. 실제 시나리오에 조건이 여러 개라는 뜻은 아니다.
 */
export function explainableLossConditions(
  state: GameState,
  observation: Extract<ProtagonistObservation, { kind: "lossObserved" }>,
  combinations: readonly RuleCombination[],
  observations: readonly ProtagonistObservation[],
): ExplainableLossCondition[] {
  const context = observation.context;
  if (context === undefined) return [];
  const tragedySet = state.scenario.tragedySet;
  const publicCast = Object.keys(state.scenario.cast);
  const conditions = new Map<string, ExplainableLossCondition>();
  const add = (condition: ExplainableLossCondition): void => {
    conditions.set(condition.key, condition);
  };

  for (const combination of combinations) {
    if (observation.timing === "protagonistDeath") {
      if (
        context.phase === "P7_INCIDENT" &&
        context.locationIntrigue.Hospital >= 2 &&
        context.firedIncidents.some(({ day, incident }) =>
          day === observation.day && incident === "hospitalIncident"
        )
      ) {
        add({
          key: "incident:hospitalIncident",
          kind: "incident",
          incident: "hospitalIncident",
        });
      }
      if (context.phase !== "P9_ROUND_END") continue;
      for (const role of ["killer", "lovedOne"] as const) {
        const met = lossRoleCandidates(
          tragedySet,
          combination,
          role,
          publicCast,
          observations,
        ).some((character) => {
          const characterState = publicCharacterAtLoss(context, character);
          return role === "killer"
            ? (characterState?.intrigue ?? 0) >= 4
            : (characterState?.paranoia ?? 0) >= 3 &&
              (characterState?.intrigue ?? 0) >= 1;
        });
        if (met) add({ key: `role:${role}`, kind: "role", role });
      }
      continue;
    }

    if (observation.timing !== "effect") {
      for (const plot of [combination.mainPlot, ...combination.subPlots]) {
        if (plotLossCouldExplain(
          tragedySet,
          combination,
          plot,
          context,
          publicCast,
          observations,
        )) {
          add({ key: `plot:${plot}`, kind: "plot", plot });
        }
      }
    }

    const roleConditions: ReadonlyArray<{
      role: "keyPerson" | "friend" | "timeTraveler" | "factor";
      met: (character: CharacterId) => boolean;
    }> = [
      {
        role: "keyPerson",
        met: (character) =>
          publicCharacterAtLoss(context, character)?.status === "dead",
      },
      {
        role: "friend",
        met: (character) =>
          publicCharacterAtLoss(context, character)?.status === "dead",
      },
      {
        role: "timeTraveler",
        met: (character) => context.lastDay &&
          (publicCharacterAtLoss(context, character)?.goodwill ?? 3) <= 2,
      },
      {
        role: "factor",
        met: (character) => context.locationIntrigue.City >= 2 &&
          publicCharacterAtLoss(context, character)?.status === "dead",
      },
    ];
    for (const { role, met } of roleConditions) {
      if (role === "friend" && observation.timing === "effect") continue;
      if (lossRoleCandidates(
        tragedySet,
        combination,
        role,
        publicCast,
        observations,
      ).some(met)) {
        add({ key: `role:${role}`, kind: "role", role });
      }
    }
  }
  return [...conditions.values()];
}

/** 산재한 공개 이력을 중복 없는 단일 관측 목록으로 정규화한다. */
export function collectProtagonistObservations(
  state: GameState,
): ProtagonistObservation[] {
  const observations: ProtagonistObservation[] = [];
  const seenLoops = new Set<number>();
  const loops = [...state.history, state.loop].filter((loop) => {
    if (seenLoops.has(loop.loop)) return false;
    seenLoops.add(loop.loop);
    return true;
  });

  for (const loop of loops) {
    const exactRoleReveals = new Set<CharacterId>();
    for (const information of loop.publicInformationThisLoop ?? []) {
      switch (information.kind) {
        case "roleReveal":
          exactRoleReveals.add(information.character);
          observations.push({
            kind: "roleRevealed",
            loop: information.loop,
            character: information.character,
            role: information.role,
            confirmed: true,
            ...(information.context === undefined
              ? {}
              : { context: information.context }),
            ...(information.observedAt === undefined
              ? {}
              : { observedAt: information.observedAt }),
          });
          break;
        case "goodwillRefusal":
          observations.push({
            kind: "goodwillRefused",
            loop: information.loop,
            day: information.day,
            character: information.character,
            rank: information.rank,
            abilityIndex: information.abilityIndex,
            ...(information.observedAt === undefined
              ? {}
              : { observedAt: information.observedAt }),
          });
          break;
        case "incidentCulprit":
          observations.push({
            kind: "incidentCulpritRevealed",
            loop: loop.loop,
            day: information.day,
            incident: information.incident,
            culprit: information.culprit,
            ...(information.observedAt === undefined
              ? {}
              : { observedAt: information.observedAt }),
          });
          break;
        case "subplot":
          observations.push({
            kind: "subplotRevealed",
            loop: loop.loop,
            declaredSubplot: information.declaredSubplot,
            revealedSubplot: information.revealedSubplot,
            ...(information.observedAt === undefined
              ? {}
              : { observedAt: information.observedAt }),
          });
          break;
        case "incidentEffect":
          observations.push({
            kind: "goodwillIncidentEffect",
            loop: loop.loop,
            day: information.resolvedOnDay ?? information.day,
            incident: information.incident,
            effectApplied: information.effectApplied,
            ...(information.observedAt === undefined
              ? {}
              : { observedAt: information.observedAt }),
          });
          break;
      }
    }
    for (const character of loop.revealedRoleCharacters ?? []) {
      if (exactRoleReveals.has(character)) continue;
      // 구 저장에는 공개 순간 역할이 없으므로 해당 루프 스냅샷으로만 복원한다.
      observations.push({
        kind: "roleRevealed",
        loop: loop.loop,
        character,
        role: effectiveRole({ ...state, loop }, character),
        confirmed: false,
      });
    }
    for (const entry of loop.phaseLog ?? []) {
      if (entry.kind === "goodwillUsed" && entry.response === "resolve") {
        const ability = characterDataOf(entry.character)
          .goodwillAbilities[entry.abilityIndex];
        // 거부 불가 능력은 절대 우호 무시 역할도 해결할 수 있으므로 근거가 아니다.
        if (ability !== undefined && !ability.immuneToGoodwillRefusel) {
          observations.push({
            kind: "goodwillAccepted",
            loop: entry.loop,
            day: entry.day,
            character: entry.character,
            rank: entry.rank,
            abilityIndex: entry.abilityIndex,
            ...(entry.observedAt === undefined
              ? {}
              : { observedAt: entry.observedAt }),
          });
        }
      } else if (entry.kind === "incidentJudged") {
        observations.push({
          kind: "incidentOccurred",
          loop: entry.loop,
          day: entry.day,
          incident: entry.incident,
          occurred: entry.fired,
          ...(entry.publicContext === undefined
            ? {}
            : { context: entry.publicContext }),
          ...(entry.deaths === undefined ? {} : { deaths: [...entry.deaths] }),
          ...(entry.observedAt === undefined
            ? {}
            : { observedAt: entry.observedAt }),
        });
      } else if (
        entry.kind === "actionResolved" &&
        entry.placements !== undefined &&
        entry.publicChanges !== undefined
      ) {
        const protagonistForbids = entry.placements.filter((placement) =>
          placement.owner !== "mastermind" &&
          placement.card === "forbidIntrigue"
        );
        if (protagonistForbids.length === 1) {
          const forbid = protagonistForbids[0];
          if (forbid !== undefined) {
            const mastermindIncrease = entry.placements.some((placement) =>
              placement.owner === "mastermind" &&
              (placement.card === "intriguePlus1" ||
                placement.card === "intriguePlus2") &&
              sameTarget(placement.target, forbid.target)
            );
            const increaseObserved = entry.publicChanges.some((change) =>
              change.kind === "counter" &&
              change.counter === "intrigue" &&
              change.delta > 0 &&
              sameTarget(change.target, forbid.target)
            );
            if (mastermindIncrease && increaseObserved) {
              observations.push({
                kind: "intrigueForbidIgnored",
                loop: entry.loop,
                day: entry.day,
                target: forbid.target,
                ...(entry.publicContext === undefined
                  ? {}
                  : { context: entry.publicContext }),
                ...(entry.observedAt === undefined
                  ? {}
                  : { observedAt: entry.observedAt }),
              });
            }
          }
        }
        const goodwillForbids = entry.placements.filter((placement) =>
          placement.card === "forbidGoodwill" &&
          placement.target.kind === "character"
        );
        for (const forbid of goodwillForbids) {
          if (forbid.target.kind !== "character") continue;
          const character = forbid.target.id;
          const goodwillPlaced = entry.placements.some((placement) =>
            (placement.card === "goodwillPlus1" ||
              placement.card === "goodwillPlus2") &&
            sameTarget(placement.target, forbid.target)
          );
          const goodwillIncreased = entry.publicChanges.some((change) =>
            change.kind === "counter" &&
            change.target.kind === "character" &&
            change.target.id === character &&
            change.counter === "goodwill" &&
            change.delta > 0
          );
          if (goodwillPlaced && !goodwillIncreased) {
            observations.push({
              kind: "goodwillForbidApplied",
              loop: entry.loop,
              day: entry.day,
              character,
              ...(entry.observedAt === undefined
                ? {}
                : { observedAt: entry.observedAt }),
            });
          }
        }
      } else if (
        entry.kind === "abilityActivated" &&
        entry.publicChanges !== undefined &&
        entry.publicChanges.length > 0
      ) {
        observations.push({
          kind: "mastermindAbilityResult",
          loop: entry.loop,
          day: entry.day,
          changes: entry.publicChanges,
          ...(entry.timing === undefined ? {} : { timing: entry.timing }),
          ...(entry.publicTrigger === undefined
            ? {}
            : { trigger: entry.publicTrigger }),
          ...(entry.publicContext === undefined
            ? {}
            : { context: entry.publicContext }),
          ...(entry.observedAt === undefined
            ? {}
            : { observedAt: entry.observedAt }),
        });
      }
    }

    for (const record of loop.roundEvidence ?? []) {
      const protectedAtRoundEnd = (loop.phaseLog ?? []).flatMap((entry) =>
        entry.loop === loop.loop &&
          entry.day === record.day &&
          entry.kind === "abilityActivated" &&
          entry.timing === "P9_ROUND_END"
          ? (entry.publicChanges ?? []).flatMap((change) =>
            change.kind === "counter" &&
              change.target.kind === "character" &&
              change.counter === "protection" &&
              change.delta < 0
              ? [change.target.id]
              : []
          )
          : []
      );
      const deathReactions = (loop.phaseLog ?? []).flatMap((entry) => {
        if (
          entry.loop !== loop.loop ||
          entry.day !== record.day ||
          entry.kind !== "abilityActivated" ||
          entry.timing !== "ON_DEATH" ||
          entry.publicTrigger?.kind !== "death"
        ) return [];
        const deadCharacters = [...entry.publicTrigger.deadCharacters];
        return (entry.publicChanges ?? []).flatMap((change) =>
          change.kind === "counter" &&
            change.target.kind === "character" &&
            change.counter === "paranoia" &&
            change.delta === 6
            ? [{ deadCharacters, target: change.target.id }]
            : []
        );
      });
      observations.push({
        kind: "roundEvidence",
        loop: loop.loop,
        record: structuredClone(record),
        context: snapshotPublicContext(loop),
        lastDay: record.day === state.scenario.daysPerLoop,
        protectedAtRoundEnd: [...new Set(protectedAtRoundEnd)],
        deathReactions,
      });
    }
  }

  for (const loop of loops) {
    if (
      loop.loop <= 1 ||
      (loop.loop === state.loop.loop && state.gamePhase === "LOOP_TIME_GAP")
    ) continue;
    const previous = loops.find((candidate) => candidate.loop === loop.loop - 1);
    if (previous === undefined) continue;
    const increased = new Set((loop.phaseLog ?? []).flatMap((entry) =>
      entry.kind === "abilityActivated" && entry.timing === "LOOP_START"
        ? (entry.publicChanges ?? []).flatMap((change) =>
          change.kind === "counter" &&
            change.target.kind === "character" &&
            change.counter === "paranoia" &&
            change.delta === 2
            ? [change.target.id]
            : []
        )
        : []
    ));
    for (const [character, previousPosition] of Object.entries(previous.board)) {
      const previousCounters = previous.charCounters[character];
      const currentPosition = loop.board[character];
      if (
        previousCounters === undefined ||
        currentPosition === undefined ||
        previousPosition.status !== "alive" ||
        previousCounters.goodwill < 1 ||
        currentPosition.status === "absent" ||
        increased.has(character)
      ) continue;
      observations.push({
        kind: "mandatoryEffectMissing",
        loop: loop.loop,
        day: 1,
        effect: "threadsFate",
        character,
      });
    }
  }

  for (const outcome of state.loopOutcomes) {
    if (outcome.result !== "protagonistsLost") continue;
    const completedLoop = state.history.find(({ loop }) =>
      loop === outcome.loop
    );
    observations.push({
      kind: "lossObserved",
      loop: outcome.loop,
      day: outcome.day,
      timing: outcome.reason,
      ...(completedLoop === undefined
        ? {}
        : { context: publicLossObservationContext(state, completedLoop) }),
      ...(outcome.observedAt === undefined
        ? {}
        : { observedAt: outcome.observedAt }),
    });
  }

  const completedLoops = new Set(state.loopOutcomes.map(({ loop }) => loop));
  for (const loop of state.history) {
    if (!completedLoops.has(loop.loop)) continue;
    const completedOutcome = state.loopOutcomes.find((outcome) =>
      outcome.loop === loop.loop
    );
    const revealed = new Set(loop.revealedRoleCharacters ?? []);
    for (const information of loop.publicInformationThisLoop ?? []) {
      if (information.kind === "roleReveal") {
        revealed.add(information.character);
      }
    }
    for (const [character, position] of Object.entries(loop.board)) {
      if (isCharacterDead(position) && !revealed.has(character)) {
        observations.push({
          kind: "deadAtLoopEndWithoutRoleReveal",
          loop: loop.loop,
          character,
          ...(completedOutcome?.observedAt === undefined
            ? {}
            : { observedAt: completedOutcome.observedAt }),
        });
      }
    }
  }

  // 구 저장 관측이 하나라도 섞이면 서로의 총순서를 복원할 수 없다. 새 메타데이터가
  // 완전한 경우에만 정렬하고, 혼합 저장은 기존 수집 순서를 유지한다.
  const ordered = observations.every(({ observedAt }) =>
      observedAt !== undefined
    )
    ? [...observations].sort((left, right) => {
      const leftAt = left.observedAt;
      const rightAt = right.observedAt;
      if (leftAt === undefined || rightAt === undefined) return 0;
      return leftAt.loop - rightAt.loop ||
        leftAt.sequence - rightAt.sequence;
    })
    : observations;
  const seen = new Set<string>();
  return ordered.filter((observation) => {
    const key = observationKey(observation);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function evaluateStateRuleHypotheses(
  state: GameState,
): RuleHypothesisEvaluation {
  return evaluateRuleHypotheses(
    state.scenario.tragedySet,
    collectProtagonistObservations(state),
    { publicCast: Object.keys(state.scenario.cast) },
  );
}

export function evaluateStateRoleTableHypotheses(
  state: GameState,
): RoleTableHypothesisEvaluation {
  return evaluateRoleTableHypotheses(
    state.scenario.tragedySet,
    Object.keys(state.scenario.cast),
    collectProtagonistObservations(state),
  );
}
