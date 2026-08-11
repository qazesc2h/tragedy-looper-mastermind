// ⚠️ 자동 생성 스캐폴딩 — 구조는 생성기가, 로직은 사람이.
//    재생성해도 when/effect 는 덮어쓰지 않도록 주의할 것.
//    source 는 원본 영문 텍스트(수정 금지). ko 는 정발 용어.

import {
  abilityLocationsOf,
  characterLocation,
  effectiveRole,
  isCharacterAlive,
  isCharacterDead,
} from "../types";
import type {
  GameState,
  CharacterId,
  HookContext,
  Hook,
  RoleId,
  Target,
} from "../types";
import { killCharacter } from "../engine/death";
import { requestLoopEnd } from "../engine/flow";

function isLastDay(state: GameState): boolean {
  return state.loop.day === state.scenario.daysPerLoop;
}

function factorHasConspiracyTheoristAbility(state: GameState): boolean {
  return state.loop.locIntrigue.School >= 2;
}

function factorHasKeyPersonAbility(state: GameState): boolean {
  return state.loop.locIntrigue.City >= 2;
}

function characterWithRole(
  state: GameState,
  role: RoleId,
): CharacterId | undefined {
  return Object.keys(state.scenario.cast).find(
    (character) => effectiveRole(state, character) === role,
  );
}

function placeBrainIntrigue(
  state: GameState,
  self: CharacterId,
  target?: Target,
): void {
  if (!target) {
    throw new Error("brain intrigue placement requires a target");
  }

  const locations = abilityLocationsOf(state, self);
  if (target.kind === "location") {
    if (!locations.includes(target.at)) {
      throw new Error("brain intrigue target must be this location");
    }
    state.loop.locIntrigue[target.at] += 1;
    return;
  }

  const targetPosition = state.loop.board[target.id];
  if (
    !targetPosition ||
    !isCharacterAlive(targetPosition) ||
    !locations.includes(characterLocation(targetPosition, target.id))
  ) {
    throw new Error(
      "brain intrigue target must be a living character in this location",
    );
  }
  state.loop.charCounters[target.id].intrigue += 1;
}

function livingCharacterTargetsInAbilityLocations(
  state: GameState,
  self: CharacterId,
): Target[] {
  const locations = abilityLocationsOf(state, self);
  return Object.entries(state.loop.board)
    .filter(([character, position]) =>
      isCharacterAlive(position) &&
      locations.includes(characterLocation(position, character))
    )
    .map(([id]) => ({ kind: "character", id }));
}

function brainIntrigueTargets(
  state: GameState,
  self: CharacterId,
): Target[] {
  return [
    ...abilityLocationsOf(state, self).map((at) => ({
      kind: "location" as const,
      at,
    })),
    ...livingCharacterTargetsInAbilityLocations(state, self),
  ];
}

function activateCultistIntrigueIgnore(
  state: GameState,
  self: CharacterId,
): void {
  const activeCultists =
    state.loop.cultistsIgnoringForbidIntrigue ??= [];
  if (!activeCultists.includes(self)) {
    activeCultists.push(self);
  }
}

function activateTimeTravelerGoodwillIgnore(
  state: GameState,
  self: CharacterId,
): void {
  const activeTimeTravelers =
    state.loop.timeTravelersIgnoringForbidGoodwill ??= [];
  if (!activeTimeTravelers.includes(self)) {
    activeTimeTravelers.push(self);
  }
}

function placeConspiracyTheoristParanoia(
  state: GameState,
  self: CharacterId,
  target?: Target,
): void {
  if (target?.kind !== "character") {
    throw new Error(
      "conspiracy theorist paranoia placement requires a character target",
    );
  }

  const targetPosition = state.loop.board[target.id];
  const locations = abilityLocationsOf(state, self);
  if (
    !targetPosition ||
    !isCharacterAlive(targetPosition) ||
    !locations.includes(characterLocation(targetPosition, target.id))
  ) {
    throw new Error(
      "conspiracy theorist target must be a living character in this location",
    );
  }
  state.loop.charCounters[target.id].paranoia += 1;
}

function otherLivingCharactersInThisLocation(
  state: GameState,
  self: CharacterId,
): CharacterId[] {
  const location = characterLocation(state.loop.board[self], self);
  return Object.entries(state.loop.board)
    .filter(([character, position]) =>
      character !== self &&
      isCharacterAlive(position) &&
      characterLocation(position, character) === location
    )
    .map(([character]) => character);
}

