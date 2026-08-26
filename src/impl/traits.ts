// 캐릭터 특성 훅. source.description은 data/character-traits.json의 영문 원문이다.

import {
  characterEntryTiming,
  isCharacterPresent,
  startLocationOf,
} from "../types";
import type { CharacterId, GameState, Hook } from "../types";
import { SERVANT_TRAIT_SOURCE } from "../engine/servant";
import { SACRED_TREE_TRAIT_SOURCE } from "../engine/sacred-tree";

function placeEnteringCharacter(
  state: GameState,
  character: CharacterId,
): void {
  state.loop.board[character] = {
    status: "alive",
    at: startLocationOf(character, state.scenario),
  };
}

function placeHenchmanAtSelectedStart(
  state: GameState,
  character: CharacterId,
): void {
  const at = state.loop.loopStartTraitLocationChoices?.[character];
  if (at === undefined) {
    throw new Error("henchman loop-start location choice is required");
  }
  state.loop.board[character] = { status: "alive", at };
}

/** 한국어판 캐릭터 특성 — 구현 여부를 한곳에서 추적한다. */
export const TRAIT_IMPL: Record<CharacterId, {
  ko: string;
  hooks: Hook[];
}> = {
  servant: {
    ko: "메이드",
    hooks: [{
      phase: "ALWAYS",
      kind: "mandatory",
      source: {
        timing: "Always",
        description: SERVANT_TRAIT_SOURCE,
      },
      // IMPLEMENTED_ELSEWHERE: movement.ts, death.ts
      when: () => false,
      effect: () => {},
    }],
  },
  copycat: {
    ko: "모방자",
    hooks: [{
      phase: "SCRIPT_BUILD",
      kind: "scriptBuild",
      source: {
        timing: "Script Build",
        description: `Script Creation: This Character must copy the role of another Character in the script (max amount ignored).`,
      },
      // SCRIPT_BUILD는 런타임 훅이 아니므로 원문 보존만 한다.
      when: () => false,
      effect: () => {},
    }],
  },
  mysteryBoy: {
    ko: "아웃사이더",
    hooks: [{
      phase: "SCRIPT_BUILD",
      kind: "scriptBuild",
      source: {
        timing: "Script Build",
        description: `Always has a role not associated with current plot.`,
      },
      // IMPLEMENTED_ELSEWHERE: src/engine/validate.ts validateScenario()
      // SCRIPT_BUILD는 런타임 훅이 아니므로 원문 보존만 한다.
      when: () => false,
      effect: () => {},
    }],
  },
  godlyBeing: {
    ko: "신",
    hooks: [{
      phase: "LOOP_CHARACTER_PLACEMENT",
      kind: "mandatory",
      source: {
        timing: "Loop Start",
        description: `Enters game on predefined loop`,
      },
      when: (state: GameState, self: CharacterId) => {
        const entry = characterEntryTiming(state.scenario, self);
        return entry?.kind === "loop" &&
          state.loop.loop === entry.value &&
          !isCharacterPresent(state.loop.board[self]);
      },
      effect: placeEnteringCharacter,
    }],
  },
  boss: {
    ko: "거물",
    hooks: [{
      phase: "ALWAYS",
      kind: "mandatory",
      source: {
        timing: "Always",
        description: `May be regarded as in his turf.`,
      },
      // IMPLEMENTED_ELSEWHERE: src/types.ts abilityLocationsOf()
      // ALWAYS 패시브이므로 사건 외 능력의 대상 판정에서만 장소 후보를 늘린다.
      when: () => false,
      effect: () => {},
    }],
  },
  henchman: {
    ko: "하수인",
    hooks: [{
      phase: "LOOP_CHARACTER_PLACEMENT",
      kind: "mandatory",
      source: {
        timing: "Loop Start",
        description: `Mastermind chooses start location each loop`,
      },
      when: (state: GameState, self: CharacterId) =>
        state.loop.loopStartTraitLocationChoices?.[self] !== undefined &&
        !isCharacterPresent(state.loop.board[self]),
      effect: placeHenchmanAtSelectedStart,
    }],
  },
  transferStudent: {
    ko: "전학생",
    hooks: [{
      phase: "P1_CHARACTER_ENTRY",
      kind: "mandatory",
      source: {
        timing: "Day Start",
        description: `This character does not appear on the board until the start of the day specified by the script.`,
      },
      when: (state: GameState, self: CharacterId) => {
        const entry = characterEntryTiming(state.scenario, self);
        return entry?.kind === "day" &&
          state.loop.day === entry.value &&
          !isCharacterPresent(state.loop.board[self]);
      },
      effect: placeEnteringCharacter,
    }],
  },
  blackCat: {
    ko: "검은 고양이",
    hooks: [
      {
        phase: "LOOP_START",
        kind: "mandatory",
        source: {
          timing: "Loop Start",
          description: `At the start of each loop, place an :intrigue: on the Shrine.`,
        },
        when: () => true,
        effect: (state: GameState) => {
          state.loop.locIntrigue.Shrine += 1;
        },
      },
      {
        phase: "P7_INCIDENT",
        kind: "mandatory",
        source: {
          timing: "Incident",
          description: `Incidents of which this character is the culprit, change their effect into "no effect". (rule-wise they occur)`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/incident.ts resolveIncident()
        // 발생 판정과 이력 기록 사이의 전용 경로이므로 여기로 옮기지 않는다.
        when: () => false,
        effect: () => {},
      },
    ],
  },
  scientist: {
    ko: "학자",
    hooks: [{
      phase: "LOOP_START",
      kind: "mandatory",
      source: {
        timing: "Loop Start",
        description: `At the start of a loop, place either a :paranoia: counter, a :goodwill: counter or an :intrigue: counter on this character.`,
      },
      when: () => true,
      effect: (state: GameState, self: CharacterId) => {
        const counter = state.loop.loopStartTraitCounterChoices?.[self];
        if (counter === undefined) {
          throw new Error("scientist loop-start counter choice is required");
        }
        state.loop.charCounters[self][counter] += 1;
      },
    }],
  },
  ai: {
    ko: "AI",
    hooks: [
      {
        phase: "SCRIPT_BUILD",
        kind: "scriptBuild",
        source: {
          timing: "Script Build",
          description: `This character cannot have the role :person:.`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/validate.ts validateScenario()
        // SCRIPT_BUILD는 런타임 훅이 아니므로 원문 보존만 한다.
        when: () => false,
        effect: () => {},
      },
      {
        phase: "P7_INCIDENT",
        kind: "mandatory",
        source: {
          timing: "Incident Trigger Check",
          description: `When determining wether an Incident triggers, to which this character is the culprit, all conters on this character conut as :paranoia: conuters.`,
        },
        // IMPLEMENTED_ELSEWHERE: src/engine/incident.ts incidentParanoia()
        // 사건 공통 발생 판정의 AI 전용 분기이므로 여기로 옮기지 않는다.
        when: () => false,
        effect: () => {},
      },
    ],
  },
  illusion: {
    ko: "환상",
    hooks: [{
      phase: "P4_RESOLVE",
      kind: "mandatory",
      source: {
        timing: "Action Card Placement / Card Resolve",
        description: `No action cards can be placed on this characte. All cards palced on this location are also applied to this character.`,
      },
      // IMPLEMENTED_ELSEWHERE: src/engine/legal.ts validatePlacement(),
      // src/engine/resolve.ts placementsWithIllusionCopies()
      when: () => false,
      effect: () => {},
    }],
  },
  sectFounder: {
    ko: "교주",
    hooks: [{
      phase: "P7_INCIDENT",
      kind: "mandatory",
      source: {
        timing: "Incident",
        description: `If this character is the culprit of an Incident that resolves, its effects resolve twice.`,
      },
      // STATIC_GUIDANCE_ONLY: 사건 2회 해결의 엔진 구현은 B의 범위가 아니다.
      when: () => false,
      effect: () => {},
    }],
  },
  sacredTree: {
    ko: "신수",
    hooks: [{
      phase: "ALWAYS",
      kind: "mandatory",
      source: {
        timing: "Each turn / Mastermind Ability",
        description: SACRED_TREE_TRAIT_SOURCE,
      },
      // IMPLEMENTED_ELSEWHERE: sacred-tree.ts와 P4/P5 입력 동선.
      when: () => false,
      effect: () => {},
    }],
  },
};
