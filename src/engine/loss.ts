import { characterDataOf } from "../data";
import { INCIDENT_IMPL } from "../impl/incidents";
import { PLOT_IMPL } from "../impl/plots";
import { effectiveAbilityRoles, ROLE_IMPL } from "../impl/roles";
import {
  effectiveRole,
  resolvePlaceX,
  type CharacterId,
  type GameState,
  type IncidentId,
  type Location,
  type PlotId,
  type RoleId,
} from "../types";
import {
  attemptProtagonistDeath,
  protagonistDeathBlocker,
  type ProtagonistDeathResult,
} from "./death";
import { requestLoopEnd } from "./flow";
import { incidentFires } from "./incident";

export type LossCategory =
  | "plot"
  | "protectedCharacter"
  | "protagonistDeath";

export type LossTiming =
  | "immediate"
  | "dayEnd"
  | "lastDay"
  | "loopEnd"
  | "incident";

export type LossSource = "plot" | "role" | "incident";
export type LossActivation = "mandatory" | "optional";
export type LossWhen =
  | "즉시"
  | "라운드 종료"
  | "마지막 날"
  | "루프 종료"
  | "사건 단계";

export interface LossRequirement {
  key: string;
  ko: string;
  current: number;
  needed: number;
  label: string;
}

export interface LossDistance {
  id: string;
  key: string;
  source: LossSource;
  category: LossCategory;
  timing: LossTiming;
  activation: LossActivation;
  activated: boolean;
  blockedBy?: CharacterId;
  when: LossWhen;
  daysLeft?: number;
  plot?: PlotId;
  role?: RoleId;
  incident?: IncidentId;
  character?: CharacterId;
  culprit?: CharacterId;
  day?: number;
  ko: string;
  current: number;
  needed: number;
  remaining: number;
  met: boolean;
  label: string;
  requirements: LossRequirement[];
}

export type LossCondition = LossDistance;

interface DistanceBase {
  id: string;
  key: string;
  source: LossSource;
  category: LossCategory;
  timing: LossTiming;
  activation: LossActivation;
  when: LossWhen;
  daysLeft?: number;
  plot?: PlotId;
  role?: RoleId;
  incident?: IncidentId;
  character?: CharacterId;
  culprit?: CharacterId;
  day?: number;
  ko: string;
  label: string;
  requirements: LossRequirement[];
  conditionMet?: boolean;
}

const LOCATION_KO: Record<Location, string> = {
  Hospital: "병원",
  Shrine: "신사",
  City: "도심",
  School: "학교",
};

function requirement(
  key: string,
  ko: string,
  current: number,
  needed: number,
  label: string,
): LossRequirement {
  return { key, ko, current, needed, label };
}

function distance(base: DistanceBase): LossDistance {
  const met = base.conditionMet ?? base.requirements.every(
    ({ current, needed }) => current >= needed,
  );
  const remaining = base.requirements.reduce(
    (sum, { current, needed }) => sum + Math.max(0, needed - current),
    0,
  );
  const single = base.requirements.length === 1
    ? base.requirements[0]
    : undefined;
  const current = single
    ? single.current
    : base.requirements.reduce(
      (sum, item) => sum + Math.min(item.current, item.needed),
      0,
    );
  const needed = single
    ? single.needed
    : base.requirements.reduce((sum, item) => sum + item.needed, 0);

  const { conditionMet: _conditionMet, ...fields } = base;
  return {
    ...fields,
    current,
    needed,
    remaining,
    met,
    activated: false,
  };
}

function plotKey(plot: PlotId): string {
  return `plot:${plot}`;
}

function roleKey(role: RoleId, character: CharacterId): string {
  return `role:${role}:${character}`;
}

function incidentKey(
  incident: IncidentId,
  day: number,
  culprit: CharacterId,
): string {
  return `incident:${incident}:${day}:${culprit}`;
}

function activePlots(state: GameState): PlotId[] {
  return [state.scenario.mainPlot, ...state.scenario.subPlots]
    .filter(
      (plot, index, plots) => plot !== "" && plots.indexOf(plot) === index,
    );
}

function actualKeyPerson(state: GameState): CharacterId | undefined {
  return Object.keys(state.scenario.cast).find(
    (character) => effectiveRole(state, character) === "keyPerson",
  );
}

