// 코어 타입 — 손으로 작성. 생성기가 덮어쓰지 않음.

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
export type ActionCard =
  | "moveVertical" | "moveHorizontal" | "moveDiagonal" | "forbidMove"
  | "paranoiaPlus1" | "paranoiaMinus1" | "forbidParanoia"
  | "goodwillPlus1" | "goodwillPlus2" | "forbidGoodwill"
  | "intriguePlus1" | "intriguePlus2" | "forbidIntrigue";

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
  incidents: { day: number; incident: IncidentId; culprit: CharacterId }[];
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
  /** "shrineMaiden:revealRole" 같은 1루프당 1회 우호 능력 */
  abilitiesUsedThisLoop: string[];

  /** 이번 라운드에 놓인 카드 (P4에서 소비) */
  placed: PlacedCard[];

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
  effect: (s: GameState, self: CharacterId) => void;
}

// ─────────────────────────────────────────────────────────── 파생 조회
/**
 * 역할은 상수가 아니라 상태의 함수다.
 * 망상 확대 바이러스(paranoiaVirus): 엑스트라 + 불안 3개 이상 → 연쇄 살인마
 * 반드시 이 함수를 통해서만 역할을 읽을 것. scenario.cast 직접 참조 금지.
 */
export function effectiveRole(s: GameState, c: CharacterId): RoleId {
  const base = s.scenario.cast[c];
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
      (c) => s.scenario.cast[c] === want,
    );
    if (!holder) continue;
    // 하수인은 각본가가 매 루프 시작 장소를 지정 → scriptSpecified 참조
    const override = s.scenario.scriptSpecified?.[`startLocation:${holder}`];
    return (override as Location) ?? startLocationOf(holder);
  }
  return undefined;
}

/** data/characters.json 에서 읽어와 주입할 것 */
export declare function startLocationOf(c: CharacterId): Location;
