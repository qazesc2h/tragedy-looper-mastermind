import { characterDataOf } from "../data";
import {
  type GameState,
  LOCATIONS,
  startLocationOf,
} from "../types";
import {
  distanceToLoss,
  type LossDistance,
  type LossRoute,
  type LossRouteControl,
} from "./loss";

export interface GuidanceActions {
  cards: number;
  abilities: number;
  cardLabels: string[];
  abilityLabels: string[];
}

/** E가 A의 목표를 문자열 재해석 없이 카드 배치 후보로 옮기기 위한 계약. */
export interface GuidancePlacementNeed {
  resource: string;
  label: string;
  targetKey: string;
}

export type InterferenceDifficulty = "낮음" | "보통" | "높음" | "해당 없음";

export interface MastermindGuidanceRoute {
  key: string;
  conditionKey: string;
  title: string;
  control: LossRouteControl;
  controlLabel: string;
  timing: string;
  minimumDay: number;
  minimumDayLabel: string;
  actions: GuidanceActions;
  interferenceDifficulty: InterferenceDifficulty;
  interference: string;
  resources: string[];
  placementNeeds: GuidancePlacementNeed[];
  warning?: string;
}

export interface MastermindGuidance {
  primary?: MastermindGuidanceRoute;
  alternatives: MastermindGuidanceRoute[];
  automaticRisks: MastermindGuidanceRoute[];
  protagonistChoices: MastermindGuidanceRoute[];
  routes: MastermindGuidanceRoute[];
}

interface MutablePlan {
  cards: string[];
  cardNeeds: GuidancePlacementNeed[];
  abilities: string[];
  targetCardCounts: Map<string, number>;
  targetAbilityCounts: Map<string, number>;
}

interface GuidanceProjection {
  state: GameState;
  include: (condition: LossDistance, route: LossRoute) => boolean;
}

const PERMANENT_BLOCKERS = new Set(["effectNotSuppressed", "targetMortal"]);

function controlLabel(control: LossRouteControl): string {
  switch (control) {
    case "automatic": return "자동 발동";
    case "mastermind": return "각본가 선택";
    case "protagonist": return "주인공 선택";
  }
}

function addCard(
  plan: MutablePlan,
  resource: string,
  label: string,
  target: string,
): void {
  plan.cards.push(`${resource}\t${label}`);
  plan.cardNeeds.push({ resource, label, targetKey: target });
  plan.targetCardCounts.set(target, (plan.targetCardCounts.get(target) ?? 0) + 1);
}

function addAbility(
  plan: MutablePlan,
  resource: string,
  label: string,
  target: string,
): void {
  plan.abilities.push(`${resource}\t${label}`);
  plan.targetAbilityCounts.set(
    target,
    (plan.targetAbilityCounts.get(target) ?? 0) + 1,
  );
}

function addIntrigue(
  plan: MutablePlan,
  amount: number,
  target: string,
): void {
  if (amount <= 0) return;
  if (amount >= 2) {
    addCard(plan, "card:intriguePlus2", "음모 +2", target);
  }
  if (amount === 1 || amount >= 3) {
    addCard(plan, "card:intriguePlus1", "음모 +1", target);
  }
  for (let index = 3; index < amount; index += 1) {
    addAbility(plan, "ability:intriguePlus1", "음모 +1 능력", target);
  }
}

function addParanoia(
  plan: MutablePlan,
  amount: number,
  target: string,
): void {
  if (amount <= 0) return;
  addCard(plan, "card:paranoiaPlus1:a", "불안 +1", target);
  if (amount >= 2) {
    addCard(plan, "card:paranoiaPlus1:b", "불안 +1", target);
  }
  for (let index = 2; index < amount; index += 1) {
    addAbility(plan, "ability:paranoiaPlus1", "불안 +1 능력", target);
  }
}

function characterParts(state: GameState, route: LossRoute): string[] {
  const cast = new Set(Object.keys(state.scenario.cast));
  return route.key.split(":").filter((part) => cast.has(part));
}

function conditionTarget(condition: LossDistance): string {
  if (condition.character !== undefined) return `character:${condition.character}`;
  if (condition.plot !== undefined) return `plot:${condition.plot}`;
  if (condition.incident !== undefined) return `incident:${condition.incident}`;
  return condition.key;
}

