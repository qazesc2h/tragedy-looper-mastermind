// ⚠️ 자동 생성 스캐폴딩 — 구조는 생성기가, 로직은 사람이.
//    재생성해도 when/effect 는 덮어쓰지 않도록 주의할 것.
//    source 는 원본 영문 텍스트(수정 금지). ko 는 정발 용어.

import type { GameState, CharacterId, Hook, Target } from "../types";

const UNSETTLING_RUMOR_USE_KEY = "unsettlingRumor:plot:0";

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
    .filter(([character, counters]) =>
      previousLoop.board[character]?.alive === true &&
      counters.goodwill >= 1
    )
    .map(([character]) => character);
}

/** 기본편 룰(플롯) — 총 12건 */
export const PLOT_IMPL: Record<string, {
  ko: string;
  goodwillRefusal?: 'Optional' | 'Mandatory';
  max?: number;
  tags?: string[];
  addsRoles?: Record<string, number>;
  hooks: Hook[];
}> = {
  // ── 살인 계획 (Murder Plan)
  murderPlan: {
    ko: "살인 계획",
    addsRoles: {"keyPerson": 1, "killer": 1, "brain": 1},
    hooks: [], // 능력 없음
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
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
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
        // SCRIPT_BUILD: 런타임 훅 아님. src/engine/validate.ts 참조
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
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
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
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
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
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
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
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
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
};
