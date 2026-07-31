// ⚠️ 자동 생성 스캐폴딩 — 구조는 생성기가, 로직은 사람이.
//    재생성해도 when/effect 는 덮어쓰지 않도록 주의할 것.
//    source 는 원본 영문 텍스트(수정 금지). ko 는 정발 용어.

import type { GameState, CharacterId, Hook } from "../types";

/** 기본편 사건 — 총 9건 */
export const INCIDENT_IMPL: Record<string, {
  ko: string;
  goodwillRefusal?: 'Optional' | 'Mandatory';
  max?: number;
  tags?: string[];
  addsRoles?: Record<string, number>;
  hooks: Hook[];
}> = {
  // ── 나비의 날갯짓 (Butterfly Effect)
  butterflyEffect: {
    ko: "나비의 날갯짓",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `Put any counter on any character in culprit’s Location.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 원격 살인 (Faraway Murder)
  farawayMurder: {
    ko: "원격 살인",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `One character with at least 2 :intrigue: dies.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 사악한 기운의 오염 (Foul Evil)
  foulEvil: {
    ko: "사악한 기운의 오염",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `Place 2 :intrigue: on the Shrine.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 병원 사건 (Hospital Incident)
  hospitalIncident: {
    ko: "병원 사건",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          prerequisite: `1 :intrigue: on the Hospital`,
          description: `Everyone in the Hospital dies.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
      {
        phase: "ALWAYS",
        kind: "lossDeath",
        source: {
          timing: "Always",
          prerequisite: `2 :intrigue: on the Hospital`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 불안 확대 (Increasing Unease)
  increasingUnease: {
    ko: "불안 확대",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `Place 2 :paranoia: on any character, then 1 :intrigue: on any other character.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 행방불명 (Missing Person)
  missingPerson: {
    ko: "행방불명",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `Move culprit to any Location. Put 1 :intrigue: on that Location.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 살인 사건 (Murder)
  murder: {
    ko: "살인 사건",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `One (1) other character in culprit’s Location dies`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 유포 (Spreading)
  spreading: {
    ko: "유포",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `Remove 2 :goodwill: (or 1 if they only have that) from a character, and then add 2 :goodwill: to another character.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
  // ── 자살 (Suicide)
  suicide: {
    ko: "자살",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `The culprit dies.`,
        },
        // TODO(구현): 위 source 를 술어/효과로 옮길 것
        when: (_s: GameState, _self: CharacterId) => false,
        effect: (_s: GameState, _self: CharacterId) => { throw new Error('unimplemented'); },
      },
    ],
  },
};