function plotLossDistance(
  state: GameState,
  plot: PlotId,
): LossDistance | undefined {
  const impl = PLOT_IMPL[plot];
  if (!impl?.hooks.some((hook) => hook.kind === "lossTragedy")) {
    return undefined;
  }

  switch (plot) {
    case "sealedItem": {
      // SOURCE: src/impl/plots.ts sealedItem 훅의 source 참조
      const current = state.loop.locIntrigue.Shrine;
      return distance({
        id: plot,
        key: plotKey(plot),
        source: "plot",
        category: "plot",
        timing: "loopEnd",
        activation: "mandatory",
        when: "루프 종료",
        plot,
        ko: impl.ko,
        label: `신사 음모 ${current}/2`,
        requirements: [
          requirement("shrineIntrigue", "신사 음모", current, 2,
            `신사 음모 ${current}/2`),
        ],
      });
    }

    case "signWithMe": {
      // SOURCE: src/impl/plots.ts signWithMe 훅의 source 참조
      const keyPerson = actualKeyPerson(state);
      const current = keyPerson === undefined
        ? 0
        : state.loop.charCounters[keyPerson].intrigue;
      return distance({
        id: plot,
        key: plotKey(plot),
        source: "plot",
        category: "plot",
        timing: "loopEnd",
        activation: "mandatory",
        when: "루프 종료",
        plot,
        character: keyPerson,
        ko: impl.ko,
        label: keyPerson === undefined
          ? "핵심 인물 없음 · 음모 0/2"
          : `핵심 인물 음모 ${current}/2`,
        requirements: [
          requirement("keyPersonIntrigue", "핵심 인물 음모", current, 2,
            `핵심 인물 음모 ${current}/2`),
        ],
      });
    }

    case "changeOfFuture": {
      // SOURCE: src/impl/plots.ts changeOfFuture 훅의 source 참조
      const current = state.loop.incidentsFiredThisLoop?.includes(
        "butterflyEffect",
      ) ? 1 : 0;
      return distance({
        id: plot,
        key: plotKey(plot),
        source: "plot",
        category: "plot",
        timing: "loopEnd",
        activation: "mandatory",
        when: "루프 종료",
        plot,
        ko: impl.ko,
        label: `나비의 날갯짓 발생 ${current}/1`,
        requirements: [
          requirement(
            "butterflyEffectFired",
            "나비의 날갯짓 발생",
            current,
            1,
            `나비의 날갯짓 발생 ${current}/1`,
          ),
        ],
      });
    }

    case "giantTimeBomb": {
      // SOURCE: src/impl/plots.ts giantTimeBomb 훅의 source 참조
      const placeX = resolvePlaceX(state);
      const current = placeX === undefined
        ? 0
        : state.loop.locIntrigue[placeX];
      const placeLabel = placeX === undefined
        ? "장소 X 미확정"
        : `장소 X(${LOCATION_KO[placeX]})`;
      return distance({
        id: plot,
        key: plotKey(plot),
        source: "plot",
        category: "plot",
        timing: "loopEnd",
        activation: "mandatory",
        when: "루프 종료",
        plot,
        ko: impl.ko,
        label: `${placeLabel} 음모 ${current}/2`,
        requirements: [
          requirement(
            "placeXIntrigue",
            `${placeLabel} 음모`,
            current,
            2,
            `${placeLabel} 음모 ${current}/2`,
          ),
        ],
      });
    }

    default:
      throw new Error(`loss distance is not implemented for plot "${plot}"`);
  }
}

function characterLabel(character: CharacterId, role: RoleId): string {
  return `${characterDataOf(character).ko}(${ROLE_IMPL[role].ko})`;
}

