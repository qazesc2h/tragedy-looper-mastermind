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

// ─────────────────────────────────────────────────────────── 게임 전체 단계
/** 9단계 라운드를 감싸는 게임/루프 수준 상태 머신. */
export type GamePhase =
  | "SETUP_SCENARIO"
  | "SETUP_REVEAL"
  | "SETUP_STAGE"
  | "SETUP_LEADER"
  | "LOOP_TIME_GAP"
  | "LOOP_CHARACTER_PLACEMENT"
  | "LOOP_COUNTER_SETUP"
  | "LOOP_CARD_DISTRIBUTION"
  | "ROUND"
  | "LOOP_JUDGMENT"
  | "FINAL_GUESS"
  | "GAME_OVER";

export type LoopEndReason = "lastDay" | "effect" | "protagonistDeath";

export interface LoopEndRequest {
  reason: LoopEndReason;
  day: number;
  phase: Phase;
  lossKeys: string[];
}

export interface RecordedLoss {
  key: string;
  id: string;
  ko: string;
  label: string;
}

export interface LoopOutcome {
  loop: number;
  day: number;
  reason: LoopEndReason;
  result: "protagonistsWon" | "protagonistsLost";
  losses: RecordedLoss[];
}

export interface FinalGuessAttempt {
  character: CharacterId;
  guessedRole: RoleId;
  actualRole: RoleId;
  correct: boolean;
}

export interface FinalGuessState {
  reason: "timeGap" | "finalLoopLoss";
  attempts: FinalGuessAttempt[];
}

export interface GameResult {
  winner: "mastermind" | "protagonists";
  reason:
    | "loopVictory"
    | "allLoopsLost"
    | "finalGuessFailure"
    | "finalGuessSuccess";
}

/** 9단계 바깥에서 걸리는 훅 지점 */
export type HookPoint =
  | Phase
  | "ALWAYS" | "LOOP_CHARACTER_PLACEMENT" | "LOOP_START"
  | "P1_CHARACTER_ENTRY" | "LOOP_END" | "LAST_DAY"
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
  /** 원본 difficultySets에서 선택한 항목과 표시용 난이도 */
  difficultyIndex?: number;
  difficulty?: number;
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

export type BoardCharacterState =
  | { status: "absent"; at?: never }
  | { status: "alive"; at: Location }
  | { status: "dead"; at: Location };

export type PresentBoardCharacterState = Exclude<
  BoardCharacterState,
  { status: "absent" }
>;

export function isCharacterPresent(
  position: BoardCharacterState,
): position is PresentBoardCharacterState {
  return position.status !== "absent";
}

export function isCharacterAlive(
  position: BoardCharacterState,
): position is Extract<BoardCharacterState, { status: "alive" }> {
  return position.status === "alive";
}

export function isCharacterDead(
  position: BoardCharacterState,
): position is Extract<BoardCharacterState, { status: "dead" }> {
  return position.status === "dead";
}

export function characterLocation(
  position: BoardCharacterState,
  character?: CharacterId,
): Location {
  if (!isCharacterPresent(position)) {
    const suffix = character === undefined ? "" : ` \"${character}\"`;
    throw new Error(`absent character${suffix} has no location`);
  }
  return position.at;
}

export function withCharacterLocation(
  position: BoardCharacterState,
  at: Location,
  character?: CharacterId,
): PresentBoardCharacterState {
  if (!isCharacterPresent(position)) {
    const suffix = character === undefined ? "" : ` \"${character}\"`;
    throw new Error(`cannot move absent character${suffix}`);
  }
  return { ...position, at };
}

