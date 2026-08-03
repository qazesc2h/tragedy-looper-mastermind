// 코어 타입 — 손으로 작성. 생성기가 덮어쓰지 않음.

import { characterDataOf } from "./data";

export type CharacterId = string;
export type RoleId = string;
export type PlotId = string;
export type IncidentId = string;

// ─────────────────────────────────────────────────────────── 게임판 기하
//   병원 │ 신사
//   ─────┼─────
//   도심 │ 학교
export type Location = "Hospital" | "Shrine" | "City" | "School";

export const LOCATIONS: Location[] = ["Hospital", "Shrine", "City", "School"];

/** 이동↑↓ */
export const VERTICAL: Record<Location, Location> = {
  Hospital: "City", City: "Hospital", Shrine: "School", School: "Shrine",
};
/** 이동←→ */
export const HORIZONTAL: Record<Location, Location> = {
  Hospital: "Shrine", Shrine: "Hospital", City: "School", School: "City",
};
/** 대각 이동 */
export const DIAGONAL: Record<Location, Location> = {
  Hospital: "School", School: "Hospital", Shrine: "City", City: "Shrine",
};

// ─────────────────────────────────────────────────────────── 라운드 단계
export type Phase =
  | "P1_ROUND_START"        // 라운드 시작   [각본가]
  | "P2_MASTERMIND_ACTION"  // 각본가 행동   [각본가]
  | "P3_PROTAGONIST_ACTION" // 주인공 행동   [주인공]
  | "P4_RESOLVE"            // 행동 해결     [각본가]
  | "P5_MASTERMIND_ABILITY" // 각본가 능력   [각본가]
  | "P6_GOODWILL"           // 주인공 능력   [주인공/각본가]
  | "P7_INCIDENT"           // 사건          [각본가]
  | "P8_LEADER_PASS"        // 리더 교대     [주인공]
  | "P9_ROUND_END";         // 라운드 종료   [각본가]

export const PHASE_ORDER: Phase[] = [
  "P1_ROUND_START", "P2_MASTERMIND_ACTION", "P3_PROTAGONIST_ACTION",
  "P4_RESOLVE", "P5_MASTERMIND_ABILITY", "P6_GOODWILL",
  "P7_INCIDENT", "P8_LEADER_PASS", "P9_ROUND_END",
];

/** 9단계 바깥에서 걸리는 훅 지점 */
export type HookPoint =
  | Phase
  | "ALWAYS" | "LOOP_START" | "LOOP_END" | "LAST_DAY"
  | "ON_DEATH" | "ON_REVEAL" | "FINAL_GUESS" | "SCRIPT_BUILD"
  | "UNKNOWN";

// ─────────────────────────────────────────────────────────── 행동 카드
export const ACTION_CARDS = [
  "moveVertical", "moveHorizontal", "moveDiagonal", "forbidMove",
  "paranoiaPlus1", "paranoiaMinus1", "forbidParanoia",
  "goodwillPlus1", "goodwillPlus2", "forbidGoodwill",
  "intriguePlus1", "intriguePlus2", "forbidIntrigue",
] as const;

export type ActionCard = typeof ACTION_CARDS[number];

export function isActionCard(value: string): value is ActionCard {
  return (ACTION_CARDS as readonly string[]).includes(value);
}

/** 카드를 놓을 수 있는 대상 */
export type Target =
  | { kind: "character"; id: CharacterId }
  | { kind: "location"; at: Location };

export interface PlacedCard {
  card: ActionCard;
  target: Target;
  owner: "mastermind" | 0 | 1 | 2;
}

// ─────────────────────────────────────────────────────────── 시나리오 (불변)
export interface Scenario {
  tragedySet: string;
  mainPlot: PlotId;
  subPlots: PlotId[];       // 입문 1, 기본 2
  cast: Record<CharacterId, RoleId>;
  incidents: ScheduledIncident[];
  loops: number;
  daysPerLoop: number;
  /** 하수인 시작 장소 등 각본가가 루프마다 지정하는 값 */
  scriptSpecified?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────── 진행 상태 (가변)
export interface Counters {
  goodwill: number;
  paranoia: number;
  intrigue: number;
}

export type IncidentCounter = keyof Counters;

export interface IncidentSelection {
  day: number;
  incident: IncidentId;
}

export interface ScheduledIncident extends IncidentSelection {
  culprit: CharacterId;
}

/** 임의 대상을 요구하는 사건 효과에 각본가가 제공하는 선택. */
export interface IncidentChoice {
  target?: CharacterId;
  otherTarget?: CharacterId;
  location?: Location;
  counter?: IncidentCounter;
}

export interface IncidentResult {
  incident?: IncidentId;
  culprit?: CharacterId;
  fired: boolean;
  effectApplied: boolean;
}

/** 이번 루프에 각본가가 주인공에게 전달해야 하는 공개·해결 결과. */
export type PublicInformation =
  | {
    kind: "incidentCulprit";
    source: "godlyBeing" | "policeOfficer";
    day: number;
    incident: IncidentId;
    culprit: CharacterId;
  }
  | {
    kind: "subplot";
    source: "informer";
    declaredSubplot: PlotId;
    revealedSubplot: PlotId;
  }
  | {
    kind: "incidentEffect";
    source: "ai";
    day: number;
    incident: IncidentId;
    culprit: CharacterId;
    effectApplied: boolean;
  };

export interface LoopState {
  loop: number;
  day: number;
  phase: Phase;
  leader: 0 | 1 | 2;

  board: Record<CharacterId, { at: Location; alive: boolean }>;
  charCounters: Record<CharacterId, Counters & { protection: number }>;
  locIntrigue: Record<Location, number>;