function movementTarget(
  state: GameState,
  route: LossRoute,
  condition: LossDistance,
): string {
  if (
    route.key.startsWith("death:serialKiller:") &&
    condition.character !== undefined
  ) {
    return `character:${condition.character}`;
  }
  const parts = characterParts(state, route);
  const conditionCharacter = condition.character;
  const other = parts.find((part) => part !== conditionCharacter);
  return other === undefined ? conditionTarget(condition) : `character:${other}`;
}

function addMovement(plan: MutablePlan, target: string, count = 1): void {
  for (let index = 0; index < count; index += 1) {
    addCard(plan, "card:movement", "이동", target);
  }
}

function requirementTarget(
  state: GameState,
  condition: LossDistance,
  route: LossRoute,
  key: string,
): string {
  if (key.startsWith("hospital")) return "location:Hospital";
  if (key === "schoolIntrigue") return "location:School";
  if (key === "shrineIntrigue") return "location:Shrine";
  if (key === "placeXIntrigue") return "location:X";
  if (key === "culpritParanoia") {
    const parts = route.key.split(":");
    const dayIndex = route.key.startsWith("death:incident:") ? 3 : -1;
    const day = dayIndex < 0 ? undefined : Number(parts[dayIndex]);
    const scheduled = Number.isInteger(day)
      ? state.scenario.incidents.find(({ day: candidateDay, incident }) =>
        candidateDay === day && route.key.includes(`:${incident}:`)
      )
      : undefined;
    const culprit = condition.culprit ?? scheduled?.culprit ?? (
      route.key.startsWith("death:incident:murder:") ? parts.at(-2) : parts.at(-1)
    );
    return `character:${culprit ?? "culprit"}`;
  }
  return conditionTarget(condition);
}

function butterflyEffectPlan(
  state: GameState,
  plan: MutablePlan,
): number | undefined {
  const incident = state.scenario.incidents
    .filter(({ incident }) => incident === "butterflyEffect")
    .sort((left, right) => left.day - right.day)[0];
  if (incident === undefined) return undefined;
  const needed = characterDataOf(incident.culprit).paranoiaLimit;
  addParanoia(plan, needed, `character:${incident.culprit}`);
  return incident.day;
}

function planForRoute(
  state: GameState,
  condition: LossDistance,
  route: LossRoute,
): { plan: MutablePlan; fixedDay?: number } | undefined {
  if (route.requirements.some(({ key, met }) =>
    PERMANENT_BLOCKERS.has(key) && !met
  )) return undefined;

  const plan: MutablePlan = {
    cards: [],
    cardNeeds: [],
    abilities: [],
    targetCardCounts: new Map(),
    targetAbilityCounts: new Map(),
  };
  let fixedDay = route.daysUntil === undefined
    ? undefined
    : state.loop.day + route.daysUntil;

  if (condition.role === "timeTraveler") {
    return { plan, fixedDay: state.scenario.daysPerLoop };
  }

  if (
    condition.role === "keyPerson" &&
    condition.character !== undefined &&
    state.scenario.cast[condition.character] === "factor"
  ) {
    addIntrigue(plan, 2, "location:City");
  }

  if (route.key.startsWith("death:serialKiller:")) {
    const serialKiller = route.key.split(":")[2];
    const plots = [state.scenario.mainPlot, ...state.scenario.subPlots];
    if (
      serialKiller !== undefined &&
      state.scenario.cast[serialKiller] === "person" &&
      plots.includes("paranoiaVirus")
    ) {
      addParanoia(plan, 3, `character:${serialKiller}`);
    }
  }

  const serialTargetSame = route.requirements.find(
    ({ key }) => key === "targetSameLocation",
  );
  const serialExactlyOne = route.requirements.find(
    ({ key }) => key === "exactlyOneOtherLiving",
  );
  if (
    route.key.startsWith("death:serialKiller:") &&
    (serialTargetSame?.met === false || serialExactlyOne?.met === false)
  ) {
    const relationMoves = Math.max(1, serialExactlyOne?.remaining ?? 0);
    addMovement(plan, movementTarget(state, route, condition), relationMoves);
  }

  for (const requirement of route.requirements) {
    if (requirement.met) continue;
    const target = requirementTarget(state, condition, route, requirement.key);
    switch (requirement.key) {
      case "placeXIntrigue":
      case "schoolIntrigue":
      case "shrineIntrigue":
      case "keyPersonIntrigue":
      case "intrigue":
      case "targetIntrigue":
      case "hospitalIntrigue":
      case "hospitalIntrigueForDeath":
        addIntrigue(plan, requirement.remaining, target);
        break;
      case "paranoia":
      case "culpritParanoia":
        addParanoia(plan, requirement.remaining, target);
        break;
      case "butterflyEffectFired":
        fixedDay = butterflyEffectPlan(state, plan);
        if (fixedDay === undefined) return undefined;
        break;
      case "sameAbilityLocation":
      case "sameLocationAsCulprit":
      case "targetAtHospital":
      case "sameLocationAsAlien":
        addMovement(plan, movementTarget(state, route, condition));
        break;
      case "targetSameLocation":
      case "exactlyOneOtherLiving":
        break;
    }
  }

  if (route.key.startsWith("death:killer:")) {
    addAbility(plan, "ability:killer", "살인 청부업자 능력", conditionTarget(condition));
  } else if (route.key.startsWith("death:serialKiller:")) {
    addAbility(plan, "ability:serialKiller", "연쇄 살인마 강제 능력", conditionTarget(condition));
  } else if (route.key.startsWith("death:goodwill:alien:")) {
    addAbility(plan, "ability:alienGoodwill", "이세계인 우호 능력", conditionTarget(condition));
  } else if (condition.role === "lovedOne") {
    addAbility(plan, "ability:lovedOne", "연인A 패배 능력", conditionTarget(condition));
  }

  return { plan, ...(fixedDay === undefined ? {} : { fixedDay }) };
}

