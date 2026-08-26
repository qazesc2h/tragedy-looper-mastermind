import goodwillAbilitiesJson from "../../data/goodwill-abilities.json";
import { characterDataOf } from "../data";
import { goodwillAbilityImplemented } from "../engine/goodwill";
import { tragedySetDefinition } from "../tragedy-sets";
import {
  abilityLocationsOf,
  characterLocation,
  isCharacterAlive,
  isCharacterDead,
  isCharacterPresent,
  LOCATIONS,
  type ActionCard,
  type CharacterId,
  type GameState,
  type IncidentSelection,
  type Location,
  type PlotId,
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
  minLoop?: number;
  immuneToGoodwillRefusel?: boolean;
  implemented?: boolean;
  _note?: string;
  _source: string;
}

export type GoodwillDisabledReason =
  | "dead"
  | "minLoop"
  | "notImplemented"
  | "usedThisRound"
  | "spent"
  | "restrictedLocation"
  | "noTarget"
  | "noSpentCard"
  | "noChoice"
  | "multipleTargets";

export type GoodwillChoice =
  | { kind: "none" }
  | { kind: "paranoiaDelta"; options: readonly (-1 | 1)[] }
  | { kind: "spentCard"; options: readonly ActionCard[] }
  | { kind: "incident"; options: readonly IncidentSelection[] }
  | { kind: "pastIncident"; options: readonly IncidentSelection[] }
  | {
    kind: "subplot";
    options: readonly PlotId[];
    revealOptions: readonly PlotId[];
  }
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
  disabledDiagnostic?: string;
}

export interface GoodwillRefusalHistoryEntry {
  character: CharacterId;
  occurrences: Array<{ loop: number; day: number }>;
}

export type AiIncidentChoiceField =
  | "target"
  | "otherTarget"
  | "location"
  | "counter";

/** AI [우호3]으로 사건 효과를 해결할 때 사건 원문이 요구하는 추가 선택. */
export function aiIncidentChoiceFields(
  incident: string,
): readonly AiIncidentChoiceField[] {
  switch (incident) {
    case "murder":
    case "farawayMurder":
      return ["target"];
    case "missingPerson":
      return ["location"];
    case "butterflyEffect":
      return ["counter", "target"];
    case "spreading":
    case "increasingUnease":
      return ["target", "otherTarget"];
    case "suicide":
    case "hospitalIncident":
    case "foulEvil":
      return [];
    default:
      throw new Error(`unknown AI incident choice fields for "${incident}"`);
  }
}

const GENERATED_GOODWILL_ABILITIES = goodwillAbilitiesJson as unknown as Readonly<
  Record<CharacterId, readonly StructuredGoodwillAbility[]>
>;

/** 생성물을 다시 만들지 않고 추가 지원하는 확장 캐릭터 능력. */
const SERVANT_GOODWILL_ABILITIES: readonly StructuredGoodwillAbility[] = [{
  abilityIndex: 1,
  rank: 4,
  ko: "다른 캐릭터 1명을 선택합니다. 이번 루프가 끝날 때까지, 이 캐릭터는 그 캐릭터도 섬깁니다.",
  target: {
    scope: "anyCharacter",
    excludeSelf: true,
    tags: [],
    predicates: ["alive"],
  },
  effect: { operation: "addServedCharacterUntilLoopEnd" },
  choices: null,
  timesPerLoop: 1,
  restrictedToLocation: null,
  implemented: true,
  _source: "Choose any other character. For the remainder of the Loop, she also serves that character.",
}];

function goodwillAbilitiesFor(
  character: CharacterId,
): readonly StructuredGoodwillAbility[] {
  if (character === "servant") return SERVANT_GOODWILL_ABILITIES;
  return GENERATED_GOODWILL_ABILITIES[character] ?? [];
}

export function encodeIncidentSelection(
  selection: IncidentSelection,
): string {
  return `${selection.day}:${selection.incident}`;
}

export function decodeIncidentSelection(
  value: string | undefined,
): IncidentSelection | undefined {
  if (!value) return undefined;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  const day = Number(value.slice(0, separator));
  const incident = value.slice(separator + 1);
  if (!Number.isInteger(day) || day < 1) return undefined;
  return { day, incident };
}

export function subplotRevealOptions(
  choice: Extract<GoodwillChoice, { kind: "subplot" }>,
  declaredSubplot: PlotId | undefined,
): PlotId[] {
  return choice.revealOptions.filter((plot) => plot !== declaredSubplot);
}

