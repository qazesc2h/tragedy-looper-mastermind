// ⚠️ 자동 생성 스캐폴딩 — 구조는 생성기가, 로직은 사람이.
//    재생성해도 when/effect 는 덮어쓰지 않도록 주의할 것.
//    source 는 원본 영문 텍스트(수정 금지). ko 는 정발 용어.

import {
  characterLocation,
  isCharacterAlive,
  startLocationOf,
  withCharacterLocation,
} from "../types";
import { isIncidentSelectableCounter } from "../counters";
import {
  incidentCharacterDecision,
  incidentCounterDecision,
  incidentEffectCulpritLocation,
  incidentLocationDecision,
  incidentRoleDecision,
  incidentSubIncidentDecision,
  incidentTypeDecision,
} from "../engine/incident-model";
import {
  attemptProtagonistDeath,
  killCharacter,
} from "../engine/death";
import type {
  CharacterId,
  GameState,
  IncidentChoiceInput,
  IncidentCounter,
  IncidentCulprit,
  IncidentHook,
  Location,
  RoleId,
} from "../types";
import { placeExtraCard } from "../engine/extra-cards";
import { recordPublicInformation } from "../engine/public-information";
import { resolveRoleReveal } from "../engine/role-reveal";
import { requestLoopEnd } from "../engine/flow";

function requiredCharacterCulprit(
  culprit: IncidentCulprit | CharacterId,
): CharacterId {
  if (typeof culprit === "string") return culprit;
  if (culprit.kind !== "character") {
    throw new Error("this incident requires a character culprit");
  }
  return culprit.id;
}

function culpritStartLocation(
  state: GameState,
  character: CharacterId,
): Location {
  if (character !== "henchman") {
    return startLocationOf(character, state.scenario);
  }
  const selected = state.loop.loopStartTraitLocationChoices?.henchman;
  if (selected === undefined) {
    throw new Error("henchman loop-start location choice is required");
  }
  return selected;
}

function livingCharacters(state: GameState): CharacterId[] {
  return Object.entries(state.loop.board)
    .filter(([, position]) => isCharacterAlive(position))
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
  if (!isIncidentSelectableCounter(selected)) {
    throw new Error(`${incident} counter type is not eligible`);
  }
  return selected;
}

function killEffectApplied(
  state: GameState,
  character: CharacterId,
): boolean {
  const before = {
    alive: isCharacterAlive(state.loop.board[character]),
    protection: state.loop.charCounters[character].protection,
  };
  killCharacter(state, character);
  return isCharacterAlive(state.loop.board[character]) !== before.alive ||
    state.loop.charCounters[character].protection !== before.protection;
}

