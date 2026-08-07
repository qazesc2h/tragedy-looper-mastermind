// 캐릭터 특성 훅. source.description은 data/character-traits.json의 영문 원문이다.

import {
  characterEntryTiming,
  isCharacterPresent,
  startLocationOf,
} from "../types";
import type { CharacterId, GameState, Hook } from "../types";

function placeEnteringCharacter(
  state: GameState,
  character: CharacterId,
): void {
  state.loop.board[character] = {
    status: "alive",
    at: startLocationOf(character, state.scenario),
  };
}

/** 한국어판 캐릭터 특성 — 구현 여부를 한곳에서 추적한다. */
export const TRAIT_IMPL: Record<CharacterId, {
  ko: string;
  hooks: Hook[];
}> = {
  mysteryBoy: {
    ko: "아웃사이더",
    hooks: [{
      phase: "SCRIPT_BUILD",
      kind: "scriptBuild",
      source: {
        timing: "Script Build",
        description: `Always has a role not associated with current plot.`,
      },
      // TODO(구현): 현재 룰에 속하지 않는 역할인지 시나리오 검증에서 확인한다.
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
      // TODO(구현): 사건 외 능력의 장소 판정에 세력권 선택을 반영한다.
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
      // TODO(구현): 고정 시나리오 값이 아니라 루프별 시작 장소 선택을 받는다.
      when: () => false,
      effect: () => {},
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
        // TODO(구현): AI가 범인일 때 발생 조건에서 모든 카운터를 불안으로 센다.
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
      // TODO(구현): 직접 배치를 금지하고 장소 카드 효과를 환상에도 적용한다.
      when: () => false,
      effect: () => {},
    }],
  },
};