export function withCharacterLife(
  position: BoardCharacterState,
  alive: boolean,
  character?: CharacterId,
): PresentBoardCharacterState {
  if (!isCharacterPresent(position)) {
    const suffix = character === undefined ? "" : ` \"${character}\"`;
    throw new Error(`cannot change life state of absent character${suffix}`);
  }
  return { status: alive ? "alive" : "dead", at: position.at };
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

/** 원인을 숨긴 채 주인공도 확인할 수 있는 게임판 변화. */
export type PublicBoardChange =
  | {
    kind: "counter";
    target: Target;
    counter: keyof Counters | "protection";
    delta: number;
  }
  | {
    kind: "movement";
    character: CharacterId;
    from: Location;
    to: Location;
  }
  | {
    kind: "status";
    character: CharacterId;
    from: BoardCharacterState["status"];
    to: BoardCharacterState["status"];
  };

/** 능력 발동 시점에 주인공도 확인할 수 있었던 공개 게임판 상태. */
export interface PublicObservationContext {
  locationIntrigue: Record<Location, number>;
}

/** 능력의 정체를 밝히지 않고 공개된 직전 사건만 보존한다. */
export type PublicAbilityTrigger = {
  kind: "death";
  deadCharacters: CharacterId[];
};

export type IncidentFailureReason =
  | "culpritAbsent"
  | "culpritDead"
  | "insufficientParanoia"
  | "culpritSuppressed";

/** 자동 통과와 판정 결과를 각본가가 나중에도 확인할 수 있는 라운드 기록. */
export type PhaseLogEntry =
  | {
    loop: number;
    day: number;
    phase: Phase;
    kind: "notApplicable";
  }
  | {
    loop: number;
    day: number;
    phase: "P1_ROUND_START";
    kind: "phaseCompleted";
  }
  | {
    loop: number;
    day: number;
    phase: "P2_MASTERMIND_ACTION" | "P3_PROTAGONIST_ACTION";
    kind: "cardsPlaced";
    placements: PlacedCard[];
  }
  | {
    loop: number;
    day: number;
    phase: "P4_RESOLVE";
    kind: "actionResolved";
    results: string[];
  }
  | {
    loop: number;
    day: number;
    phase: Phase;
    kind: "abilityActivated";
    /** 실제 훅 시점. 구 저장의 P5 기록에는 없을 수 있다. */
    timing?: HookPoint;
    /** 역할명 대신 주인공도 본 직전 사건만 기록한다. */
    publicTrigger?: PublicAbilityTrigger;
    /** 캐릭터 역할 능력일 때만 존재한다. 룰 능력은 추가 규칙으로 표시한다. */
    character?: CharacterId;
    description: string;
    /** 능력의 정체는 숨기고 게임판에서 관측된 결과만 보존한다. */
    publicChanges?: PublicBoardChange[];
    /** 조건부 역할 능력을 판정하기 위한 발동 직전 공개 상태. */
    publicContext?: PublicObservationContext;
  }
  | {
    loop: number;
    day: number;
    phase: "P5_MASTERMIND_ABILITY";
    kind: "abilitySkipped";
  }
  | {
    loop: number;
    day: number;
    phase: "P6_GOODWILL";
    kind: "goodwillUsed";
    character: CharacterId;
    rank: number;
    abilityIndex: number;
    response: "resolve" | "refuse";
    effectApplied: boolean;
  }
  | {
    loop: number;
    day: number;
    phase: "P6_GOODWILL";
    kind: "goodwillSkipped";
  }
  | {
    loop: number;
    day: number;
    phase: "P7_INCIDENT";
    kind: "incidentJudged";
    incident: IncidentId;
    culprit: CharacterId;
    fired: boolean;
    effectApplied: boolean;
    failureReasons: IncidentFailureReason[];
    /** 사건 해결 중 새로 사망한 캐릭터. 예전 저장 기록에는 없을 수 있다. */
    deaths?: CharacterId[];
    /** 사건 해결 중 주인공 사망이 실제 요청되었는지 여부. */
    protagonistsDied?: boolean;
  }
  | {
    loop: number;
    day: number;
    phase: "P8_LEADER_PASS";
    kind: "leaderPassed";
    from: 0 | 1 | 2;
    to: 0 | 1 | 2;
  }
  | {
    loop: number;
    day: number;
    phase: "P9_ROUND_END";
    kind: "roundEnded";
    loopEnded: boolean;
  };

/** 이번 루프에 각본가가 주인공에게 전달해야 하는 공개·해결 결과. */
export type PublicInformation =
  | {
    kind: "roleReveal";
    character: CharacterId;
    role: RoleId;
    loop: number;
    day: number;
  }
  | {
    kind: "goodwillRefusal";
    character: CharacterId;
    rank: number;
    abilityIndex: number;
    loop: number;
    day: number;
  }
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

  board: Record<CharacterId, BoardCharacterState>;
  /** 거물의 세력권 카운터가 놓인 장소. 실제 캐릭터 위치와 독립적이다. */
  turfLocations: Partial<Record<CharacterId, Location>>;
  charCounters: Record<CharacterId, Counters & { protection: number }>;
  locIntrigue: Record<Location, number>;

  /** 「1루프당 1회」 소진 추적 — 각본가 인지 부하의 핵심 */
  spentOncePerLoop: {
    mastermind: ActionCard[];
    protagonists: [ActionCard[], ActionCard[], ActionCard[]];
  };
  /** "shrineMaiden:goodwill:1" 같은 1루프당 1회 우호 능력 */
  abilitiesUsedThisLoop: string[];
  /** 같은 우호 능력은 횟수 제한 표기와 무관하게 한 라운드에 한 번만 쓴다. */
  abilitiesUsedThisRound: string[];

  /** 우호 능력으로 이번 루프 동안 금지 장소가 해제된 캐릭터 */
  locationRestrictionsRemoved?: CharacterId[];

  /** 이번 라운드에 놓인 카드 (P4에서 소비) */
  placed: PlacedCard[];

  /** P4 안에서 카드 공개·효과 해결을 마치고 결과 확인을 기다리는 상태 */
  actionResolutionComplete: boolean;

  /** 자동 통과·사건 판정·리더 교대 기록 */
  phaseLog?: PhaseLogEntry[];

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

  /** 이 캐릭터가 범인인 사건은 이번 루프 동안 발생하지 않는다. */
  incidentCulpritSuppressedFor?: CharacterId[];

  /** 이 캐릭터의 지속 효과가 이번 루프 동안 주인공 사망을 막는다. */
  protagonistDeathPreventedBy?: CharacterId[];

  /** 이번 루프에 우호 능력으로 공개했거나 별도로 해결한 정보. */
  publicInformationThisLoop?: PublicInformation[];

  /** 현재 라운드에 각본가가 발동하기로 한 [선택] 패배 조건 */
  optionalLossActivations?: Record<string, boolean>;

  /** P9의 동시 [강제] 효과를 판정·적용한 뒤 [선택] 입력을 기다리는 상태 */
  roundEndMandatoryResolved?: boolean;

  /** 현재 정규 효과 묶음에서 새로 성립한 즉시 종료 조건 */
  pendingImmediateLossKeys?: string[];

  /** 루프 시작 전에 각본가가 고른 캐릭터 특성의 카운터 종류 */
  loopStartTraitCounterChoices?: Partial<
    Record<CharacterId, IncidentCounter>
  >;

  /** 하수인처럼 루프마다 각본가가 고르는 캐릭터 시작 장소 */
  loopStartTraitLocationChoices?: Partial<
    Record<CharacterId, Location>
  >;

  /** 특수 게이지 (기본편 미사용, 확장 대비) */
  specialGauge?: number;
}