function unpack(items: readonly string[]): { resources: string[]; labels: string[] } {
  return {
    resources: items.map((item) => item.split("\t", 1)[0]),
    labels: items.map((item) => item.slice(item.indexOf("\t") + 1)),
  };
}

function minimumDay(
  state: GameState,
  condition: LossDistance,
  plan: MutablePlan,
  fixedDay: number | undefined,
): number {
  if (condition.timing === "loopEnd" || condition.timing === "lastDay") {
    return state.scenario.daysPerLoop;
  }
  const cardDays = Math.max(0, ...plan.targetCardCounts.values());
  const abilityDays = Math.max(0, ...plan.targetAbilityCounts.values());
  return Math.max(1, fixedDay ?? 1, cardDays, abilityDays);
}

function minimumDayLabel(
  condition: LossDistance,
  day: number,
): string {
  if (condition.timing === "loopEnd") return `${day}일째 루프 종료`;
  if (condition.timing === "lastDay") return `${day}일째 마지막 날`;
  if (condition.timing === "incident") return `${day}일째 사건 단계`;
  return `${day}일째`;
}

function guidanceTiming(
  state: GameState,
  condition: LossDistance,
  route: LossRoute,
): string {
  if (
    condition.timing === "incident" ||
    route.key.startsWith("death:incident:")
  ) {
    const day = route.daysUntil === undefined
      ? condition.day
      : state.loop.day + route.daysUntil;
    return day === undefined ? "사건 단계" : `${day}일 사건 단계`;
  }
  return route.when;
}

function interferenceFor(
  condition: LossDistance,
  route: LossRoute,
): { difficulty: InterferenceDifficulty; text: string } {
  if (condition.role === "timeTraveler") {
    return {
      difficulty: "보통",
      text: "마지막 날까지 시간 여행자에게 우호를 3개 이상 놓는다. 우호 금지는 무시된다.",
    };
  }
  if (route.control === "protagonist") {
    return {
      difficulty: "해당 없음",
      text: "주인공이 직접 능력 사용과 대상을 고르므로 각본가가 노릴 수 없다.",
    };
  }
  if (route.key.startsWith("death:serialKiller:")) {
    return {
      difficulty: "낮음",
      text: "둘 중 하나를 이동시키거나 같은 장소에 제3의 생존자를 둔다.",
    };
  }
  if (route.key.startsWith("death:killer:")) {
    return {
      difficulty: "보통",
      text: "핵심 인물의 음모를 금지·제거하거나 청부업자와 다른 장소로 분리한다.",
    };
  }
  if (route.key.includes(":suicide:")) {
    return {
      difficulty: "보통",
      text: "사건 전 범인의 불안을 한계 미만으로 낮추거나 대상에게 보호를 둔다.",
    };
  }
  if (route.key.includes(":murder:")) {
    return {
      difficulty: "낮음",
      text: "범인의 불안을 낮추거나 범인과 대상을 분리하거나 대상에게 보호를 둔다.",
    };
  }
  if (route.key.includes(":farawayMurder:")) {
    return {
      difficulty: "낮음",
      text: "범인의 불안을 낮추거나 대상의 음모를 2 미만으로 유지하거나 보호를 둔다.",
    };
  }
  if (route.key.includes(":hospitalIncident:")) {
    return {
      difficulty: "낮음",
      text: "범인의 불안을 낮추고 병원 음모를 막으며, 캐릭터 사망 경로라면 대상을 병원 밖으로 옮긴다.",
    };
  }
  if (condition.role === "killer") {
    return {
      difficulty: "보통",
      text: "살인 청부업자 본인의 음모를 금지·제거해 4 미만으로 유지한다.",
    };
  }
  if (condition.role === "lovedOne") {
    return {
      difficulty: "낮음",
      text: "연인A의 불안 또는 음모 중 하나를 기준 미만으로 낮춘다.",
    };
  }
  if (condition.incident === "hospitalIncident") {
    return {
      difficulty: "낮음",
      text: "범인의 불안을 낮추거나 병원 음모를 2 미만으로 유지하고 사건 억제 능력을 사용한다.",
    };
  }
  return {
    difficulty: "보통",
    text: "대상에 음모 금지를 놓거나 우호 능력으로 음모를 제거해 기준 미만으로 유지한다.",
  };
}

