import { characterDataOf } from "../data";
import { PLOT_IMPL } from "../impl/plots";
import { ROLE_IMPL } from "../impl/roles";
import {
  effectiveRole,
  type CharacterId,
  type GameState,
  type HookPoint,
  type IncidentId,
  type LoopEndReason,
  type PlotId,
  type PublicAbilityTrigger,
  type PublicBoardChange,
  type PublicObservationContext,
  type RoleId,
  type Target,
} from "../types";
import {
  rolesForTragedySet,
  tragedySetDefinition,
} from "../tragedy-sets";

export {
  publicBoardChanges,
  publicObservationContext,
} from "./public-observation";

export interface RuleCombination {
  id: string;
  mainPlot: PlotId;
  subPlots: PlotId[];
}

/** 주인공이 실제 플레이에서 알게 된 사실만을 담는다. */
export type ProtagonistObservation =
  | {
    kind: "roleRevealed";
    loop: number;
    character: CharacterId;
    role: RoleId;
    /** false면 공개 순간 역할이 없는 구 저장을 루프 스냅샷으로 복원한 값이다. */
    confirmed?: boolean;
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
    kind: "incidentOccurred";
    loop: number;
    day: number;
    incident: IncidentId;
    occurred: boolean;
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
  };

export type RuleContradictionCode =
  | "revealedRoleUnavailable"
  | "outsiderRoleAssociated"
  | "goodwillRefusalUnavailable"
  | "revealedSubplotMissing"
  | "mastermindAbilityUnavailable"
  | "deathReactionUnavailable"
  | "loopStartEffectUnavailable"
  | "crossObservationRoleUnavailable"
  | "loopStartGoodwillUnavailable"
  | "intrigueForbidIgnoreUnavailable";

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
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
): RuleContradiction | undefined {
  // 공개 순간 역할이 없는 구 저장의 복원값은 확정 증거로 쓰지 않는다.
  if (observation.confirmed === false) return undefined;
  const plotLessRole = characterDataOf(observation.character).plotLessRole;
  const compatible = plotLessRole
    ? inactiveSetRoleIsPossible(tragedySetRoles, ranges, observation.role)
    : activeRoleIsPossible(ranges, observation.role);
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

interface ObservationCauseAlternative {
  requirements: RoleCauseRequirement[];
  /** 같은 루프에서 한 번뿐인 룰 능력의 소비 단위. */
  oncePerLoopUse?: string;
}

interface ObservationCauseClause {
  observation: Extract<
    ProtagonistObservation,
    { kind: "mastermindAbilityResult" }
  >;
  alternatives: ObservationCauseAlternative[];
}

function confirmedRoleByCharacter(
  observations: readonly ProtagonistObservation[],
): Map<CharacterId, RoleId> {
  const roles = new Map<CharacterId, RoleId>();
  for (const observation of observations) {
    if (
      observation.kind === "roleRevealed" &&
      observation.confirmed !== false
    ) {
      roles.set(observation.character, observation.role);
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
  if (activeCount > 0) return activeCount;
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

function causeClausesForObservation(
  observation: ProtagonistObservation,
  combination: RuleCombination,
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  confirmedRoles: ReadonlyMap<CharacterId, RoleId>,
): ObservationCauseClause[] {
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
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  publicCast: readonly CharacterId[],
  confirmedRoles: ReadonlyMap<CharacterId, RoleId>,
): Set<CharacterId>[] {
  const capacity = roleCapacity(role, tragedySetRoles, ranges, publicCast);
  const confirmedHolders = [...confirmedRoles.entries()].flatMap(
    ([character, confirmedRole]) => confirmedRole === role ? [character] : [],
  );
  if (confirmedHolders.length > capacity) return [];

  const mandatory = new Set(confirmedHolders);
  const universe = [...new Set([
    ...confirmedHolders,
    ...requirements.flatMap(({ candidates }) => candidates),
  ])];
  const optional = universe.filter((character) => !mandatory.has(character));
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
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
  publicCast: readonly CharacterId[],
  confirmedRoles: ReadonlyMap<CharacterId, RoleId>,
): boolean {
  const byRole = new Map<RoleId, RoleCauseRequirement[]>();
  for (const requirement of requirements) {
    const roleRequirements = byRole.get(requirement.role) ?? [];
    roleRequirements.push(requirement);
    byRole.set(requirement.role, roleRequirements);
  }

  const roleOptions = [...byRole.entries()].map(([role, roleRequirements]) => ({
    role,
    options: holderOptionsForRole(
      role,
      roleRequirements,
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
): boolean {
  const ordered = [...clauses].sort(
    (left, right) => left.alternatives.length - right.alternatives.length,
  );
  const search = (
    index: number,
    requirements: readonly RoleCauseRequirement[],
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
      const nextUses = alternative.oncePerLoopUse === undefined
        ? uses
        : new Set([...uses, alternative.oncePerLoopUse]);
      return roleRequirementsCanCoexist(
          nextRequirements,
          tragedySetRoles,
          ranges,
          publicCast,
          confirmedRoles,
        ) && search(index + 1, nextRequirements, nextUses);
    });
  };
  return search(0, [], new Set());
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
    const confirmedRoles = confirmedRoleByCharacter(prefix);
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
          tragedySetRoles,
          ranges,
        );
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
      case "lossObserved":
      case "goodwillIncidentEffect":
        // 역할 배정 없이 룰 조합만으로 확정할 수 없으므로 보수적으로 유지한다.
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

function observationKey(observation: ProtagonistObservation): string {
  return JSON.stringify(observation);
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
          });
          break;
        case "incidentCulprit":
          observations.push({
            kind: "incidentCulpritRevealed",
            loop: loop.loop,
            day: information.day,
            incident: information.incident,
            culprit: information.culprit,
          });
          break;
        case "subplot":
          observations.push({
            kind: "subplotRevealed",
            loop: loop.loop,
            declaredSubplot: information.declaredSubplot,
            revealedSubplot: information.revealedSubplot,
          });
          break;
        case "incidentEffect":
          observations.push({
            kind: "goodwillIncidentEffect",
            loop: loop.loop,
            day: information.day,
            incident: information.incident,
            effectApplied: information.effectApplied,
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
      if (entry.kind === "incidentJudged") {
        observations.push({
          kind: "incidentOccurred",
          loop: entry.loop,
          day: entry.day,
          incident: entry.incident,
          occurred: entry.fired,
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
              });
            }
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
        });
      }
    }
  }

  for (const outcome of state.loopOutcomes) {
    if (outcome.result !== "protagonistsLost") continue;
    observations.push({
      kind: "lossObserved",
      loop: outcome.loop,
      day: outcome.day,
      timing: outcome.reason,
    });
  }

  const seen = new Set<string>();
  return observations.filter((observation) => {
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
