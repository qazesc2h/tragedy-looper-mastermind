import basicTragedyScriptsJson from "../data/basic-tragedy-scripts.json";
import charactersJson from "../data/characters.json";
import { validateScenario } from "./engine/validate";

import type {
  CharacterId,
  Location,
  RoleId,
  Scenario,
} from "./types";

export interface CharacterData {
  id: CharacterId;
  en: string;
  ko: string;
  paranoiaLimit: number;
  startLocation: readonly Location[];
  forbiddenLocation: readonly Location[];
  tags: readonly string[];
  comesInLater: boolean;
  goodwillAbilities: readonly GoodwillAbilityData[];
}

export interface GoodwillAbilityData {
  rank: number | null;
  en: string;
  timesPerLoop: number | null;
  restrictedToLocation: readonly Location[] | null;
  immuneToGoodwillRefusel: boolean;
}

export interface ScenarioAdapterOptions {
  /** difficultySets에서 사용할 항목. 원본에 적힌 첫 항목이 기본값이다. */
  difficultyIndex?: number;
  /** 루프 시작마다 각본가가 지정해야 하는 값. */
  scriptSpecified?: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value;
}

function requireArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  return value;
}

function requireString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new Error(`${context} must be a string`);
  }
  return value;
}

function requireNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context} must be a finite number`);
  }
  return value;
}

function requireNullableNumber(
  value: unknown,
  context: string,
): number | null {
  return value === null ? null : requireNumber(value, context);
}

function requireStringArray(value: unknown, context: string): string[] {
  return requireArray(value, context).map((entry, index) =>
    requireString(entry, `${context}[${index}]`)
  );
}

function parseLocation(value: unknown, context: string): Location {
  if (
    value !== "Hospital" &&
    value !== "Shrine" &&
    value !== "City" &&
    value !== "School"
  ) {
    throw new Error(`${context} is not a valid location`);
  }
  return value;
}

function parseCharacterData(id: CharacterId, value: unknown): CharacterData {
  const raw = requireRecord(value, `character "${id}"`);
  const rawId = requireString(raw.id, `character "${id}".id`);
  if (rawId !== id) {
    throw new Error(`character key "${id}" does not match id "${rawId}"`);
  }
  const paranoiaLimit = requireNumber(
    raw.paranoiaLimit,
    `character "${id}".paranoiaLimit`,
  );

  const startLocation = requireArray(
    raw.startLocation,
    `character "${id}".startLocation`,
  ).map((location, index) =>
    parseLocation(location, `character "${id}".startLocation[${index}]`)
  );
  if (startLocation.length === 0) {
    throw new Error(`character "${id}" has no start location`);
  }
  const forbiddenLocation = requireArray(
    raw.forbiddenLocation,
    `character "${id}".forbiddenLocation`,
  ).map((location, index) =>
    parseLocation(location, `character "${id}".forbiddenLocation[${index}]`)
  );
  if (typeof raw.comesInLater !== "boolean") {
    throw new Error(`character "${id}".comesInLater must be a boolean`);
  }
  const tags = requireStringArray(raw.tags, `character "${id}".tags`);
  const goodwillAbilities = requireArray(
    raw.goodwillAbilities,
    `character "${id}".goodwillAbilities`,
  ).map((ability, index): GoodwillAbilityData => {
    const context = `character "${id}".goodwillAbilities[${index}]`;
    const entry = requireRecord(ability, context);
    const restrictedToLocation = entry.restrictedToLocation === null
      ? null
      : requireArray(
        entry.restrictedToLocation,
        `${context}.restrictedToLocation`,
      ).map((location, locationIndex) =>
        parseLocation(
          location,
          `${context}.restrictedToLocation[${locationIndex}]`,
        )
      );

    return {
      rank: requireNullableNumber(entry.rank, `${context}.rank`),
      en: requireString(entry.en, `${context}.en`),
      timesPerLoop: requireNullableNumber(
        entry.timesPerLoop,
        `${context}.timesPerLoop`,
      ),
      restrictedToLocation,
      immuneToGoodwillRefusel:
        entry.immuneToGoodwillRefusel === true,
    };
  });

  return {
    id,
    en: requireString(raw.en, `character "${id}".en`),
    ko: typeof raw.ko === "string"
      ? raw.ko
      : requireString(raw.en, `character "${id}".en`),
    paranoiaLimit,
    startLocation,
    forbiddenLocation,
    tags,
    comesInLater: raw.comesInLater,
    goodwillAbilities,
  };
}

const rawCharacters: Record<string, unknown> = charactersJson;

export const CHARACTERS: Readonly<Record<CharacterId, CharacterData>> =
  Object.fromEntries(
    Object.entries(rawCharacters)
      .filter(([id]) => !id.startsWith("_"))
      .map(([id, value]) => [
        id,
        parseCharacterData(id, value),
      ]),
  );

export function characterDataOf(id: CharacterId): CharacterData {
  const character = CHARACTERS[id];
  if (!character) {
    throw new Error(`unknown character "${id}"`);
  }
  return character;
}

function parseCast(
  value: unknown,
  context: string,
): {
  cast: Record<CharacterId, RoleId>;
  scriptSpecified: Record<string, unknown>;
} {
  const rawCast = requireRecord(value, context);
  const cast: Record<CharacterId, RoleId> = {};
  const scriptSpecified: Record<string, unknown> = {};

  for (const [character, rawRole] of Object.entries(rawCast)) {
    if (typeof rawRole === "string") {
      cast[character] = rawRole;
      continue;
    }

    const roleAndMetadata = requireArray(rawRole, `${context}.${character}`);
    if (roleAndMetadata.length !== 2) {
      throw new Error(
        `${context}.${character} must contain a role and script metadata`,
      );
    }
    cast[character] = requireString(
      roleAndMetadata[0],
      `${context}.${character}[0]`,
    );

    const metadata = requireRecord(
      roleAndMetadata[1],
      `${context}.${character}[1]`,
    );
    for (const [name, metadataValue] of Object.entries(metadata)) {
      scriptSpecified[`${name}:${character}`] = metadataValue;
    }
  }

  return { cast, scriptSpecified };
}

function parseIncidents(
  value: unknown,
  context: string,
): Scenario["incidents"] {
  return requireArray(value, context).map((entry, index) => {
    const raw = requireRecord(entry, `${context}[${index}]`);
    return {
      day: requireNumber(raw.day, `${context}[${index}].day`),
      incident: requireString(
        raw.incident,
        `${context}[${index}].incident`,
      ),
      culprit: requireString(
        raw.culprit,
        `${context}[${index}].culprit`,
      ),
    };
  });
}

export function adaptBasicTragedyScript(
  value: unknown,
  options: ScenarioAdapterOptions = {},
): Scenario {
  const raw = requireRecord(value, "basic tragedy script");
  const title =
    typeof raw.title === "string" ? raw.title : "(untitled basic tragedy)";
  const context = `basic tragedy script "${title}"`;

  const mainPlots = requireStringArray(raw.mainPlot, `${context}.mainPlot`);
  if (mainPlots.length !== 1) {
    throw new Error(`${context}.mainPlot must contain exactly one plot`);
  }

  const difficultySets = requireArray(
    raw.difficultySets,
    `${context}.difficultySets`,
  );
  const difficultyIndex = options.difficultyIndex ?? 0;
  const selectedDifficulty = difficultySets[difficultyIndex];
  if (!selectedDifficulty) {
    throw new Error(
      `${context}.difficultySets has no entry at index ${difficultyIndex}`,
    );
  }
  const difficulty = requireRecord(
    selectedDifficulty,
    `${context}.difficultySets[${difficultyIndex}]`,
  );

  const { cast, scriptSpecified: castMetadata } = parseCast(
    raw.cast,
    `${context}.cast`,
  );
  const scriptSpecified = {
    ...castMetadata,
    ...options.scriptSpecified,
  };

  const scenario: Scenario = {
    tragedySet: requireString(raw.tragedySet, `${context}.tragedySet`),
    mainPlot: mainPlots[0],
    subPlots: requireStringArray(raw.subPlots, `${context}.subPlots`),
    cast,
    incidents: parseIncidents(raw.incidents, `${context}.incidents`),
    loops: requireNumber(
      difficulty.numberOfLoops,
      `${context}.difficultySets[${difficultyIndex}].numberOfLoops`,
    ),
    daysPerLoop: requireNumber(raw.daysPerLoop, `${context}.daysPerLoop`),
    scriptSpecified:
      Object.keys(scriptSpecified).length > 0 ? scriptSpecified : undefined,
  };
  const validation = validateScenario(scenario);
  if (!validation.ok) {
    throw new Error(validation.errors.join("\n"));
  }
  return scenario;
}

const rawBasicTragedyScripts: readonly unknown[] = basicTragedyScriptsJson;

export function loadBasicTragedyScenarios(
  options: ScenarioAdapterOptions = {},
): Scenario[] {
  return rawBasicTragedyScripts.map((script) =>
    adaptBasicTragedyScript(script, options)
  );
}