function roleLossDistance(
  state: GameState,
  character: CharacterId,
  role: RoleId,
): LossDistance[] {
  const impl = ROLE_IMPL[role];
  if (!impl) return [];
  const labelPrefix = characterLabel(character, role);
  const out: LossDistance[] = [];

  for (const [hookIndex, hook] of impl.hooks.entries()) {
    const isTimeTravelerLoss = role === "timeTraveler" && hookIndex === 1;
    if (
      hook.kind !== "lossTragedy" &&
      hook.kind !== "lossDeath" &&
      !isTimeTravelerLoss
    ) {
      continue;
    }

    if (role === "keyPerson" && hookIndex === 0) {
      const current = state.loop.board[character].alive ? 0 : 1;
      out.push(distance({
        id: role,
        key: roleKey(role, character),
        source: "role",
        category: "protectedCharacter",
        timing: "immediate",
        activation: "mandatory",
        when: "즉시",
        role,
        character,
        ko: impl.ko,
        conditionMet: hook.when(state, character),
        label: `${labelPrefix} 사망 ${current}/1`,
        requirements: [
          requirement("dead", "사망", current, 1,
            `${labelPrefix} 사망 ${current}/1`),
        ],
      }));
      continue;
    }

    if (role === "timeTraveler" && hookIndex === 1) {
      const current = state.loop.charCounters[character].goodwill;
      const daysLeft = Math.max(
        0,
        state.scenario.daysPerLoop - state.loop.day,
      );
      out.push(distance({
        id: role,
        key: roleKey(role, character),
        source: "role",
        category: "protectedCharacter",
        timing: "lastDay",
        activation: "optional",
        when: "마지막 날",
        daysLeft,
        role,
        character,
        ko: impl.ko,
        conditionMet: hook.when(state, character),
        label: `우호 ${current}/3 확보 필요`,
        requirements: [
          requirement(
            "goodwill",
            "우호 확보",
            current,
            3,
            `우호 ${current}/3 확보 필요`,
          ),
        ],
      }));
      continue;
    }

    if (role === "friend" && hookIndex === 0) {
      const current = state.loop.board[character].alive ? 0 : 1;
      out.push(distance({
        id: role,
        key: roleKey(role, character),
        source: "role",
        category: "protectedCharacter",
        timing: "loopEnd",
        activation: "mandatory",
        when: "루프 종료",
        role,
        character,
        ko: impl.ko,
        conditionMet: hook.when(state, character),
        label: `${labelPrefix} 사망 ${current}/1`,
        requirements: [
          requirement("dead", "사망", current, 1,
            `${labelPrefix} 사망 ${current}/1`),
        ],
      }));
      continue;
    }

    if (role === "killer" && hookIndex === 1) {
      const current = state.loop.charCounters[character].intrigue;
      out.push(distance({
        id: role,
        key: roleKey(role, character),
        source: "role",
        category: "protagonistDeath",
        timing: "dayEnd",
        activation: "optional",
        when: "라운드 종료",
        role,
        character,
        ko: impl.ko,
        conditionMet: hook.when(state, character),
        label: `${labelPrefix} 음모 ${current}/4`,
        requirements: [
          requirement("intrigue", "음모", current, 4,
            `${labelPrefix} 음모 ${current}/4`),
        ],
      }));
      continue;
    }

    if (role === "lovedOne" && hookIndex === 1) {
      const paranoia = state.loop.charCounters[character].paranoia;
      const intrigue = state.loop.charCounters[character].intrigue;
      out.push(distance({
        id: role,
        key: roleKey(role, character),
        source: "role",
        category: "protagonistDeath",
        timing: "dayEnd",
        activation: "optional",
        when: "라운드 종료",
        role,
        character,
        ko: impl.ko,
        conditionMet: hook.when(state, character),
        label: `${labelPrefix} 불안 ${paranoia}/3 · 음모 ${intrigue}/1`,
        requirements: [
          requirement("paranoia", "불안", paranoia, 3,
            `불안 ${paranoia}/3`),
          requirement("intrigue", "음모", intrigue, 1,
            `음모 ${intrigue}/1`),
        ],
      }));
      continue;
    }

    throw new Error(
      `loss distance is not implemented for role "${role}" hook ${hookIndex}`,
    );
  }

  return out;
}

function incidentLossDistance(
  state: GameState,
  scheduled: GameState["scenario"]["incidents"][number],
): LossDistance[] {
  const impl = INCIDENT_IMPL[scheduled.incident];
  const lossHook = impl?.hooks.find((hook) => hook.kind === "lossDeath");
  if (!lossHook) {
    return [];
  }
  if (scheduled.incident !== "hospitalIncident") {
    throw new Error(
      `loss distance is not implemented for incident "${scheduled.incident}"`,
    );
  }

  const culpritPosition = state.loop.board[scheduled.culprit];
  const culpritCounters = state.loop.charCounters[scheduled.culprit];
  const paranoiaNeeded = characterDataOf(scheduled.culprit).paranoiaLimit;
  const alive = culpritPosition.alive ? 1 : 0;
  const paranoia = culpritCounters.paranoia;
  const hospitalIntrigue = state.loop.locIntrigue.Hospital;
  const label = `${scheduled.day}일 ${impl.ko}: ` +
    `범인 생존 ${alive}/1 · 범인 불안 ${paranoia}/${paranoiaNeeded} · ` +
    `병원 음모 ${hospitalIntrigue}/2`;

  return [distance({
    id: scheduled.incident,
    key: incidentKey(
      scheduled.incident,
      scheduled.day,
      scheduled.culprit,
    ),
    source: "incident",
    category: "protagonistDeath",
    timing: "incident",
    activation: "mandatory",
    when: "사건 단계",
    incident: scheduled.incident,
    culprit: scheduled.culprit,
    day: scheduled.day,
    ko: impl.ko,
    conditionMet:
      incidentFires(state, scheduled.culprit) &&
      scheduled.culprit !== "blackCat" &&
      lossHook.when(state, scheduled.culprit),
    label,
    requirements: [
      requirement("culpritAlive", "범인 생존", alive, 1,
        `범인 생존 ${alive}/1`),
      requirement("culpritParanoia", "범인 불안", paranoia, paranoiaNeeded,
        `범인 불안 ${paranoia}/${paranoiaNeeded}`),
      requirement("hospitalIntrigue", "병원 음모", hospitalIntrigue, 2,
        `병원 음모 ${hospitalIntrigue}/2`),
    ],
  })];
}

