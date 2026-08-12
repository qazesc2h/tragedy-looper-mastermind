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
  | "roundEndDeathUnavailable"
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
      ranges.set(role, {
        min: existing.min + min,
        max: existing.max + max,
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

function roundEndDeathContradiction(
  observation: Extract<
    ProtagonistObservation,
    { kind: "mastermindAbilityResult" }
  >,
  combination: RuleCombination,
  tragedySetRoles: readonly RoleId[],
  ranges: ReadonlyMap<RoleId, RoleRange>,
): RuleContradiction | undefined {
  if (
    observation.timing !== "P9_ROUND_END" ||
    observation.context?.characters === undefined
  ) return undefined;

  const deaths = observation.changes.flatMap((change) =>
    change.kind === "status" &&
      change.from === "alive" &&
      change.to === "dead"
      ? [change.character]
      : []
  );
  if (deaths.length === 0) return undefined;

  for (const death of deaths) {
    const deceased = observation.context.characters[death];
    if (deceased?.status !== "alive" || deceased.location === undefined) {
      continue;
    }
    const deathLocation = deceased.location;
    const livingHere = Object.entries(observation.context.characters)
      .filter(([, character]) =>
        character.status === "alive" &&
        character.location === deathLocation
      );
    const others = livingHere.filter(([character]) => character !== death);
    const possibleKillers = Object.entries(observation.context.characters)
      .filter(([character, state]) =>
        character !== death &&
        state.status !== "absent" &&
        observedAbilityLocations(state).includes(deathLocation)
      );

    const serialPattern = livingHere.length === 2 && others.length === 1;
    const actualSerialKillerPossible = serialPattern &&
      others.some(([character]) =>
        roleCouldBelongToCharacter(
          tragedySetRoles,
          ranges,
          "serialKiller",
          character,
        )
      );
    const virusSerialKillerPossible = serialPattern &&
      combination.subPlots.includes("paranoiaVirus") &&
      others.some(([characterId, character]) =>
        !characterDataOf(characterId).plotLessRole &&
        character.paranoia >= 3
      );

    const killerPattern = deceased.intrigue >= 2 &&
      possibleKillers.length >= 1;
    const killerPossible = killerPattern &&
      roleCouldBelongToCharacter(
        tragedySetRoles,
        ranges,
        "keyPerson",
        death,
      ) &&
      possibleKillers.some(([character]) =>
        roleCouldBelongToCharacter(
          tragedySetRoles,
          ranges,
          "killer",
          character,
        )
      );

    if (!serialPattern && !killerPattern) {
      // 공개 패턴만으로 C-3의 두 원인 중 어느 쪽도 특정할 수 없다.
      continue;
    }
    if (
      actualSerialKillerPossible ||
      virusSerialKillerPossible ||
      killerPossible
    ) return undefined;

    return {
      code: "roundEndDeathUnavailable",
      observation,
      reason: "라운드 종료의 공개 사망 상태를 이 조합의 가능한 역할로 설명할 수 없습니다.",
    };
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

  const roundEndDeath = roundEndDeathContradiction(
    observation,
    combination,
    tragedySetRoles,
    ranges,
  );
  if (roundEndDeath !== undefined) return roundEndDeath;

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
