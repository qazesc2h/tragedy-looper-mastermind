import { characterDataOf } from "../data";
import { INCIDENT_IMPL } from "../impl/incidents";
import { PLOT_IMPL } from "../impl/plots";
import { effectiveAbilityRoles, ROLE_IMPL } from "../impl/roles";
import {
  abilityLocationsOf,
  characterLocation,
  effectiveRole,
  isCharacterAlive,
  isCharacterDead,
  isCharacterPresent,
  PHASE_ORDER,
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
import { servantDeathReplacement } from "./servant";
import { requestLoopEnd } from "./flow";
import { incidentFires, incidentParanoia } from "./incident";

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
export type LossRouteControl = "automatic" | "mastermind" | "protagonist";
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
  remaining: number;
  met: boolean;
  label: string;
}

export interface LossRoute {
  key: string;
  ko: string;
  control: LossRouteControl;
  when: string;
  daysUntil?: number;
  available: boolean;
  met: boolean;
  requirements: LossRequirement[];
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
  /** 판정 조건과 별개로, 이 패배가 실제로 성립할 수 있는 경로별 진척. */
  routes: LossRoute[];
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
  routes?: LossRoute[];
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
  conditionMet?: boolean,
  remainingOverride?: number,
): LossRequirement {
  const met = conditionMet ?? current >= needed;
  return {
    key,
    ko,
    current,
    needed,
    remaining: met
      ? 0
      : remainingOverride ?? Math.max(0, needed - current),
    met,
    label,
  };
}

function route(
  key: string,
  ko: string,
  control: LossRouteControl,
  when: string,
  available: boolean,
  requirements: LossRequirement[],
  daysUntil?: number,
  conditionMet?: boolean,
): LossRoute {
  return {
    key,
    ko,
    control,
    when,
    ...(daysUntil === undefined ? {} : { daysUntil }),
    available,
    met: available && (conditionMet ?? requirements.every(({ met }) => met)),
    requirements,
  };
}