/** UI 작업 실패 시 롤백된 안전 상태와 오류 메시지를 함께 보존한다. */
export interface RuntimeErrorRecord {
  occurredAt: string;
  action: string;
  message: string;
  gamePhase: GamePhase;
  loop: LoopState;
  pendingLoopEnd?: LoopEndRequest;
}

export interface GameState {
  scenario: Scenario;
  gamePhase: GamePhase;
  loop: LoopState;
  /** 루프 종료 시점 스냅샷 — 인과율(threadsFate) 등 루프 간 참조에 필요 */
  history: LoopState[];
  /** 이미 판정이 끝난 루프의 결과. 게임 종료 뒤에도 회고용으로 보존한다. */
  loopOutcomes: LoopOutcome[];
  /** 최종 루프 뒤 시작한 공개 하우스 룰 추가 루프 횟수 */
  extraLoopsPlayed?: number;
  /** 효과 해결 중 발생한 종료 신호. 동시 해결이 끝날 때까지 적용을 미룬다. */
  pendingLoopEnd?: LoopEndRequest;
  /** 최근 UI/단계 처리 오류. 현재 상태 복사 진단 정보에 포함한다. */
  runtimeErrors?: RuntimeErrorRecord[];
  finalGuess?: FinalGuessState;
  result?: GameResult;
  /** 시간의 틈 권장 10분 타이머. 실행 중이면 endsAt으로 남은 시간을 계산한다. */
  timeGapTimer?: {
    remainingSeconds: number;
    endsAt?: string;
  };
}

