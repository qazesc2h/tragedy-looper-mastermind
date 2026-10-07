// ⚠️ 자동 생성 스캐폴딩 — 구조는 생성기가, 로직은 사람이.
//    재생성해도 when/effect 는 덮어쓰지 않도록 주의할 것.
//    source 는 원본 영문 텍스트(수정 금지). ko 는 정발 용어.

import {
  characterLocation,
  effectiveRole,
  isCharacterAlive,
  LOCATIONS,
} from "../types";
import type { GameState, CharacterId, Hook, Target } from "../types";
import { placeExtraCard } from "../engine/extra-cards";
import { adjustSpecialGauge } from "../engine/special-gauge";

const UNSETTLING_RUMOR_USE_KEY = "unsettlingRumor:plot:0";
const UNSAFE_TRIGGER_USE_KEY = "unsafeTrigger:plot:0";

function unsettlingRumorAvailable(state: GameState): boolean {
  return !state.loop.abilitiesUsedThisLoop.includes(
    UNSETTLING_RUMOR_USE_KEY,
  );
}

function charactersWithGoodwillLastLoop(
  state: GameState,
): CharacterId[] {
  const previousLoop = state.history.at(-1);
  if (!previousLoop) return [];

  return Object.entries(previousLoop.charCounters)
    .filter(([, counters]) => counters.goodwill >= 1)
    .map(([character]) => character);
}

function charactersWhoDiedLastLoop(state: GameState): CharacterId[] {
  const previousLoop = state.history.at(-1);
  if (previousLoop === undefined) return [];
  return Object.entries(previousLoop.board)
    .filter(([, position]) => position.status === "dead")
    .map(([character]) => character);
}

function loopStartExtraCardTarget(
  state: GameState,
  plot: "fatedConnections" | "diceOfGods",
): Target | undefined {
  const character = state.loop.loopStartExtraCardChoices?.[plot];
  return character === undefined ? undefined : { kind: "character", id: character };
}

function placePlotExtraCard(
  state: GameState,
  plot: "fatedConnections" | "diceOfGods",
  target?: Target,
): void {
  if (
    target?.kind !== "character" ||
    !charactersWhoDiedLastLoop(state).includes(target.id)
  ) {
    throw new Error(`${plot} requires a character who died last loop`);
  }
  placeExtraCard(state.loop, {
    instanceId: `${plot}:${state.loop.loop}`,
    cardId: plot,
    controller: "mastermind",
    source: { kind: "rule", id: plot },
    target: { kind: "character", id: target.id },
    expiresAt: "loopStart",
  });
}