function guidanceRoute(
  state: GameState,
  condition: LossDistance,
  route: LossRoute,
): MastermindGuidanceRoute | undefined {
  const planned = planForRoute(state, condition, route);
  if (planned === undefined) return undefined;
  const cards = unpack(planned.plan.cards);
  const abilities = unpack(planned.plan.abilities);
  const day = minimumDay(state, condition, planned.plan, planned.fixedDay);
  const interference = interferenceFor(condition, route);
  const warning = condition.role === "timeTraveler"
    ? "각본가 행동은 0회다. 주인공이 우호를 쌓지 않고 방치하면 마지막 날에 성립한다."
    : route.control === "automatic"
    ? "조건이 갖춰지면 강제 발동한다. 각본가도 멈출 수 없다."
    : route.control === "protagonist"
    ? "사용 여부와 대상은 주인공이 고른다. 노릴 경로가 아니다."
    : undefined;
  return {
    key: route.key,
    conditionKey: condition.key,
    title: `${condition.ko} · ${route.ko}`,
    control: route.control,
    controlLabel: controlLabel(route.control),
    timing: guidanceTiming(state, condition, route),
    minimumDay: day,
    minimumDayLabel: minimumDayLabel(condition, day),
    actions: {
      cards: cards.labels.length,
      abilities: abilities.labels.length,
      cardLabels: cards.labels,
      abilityLabels: abilities.labels,
    },
    interferenceDifficulty: interference.difficulty,
    interference: interference.text,
    resources: [...new Set([...cards.resources, ...abilities.resources])],
    placementNeeds: planned.plan.cardNeeds,
    ...(warning === undefined ? {} : { warning }),
  };
}

function placementProjections(state: GameState): GameState[] {
  const projected = structuredClone(state);
  const henchmanNeedsChoice = projected.loop.board.henchman?.status === "absent";
  for (const character of Object.keys(projected.scenario.cast)) {
    if (character === "henchman") continue;
    if (projected.loop.board[character]?.status !== "absent") continue;
    projected.loop.board[character] = {
      status: "alive",
      at: startLocationOf(character, projected.scenario),
    };
  }
  if (!henchmanNeedsChoice) return [projected];
  return LOCATIONS.map((at) => {
    const candidate = structuredClone(projected);
    candidate.loop.board.henchman = { status: "alive", at };
    candidate.loop.loopStartTraitLocationChoices = { henchman: at };
    return candidate;
  });
}