// ─────────────────────────────────────────────────────────── 훅
export interface DeathHookContext {
  kind: "death";
  /** 같은 원자적 효과 묶음에서 실제로 사망한 캐릭터들 */
  deadCharacters: readonly CharacterId[];
}

export type HookContext = DeathHookContext;

export interface Hook {
  phase: HookPoint;
  kind: "mandatory" | "optional" | "lossTragedy" | "lossDeath" | "scriptBuild";
  timesPerLoop?: number;
  /** 원본 영문 (수정 금지) — 구현 검증용 근거 */
  source: { timing: string; prerequisite?: string; description?: string };
  when: (
    s: GameState,
    self: CharacterId,
    context?: HookContext,
  ) => boolean;
  /** 선택형 훅이 사용자에게 요구하는 합법 대상. 없으면 발동 여부만 선택한다. */
  selectableTargets?: (s: GameState, self: CharacterId) => Target[];
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

/** 각본이 지정한 캐릭터의 세력권 장소를 엄격하게 읽는다. */
export function scenarioTurfLocation(
  scenario: Scenario,
  character: CharacterId,
): Location | undefined {
  if (!(character in scenario.cast)) return undefined;

  const key = `Turf:${character}`;
  const selected = scenario.scriptSpecified?.[key];
  const location = LOCATIONS.find((candidate) => candidate === selected);
  if (location === undefined) {
    throw new Error(
      `turf for "${character}" must be provided as ` +
      `scenario.scriptSpecified["${key}"]; allowed: ${LOCATIONS.join(", ")}`,
    );
  }
  return location;
}

/** 사건을 제외한 능력에서 이 캐릭터로 취급할 수 있는 장소들. */
export function abilityLocationsOf(
  state: GameState,
  character: CharacterId,
): Location[] {
  const actual = characterLocation(state.loop.board[character], character);
  const turf = state.loop.turfLocations[character];
  return turf !== undefined && turf !== actual ? [actual, turf] : [actual];
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
    if (holder === "henchman") {
      return s.loop.loopStartTraitLocationChoices?.henchman;
    }
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

export type CharacterEntryTiming =
  | { kind: "loop"; value: number }
  | { kind: "day"; value: number };

/** 각본에 지정된 신·전학생의 비공개 등장 시점을 반환한다. */
export function characterEntryTiming(
  scenario: Scenario,
  character: CharacterId,
): CharacterEntryTiming | undefined {
  const kind = character === "godlyBeing"
    ? "loop"
    : character === "transferStudent"
    ? "day"
    : undefined;
  if (kind === undefined) return undefined;

  const value = scenario.scriptSpecified?.[
    `enters on ${kind}:${character}`
  ];
  return typeof value === "number" ? { kind, value } : undefined;
}
