import goodwillAbilitiesJson from "../../data/goodwill-abilities.json";
import { characterDataOf } from "../data";
import {
  LOCATIONS,
  type ActionCard,
  type CharacterId,
  type GameState,
  type Location,
  type Target,
} from "../types";

export type GoodwillTargetScope =
  | "sameLocation"
  | "anyCharacter"
  | "anyLocation"
  | "self"
  | "none";

type GoodwillTargetKind = Target["kind"];
type GoodwillTargetPredicate =
  | "alive"
  | "dead"
  | "aliveIfCharacter"
  | "inUserTurf"
  | "isPatient"
  | "panicked"
  | "hasIntrigue";

export interface StructuredGoodwillAbility {
  abilityIndex: number;
  rank: number;
  ko: string | null;
  target: {
    scope: GoodwillTargetScope;
    excludeSelf: boolean;
    tags: readonly string[];
    kinds?: readonly GoodwillTargetKind[];
    predicates?: readonly GoodwillTargetPredicate[];
    count?: number;
  };
  effect: Readonly<Record<string, unknown>>;
  choices: readonly string[] | null;
  timesPerLoop: number | null;
  restrictedToLocation: readonly Location[] | null;
  cannotBeRefused?: boolean;
  _source: string;
}

export type GoodwillDisabledReason =
  | "spent"
  | "restrictedLocation"
  | "noTarget"
  | "noSpentCard"
  | "unsupportedTurf"
  | "multipleTargets";

export type GoodwillChoice =
  | { kind: "none" }
  | { kind: "paranoiaDelta"; options: readonly (-1 | 1)[] }
  | { kind: "spentCard"; options: readonly ActionCard[] }
  | { kind: "incident"; options: readonly string[] }
  | { kind: "pastIncident"; options: readonly string[] }
  | { kind: "subplot"; options: readonly string[] }
  | { kind: "counter"; options: readonly string[] };

export interface GoodwillAbilityView {
  character: CharacterId;
  abilityIndex: number;
  key: string;
  schema: StructuredGoodwillAbility;
  targets: readonly Target[];
  targetRequired: boolean;
  choice: GoodwillChoice;
  disabledReason?: GoodwillDisabledReason;
}

const GOODWILL_ABILITIES = goodwillAbilitiesJson as unknown as Readonly<
  Record<CharacterId, readonly StructuredGoodwillAbility[]>
>;

function targetKinds(
  ability: StructuredGoodwillAbility,
): readonly GoodwillTargetKind[] {
  return ability.target.kinds ?? (
    ability.target.scope === "anyLocation" ? ["location"] : ["character"]
  );
}

function characterPassesPredicates(
  state: GameState,
  character: CharacterId,
  predicates: readonly GoodwillTargetPredicate[],
): boolean {
  const board = state.loop.board[character];
  const counters = state.loop.charCounters[character];
  return predicates.every((predicate) => {
    switch (predicate) {
      case "alive":
      case "aliveIfCharacter":
        return board.alive;
      case "dead":
        return !board.alive;
      case "isPatient":
        return character === "patient";
      case "panicked":
        return counters.paranoia >= characterDataOf(character).paranoiaLimit;
      case "hasIntrigue":
        return counters.intrigue >= 1;
      case "inUserTurf":
        return true;
    }
  });
}

function characterTargets(
  state: GameState,
  user: CharacterId,
  ability: StructuredGoodwillAbility,
): Target[] {
  if (!targetKinds(ability).includes("character")) return [];
  const userLocation = state.loop.board[user].at;
  const predicates = ability.target.predicates ?? [];

  return Object.keys(state.loop.board).flatMap((character) => {
    if (ability.target.excludeSelf && character === user) return [];
    if (
      ability.target.scope === "sameLocation" &&
      state.loop.board[character].at !== userLocation
    ) return [];
    if (
      ability.target.tags.some((tag) =>
        !characterDataOf(character).tags.includes(tag)
      )
    ) return [];
    if (!characterPassesPredicates(state, character, predicates)) return [];
    return [{ kind: "character" as const, id: character }];
  });
}

