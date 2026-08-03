// ⚠️ 자동 생성 스캐폴딩 — 구조는 생성기가, 로직은 사람이.
//    재생성해도 when/effect 는 덮어쓰지 않도록 주의할 것.
//    source 는 원본 영문 텍스트(수정 금지). ko 는 정발 용어.

import {
  attemptProtagonistDeath,
  killCharacter,
} from "../engine/death";
import type {
  CharacterId,
  GameState,
  IncidentChoice,
  IncidentCounter,
  IncidentHook,
  Location,
} from "../types";

function livingCharacters(state: GameState): CharacterId[] {
  return Object.entries(state.loop.board)
    .filter(([, position]) => position.alive)
    .map(([character]) => character);
}

function selectedCharacter(
  eligible: readonly CharacterId[],
  selected: CharacterId | undefined,
  incident: string,
): CharacterId | undefined {
  if (eligible.length === 0) {
    return undefined;
  }
  if (selected === undefined) {
    throw new Error(`${incident} requires a character target`);
  }
  if (!eligible.includes(selected)) {
    throw new Error(`${incident} target is not eligible`);
  }
  return selected;
}

function selectedLocation(
  selected: Location | undefined,
  incident: string,
): Location {
  if (selected === undefined) {
    throw new Error(`${incident} requires a location target`);
  }
  return selected;
}

function selectedCounter(
  selected: IncidentCounter | undefined,
  incident: string,
): IncidentCounter {
  if (selected === undefined) {
    throw new Error(`${incident} requires a counter type`);
  }
  return selected;
}

function killEffectApplied(
  state: GameState,
  character: CharacterId,
): boolean {
  const before = {
    alive: state.loop.board[character].alive,
    protection: state.loop.charCounters[character].protection,
  };
  killCharacter(state, character);
  return state.loop.board[character].alive !== before.alive ||
    state.loop.charCounters[character].protection !== before.protection;
}

/** 기본편 사건 — 총 9건 */
export const INCIDENT_IMPL: Record<string, {
  ko: string;
  goodwillRefusal?: 'Optional' | 'Mandatory';
  max?: number;
  tags?: string[];
  addsRoles?: Record<string, number>;
  hooks: IncidentHook[];
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
        when: (_s: GameState, _self: CharacterId) => true,
        effect: (
          s: GameState,
          culprit: CharacterId,
          choice?: IncidentChoice,
        ) => {
          const location = s.loop.board[culprit].at;
          const target = selectedCharacter(
            livingCharacters(s).filter(
              (character) => s.loop.board[character].at === location,
            ),
            choice?.target,
            "butterflyEffect",
          );
          if (target === undefined) return false;
          const counter = selectedCounter(choice?.counter, "butterflyEffect");
          s.loop.charCounters[target][counter] += 1;
          return true;
        },
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
        when: (_s: GameState, _self: CharacterId) => true,
        effect: (s: GameState, _culprit: CharacterId, choice?: IncidentChoice) => {
          const target = selectedCharacter(
            livingCharacters(s).filter(
              (character) => s.loop.charCounters[character].intrigue >= 2,
            ),
            choice?.target,
            "farawayMurder",
          );
          return target === undefined ? false : killEffectApplied(s, target);
        },
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
        when: (_s: GameState, _self: CharacterId) => true,
        effect: (s: GameState, _self: CharacterId) => {
          s.loop.locIntrigue.Shrine += 2;
          return true;
        },
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
        when: (s: GameState, _self: CharacterId) =>
          s.loop.locIntrigue.Hospital >= 1,
        effect: (s: GameState, _self: CharacterId) => {
          let applied = false;
          for (const character of livingCharacters(s)) {
            if (s.loop.board[character].at === "Hospital") {
              applied = killEffectApplied(s, character) || applied;
            }
          }
          return applied;
        },
      },
      {
        phase: "ALWAYS",
        kind: "lossDeath",
        source: {
          timing: "Always",
          prerequisite: `2 :intrigue: on the Hospital`,
        },
        when: (s: GameState, _self: CharacterId) =>
          s.loop.locIntrigue.Hospital >= 2,
        effect: (s: GameState, _self: CharacterId) =>
          attemptProtagonistDeath(s).died,
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
        when: (_s: GameState, _self: CharacterId) => true,
        effect: (s: GameState, _culprit: CharacterId, choice?: IncidentChoice) => {
          const living = livingCharacters(s);
          const first = selectedCharacter(
            living,
            choice?.target,
            "increasingUnease",
          );
          if (first === undefined) return false;
          const second = selectedCharacter(
            living.filter((character) => character !== first),
            choice?.otherTarget,
            "increasingUnease",
          );

          s.loop.charCounters[first].paranoia += 2;
          if (second !== undefined) {
            s.loop.charCounters[second].intrigue += 1;
          }
          return true;
        },
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
        when: (_s: GameState, _self: CharacterId) => true,
        effect: (
          s: GameState,
          culprit: CharacterId,
          choice?: IncidentChoice,
        ) => {
          const location = selectedLocation(choice?.location, "missingPerson");
          s.loop.board[culprit].at = location;
          s.loop.locIntrigue[location] += 1;
          return true;
        },
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
        when: (_s: GameState, _self: CharacterId) => true,
        effect: (
          s: GameState,
          culprit: CharacterId,
          choice?: IncidentChoice,
        ) => {
          const location = s.loop.board[culprit].at;
          const target = selectedCharacter(
            livingCharacters(s).filter(
              (character) =>
                character !== culprit &&
                s.loop.board[character].at === location,
            ),
            choice?.target,
            "murder",
          );
          return target === undefined ? false : killEffectApplied(s, target);
        },
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
        when: (_s: GameState, _self: CharacterId) => true,
        effect: (s: GameState, _culprit: CharacterId, choice?: IncidentChoice) => {
          const living = livingCharacters(s);
          const donor = selectedCharacter(
            living.filter(
              (character) => s.loop.charCounters[character].goodwill >= 1,
            ),
            choice?.target,
            "spreading",
          );
          if (donor === undefined) return false;
          const recipient = selectedCharacter(
            living.filter((character) => character !== donor),
            choice?.otherTarget,
            "spreading",
          );

          s.loop.charCounters[donor].goodwill = Math.max(
            0,
            s.loop.charCounters[donor].goodwill - 2,
          );
          if (recipient !== undefined) {
            s.loop.charCounters[recipient].goodwill += 2;
          }
          return true;
        },
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
        when: (_s: GameState, _self: CharacterId) => true,
        effect: (s: GameState, culprit: CharacterId) =>
          killEffectApplied(s, culprit),
      },
    ],
  },
};