function targetKinds(
  ability: StructuredGoodwillAbility,
): readonly GoodwillTargetKind[] {
  return ability.target.kinds ?? (
    ability.target.scope === "anyLocation" ? ["location"] : ["character"]
  );
}

function characterPassesPredicates(
  state: GameState,
  user: CharacterId,
  character: CharacterId,
  predicates: readonly GoodwillTargetPredicate[],
): boolean {
  const board = state.loop.board[character];
  const counters = state.loop.charCounters[character];
  return predicates.every((predicate) => {
    switch (predicate) {
      case "alive":
      case "aliveIfCharacter":
        return isCharacterAlive(board);
      case "dead":
        return isCharacterDead(board);
      case "isPatient":
        return character === "patient";
      case "panicked":
        return counters.paranoia >= characterDataOf(character).paranoiaLimit;
      case "hasIntrigue":
        return counters.intrigue >= 1;
      case "inUserTurf":
        return state.loop.turfLocations[user] ===
          characterLocation(board, character);
    }
  });
}

function characterTargets(
  state: GameState,
  user: CharacterId,
  ability: StructuredGoodwillAbility,
): Target[] {
  if (!targetKinds(ability).includes("character")) return [];
  const userLocations = abilityLocationsOf(state, user);
  const predicates = ability.target.predicates ?? [];

  return Object.keys(state.loop.board).flatMap((character) => {
    if (!isCharacterPresent(state.loop.board[character])) return [];
    if (ability.target.excludeSelf && character === user) return [];
    if (
      ability.target.scope === "sameLocation" &&
      !userLocations.includes(
        characterLocation(state.loop.board[character], character),
      )
    ) return [];
    if (
      ability.target.tags.some((tag) =>
        !characterDataOf(character).tags.includes(tag)
      )
    ) return [];
    if (
      !characterPassesPredicates(state, user, character, predicates)
    ) return [];
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
    ? [characterLocation(state.loop.board[user], user)]
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

function uniqueIncidentSelections(
  values: readonly IncidentSelection[],
): IncidentSelection[] {
  const seen = new Set<string>();
  return values.filter((selection) => {
    const key = encodeIncidentSelection(selection);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
      options: uniqueIncidentSelections(
        state.scenario.incidents.map(({ day, incident }) => ({ day, incident })),
      ),
    };
  }
  if (choices.length === 1 && choices[0] === "pastIncident") {
    return {
      kind: "pastIncident",
      options: uniqueIncidentSelections(
        state.loop.incidentOccurrencesFiredThisLoop?.map(
          ({ day, incident }) => ({ day, incident }),
        ) ?? [],
      ),
    };
  }
  if (choices.length === 1 && choices[0] === "subplot") {
    return {
      kind: "subplot",
      options: [...tragedySetDefinition(state.scenario.tragedySet).subPlots],
      revealOptions: state.scenario.subPlots,
    };
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
  if (!isCharacterAlive(state.loop.board[character])) return "dead";
  if (ability.minLoop !== undefined && state.loop.loop < ability.minLoop) {
    return "minLoop";
  }
  if (!goodwillAbilityImplemented(character, ability.abilityIndex)) {
    return "notImplemented";
  }
  const key = `${character}:goodwill:${ability.abilityIndex}`;
  if (state.loop.abilitiesUsedThisRound.includes(key)) {
    return "usedThisRound";
  }
  const used = state.loop.abilitiesUsedThisLoop.filter(
    (usedKey) => usedKey === key,
  ).length;
  if (ability.timesPerLoop !== null && used >= ability.timesPerLoop) {
    return "spent";
  }
  if (
    ability.restrictedToLocation !== null &&
    !ability.restrictedToLocation.includes(
      characterLocation(state.loop.board[character], character),
    )
  ) {
    return "restrictedLocation";
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
  if (
    (choice.kind === "incident" || choice.kind === "pastIncident") &&
    choice.options.length === 0
  ) {
    return "noChoice";
  }
  if (
    choice.kind === "subplot" &&
    (choice.options.length === 0 || choice.revealOptions.length === 0)
  ) {
    return "noChoice";
  }
  return undefined;
}

function disabledDiagnosticFor(
  state: GameState,
  character: CharacterId,
  ability: StructuredGoodwillAbility,
  targets: readonly Target[],
  choice: GoodwillChoice,
  reason: GoodwillDisabledReason,
): string {
  switch (reason) {
    case "dead":
      return `status=${state.loop.board[character].status}`;
    case "minLoop":
      return `loop=${state.loop.loop}, minLoop=${ability.minLoop}`;
    case "notImplemented":
      return "implemented=false";
    case "usedThisRound":
      return `usedThisRound=${JSON.stringify(
        state.loop.abilitiesUsedThisRound,
      )}`;
    case "spent": {
      const key = `${character}:goodwill:${ability.abilityIndex}`;
      const used = state.loop.abilitiesUsedThisLoop.filter(
        (usedKey) => usedKey === key,
      ).length;
      return `used=${used}, limit=${ability.timesPerLoop}`;
    }
    case "restrictedLocation":
      return `at=${characterLocation(
        state.loop.board[character],
        character,
      )}, allowed=${
        JSON.stringify(ability.restrictedToLocation)
      }`;
    case "noTarget":
      return `scope=${ability.target.scope}, excludeSelf=${
        ability.target.excludeSelf
      }, tags=${JSON.stringify(ability.target.tags)}, predicates=${
        JSON.stringify(ability.target.predicates ?? [])
      }, candidates=${JSON.stringify(targets)}`;
    case "noSpentCard":
      return `leader=${state.loop.leader}, spent=${
        JSON.stringify(state.loop.spentOncePerLoop.protagonists)
      }`;
    case "noChoice":
      if (choice.kind === "subplot") {
        return `choice=subplot, declarations=${
          JSON.stringify(choice.options)
        }, reveals=${JSON.stringify(choice.revealOptions)}`;
      }
      if (
        choice.kind === "incident" ||
        choice.kind === "pastIncident" ||
        choice.kind === "counter"
      ) {
        return `choice=${choice.kind}, candidates=${JSON.stringify(choice.options)}`;
      }
      return `choice=${choice.kind}, candidates=[]`;
    case "multipleTargets":
      return `required=${ability.target.count ?? 1}, candidates=${
        JSON.stringify(targets)
      }`;
  }
}

/** P6에 표시할 능력을 구조화 데이터의 제약과 현재 상태로 계산한다. */
export function goodwillAbilityViews(state: GameState): GoodwillAbilityView[] {
  return Object.keys(state.loop.board).flatMap((character) => {
    // 시체와 부재 카드는 능력 사용자 목록 자체에서 제외한다. 시체를 대상으로
    // 하는 이세계인[우호5]·감식관[우호5]은 살아 있는 사용자의 target predicate
    // "dead" 경로로 계속 표시된다.
    if (!isCharacterAlive(state.loop.board[character])) return [];
    return goodwillAbilitiesFor(character).flatMap((schema) => {
      if (state.loop.charCounters[character].goodwill < schema.rank) return [];
      const targets = targetsFor(state, character, schema);
      const choice = choiceFor(state, schema.choices);
      const disabledReason = disabledReasonFor(
        state,
        character,
        schema,
        targets,
        choice,
      );
      return [{
        character,
        abilityIndex: schema.abilityIndex,
        key: `${character}:goodwill:${schema.abilityIndex}`,
        schema,
        targets,
        targetRequired:
          schema.target.scope !== "none" && schema.target.scope !== "self",
        choice,
        disabledReason,
        disabledDiagnostic: disabledReason === undefined
          ? undefined
          : disabledDiagnosticFor(
            state,
            character,
            schema,
            targets,
            choice,
            disabledReason,
          ),
      }];
    });
  });
}

/** 현재 루프와 이전 루프 스냅샷에서 주인공에게 공개된 거부 날짜를 모은다. */
export function goodwillRefusalHistory(
  state: GameState,
): GoodwillRefusalHistoryEntry[] {
  const byCharacter = new Map<CharacterId, Array<{ loop: number; day: number }>>();
  const seen = new Set<string>();
  for (const loop of [...state.history, state.loop]) {
    for (const information of loop.publicInformationThisLoop ?? []) {
      if (information.kind !== "goodwillRefusal") continue;
      const key = `${information.character}:${information.loop}:${information.day}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const occurrences = byCharacter.get(information.character) ?? [];
      occurrences.push({ loop: information.loop, day: information.day });
      byCharacter.set(information.character, occurrences);
    }
  }
  return [...byCharacter.entries()].map(([character, occurrences]) => ({
    character,
    occurrences: occurrences.sort(
      (left, right) => left.loop - right.loop || left.day - right.day,
    ),
  }));
}