function distance(base: DistanceBase): LossDistance {
  const met = base.conditionMet ?? base.requirements.every(
    (item) => item.met,
  );
  const remaining = base.requirements.reduce(
    (sum, item) => sum + item.remaining,
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
    routes: base.routes ?? [route(
      `${base.key}:direct`,
      base.ko,
      base.activation === "optional" ? "mastermind" : "automatic",
      base.when,
      true,
      base.requirements,
      base.daysLeft,
      met,
    )],
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
    case "lightAvenger": {
      // SOURCE: src/impl/plots.ts lightAvenger 훅의 source 참조
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

    case "placeProtect": {
      // SOURCE: src/impl/plots.ts placeProtect 훅의 source 참조
      const current = state.loop.locIntrigue.School;
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
        label: `학교 음모 ${current}/2`,
        requirements: [
          requirement("schoolIntrigue", "학교 음모", current, 2,
            `학교 음모 ${current}/2`),
        ],
      });
    }

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

function booleanRequirement(
  key: string,
  ko: string,
  met: boolean,
  passLabel: string,
  failLabel: string,
): LossRequirement {
  return requirement(key, ko, Number(met), 1, met ? passLabel : failLabel, met);
}

function targetCanDieRequirements(
  state: GameState,
  target: CharacterId,
): LossRequirement[] {
  const alive = isCharacterAlive(state.loop.board[target]);
  const protection = state.loop.charCounters[target].protection;
  return [
    booleanRequirement(
      "targetAlive",
      "대상 생존",
      alive,
      "대상 생존",
      "대상이 이미 사망",
    ),
    booleanRequirement(
      "targetUnprotected",
      "보호 없음",
      protection === 0,
      "보호 없음",
      `보호 ${protection}개`,
    ),
    booleanRequirement(
      "targetMortal",
      "사망 가능",
      effectiveRole(state, target) !== "timeTraveler",
      "사망 가능",
      "시간 여행자라 사망하지 않음",
    ),
    booleanRequirement(
      "servantNotReplacingDeath",
      "메이드 대신 사망 없음",
      servantDeathReplacement(state, target) === undefined,
      "메이드 대신 사망 없음",
      "동소의 살아 있는 메이드가 대신 사망",
    ),
  ];
}

function characterHasAbilityRole(
  state: GameState,
  character: CharacterId,
  role: RoleId,
): boolean {
  return effectiveAbilityRoles(state, character).includes(role);
}

function futureRoundAvailable(state: GameState): boolean {
  return state.pendingLoopEnd === undefined && [
    "LOOP_TIME_GAP",
    "LOOP_CHARACTER_PLACEMENT",
    "LOOP_COUNTER_SETUP",
    "LOOP_CARD_DISTRIBUTION",
    "ROUND",
  ].includes(state.gamePhase);
}

function killerKeyPersonRoutes(
  state: GameState,
  keyPerson: CharacterId,
): LossRoute[] {
  return Object.keys(state.loop.board).flatMap((killer) => {
    const position = state.loop.board[killer];
    if (
      !isCharacterPresent(position) ||
      !characterHasAbilityRole(state, killer, "killer")
    ) return [];
    const keyPersonPosition = state.loop.board[keyPerson];
    const inRange = isCharacterPresent(keyPersonPosition) &&
      abilityLocationsOf(state, killer).includes(
        characterLocation(keyPersonPosition, keyPerson),
      );
    const intrigue = state.loop.charCounters[keyPerson].intrigue;
    return [route(
      `death:killer:${killer}:${keyPerson}`,
      `${characterDataOf(killer).ko}의 살인 청부업자 능력`,
      "mastermind",
      "오늘 라운드 종료",
      futureRoundAvailable(state),
      [
        booleanRequirement(
          "killerAlive",
          "청부업자 생존",
          isCharacterAlive(position),
          "청부업자 생존",
          "청부업자 사망",
        ),
        requirement(
          "keyPersonIntrigue",
          "핵심 인물 음모",
          intrigue,
          2,
          `핵심 인물 음모 ${intrigue}/2`,
        ),
        booleanRequirement(
          "sameAbilityLocation",
          "능력 범위가 같음",
          inRange,
          "같은 장소/세력권",
          "다른 장소/세력권",
        ),
        ...targetCanDieRequirements(state, keyPerson),
      ],
    )];
  });
}

function serialKillerDeathRoutes(
  state: GameState,
  target: CharacterId,
): LossRoute[] {
  return Object.keys(state.loop.board).flatMap((serialKiller) => {
    const position = state.loop.board[serialKiller];
    if (
      serialKiller === target ||
      !isCharacterAlive(position) ||
      !characterHasAbilityRole(state, serialKiller, "serialKiller")
    ) return [];
    const serialLocation = characterLocation(position, serialKiller);
    const targetPosition = state.loop.board[target];
    const targetSameLocation = isCharacterAlive(targetPosition) &&
      characterLocation(targetPosition, target) === serialLocation;
    const otherLiving = Object.entries(state.loop.board).filter(
      ([character, candidate]) =>
        character !== serialKiller &&
        isCharacterAlive(candidate) &&
        characterLocation(candidate, character) === serialLocation,
    ).length;
    return [route(
      `death:serialKiller:${serialKiller}:${target}`,
      `${characterDataOf(serialKiller).ko}의 연쇄 살인마 능력`,
      "automatic",
      "오늘 라운드 종료",
      futureRoundAvailable(state),
      [
        booleanRequirement(
          "targetSameLocation",
          "대상과 같은 장소",
          targetSameLocation,
          "대상과 같은 장소",
          "대상과 다른 장소",
        ),
        requirement(
          "exactlyOneOtherLiving",
          "같은 장소의 다른 생존자",
          otherLiving,
          1,
          `다른 생존자 ${otherLiving}명/정확히 1명`,
          otherLiving === 1,
          Math.abs(otherLiving - 1),
        ),
        ...targetCanDieRequirements(state, target),
      ],
    )];
  });
}

function incidentAlreadyResolved(
  state: GameState,
  scheduled: GameState["scenario"]["incidents"][number],
): boolean {
  return state.loop.incidentOccurrencesFiredThisLoop?.some(
    ({ day, incident, culprit }) =>
      day === scheduled.day &&
      incident === scheduled.incident &&
      culprit === scheduled.culprit,
  ) ?? false;
}

function incidentRouteAvailable(
  state: GameState,
  scheduled: GameState["scenario"]["incidents"][number],
): boolean {
  if (!futureRoundAvailable(state)) return false;
  if (incidentAlreadyResolved(state, scheduled)) return false;
  if (scheduled.day > state.loop.day) return true;
  if (scheduled.day < state.loop.day) return false;
  if (state.gamePhase !== "ROUND") return true;
  return PHASE_ORDER.indexOf(state.loop.phase) <=
    PHASE_ORDER.indexOf("P7_INCIDENT");
}

function incidentWhen(
  state: GameState,
  scheduled: GameState["scenario"]["incidents"][number],
): string {
  const daysUntil = scheduled.day - state.loop.day;
  if (!incidentRouteAvailable(state, scheduled)) {
    return `${scheduled.day}일 사건 · 기회 지남`;
  }
  return daysUntil === 0
    ? `${scheduled.day}일 사건 · 오늘`
    : `${scheduled.day}일 사건 · ${daysUntil}일 후`;
}

function incidentCommonRequirements(
  state: GameState,
  scheduled: GameState["scenario"]["incidents"][number],
): LossRequirement[] {
  const culpritPosition = state.loop.board[scheduled.culprit];
  const paranoia = incidentParanoia(state, scheduled.culprit);
  const paranoiaNeeded = characterDataOf(scheduled.culprit).paranoiaLimit;
  const suppressed = state.loop.incidentCulpritSuppressedFor?.includes(
    scheduled.culprit,
  ) ?? false;
  return [
    booleanRequirement(
      "culpritAlive",
      "범인 생존",
      isCharacterAlive(culpritPosition),
      "범인 생존",
      "범인 사망/부재",
    ),
    requirement(
      "culpritParanoia",
      "범인 불안",
      paranoia,
      paranoiaNeeded,
      `범인 불안 ${paranoia}/${paranoiaNeeded}`,
    ),
    booleanRequirement(
      "culpritNotSuppressed",
      "사건 발생 억제 없음",
      !suppressed,
      "사건 발생 억제 없음",
      "범인의 사건 발생이 억제됨",
    ),
    booleanRequirement(
      "effectNotSuppressed",
      "사건 효과 유효",
      scheduled.culprit !== "blackCat",
      "사건 효과 유효",
      "검은 고양이로 사건 효과 없음",
    ),
  ];
}

function incidentDeathRoutes(
  state: GameState,
  target: CharacterId,
): LossRoute[] {
  return state.scenario.incidents.flatMap((scheduled) => {
    const common = incidentCommonRequirements(state, scheduled);
    const targetPosition = state.loop.board[target];
    const culpritPosition = state.loop.board[scheduled.culprit];
    const targetAlive = isCharacterAlive(targetPosition);
    const daysUntil = Math.max(0, scheduled.day - state.loop.day);
    const base = {
      when: incidentWhen(state, scheduled),
      available: incidentRouteAvailable(state, scheduled),
      daysUntil,
    };
    const incidentLabel = `${scheduled.day}일 ${INCIDENT_IMPL[scheduled.incident].ko}`;

    switch (scheduled.incident) {
      case "suicide":
        return scheduled.culprit === target
          ? [route(
            `death:incident:suicide:${scheduled.day}:${target}`,
            incidentLabel,
            "automatic",
            base.when,
            base.available,
            [...common, ...targetCanDieRequirements(state, target)],
            base.daysUntil,
          )]
          : [];
      case "murder": {
        const sameLocation = targetAlive && isCharacterAlive(culpritPosition) &&
          target !== scheduled.culprit &&
          characterLocation(targetPosition, target) ===
            characterLocation(culpritPosition, scheduled.culprit);
        return target === scheduled.culprit
          ? []
          : [route(
            `death:incident:murder:${scheduled.day}:${scheduled.culprit}:${target}`,
            `${incidentLabel} · 각본가 대상 선택`,
            "mastermind",
            base.when,
            base.available,
            [
              ...common,
              booleanRequirement(
                "sameLocationAsCulprit",
                "범인과 같은 장소",
                sameLocation,
                "범인과 같은 장소",
                "범인과 다른 장소",
              ),
              ...targetCanDieRequirements(state, target),
            ],
            base.daysUntil,
          )];
      }
      case "farawayMurder": {
        const intrigue = state.loop.charCounters[target].intrigue;
        return [route(
          `death:incident:farawayMurder:${scheduled.day}:${target}`,
          `${incidentLabel} · 각본가 대상 선택`,
          "mastermind",
          base.when,
          base.available,
          [
            ...common,
            requirement(
              "targetIntrigue",
              "대상 음모",
              intrigue,
              2,
              `대상 음모 ${intrigue}/2`,
            ),
            ...targetCanDieRequirements(state, target),
          ],
          base.daysUntil,
        )];
      }
      case "hospitalIncident": {
        const atHospital = targetAlive &&
          characterLocation(targetPosition, target) === "Hospital";
        const hospitalIntrigue = state.loop.locIntrigue.Hospital;
        return [route(
          `death:incident:hospitalIncident:${scheduled.day}:${target}`,
          `${incidentLabel} · 병원 전원 사망`,
          "automatic",
          base.when,
          base.available,
          [
            ...common,
            requirement(
              "hospitalIntrigueForDeath",
              "병원 음모",
              hospitalIntrigue,
              1,
              `병원 음모 ${hospitalIntrigue}/1`,
            ),
            booleanRequirement(
              "targetAtHospital",
              "대상이 병원에 있음",
              atHospital,
              "대상이 병원에 있음",
              "대상이 병원 밖에 있음",
            ),
            ...targetCanDieRequirements(state, target),
          ],
          base.daysUntil,
        )];
      }
      default:
        return [];
    }
  });
}

function alienGoodwillDeathRoutes(
  state: GameState,
  target: CharacterId,
): LossRoute[] {
  const alienPosition = state.loop.board.alien;
  if (
    target === "alien" ||
    alienPosition === undefined ||
    !isCharacterPresent(alienPosition)
  ) {
    return [];
  }
  const targetPosition = state.loop.board[target];
  const sameLocation = isCharacterAlive(alienPosition) &&
    isCharacterAlive(targetPosition) &&
    characterLocation(alienPosition, "alien") ===
      characterLocation(targetPosition, target);
  const goodwill = state.loop.charCounters.alien.goodwill;
  const useKey = "alien:goodwill:0";
  const used = state.loop.abilitiesUsedThisLoop.filter(
    (key) => key === useKey,
  ).length;
  const availableThisLoop = used < 1;
  const p6NotPassedForLoop = state.loop.day < state.scenario.daysPerLoop ||
    PHASE_ORDER.indexOf(state.loop.phase) <= PHASE_ORDER.indexOf("P6_GOODWILL");
  return [route(
    `death:goodwill:alien:${target}`,
    "이세계인 우호 4 · 주인공 선택",
    "protagonist",
    "주인공 우호 단계",
    futureRoundAvailable(state) && p6NotPassedForLoop,
    [
      booleanRequirement(
        "alienAlive",
        "이세계인 생존",
        isCharacterAlive(alienPosition),
        "이세계인 생존",
        "이세계인 사망/부재",
      ),
      requirement(
        "alienGoodwill",
        "이세계인 우호",
        goodwill,
        4,
        `이세계인 우호 ${goodwill}/4`,
      ),
      booleanRequirement(
        "sameLocationAsAlien",
        "이세계인과 같은 장소",
        sameLocation,
        "이세계인과 같은 장소",
        "이세계인과 다른 장소",
      ),
      booleanRequirement(
        "alienKillUnused",
        "우호 능력 미사용",
        availableThisLoop,
        "우호 4 사망 능력 미사용",
        "우호 4 사망 능력 사용 완료",
      ),
      ...targetCanDieRequirements(state, target),
    ],
  )];
}

function protectedCharacterDeathRoutes(
  state: GameState,
  target: CharacterId,
  includeKiller: boolean,
): LossRoute[] {
  if (isCharacterDead(state.loop.board[target])) {
    return [route(
      `death:current:${target}`,
      "현재 사망",
      "automatic",
      "현재",
      true,
      [booleanRequirement(
        "dead",
        "사망",
        true,
        "사망",
        "생존",
      )],
    )];
  }
  return [
    ...(includeKiller ? killerKeyPersonRoutes(state, target) : []),
    ...serialKillerDeathRoutes(state, target),
    ...incidentDeathRoutes(state, target),
    ...alienGoodwillDeathRoutes(state, target),
  ];
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
      const current = isCharacterDead(state.loop.board[character]) ? 1 : 0;
      const condition = distance({
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
      });
      condition.routes = protectedCharacterDeathRoutes(state, character, true);
      out.push(condition);
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
      const current = isCharacterDead(state.loop.board[character]) ? 1 : 0;
      const condition = distance({
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
      });
      condition.routes = protectedCharacterDeathRoutes(state, character, false);
      out.push(condition);
      continue;
    }

    if (role === "killer" && hookIndex === 1) {
      const current = state.loop.charCounters[character].intrigue;
      const condition = distance({
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
      });
      const keyPerson = actualKeyPerson(state);
      if (keyPerson !== undefined) {
        condition.routes = [
          ...condition.routes,
          ...killerKeyPersonRoutes(state, keyPerson).filter(
            ({ key }) => key.startsWith(`death:killer:${character}:`),
          ),
        ];
      }
      out.push(condition);
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
  const paranoiaNeeded = characterDataOf(scheduled.culprit).paranoiaLimit;
  const alive = isCharacterAlive(culpritPosition) ? 1 : 0;
  const paranoia = incidentParanoia(state, scheduled.culprit);
  const paranoiaLabel = scheduled.culprit === "ai"
    ? "범인 판정 불안"
    : "범인 불안";
  const hospitalIntrigue = state.loop.locIntrigue.Hospital;
  const notSuppressed = state.loop.incidentCulpritSuppressedFor?.includes(
    scheduled.culprit,
  ) ? 0 : 1;
  const effectValid = scheduled.culprit === "blackCat" ? 0 : 1;
  const label = `${scheduled.day}일 ${impl.ko}: ` +
    `범인 생존 ${alive}/1 · ${paranoiaLabel} ${paranoia}/${paranoiaNeeded} · ` +
    `발생 억제 없음 ${notSuppressed}/1 · 효과 유효 ${effectValid}/1 · ` +
    `병원 음모 ${hospitalIntrigue}/2`;

  const condition = distance({
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
      ...incidentCommonRequirements(state, scheduled),
      requirement("hospitalIntrigue", "병원 음모", hospitalIntrigue, 2,
        `병원 음모 ${hospitalIntrigue}/2`),
    ],
  });
  condition.routes = [route(
    `${condition.key}:protagonistDeath`,
    `${scheduled.day}일 ${impl.ko} · 주인공 사망`,
    "automatic",
    incidentWhen(state, scheduled),
    incidentRouteAvailable(state, scheduled),
    condition.requirements,
    Math.max(0, scheduled.day - state.loop.day),
  )];
  return [condition];
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
    if (!isCharacterPresent(state.loop.board[character])) continue;
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