// IMPLEMENTED_ELSEWHERE: src/engine/incident.ts resolveIncidentEffect()
// 사건 훅의 ALWAYS는 원문 timing 보존용이며 발생한 사건만 직접 해결한다.
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
        when: (_s: GameState, _self: IncidentCulprit | CharacterId) => true,
        effect: (
          s: GameState,
          culprit: IncidentCulprit | CharacterId,
          choice?: IncidentChoiceInput,
        ) => {
          const location = incidentEffectCulpritLocation(s, culprit);
          const target = selectedCharacter(
            livingCharacters(s).filter(
              (character) =>
                characterLocation(s.loop.board[character], character) ===
                  location,
            ),
            incidentCharacterDecision(choice, "target"),
            "butterflyEffect",
          );
          if (target === undefined) return false;
          const counter = selectedCounter(
            incidentCounterDecision(choice),
            "butterflyEffect",
          );
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
        when: (_s: GameState, _self: IncidentCulprit | CharacterId) => true,
        effect: (s: GameState, _culprit: IncidentCulprit | CharacterId, choice?: IncidentChoiceInput) => {
          const target = selectedCharacter(
            livingCharacters(s).filter(
              (character) => s.loop.charCounters[character].intrigue >= 2,
            ),
            incidentCharacterDecision(choice, "target"),
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
        when: (_s: GameState, _self: IncidentCulprit | CharacterId) => true,
        effect: (s: GameState, _self: IncidentCulprit | CharacterId) => {
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
        when: (s: GameState, _self: IncidentCulprit | CharacterId) =>
          s.loop.locIntrigue.Hospital >= 1,
        effect: (s: GameState, _self: IncidentCulprit | CharacterId) => {
          let applied = false;
          for (const character of livingCharacters(s)) {
            if (
              characterLocation(s.loop.board[character], character) ===
                "Hospital"
            ) {
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
        when: (s: GameState, _self: IncidentCulprit | CharacterId) =>
          s.loop.locIntrigue.Hospital >= 2,
        effect: (s: GameState, _self: IncidentCulprit | CharacterId) =>
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
        when: (_s: GameState, _self: IncidentCulprit | CharacterId) => true,
        effect: (s: GameState, _culprit: IncidentCulprit | CharacterId, choice?: IncidentChoiceInput) => {
          const living = livingCharacters(s);
          const first = selectedCharacter(
            living,
            incidentCharacterDecision(choice, "target"),
            "increasingUnease",
          );
          if (first === undefined) return false;
          const second = selectedCharacter(
            living.filter((character) => character !== first),
            incidentCharacterDecision(choice, "otherTarget"),
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
        when: (_s: GameState, _self: IncidentCulprit | CharacterId) => true,
        effect: (
          s: GameState,
          culprit: IncidentCulprit | CharacterId,
          choice?: IncidentChoiceInput,
        ) => {
          const character = requiredCharacterCulprit(culprit);
          const location = selectedLocation(
            incidentLocationDecision(choice, "location"),
            "missingPerson",
          );
          s.loop.board[character] = withCharacterLocation(
            s.loop.board[character],
            location,
            character,
          );
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
        when: (_s: GameState, _self: IncidentCulprit | CharacterId) => true,
        effect: (
          s: GameState,
          culprit: IncidentCulprit | CharacterId,
          choice?: IncidentChoiceInput,
        ) => {
          const character = requiredCharacterCulprit(culprit);
          const location = incidentEffectCulpritLocation(s, culprit);
          const target = selectedCharacter(
            livingCharacters(s).filter(
              (character) =>
                character !== requiredCharacterCulprit(culprit) &&
                characterLocation(s.loop.board[character], character) ===
                  location,
            ),
            incidentCharacterDecision(choice, "target"),
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
        when: (_s: GameState, _self: IncidentCulprit | CharacterId) => true,
        effect: (s: GameState, _culprit: IncidentCulprit | CharacterId, choice?: IncidentChoiceInput) => {
          const living = livingCharacters(s);
          const donor = selectedCharacter(
            living.filter(
              (character) => s.loop.charCounters[character].goodwill >= 1,
            ),
            incidentCharacterDecision(choice, "target"),
            "spreading",
          );
          if (donor === undefined) return false;
          const recipient = selectedCharacter(
            living.filter((character) => character !== donor),
            incidentCharacterDecision(choice, "otherTarget"),
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
        when: (_s: GameState, _self: IncidentCulprit | CharacterId) => true,
        effect: (s: GameState, culprit: IncidentCulprit | CharacterId) =>
          killEffectApplied(s, requiredCharacterCulprit(culprit)),
      },
    ],
  },
  // ── 연속 살인 (Serial Murder)
  serialMurder: {
    ko: "연속 살인",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `One other character in the culprit’s location dies. The same character may be the culprit of several Serial Murder Incidents.`,
        },
        when: () => true,
        effect: (
          s: GameState,
          culprit: IncidentCulprit | CharacterId,
          choice?: IncidentChoiceInput,
        ) => {
          const character = requiredCharacterCulprit(culprit);
          const location = incidentEffectCulpritLocation(s, culprit);
          const target = selectedCharacter(
            livingCharacters(s).filter((candidate) =>
              candidate !== character &&
              characterLocation(s.loop.board[candidate], candidate) === location
            ),
            incidentCharacterDecision(choice, "target"),
            "serialMurder",
          );
          return target === undefined ? false : killEffectApplied(s, target);
        },
      },
    ],
  },
  // ── 전조 (Portent)
  portent: {
    ko: "전조",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `[When determning wether this Incident triggers or not, treat the culprit’s :paranoia: limit ats 1 less then its printed limit] Put 1 :paranoia: counter on any character in the culprit’s location.`,
        },
        when: () => true,
        effect: (
          s: GameState,
          culprit: IncidentCulprit | CharacterId,
          choice?: IncidentChoiceInput,
        ) => {
          const location = incidentEffectCulpritLocation(s, culprit);
          const target = selectedCharacter(
            livingCharacters(s).filter((candidate) =>
              characterLocation(s.loop.board[candidate], candidate) === location
            ),
            incidentCharacterDecision(choice, "target"),
            "portent",
          );
          if (target === undefined) return false;
          s.loop.charCounters[target].paranoia += 1;
          return true;
        },
      },
    ],
  },
  // ── 테러리즘 (Terrorism)
  terrorism: {
    ko: "테러리즘",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          prerequisite: `1 :intrigue: on the City`,
          description: `Everyone in the City dies.`,
        },
        when: (s: GameState) => s.loop.locIntrigue.City >= 1,
        effect: (s: GameState) => {
          let applied = false;
          for (const character of livingCharacters(s)) {
            if (
              characterLocation(s.loop.board[character], character) === "City"
            ) {
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
          prerequisite: `2 :intrigue: on the City`,
        },
        when: (s: GameState) => s.loop.locIntrigue.City >= 2,
        effect: (s: GameState) => attemptProtagonistDeath(s).died,
      },
    ],
  },
  // ── 엽기 살인 (Bestial Murder)
  bestialMurder: {
    ko: "엽기 살인",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `[When determinig wether this Incident triggers or not, treat the culprit’s :paranoia: limit as 1 more than its printed limit.] Resolve ":sserialMurder:" and ":increasingUnease:" in that order. Then increase the Extra Gauge by 1 more step.`,
        },
        when: () => true,
        effect: (
          s: GameState,
          culprit: IncidentCulprit | CharacterId,
          choice?: IncidentChoiceInput,
        ) => {
          const serialChoice = incidentSubIncidentDecision(
            choice,
            "serialMurder",
          );
          const uneaseChoice = incidentSubIncidentDecision(
            choice,
            "increasingUnease",
          );
          let applied = false;
          for (const hook of INCIDENT_IMPL.serialMurder.hooks) {
            if (hook.when(s, culprit)) {
              applied = hook.effect(s, culprit, serialChoice) || applied;
            }
          }
          for (const hook of INCIDENT_IMPL.increasingUnease.hooks) {
            if (hook.when(s, culprit)) {
              applied = hook.effect(s, culprit, uneaseChoice) || applied;
            }
          }
          return applied;
        },
      },
    ],
  },
  // ── 음모 공작 (Conspiracies)
  conspiracies: {
    ko: "음모 공작",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `Resolve either a :serialMurder: or a :missingPerson: Incident. Check :intrigue: instead of :paranoia: conters to trigger the Incident.`,
        },
        when: () => true,
        effect: (
          s: GameState,
          culprit: IncidentCulprit | CharacterId,
          choice?: IncidentChoiceInput,
        ) => {
          const selected = incidentTypeDecision(choice);
          if (selected !== "serialMurder" && selected !== "missingPerson") {
            throw new Error("conspiracies requires Serial Murder or Missing Person");
          }
          const hooks = INCIDENT_IMPL[selected].hooks.filter((hook) =>
            hook.when(s, culprit)
          );
          let applied = false;
          for (const hook of hooks) {
            applied = hook.effect(s, culprit, choice) || applied;
          }
          return applied;
        },
      },
    ],
  },
  // ── 대폭동 (Uproar)
  uproar: {
    ko: "대폭동",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          prerequisite: `1 :intrigue: on the School`,
          description: `Everyone in the School dies.`,
        },
        when: (s: GameState) => s.loop.locIntrigue.School >= 1,
        effect: (s: GameState) => {
          let applied = false;
          for (const character of livingCharacters(s)) {
            if (characterLocation(s.loop.board[character], character) === "School") {
              applied = killEffectApplied(s, character) || applied;
            }
          }
          return applied;
        },
      },
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          prerequisite: `1 :intrigue: on the City`,
          description: `Everyone in the City dies.`,
        },
        when: (s: GameState) => s.loop.locIntrigue.City >= 1,
        effect: (s: GameState) => {
          let applied = false;
          for (const character of livingCharacters(s)) {
            if (characterLocation(s.loop.board[character], character) === "City") {
              applied = killEffectApplied(s, character) || applied;
            }
          }
          return applied;
        },
      },
    ],
  },
  // ── 위장 사건 (Fake Incident)
  fakeIncident: {
    ko: "위장 사건",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "lossDeath",
        source: {
          timing: "Always",
          prerequisite: `2 :intrigue: on the culprit’s starting location`,
        },
        when: (s: GameState, culprit: IncidentCulprit | CharacterId) => {
          const character = requiredCharacterCulprit(culprit);
          return s.loop.locIntrigue[culpritStartLocation(s, character)] >= 2;
        },
        effect: (s: GameState) => attemptProtagonistDeath(s).died,
      },
    ],
  },
  // ── 타개 (Breakthrough)
  breakthrough: {
    ko: "타개",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `The Protagonist Leader chooses one location or character, and removes 2 :intrigue: counters from there.`,
        },
        when: () => true,
        effect: (
          s: GameState,
          _culprit: IncidentCulprit | CharacterId,
          choice?: IncidentChoiceInput,
        ) => {
          const character = incidentCharacterDecision(choice, "target");
          const location = incidentLocationDecision(choice, "location");
          if ((character === undefined) === (location === undefined)) {
            throw new Error("breakthrough requires exactly one target");
          }
          if (character !== undefined) {
            const counters = s.loop.charCounters[character];
            if (counters === undefined) throw new Error("unknown breakthrough target");
            const before = counters.intrigue;
            counters.intrigue = Math.max(0, before - 2);
            return counters.intrigue !== before;
          }
          const before = s.loop.locIntrigue[location!];
          s.loop.locIntrigue[location!] = Math.max(0, before - 2);
          return s.loop.locIntrigue[location!] !== before;
        },
      },
    ],
  },
  // ── 위장 자살 (Faked Suicide)
  fakedSuicide: {
    ko: "위장 자살",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `Set an Extra Card on the culprit. The Protagonists may not play any cards on character(s) with an Extra Card.`,
        },
        when: () => true,
        effect: (s: GameState, culprit: IncidentCulprit | CharacterId) => {
          const character = requiredCharacterCulprit(culprit);
          placeExtraCard(s.loop, {
            instanceId: `fakedSuicide:${s.loop.loop}:${s.loop.day}:${s.loop.extraCards.length}`,
            cardId: "fakedSuicide",
            controller: "mastermind",
            source: { kind: "incident", id: "fakedSuicide" },
            target: { kind: "character", id: character },
            expiresAt: "loopStart",
          });
          s.loop.fakedSuicideRestrictionActive = true;
          return true;
        },
      },
    ],
  },
  // ── 고백 (Confession)
  confession: {
    ko: "고백",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `Reveal the culprit and the culprit’s role.`,
        },
        when: () => true,
        effect: (
          s: GameState,
          culprit: IncidentCulprit | CharacterId,
          choice?: IncidentChoiceInput,
        ) => {
          const character = requiredCharacterCulprit(culprit);
          recordPublicInformation(s, {
            kind: "incidentCulprit",
            source: "confession",
            day: s.loop.day,
            declaredIncident: "confession",
            culprit: { kind: "character", id: character },
          }, "P7_INCIDENT");
          const claimedRole = incidentRoleDecision(choice) as RoleId | undefined;
          return resolveRoleReveal(
            s,
            character,
            claimedRole,
            "P7_INCIDENT",
          );
        },
      },
    ],
  },
  // ── 은 총탄 (The Silver Bullet)
  silverBullet: {
    ko: "은 총탄",
    hooks: [
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          description: `The loop ends after this Incident step (resulting in a Protagonist victory unless any loss condition is fullifilled). This Incident dose not increase the Extra Gauge.`,
        },
        when: () => true,
        effect: (s: GameState) => {
          requestLoopEnd(s, "effect");
          return true;
        },
      },
    ],
  },
};