function locationTargets(
  state: GameState,
  user: CharacterId,
  ability: StructuredGoodwillAbility,
): Target[] {
  if (!targetKinds(ability).includes("location")) return [];
  const locations = ability.target.scope === "sameLocation"
    ? [state.loop.board[user].at]
    : LOCATIONS;
  return locations.map((at) => ({ kind: "location" as const, at }));
}

function targetsFor(
  state: GameState,
  user: CharacterId,
  ability: StructuredGoodwillAbility,
): Target[] {
  if (ability.target.scope === "none" || ability.target.scope === "self") {
    return [];
  }
  return [
    ...characterTargets(state, user, ability),
    ...locationTargets(state, user, ability),
  ];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function choiceFor(
  state: GameState,
  choices: readonly string[] | null,
): GoodwillChoice {
  if (choices === null) return { kind: "none" };
  if (choices.length === 2 && choices.includes("+1") && choices.includes("-1")) {
    return {
      kind: "paranoiaDelta",
      options: choices.map((choice) => choice === "+1" ? 1 : -1),
    };
  }
  if (choices.length === 1 && choices[0] === "spentOncePerLoopCard") {
    return {
      kind: "spentCard",
      options: state.loop.spentOncePerLoop.protagonists[state.loop.leader],
    };
  }
  if (choices.length === 1 && choices[0] === "incident") {
    return {
      kind: "incident",
      options: unique(state.scenario.incidents.map(({ incident }) => incident)),
    };
  }
  if (choices.length === 1 && choices[0] === "pastIncident") {
    return {
      kind: "pastIncident",
      options: unique(state.loop.incidentsFiredThisLoop ?? []),
    };
  }
  if (choices.length === 1 && choices[0] === "subplot") {
    return { kind: "subplot", options: state.scenario.subPlots };
  }
  return { kind: "counter", options: choices };
}

function disabledReasonFor(
  state: GameState,
  character: CharacterId,
  ability: StructuredGoodwillAbility,
  targets: readonly Target[],
  choice: GoodwillChoice,
): GoodwillDisabledReason | undefined {
  const key = `${character}:goodwill:${ability.abilityIndex}`;
  const used = state.loop.abilitiesUsedThisLoop.filter(
    (usedKey) => usedKey === key,
  ).length;
  if (ability.timesPerLoop !== null && used >= ability.timesPerLoop) {
    return "spent";
  }
  if (
    ability.restrictedToLocation !== null &&
    !ability.restrictedToLocation.includes(state.loop.board[character].at)
  ) {
    return "restrictedLocation";
  }
  if (ability.target.predicates?.includes("inUserTurf")) {
    return "unsupportedTurf";
  }
  const targetCount = ability.target.count ?? 1;
  if (targetCount > 1) return "multipleTargets";
  if (
    ability.target.scope !== "none" &&
    ability.target.scope !== "self" &&
    targets.length < targetCount
  ) {
    return "noTarget";
  }
  if (choice.kind === "spentCard" && choice.options.length === 0) {
    return "noSpentCard";
  }
  return undefined;
}

/** P6에 표시할 능력을 구조화 데이터의 제약과 현재 상태로 계산한다. */
export function goodwillAbilityViews(state: GameState): GoodwillAbilityView[] {
  return Object.keys(state.loop.board).flatMap((character) =>
    (GOODWILL_ABILITIES[character] ?? []).flatMap((schema) => {
      if (state.loop.charCounters[character].goodwill < schema.rank) return [];
      const targets = targetsFor(state, character, schema);
      const choice = choiceFor(state, schema.choices);
      return [{
        character,
        abilityIndex: schema.abilityIndex,
        key: `${character}:goodwill:${schema.abilityIndex}`,
        schema,
        targets,
        targetRequired:
          schema.target.scope !== "none" && schema.target.scope !== "self",
        choice,
        disabledReason: disabledReasonFor(
          state,
          character,
          schema,
          targets,
          choice,
        ),
      }];
    })
  );
}