function revealRole(state: GameState, self: CharacterId): void {
  const revealed = state.loop.revealedRoleCharacters ??= [];
  if (!revealed.includes(self)) {
    revealed.push(self);
    const information = state.loop.publicInformationThisLoop ??= [];
    information.push({
      kind: "roleReveal",
      character: self,
      role: effectiveRole(state, self),
      loop: state.loop.loop,
      day: state.loop.day,
    });
  }
}

function roleWasRevealed(
  state: GameState,
  self: CharacterId,
): boolean {
  return Boolean(
    state.loop.revealedRoleCharacters?.includes(self) ||
    state.history.some(
      (loop) => loop.revealedRoleCharacters?.includes(self),
    ),
  );
}

function counterpartDied(
  state: GameState,
  counterpartRole: RoleId,
  context: HookContext | undefined,
): boolean {
  return context?.kind === "death" && context.deadCharacters.some(
    (character) => effectiveRole(state, character) === counterpartRole,
  );
}

/** 입문편·기본편 역할 — 총 14건 */
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
  // ── 골칫거리 (Curmudgeon)
  curmudgeon: {
    ko: "골칫거리",
    goodwillRefusal: "Optional",
    hooks: [], // 추가 능력 없음
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
        // IMPLEMENTED_ELSEWHERE: src/engine/loss.ts evaluateLoss()
        // 일반 ALWAYS 디스패처가 아니라 즉시 패배 조건 조회로 처리한다.
        when: (s: GameState, self: CharacterId) =>
          isCharacterDead(s.loop.board[self]),
        effect: (s: GameState, _self: CharacterId) => {
          requestLoopEnd(s, "effect");
        },
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
        when: (s: GameState, self: CharacterId) => {
          const keyPerson = characterWithRole(s, "keyPerson");
          return (
            keyPerson !== undefined &&
            isCharacterAlive(s.loop.board[keyPerson]) &&
            s.loop.charCounters[keyPerson].intrigue >= 2 &&
            abilityLocationsOf(s, self).includes(
              characterLocation(s.loop.board[keyPerson], keyPerson),
            )
          );
        },
        effect: (s: GameState, _self: CharacterId) => {
          const keyPerson = characterWithRole(s, "keyPerson");
          if (keyPerson !== undefined) {
            killCharacter(s, keyPerson);
          }
        },
      },
      {
        phase: "P9_ROUND_END",
        kind: "lossDeath",
        source: {
          timing: "Day End",
          prerequisite: `This character has at least 4 :intrigue:`,
        },
        when: (s: GameState, self: CharacterId) =>
          s.loop.charCounters[self].intrigue >= 4,
        // source.description이 없으므로 판정 외에 적용할 효과는 없다.
        effect: (_s: GameState, _self: CharacterId) => {},
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
        when: (_s: GameState, _self: CharacterId) => true,
        selectableTargets: brainIntrigueTargets,
        effect: (
          s: GameState,
          self: CharacterId,
          target?: Target,
        ) => {
          placeBrainIntrigue(s, self, target);
        },
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
        when: (_s: GameState, _self: CharacterId) => true,
        effect: (s: GameState, self: CharacterId) => {
          activateCultistIntrigueIgnore(s, self);
        },
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
        when: (_s: GameState, _self: CharacterId) => true,
        effect: (s: GameState, self: CharacterId) => {
          activateTimeTravelerGoodwillIgnore(s, self);
        },
      },
      {
        phase: "P9_ROUND_END",
        kind: "optional",
        source: {
          timing: "Day End, Last Day",
          prerequisite: `There is 2 or less :goodwill: on this character.`,
          description: `Loop ends`,
        },
        when: (s: GameState, self: CharacterId) =>
          isLastDay(s) &&
          s.loop.charCounters[self].goodwill <= 2,
        effect: (s: GameState, _self: CharacterId) => {
          requestLoopEnd(s, "effect");
        },
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
        when: (s: GameState, self: CharacterId) =>
          isCharacterDead(s.loop.board[self]),
        effect: (s: GameState, self: CharacterId) => {
          revealRole(s, self);
        },
      },
      {
        phase: "LOOP_START",
        kind: "mandatory",
        source: {
          timing: "Loop Start",
          prerequisite: `This role has been revealed`,
          description: `This character gets 1 :goodwill:.`,
        },
        when: (s: GameState, self: CharacterId) =>
          roleWasRevealed(s, self),
        effect: (s: GameState, self: CharacterId) => {
          s.loop.charCounters[self].goodwill += 1;
        },
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
        when: (_s: GameState, _self: CharacterId) => true,
        selectableTargets: livingCharacterTargetsInAbilityLocations,
        effect: (
          s: GameState,
          self: CharacterId,
          target?: Target,
        ) => {
          placeConspiracyTheoristParanoia(s, self, target);
        },
      },
    ],
  },
  // ── 연인B (Lover)
  lover: {
    ko: "연인B",
    hooks: [
      {
        phase: "ON_DEATH",
        kind: "mandatory",
        source: {
          timing: "Always",
          prerequisite: `The :lovedOne: dies`,
          description: `This character gets 6 :paranoia:.`,
        },
        when: (
          s: GameState,
          _self: CharacterId,
          context?: HookContext,
        ) => counterpartDied(s, "lovedOne", context),
        effect: (s: GameState, self: CharacterId) => {
          if (isCharacterAlive(s.loop.board[self])) {
            s.loop.charCounters[self].paranoia += 6;
          }
        },
      },
    ],
  },
  // ── 연인A (Loved One)
  lovedOne: {
    ko: "연인A",
    hooks: [
      {
        phase: "ON_DEATH",
        kind: "mandatory",
        source: {
          timing: "Always",
          prerequisite: `The :lover: dies`,
          description: `This character gets 6 :paranoia:.`,
        },
        when: (
          s: GameState,
          _self: CharacterId,
          context?: HookContext,
        ) => counterpartDied(s, "lover", context),
        effect: (s: GameState, self: CharacterId) => {
          if (isCharacterAlive(s.loop.board[self])) {
            s.loop.charCounters[self].paranoia += 6;
          }
        },
      },
      {
        phase: "P9_ROUND_END",
        kind: "lossDeath",
        source: {
          timing: "Day End",
          prerequisite: `This character has at least 3 :paranoia: and at least 1 :intrigue:.`,
        },
        when: (s: GameState, self: CharacterId) =>
          s.loop.charCounters[self].paranoia >= 3 &&
          s.loop.charCounters[self].intrigue >= 1,
        // source.description이 없으므로 판정 외에 적용할 효과는 없다.
        effect: (_s: GameState, _self: CharacterId) => {},
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
        when: (s: GameState, self: CharacterId) =>
          otherLivingCharactersInThisLocation(s, self).length === 1,
        effectTarget: (s: GameState, self: CharacterId) => {
          const target = otherLivingCharactersInThisLocation(s, self)[0];
          return target === undefined
            ? undefined
            : { kind: "character", id: target };
        },
        effect: (
          s: GameState,
          self: CharacterId,
          target?: Target,
        ) => {
          const fallbackTargets = target?.kind === "character"
            ? []
            : otherLivingCharactersInThisLocation(s, self);
          const targetCharacter = target?.kind === "character"
            ? target.id
            : fallbackTargets.length === 1
              ? fallbackTargets[0]
              : undefined;
          if (targetCharacter === undefined) {
            return;
          }
          killCharacter(s, targetCharacter);
        },
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
        // IMPLEMENTED_ELSEWHERE: effectiveAbilityRoles()가 이 훅을 조회한다.
        when: (s: GameState, _self: CharacterId) =>
          factorHasConspiracyTheoristAbility(s),
        effect: (_s: GameState, _self: CharacterId) =>
          "conspiracyTheorist",
      },
      {
        phase: "ALWAYS",
        kind: "mandatory",
        source: {
          timing: "Always",
          prerequisite: `There is at least 2 :intrigue: on the City`,
          description: `This character gains the :keyPerson:’s ability, but not its role.`,
        },
        // IMPLEMENTED_ELSEWHERE: effectiveAbilityRoles()가 이 훅을 조회한다.
        when: (s: GameState, _self: CharacterId) =>
          factorHasKeyPersonAbility(s),
        effect: (_s: GameState, _self: CharacterId) => "keyPerson",
      },
    ],
  },
};

/** 역할 정체성은 유지하면서 현재 획득한 역할 능력만 함께 반환한다. */
export function effectiveAbilityRoles(
  state: GameState,
  character: CharacterId,
): RoleId[] {
  const role = effectiveRole(state, character);
  const abilityRoles = [role];
  if (role !== "factor") {
    return abilityRoles;
  }

  for (const grantHook of ROLE_IMPL.factor.hooks) {
    if (!grantHook.when(state, character)) {
      continue;
    }
    const grantedRole = grantHook.effect(state, character);
    if (grantedRole && !abilityRoles.includes(grantedRole)) {
      abilityRoles.push(grantedRole);
    }
  }
  return abilityRoles;
}