/** 입문편·기본편 룰(플롯) — 총 16건 */
export const PLOT_IMPL: Record<string, {
  ko: string;
  goodwillRefusal?: 'Optional' | 'Mandatory';
  max?: number;
  tags?: string[];
  addsRoles?: Record<string, number | [number, number]>;
  hooks: Hook[];
}> = {
  // ── 살인 계획 (Murder Plan)
  murderPlan: {
    ko: "살인 계획",
    addsRoles: {"keyPerson": 1, "killer": 1, "brain": 1},
    hooks: [], // 능력 없음
  },
  // ── 복수자의 등불 (Light of the Avenger)
  lightAvenger: {
    ko: "복수자의 등불",
    addsRoles: {"brain": 1},
    hooks: [
      {
        phase: "LOOP_END",
        kind: "lossTragedy",
        source: {
          timing: "Loop End",
          prerequisite: `2 :intrigue: on the :brain:’s starting location`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/loss.ts evaluateLoss()
        // 이 훅은 원문 보존용이다. 여기에 로직을 넣지 마라 — 이중 구현이 된다.
        when: () => false,
        effect: () => {},
      },
    ],
  },
  // ── 지켜야 할 장소 (A Place to Protect)
  placeProtect: {
    ko: "지켜야 할 장소",
    addsRoles: {"keyPerson": 1, "cultist": 1},
    hooks: [
      {
        phase: "LOOP_END",
        kind: "lossTragedy",
        source: {
          timing: "Loop End",
          prerequisite: `2 :intrigue: on the School.`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/loss.ts evaluateLoss()
        // 이 훅은 원문 보존용이다. 여기에 로직을 넣지 마라 — 이중 구현이 된다.
        when: () => false,
        effect: () => {},
      },
    ],
  },
  // ── 봉인된 것 (The Sealed Item)
  sealedItem: {
    ko: "봉인된 것",
    addsRoles: {"brain": 1, "cultist": 1},
    hooks: [
      {
        phase: "LOOP_END",
        kind: "lossTragedy",
        source: {
          timing: "Loop End",
          prerequisite: `2 :intrigue: on the Shrine.`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/loss.ts evaluateLoss()
        // 이 훅은 원문 보존용이다. 여기에 로직을 넣지 마라 — 이중 구현이 된다.
        when: () => false,
        effect: () => {},
      },
    ],
  },
  // ── 비밀 기록 (Secret Record)
  secretRecord: {
    ko: "비밀 기록",
    addsRoles: {"keyPerson": 1, "brain": 1, "conspiracyTheorist": 1},
    hooks: [
      {
        phase: "LOOP_END",
        kind: "lossTragedy",
        source: {
          timing: "Loop End",
          prerequisite: `If the Brain, Factor, or Magician were revealed during this loop, the Protagonists lose.`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/loss.ts evaluateLoss()
        when: () => false,
        effect: () => {},
      },
    ],
  },
  // ── 뻗쳐오는 마수 (The Devil's Hand)
  devilsHand: {
    ko: "뻗쳐오는 마수",
    addsRoles: {"keyPerson": 1, "cultist": 1, "ninja": 1},
    hooks: [],
  },
  // ── 사나이의 싸움 (Male Confrontation)
  maleConfrontation: {
    ko: "사나이의 싸움",
    addsRoles: {"ninja": 1},
    hooks: [
      {
        phase: "LOOP_END",
        kind: "lossTragedy",
        source: {
          timing: "Loop End",
          prerequisite: `The :ninja: (or its corpse) has at least 2 :intrigue: counters.`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/loss.ts evaluateLoss()
        when: () => false,
        effect: () => {},
      },
      {
        phase: "SCRIPT_BUILD",
        kind: "scriptBuild",
        source: {
          timing: "Script Creation",
          description: `The :ninja: (for this plot) must have the tag man.`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/validate.ts validateScenario()
        when: () => false,
        effect: () => {},
      },
    ],
  },
  // ── 인과의 인연 (Fated Connections)
  fatedConnections: {
    ko: "인과의 인연",
    addsRoles: {"conspiracyTheorist": 1, "friend": 1, "serialKiller": 1},
    hooks: [
      {
        phase: "LOOP_START",
        kind: "mandatory",
        source: {
          timing: "Loop Start",
          prerequisite: `A Character died the last turn.`,
          description: `Chose one of those. Plac any Extra Card on that character. Character(s) with an Extra card has their role changed into a :keyPerson:.`,
        },
        when: (s: GameState) => charactersWhoDiedLastLoop(s).length > 0,
        effectTarget: (s: GameState) =>
          loopStartExtraCardTarget(s, "fatedConnections"),
        effect: (s: GameState, _self: CharacterId, target?: Target) => {
          placePlotExtraCard(s, "fatedConnections", target);
        },
      },
    ],
  },
  // ── 외줄 위에서의 계획 (Tightrope Plan)
  tightropePlan: {
    ko: "외줄 위에서의 계획",
    addsRoles: {"brain": 1, "killer": 1},
    hooks: [{
      phase: "LOOP_END",
      kind: "lossTragedy",
      source: {
        timing: "Loop End",
        prerequisite: `The Extra Gauge is 1 or lower.`,
      },
      // IMPLEMENTED_ELSEWHERE: src/engine/loss.ts evaluateLoss()
      when: () => false,
      effect: () => {},
    }],
  },
  // ── 스트리크닌 한 방울 (A Drop of Strychnine)
  dropStrychnine: {
    ko: "스트리크닌 한 방울",
    addsRoles: {"keyPerson": 1, "poisoner": 1, "fool": 1},
    hooks: [{
      phase: "P7_INCIDENT",
      kind: "mandatory",
      source: {
        timing: "Incident step",
        description: `When determining whether ":serialMurde:," or ":suicide:" triggers, count :intrigue: counters also as :paranoia: counters.`,
      },
      // IMPLEMENTED_ELSEWHERE: src/engine/incident.ts incidentParanoia()
      when: () => false,
      effect: () => {},
    }],
  },
  // ── 누벼 엮은 사건 퀼트 (A Quilt of Incidents)
  quiltIncidents: {
    ko: "누벼 엮은 사건 퀼트",
    addsRoles: {"fool": 1, "conspiracyTheorist": 1},
    hooks: [{
      phase: "LOOP_END",
      kind: "lossTragedy",
      source: {
        timing: "Loop End",
        prerequisite: `The Extra Gauge is 3 or more.`,
      },
      // IMPLEMENTED_ELSEWHERE: src/engine/loss.ts evaluateLoss()
      when: () => false,
      effect: () => {},
    }],
  },
  // ── 검은 학교 (The Black School)
  blackSchool: {
    ko: "검은 학교",
    addsRoles: {"brain": 1},
    hooks: [{
      phase: "LOOP_END",
      kind: "lossTragedy",
      source: {
        timing: "Loop End",
        prerequisite: `There are more than X :intrigue: counters on the School, X is 1 less than the current loop number.`,
      },
      // IMPLEMENTED_ELSEWHERE: src/engine/loss.ts evaluateLoss()
      when: () => false,
      effect: () => {},
    }],
  },
  // ── 어리석은 자의 춤 (Dance of Fools)
  danceFools: {
    ko: "어리석은 자의 춤",
    addsRoles: {"friend": 1, "fool": 1},
    hooks: [],
  },
  // ── 격리 병동 사이코 (Isolated Institution Psycho)
  isolatedInstitutionPsycho: {
    ko: "격리 병동 사이코",
    addsRoles: {"conspiracyTheorist": 1, "therapist": 1, "paranoiac": 1},
    hooks: [{
      phase: "LOOP_START",
      kind: "mandatory",
      source: {
        timing: "Loop Start",
        prerequisite: `The Extra Gauge was 2 or less at the end of the previous loop`,
        description: `Increase it by 1.`,
      },
      when: (s: GameState) =>
        (s.history.at(-1)?.specialGauge?.value ?? Number.POSITIVE_INFINITY) <= 2,
      effect: (s: GameState) => {
        if (s.loop.specialGauge === undefined) {
          throw new Error("isolatedInstitutionPsycho requires a special gauge");
        }
        adjustSpecialGauge(s.loop.specialGauge, 1);
      },
    }],
  },
  // ── 절대적인 의지 (An Absolute Will)
  anAbsoluteWill: {
    ko: "절대적인 의지",
    addsRoles: {"obstinate": 1},
    hooks: [],
  },
  // ── 쌍둥이 트릭 (Tricky Twins)
  trickyTwins: {
    ko: "쌍둥이 트릭",
    addsRoles: {"twin": 1, "paranoiac": 1},
    hooks: [],
  },
  // ── 화약의 향기 (Smell of Gunpowder)
  smellGunpowder: {
    ko: "화약의 향기",
    addsRoles: {"serialKiller": 1},
    hooks: [{
      phase: "LOOP_END",
      kind: "lossTragedy",
      source: {
        timing: "Loop End",
        prerequisite: `There are a total of 12 or more :paranoia: counters on the remaining charactrs.`,
      },
      // IMPLEMENTED_ELSEWHERE: src/engine/loss.ts evaluateLoss()
      when: () => false,
      effect: () => {},
    }],
  },
  // ── 나는 명탐정 (I am a Master Detective)
  masterDetective: {
    ko: "나는 명탐정",
    addsRoles: {"conspiracyTheorist": 1, "friend": 1, "privateInvestigator": 1},
    hooks: [],
  },
  // ── 나와 계약하자! (Sign with me!)
  signWithMe: {
    ko: "나와 계약하자!",
    addsRoles: {"keyPerson": 1},
    hooks: [
      {
        phase: "ALWAYS",
        kind: "scriptBuild",
        source: {
          timing: "Always",
          description: `:keyPerson: must be a :girl:.`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/validate.ts validateScenario()
        // SCRIPT_BUILD: 런타임 훅 아님.
        // 이 훅은 원문 보존용이다. 런타임 로직을 넣지 않는다.
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => {},
      },
      {
        phase: "LOOP_END",
        kind: "lossTragedy",
        source: {
          timing: "Loop End",
          prerequisite: `2 :intrigue: on the :keyPerson:.`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/loss.ts evaluateLoss()
        // 이 훅은 원문 보존용이다. 여기에 로직을 넣지 마라 — 이중 구현이 된다.
        when: () => false,
        effect: () => {},
      },
    ],
  },
  // ── 미래 변경 계획 (Change of Future)
  changeOfFuture: {
    ko: "미래 변경 계획",
    addsRoles: {"cultist": 1, "timeTraveler": 1},
    hooks: [
      {
        phase: "LOOP_END",
        kind: "lossTragedy",
        source: {
          timing: "Loop End",
          prerequisite: `˝:butterflyEffect:˝ has occured this loop.`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/loss.ts evaluateLoss()
        // 이 훅은 원문 보존용이다. 여기에 로직을 넣지 마라 — 이중 구현이 된다.
        when: () => false,
        effect: () => {},
      },
    ],
  },
  // ── 거대 시한폭탄 X의 존재 (Giant Time Bomb)
  giantTimeBomb: {
    ko: "거대 시한폭탄 X의 존재",
    addsRoles: {"witch": 1},
    hooks: [
      {
        phase: "LOOP_END",
        kind: "lossTragedy",
        source: {
          timing: "Loop End",
          prerequisite: `2 :intrigue: on the :witch:’s starting location.`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/loss.ts evaluateLoss()
        // 이 훅은 원문 보존용이다. 여기에 로직을 넣지 마라 — 이중 구현이 된다.
        when: () => false,
        effect: () => {},
      },
    ],
  },
  // ── 친목 동아리 (Circle of Friends)
  circleFriends: {
    ko: "친목 동아리",
    addsRoles: {"friend": 2, "conspiracyTheorist": 1},
    hooks: [], // 능력 없음
  },
  // ── 연애의 풍경 (A Love Affair)
  loveAffair: {
    ko: "연애의 풍경",
    addsRoles: {"lover": 1, "lovedOne": 1},
    hooks: [], // 능력 없음
  },
  // ── 숨어 있는 살인귀 (The Hidden Freak)
  hiddenFreak: {
    ko: "숨어 있는 살인귀",
    addsRoles: {"serialKiller": 1, "friend": 1},
    hooks: [], // 능력 없음
  },
  // ── 칼부림 살인마의 그림자 (Shadow of the Ripper)
  shadowRipper: {
    ko: "칼부림 살인마의 그림자",
    addsRoles: {"conspiracyTheorist": 1, "serialKiller": 1},
    hooks: [], // 추가 규칙 없음
  },
  // ── 불온한 소문 (An Unsettling Rumor)
  unsettlingRumor: {
    ko: "불온한 소문",
    addsRoles: {"conspiracyTheorist": 1},
    hooks: [
      {
        phase: "P5_MASTERMIND_ABILITY",
        kind: "optional",
        timesPerLoop: 1,
        source: {
          timing: "Mastermind Ability",
          description: `You may place 1 :intrigue: on any location.`,
        },
        when: (s: GameState, _self: CharacterId) =>
          unsettlingRumorAvailable(s),
        selectableTargets: () =>
          LOCATIONS.map((at) => ({ kind: "location", at })),
        effect: (
          s: GameState,
          _self: CharacterId,
          target?: Target,
        ) => {
          if (!unsettlingRumorAvailable(s)) {
            throw new Error("unsettlingRumor is already spent this loop");
          }
          if (target?.kind !== "location") {
            throw new Error("unsettlingRumor requires a location target");
          }
          s.loop.locIntrigue[target.at] += 1;
          s.loop.abilitiesUsedThisLoop.push(UNSETTLING_RUMOR_USE_KEY);
        },
      },
    ],
  },
  // ── 최악의 시나리오 (A Hideous Script)
  hideousScript: {
    ko: "최악의 시나리오",
    addsRoles: {
      "conspiracyTheorist": 1,
      "curmudgeon": [0, 2],
      "friend": 1,
    },
    hooks: [
      {
        phase: "SCRIPT_BUILD",
        kind: "scriptBuild",
        source: {
          timing: "Always",
          description: `Script writer may choose 0 or 1 or 2 :curmudgeon:s.`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/validate.ts validateScenario()
        // SCRIPT_BUILD 훅은 런타임에 해결하지 않는다.
        when: () => false,
        effect: () => {},
      },
    ],
  },
  // ── 망상 확대 바이러스 (Paranoia Virus)
  paranoiaVirus: {
    ko: "망상 확대 바이러스",
    addsRoles: {"conspiracyTheorist": 1},
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `All :person:s with at least 3 :paranoia: turn into :serialKiller:s.`,
        },
        // IMPLEMENTED_ELSEWHERE: src/types.ts effectiveRole()
        // 이 훅은 원문 보존용이다. 여기에 로직을 넣지 마라 — 이중 구현이 된다.
        when: () => false,
        effect: () => {},
      },
    ],
  },
  // ── 인과율 (Threads of Fate)
  threadsFate: {
    ko: "인과율",
    hooks: [
      {
        phase: "LOOP_START",
        kind: "mandatory",
        source: {
          timing: "Loop Start",
          description: `Place 2 :paranoia: on all characters who had :goodwill: last loop.`,
        },
        when: (s: GameState, _self: CharacterId) =>
          charactersWithGoodwillLastLoop(s).length > 0,
        effect: (s: GameState, _self: CharacterId) => {
          for (const character of charactersWithGoodwillLastLoop(s)) {
            s.loop.charCounters[character].paranoia += 2;
          }
        },
      },
    ],
  },
  // ── 불확정 인자 χ (Unknown Factor X)
  unknownFactor: {
    ko: "불확정 인자 χ",
    addsRoles: {"factor": 1},
    hooks: [], // 능력 없음
  },
  // ── 애증의 나선 (Love-Hate Spiral)
  loveHateSpiral: {
    ko: "애증의 나선",
    addsRoles: {"friend": 1, "obstinate": 1},
    hooks: [],
  },
  // ── 죽음의 쇼타임 (Showtime of Death)
  showtimeDeath: {
    ko: "죽음의 쇼타임",
    addsRoles: {"magician": 1, "immortalRole": 1},
    hooks: [
      {
        phase: "LOOP_END",
        kind: "lossTragedy",
        source: {
          timing: "Loop End",
          prerequisite: `There are 6 or less characters alive.`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/loss.ts evaluateLoss()
        when: () => false,
        effect: () => {},
      },
    ],
  },
  // ── 마녀의 다과회 (Witches' Tea Time)
  witchesTeaTime: {
    ko: "마녀의 다과회",
    addsRoles: {"conspiracyTheorist": 1, "friend": 1, "witch": 2},
    hooks: [],
  },
  // ── 신의 주사위 (Dice of the Gods)
  diceOfGods: {
    ko: "신의 주사위",
    addsRoles: {"serialKiller": 1, "obstinate": 1},
    hooks: [
      {
        phase: "LOOP_START",
        kind: "mandatory",
        source: {
          timing: "Loop Start",
          prerequisite: `A Character died the last turn.`,
          description: `Chose one of those. Plac any Extra Card on that character.`,
        },
        // 공식 요약표: 인과의 인연과 함께 채택해도 이 효과는 중첩되지 않는다.
        when: (s: GameState) =>
          ![s.scenario.mainPlot, ...s.scenario.subPlots].includes(
            "fatedConnections",
          ) && charactersWhoDiedLastLoop(s).length > 0,
        effectTarget: (s: GameState) =>
          loopStartExtraCardTarget(s, "diceOfGods"),
        effect: (s: GameState, _self: CharacterId, target?: Target) => {
          placePlotExtraCard(s, "diceOfGods", target);
        },
      },
    ],
  },
  // ── 통하지 않는 마음 (Unanswered Heart)
  unansweredHeart: {
    ko: "통하지 않는 마음",
    addsRoles: {"conspiracyTheorist": 1, "magician": 1},
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `"Forbid :goodwill:" has the effect of "Forbid Movement"`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/resolve.ts resolveMovement()
        when: () => false,
        effect: () => {},
      },
    ],
  },
  // ── 불확정 인자 χ괴 (Unsafe Trigger)
  unsafeTrigger: {
    ko: "불확정 인자 χ괴",
    addsRoles: {"factor": 1},
    hooks: [
      {
        phase: "P5_MASTERMIND_ABILITY",
        kind: "optional",
        timesPerLoop: 1,
        source: {
          timing: "Mastermind Ability",
          prerequisite: `The :factor: is alive.`,
          description: `You may place 1 Intruge counter on the :factor:’s location`,
        },
        when: (s: GameState) =>
          !s.loop.abilitiesUsedThisLoop.includes(UNSAFE_TRIGGER_USE_KEY) &&
          Object.keys(s.scenario.cast).some((character) =>
            effectiveRole(s, character) === "factor" &&
            isCharacterAlive(s.loop.board[character])
          ),
        effect: (s: GameState) => {
          const factor = Object.keys(s.scenario.cast).find((character) =>
            effectiveRole(s, character) === "factor" &&
            isCharacterAlive(s.loop.board[character])
          );
          if (factor === undefined) {
            throw new Error("unsafeTrigger requires a living factor");
          }
          if (s.loop.abilitiesUsedThisLoop.includes(UNSAFE_TRIGGER_USE_KEY)) {
            throw new Error("unsafeTrigger is already spent this loop");
          }
          const location = characterLocation(s.loop.board[factor], factor);
          s.loop.locIntrigue[location] += 1;
          s.loop.abilitiesUsedThisLoop.push(UNSAFE_TRIGGER_USE_KEY);
        },
      },
    ],
  },
  // ── 멸망을 노래하는 자 (Worshippers of the Apocalypse)
  worshippersApocalypse: {
    ko: "멸망을 노래하는 자",
    addsRoles: {"prophet": 1},
    hooks: [
      {
        phase: "SCRIPT_BUILD",
        kind: "scriptBuild",
        source: {
          timing: "Script Creation",
          description: `There must be at least one :suicide: Incident`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/validate.ts validateScenario()
        when: () => false,
        effect: () => {},
      },
      {
        phase: "P7_INCIDENT",
        kind: "mandatory",
        source: {
          timing: "Incident step",
          prerequisite: `The Culprit is a :person: and the :prophet: is alive.`,
          description: `When determning whether an Incident triggers, the culprit is regarded as having 1 less than its printed :paranoia: limit.`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/incident.ts incidentFailureReasons()
        when: () => false,
        effect: () => {},
      },
    ],
  },
};