function staticGuidanceProjections(state: GameState): GuidanceProjection[] {
  const placements = placementProjections(state);
  const projections: GuidanceProjection[] = placements.map((candidate) => ({
    state: candidate,
    include: () => true,
  }));
  if (Object.values(state.scenario.cast).includes("factor")) {
    projections.push(...placements.map((candidate): GuidanceProjection => {
      const factor = structuredClone(candidate);
      factor.loop.locIntrigue.City = 2;
      return {
        state: factor,
        include: (condition) => condition.role === "keyPerson" &&
          condition.character !== undefined &&
          factor.scenario.cast[condition.character] === "factor",
      };
    }));
  }
  const plots = [state.scenario.mainPlot, ...state.scenario.subPlots];
  if (plots.includes("paranoiaVirus")) {
    projections.push(...placements.map((candidate): GuidanceProjection => {
      const virus = structuredClone(candidate);
      const transformed = new Set<string>();
      for (const [character, role] of Object.entries(virus.scenario.cast)) {
        if (role !== "person") continue;
        virus.loop.charCounters[character].paranoia = 3;
        transformed.add(character);
      }
      return {
        state: virus,
        include: (_condition, route) => {
          const serialKiller = route.key.startsWith("death:serialKiller:")
            ? route.key.split(":")[2]
            : undefined;
          return serialKiller !== undefined && transformed.has(serialKiller);
        },
      };
    }));
    if (Object.values(state.scenario.cast).includes("factor")) {
      projections.push(...placements.map((candidate): GuidanceProjection => {
        const combined = structuredClone(candidate);
        combined.loop.locIntrigue.City = 2;
        const transformed = new Set<string>();
        for (const [character, role] of Object.entries(combined.scenario.cast)) {
          if (role !== "person") continue;
          combined.loop.charCounters[character].paranoia = 3;
          transformed.add(character);
        }
        return {
          state: combined,
          include: (condition, route) => {
            const protectedCharacter = condition.character;
            const serialKiller = route.key.startsWith("death:serialKiller:")
              ? route.key.split(":")[2]
              : undefined;
            return condition.role === "keyPerson" &&
              protectedCharacter !== undefined &&
              combined.scenario.cast[protectedCharacter] === "factor" &&
              serialKiller !== undefined && transformed.has(serialKiller);
          },
        };
      }));
    }
  }
  return projections;
}

function routeScore(route: MastermindGuidanceRoute): readonly number[] {
  const control = route.control === "mastermind" ? 0 : 1;
  return [
    route.minimumDay,
    route.actions.cards + route.actions.abilities,
    control,
  ];
}

function compareRoutes(
  left: MastermindGuidanceRoute,
  right: MastermindGuidanceRoute,
): number {
  const leftScore = routeScore(left);
  const rightScore = routeScore(right);
  for (let index = 0; index < leftScore.length; index += 1) {
    const difference = leftScore[index] - rightScore[index];
    if (difference !== 0) return difference;
  }
  return left.title.localeCompare(right.title, "ko");
}

function resourceOverlap(
  left: MastermindGuidanceRoute,
  right: MastermindGuidanceRoute,
): number {
  const leftResources = new Set(left.resources);
  return right.resources.filter((resource) => leftResources.has(resource)).length;
}

/**
 * 현재 진행도와 무관한 게임 시작 전 지침을 생성한다.
 * `distanceToLoss()`의 시나리오별 인과 경로만 사용하며 공개 추리 정보에는 섞지 않는다.
 */
export function mastermindGuidance(state: GameState): MastermindGuidance {
  const routes = staticGuidanceProjections(state).flatMap((projection) =>
    distanceToLoss(projection.state).flatMap((condition) =>
      condition.routes.flatMap((route) => {
        if (!projection.include(condition, route)) return [];
        const candidate = guidanceRoute(projection.state, condition, route);
        return candidate === undefined ? [] : [candidate];
      })
    )
  );
  const byKey = new Map<string, MastermindGuidanceRoute>();
  for (const route of routes) {
    const uniqueKey = `${route.conditionKey}|${route.key}`;
    const previous = byKey.get(uniqueKey);
    if (previous === undefined || compareRoutes(route, previous) < 0) {
      byKey.set(uniqueKey, route);
    }
  }
  const unique = [...byKey.values()].sort(compareRoutes);
  const pursuable = unique.filter(({ control }) => control !== "protagonist");
  const primary = pursuable[0];
  const alternatives = primary === undefined
    ? []
    : pursuable.slice(1).sort((left, right) => {
      const overlap = resourceOverlap(primary, left) -
        resourceOverlap(primary, right);
      return overlap !== 0 ? overlap : compareRoutes(left, right);
    }).slice(0, 2);
  return {
    ...(primary === undefined ? {} : { primary }),
    alternatives,
    automaticRisks: unique.filter(({ control }) => control === "automatic"),
    protagonistChoices: unique.filter(({ control }) => control === "protagonist"),
    routes: unique,
  };
}
