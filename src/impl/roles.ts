// ⚠️ 자동 생성 스캐폴딩 — 구조는 생성기가, 로직은 사람이.
//    재생성해도 when/effect 는 덮어쓰지 않도록 주의할 것.
//    source 는 원본 영문 텍스트(수정 금지). ko 는 정발 용어.

import type { GameState, CharacterId, Hook } from "../types";

/** 기본편 역할 — 총 13건 */
export const ROLE_IMPL: Record<string, {
  ko: string;
  goodwillRefusal?: 'Optional' | 'Mandatory';
  max?: number;
  tags?: string[];
  addsRoles?: Record<string, number>;
  hooks: Hook[];
}> = {
  // ── 엑스트라 (Person)
  person: {
    ko: "엑스트라",
    hooks: [], // 능력 없음
  },
  // ── 핵심 인물 (Key Person)
  keyPerson: {
    ko: "핵심 인물",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "lossTragedy",
        source: {
          timing: "Always",
          prerequisite: `This character dies.`,
          description: `The loop ends immediately.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 살인 청부업자 (Killer)
  killer: {
    ko: "살인 청부업자",
    goodwillRefusal: "Optional",
    hooks: [
      {
        phase: "P9_ROUND_END",
        kind: "optional",
        source: {
          timing: "Day End",
          prerequisite: `The :keyPerson: has at least 2 :intrigue: and is in this character‘s location`,
          description: `Kill the :keyPerson:`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
      {
        phase: "P9_ROUND_END",
        kind: "lossDeath",
        source: {
          timing: "Day End",
          prerequisite: `This character has at least 4 :intrigue:`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 흑막 (Brain)
  brain: {
    ko: "흑막",
    goodwillRefusal: "Optional",
    hooks: [
      {
        phase: "P5_MASTERMIND_ABILITY",
        kind: "optional",
        source: {
          timing: "Mastermind Ability",
          description: `You may place 1 :intrigue: on this location or on any character in this location.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 광신도 (Cultist)
  cultist: {
    ko: "광신도",
    goodwillRefusal: "Mandatory",
    hooks: [
      {
        phase: "P4_RESOLVE",
        kind: "optional",
        source: {
          timing: "Card resolve",
          description: `You may ignore all Forbid :intrigue: effects on this location and on all characters in this location.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 시간 여행자 (Time Traveler)
  timeTraveler: {
    ko: "시간 여행자",
    tags: ["immortal"],
    hooks: [
      {
        phase: "P4_RESOLVE",
        kind: "mandatory",
        source: {
          timing: "Card resolve",
          description: `Ignore Forbid :goodwill: on this character.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
      {
        phase: "P9_ROUND_END",
        kind: "lossTragedy",
        source: {
          timing: "Day End",
          prerequisite: `There is 2 or less :goodwill: on this character.`,
          description: `Loop ends`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
      {
        phase: "LAST_DAY",
        kind: "lossTragedy",
        source: {
          timing: "Last Day",
          prerequisite: `There is 2 or less :goodwill: on this character.`,
          description: `Loop ends`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 마녀 (Witch)
  witch: {
    ko: "마녀",
    goodwillRefusal: "Mandatory",
    hooks: [], // 능력 없음
  },
  // ── 친구 (Friend)
  friend: {
    ko: "친구",
    max: 2,
    hooks: [
      {
        phase: "LOOP_END",
        kind: "lossTragedy",
        source: {
          timing: "Loop End",
          prerequisite: `This character is dead.`,
          description: `Reveal its role.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
      {
        phase: "LOOP_START",
        kind: "mandatory",
        source: {
          timing: "Loop Start",
          prerequisite: `This role has been revealed`,
          description: `This character gets 1 :goodwill:.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 선동가 (Conspiracy Theorist)
  conspiracyTheorist: {
    ko: "선동가",
    max: 1,
    hooks: [
      {
        phase: "P5_MASTERMIND_ABILITY",
        kind: "optional",
        source: {
          timing: "Mastermind Ability",
          description: `You may place 1 :paranoia: on any character in this location.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 연인B (Lover)
  lover: {
    ko: "연인B",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          prerequisite: `The :lovedOne: dies`,
          description: `This character gets 6 :paranoia:.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 연인A (Loved One)
  lovedOne: {
    ko: "연인A",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          prerequisite: `The :lover: dies`,
          description: `This character gets 6 :paranoia:.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
      {
        phase: "P9_ROUND_END",
        kind: "lossDeath",
        source: {
          timing: "Day End",
          prerequisite: `This character has at least 3 :paranoia: and at least 1 :intrigue:.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 연쇄 살인마 (Serial Killer)
  serialKiller: {
    ko: "연쇄 살인마",
    hooks: [
      {
        phase: "P9_ROUND_END",
        kind: "mandatory",
        source: {
          timing: "Day End",
          prerequisite: `There is exactly 1 other (living) character in this location`,
          description: `That character dies.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 변수 (Factor)
  factor: {
    ko: "변수",
    goodwillRefusal: "Optional",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          prerequisite: `There is at least 2 :intrigue: on the School`,
          description: `This character gains the :conspiracyTheorist:‘s ability, but not its role.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          prerequisite: `There is at least 2 :intrigue: on the City`,
          description: `This character gains the :keyPerson:’s ability, but not its role.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
};