/** 현재 시나리오의 모든 패배 조건과 남은 카운터/사건 거리를 반환한다. */
export function distanceToLoss(state: GameState): LossDistance[] {
  const out: LossDistance[] = [];

  for (const plot of activePlots(state)) {
    const plotDistance = plotLossDistance(state, plot);
    if (plotDistance) out.push(plotDistance);
  }

  const seenRoleConditions = new Set<string>();
  for (const character of Object.keys(state.scenario.cast)) {
    for (const role of effectiveAbilityRoles(state, character)) {
      const key = `${character}:${role}`;
      if (seenRoleConditions.has(key)) continue;
      seenRoleConditions.add(key);
      out.push(...roleLossDistance(state, character, role));
    }
  }

  for (const scheduled of state.scenario.incidents) {
    out.push(...incidentLossDistance(state, scheduled));
  }

  return out.map((condition) => {
    const atTiming = isCurrentTiming(state, condition);
    const blockedBy = condition.category === "protagonistDeath" &&
        condition.met && atTiming
      ? protagonistDeathBlocker(state)
      : undefined;
    const activated = blockedBy === undefined && (
      condition.activation === "mandatory"
        ? condition.met && atTiming
        : Boolean(state.loop.optionalLossActivations?.[condition.key]) &&
          condition.met && atTiming
    );
    return { ...condition, activated, blockedBy };
  });
}

function isCurrentTiming(state: GameState, condition: LossDistance): boolean {
  switch (condition.timing) {
    case "immediate":
      return true;
    case "dayEnd":
      return state.loop.phase === "P9_ROUND_END";
    case "lastDay":
      return state.loop.phase === "P9_ROUND_END" &&
        state.loop.day === state.scenario.daysPerLoop;
    case "loopEnd":
      return state.gamePhase === "LOOP_JUDGMENT" || (
        state.loop.phase === "P9_ROUND_END" &&
        state.loop.day === state.scenario.daysPerLoop
      );
    case "incident":
      return state.loop.phase === "P7_INCIDENT" &&
        condition.day === state.loop.day;
  }
}

/** 현재 판정 시점에 실제로 성립한 패배 조건만 반환한다. */
export function evaluateLoss(state: GameState): LossCondition[] {
  return distanceToLoss(state).filter(
    (condition) =>
      condition.met &&
      condition.blockedBy === undefined &&
      isCurrentTiming(state, condition),
  );
}

/** 현재 판정 시점의 [선택] 패배 조건 발동 여부를 기록한다. */
export function setOptionalLossActivation(
  state: GameState,
  key: string,
  activated: boolean,
): ProtagonistDeathResult | undefined {
  const condition = distanceToLoss(state).find(
    (candidate) => candidate.key === key,
  );
  if (!condition) {
    throw new Error(`unknown loss condition "${key}"`);
  }
  if (condition.activation !== "optional") {
    throw new Error(`loss condition "${key}" is mandatory`);
  }
  if (!condition.met || !isCurrentTiming(state, condition)) {
    throw new Error(`loss condition "${key}" is not currently met`);
  }

  if (activated) {
    if (condition.category === "protagonistDeath") {
      const death = attemptProtagonistDeath(state);
      if (!death.died) return death;
    }
    const activations = state.loop.optionalLossActivations ??= {};
    activations[key] = true;
    if (condition.category !== "protagonistDeath") {
      requestLoopEnd(state, "effect", [key]);
    } else if (state.pendingLoopEnd) {
      requestLoopEnd(state, "protagonistDeath", [key]);
    }
    return condition.category === "protagonistDeath"
      ? { died: true }
      : undefined;
  }

  const activations = state.loop.optionalLossActivations;
  if (!activations) return undefined;
  delete activations[key];
  if (Object.keys(activations).length === 0) {
    delete state.loop.optionalLossActivations;
  }
  return undefined;
}