  /** 「1루프당 1회」 소진 추적 — 각본가 인지 부하의 핵심 */
  spentOncePerLoop: {
    mastermind: ActionCard[];
    protagonists: [ActionCard[], ActionCard[], ActionCard[]];
  };
  /** "shrineMaiden:goodwill:1" 같은 1루프당 1회 우호 능력 */
  abilitiesUsedThisLoop: string[];

  /** 우호 능력으로 이번 루프 동안 금지 장소가 해제된 캐릭터 */
  locationRestrictionsRemoved?: CharacterId[];

  /** 이번 라운드에 놓인 카드 (P4에서 소비) */
  placed: PlacedCard[];

  /** 이번 P4에서 음모 금지 무시 능력을 발동한 광신도 */
  cultistsIgnoringForbidIntrigue?: CharacterId[];

  /** 이번 P4에서 자신의 우호 금지를 무시하는 시간 여행자 */
  timeTravelersIgnoringForbidGoodwill?: CharacterId[];

  /** 이번 루프에 역할이 공개된 캐릭터 */
  revealedRoleCharacters?: CharacterId[];

  /** 이번 루프에 실제로 발생한 사건. 효과가 없었어도 기록한다. */
  incidentsFiredThisLoop?: IncidentId[];

  /** 같은 사건이 여러 번 예정된 경우도 구분하는 실제 발생 기록. */
  incidentOccurrencesFiredThisLoop?: ScheduledIncident[];

  /** 이번 루프에 우호 능력으로 공개했거나 별도로 해결한 정보. */
  publicInformationThisLoop?: PublicInformation[];

  /** 현재 라운드에 각본가가 발동하기로 한 [선택] 패배 조건 */
  optionalLossActivations?: Record<string, boolean>;

  /** 특수 게이지 (기본편 미사용, 확장 대비) */
  specialGauge?: number;
}

export interface GameState {
  scenario: Scenario;
  loop: LoopState;
  /** 루프 종료 시점 스냅샷 — 인과율(threadsFate) 등 루프 간 참조에 필요 */
  history: LoopState[];
}

// ─────────────────────────────────────────────────────────── 훅
export interface Hook {
  phase: HookPoint;
  kind: "mandatory" | "optional" | "lossTragedy" | "lossDeath" | "scriptBuild";
  timesPerLoop?: number;
  /** 원본 영문 (수정 금지) — 구현 검증용 근거 */
  source: { timing: string; prerequisite?: string; description?: string };
  when: (s: GameState, self: CharacterId) => boolean;
  /** 동시 해결 전에 확정해야 하는 효과 대상 */
  effectTarget?: (s: GameState, self: CharacterId) => Target | undefined;
  effect: (
    s: GameState,
    self: CharacterId,
    target?: Target,
  ) => void | RoleId;
}

export interface IncidentHook extends Omit<Hook, "effect" | "effectTarget"> {
  effect: (
    s: GameState,
    culprit: CharacterId,
    choice?: IncidentChoice,
  ) => boolean;
}

// ─────────────────────────────────────────────────────────── 파생 조회
/**
 * 역할은 상수가 아니라 상태의 함수다.
 * 망상 확대 바이러스(paranoiaVirus): 엑스트라 + 불안 3개 이상 → 연쇄 살인마
 * 반드시 이 함수를 통해서만 역할을 읽을 것. scenario.cast 직접 참조 금지.
 */
export function effectiveRole(s: GameState, c: CharacterId): RoleId {
  const base = s.scenario.cast[c];
  // SOURCE: src/impl/plots.ts paranoiaVirus 훅의 source 참조
  if (
    s.scenario.subPlots.includes("paranoiaVirus") &&
    base === "person" &&
    s.loop.charCounters[c].paranoia >= 3
  ) {
    return "serialKiller";
  }
  return base;
}

/**
 * 장소 X 해석. 룰마다 참조 대상이 다르고, 하수인이 맡으면 루프마다 바뀐다.
 *   복수자의 등불(lightAvenger) → 흑막의 시작 장소
 *   거대 시한폭탄 X(giantTimeBomb) → 마녀의 시작 장소
 */
export function resolvePlaceX(s: GameState): Location | undefined {
  const roleOfPlaceX: Record<PlotId, RoleId> = {
    lightAvenger: "brain",
    giantTimeBomb: "witch",
  };
  const plots = [s.scenario.mainPlot, ...s.scenario.subPlots];
  for (const p of plots) {
    const want = roleOfPlaceX[p];
    if (!want) continue;
    const holder = Object.keys(s.scenario.cast).find(
      (c) => effectiveRole(s, c) === want,
    );
    if (!holder) continue;
    return startLocationOf(holder, s.scenario);
  }
  return undefined;
}

/** data/characters.json의 시작 장소를 시나리오 지정값과 함께 해석한다. */
export function startLocationOf(
  c: CharacterId,
  scenario?: Scenario,
): Location {
  const choices = characterDataOf(c).startLocation;
  if (choices.length === 1) {
    return choices[0];
  }

  const key = `startLocation:${c}`;
  const selected = scenario?.scriptSpecified?.[key];
  if (selected === undefined) {
    throw new Error(
      `start location for "${c}" must be provided as ` +
      `scenario.scriptSpecified["${key}"]; allowed: ${choices.join(", ")}`,
    );
  }

  const location = choices.find((choice) => choice === selected);
  if (!location) {
    throw new Error(
      `invalid start location for "${c}" in ` +
      `scenario.scriptSpecified["${key}"]; allowed: ${choices.join(", ")}`,
    );
  }
  return location;
}
