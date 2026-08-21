import basicTragedyScriptsJson from "../data/basic-tragedy-scripts.json";
import charactersJson from "../data/characters.json";
import firstStepsScriptsJson from "../data/first-steps-scripts.json";
import goodwillAbilitiesJson from "../data/goodwill-abilities.json";
import { validateScenario } from "./engine/validate";
import { applyScenarioErrata } from "./errata";

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
  plotLessRole: boolean;
  comesInLater: boolean;
  goodwillAbilities: readonly GoodwillAbilityData[];
}

export interface GoodwillAbilityData {
  rank: number | null;
  en: string;
  ko: string;
  timesPerLoop: number | null;
  restrictedToLocation: readonly Location[] | null;
  immuneToGoodwillRefusel: boolean;
  minLoop: number | null;
}

export interface ScenarioAdapterOptions {
  /** 번들 각본 ID. 주어지면 검증 전에 정오표 오버레이를 적용한다. */
  scenarioId?: string;
  /** difficultySets에서 사용할 항목. 원본에 적힌 첫 항목이 기본값이다. */
  difficultyIndex?: number;
  /** 원본 각본 메타데이터를 테스트·도구에서 덮어쓸 때 사용한다. */
  scriptSpecified?: Readonly<Record<string, unknown>>;
  /** 카탈로그에서 출처별 검증 결과를 별도로 보존할 때 검증 예외를 건너뛴다. */
  skipValidation?: boolean;
}

export interface ScriptDifficulty {
  index: number;
  numberOfLoops: number;
  difficulty: number;
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

function goodwillAbilityMetadata(
  id: CharacterId,
  abilityIndex: number,
): { ko?: string; minLoop: number | null } {
  const rawAbilities = (
    goodwillAbilitiesJson as unknown as Record<string, unknown>
  )[id];
  if (!Array.isArray(rawAbilities)) return { minLoop: null };

  const rawAbility = rawAbilities.find((candidate) =>
    isRecord(candidate) && candidate.abilityIndex === abilityIndex
  );
  if (!isRecord(rawAbility)) return { minLoop: null };

  const ko = typeof rawAbility.ko === "string" ? rawAbility.ko : undefined;
  if (rawAbility.minLoop === undefined) return { ko, minLoop: null };

  const minLoop = requireNumber(
    rawAbility.minLoop,
    `goodwill ability "${id}:${abilityIndex}".minLoop`,
  );
  if (!Number.isInteger(minLoop) || minLoop < 1) {
    throw new Error(
      `goodwill ability "${id}:${abilityIndex}".minLoop must be a positive integer`,
    );
  }
  return { ko, minLoop };
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
  if (typeof raw.plotLessRole !== "boolean") {
    throw new Error(`character "${id}".plotLessRole must be a boolean`);
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

    const metadata = goodwillAbilityMetadata(id, index);
    const en = requireString(entry.en, `${context}.en`);
    return {
      rank: requireNullableNumber(entry.rank, `${context}.rank`),
      en,
      ko: metadata.ko ?? en,
      timesPerLoop: requireNullableNumber(
        entry.timesPerLoop,
        `${context}.timesPerLoop`,
      ),
      restrictedToLocation,
      immuneToGoodwillRefusel:
        entry.immuneToGoodwillRefusel === true,
      minLoop: metadata.minLoop,
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
    plotLessRole: raw.plotLessRole,
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

export function scriptDifficulties(value: unknown): ScriptDifficulty[] {
  const raw = requireRecord(value, "tragedy script");
  const title = typeof raw.title === "string" ? raw.title : "(untitled)";
  const context = `tragedy script "${title}"`;
  return requireArray(raw.difficultySets, `${context}.difficultySets`).map(
    (entry, index) => {
      const difficulty = requireRecord(
        entry,
        `${context}.difficultySets[${index}]`,
      );
      return {
        index,
        numberOfLoops: requireNumber(
          difficulty.numberOfLoops,
          `${context}.difficultySets[${index}].numberOfLoops`,
        ),
        difficulty: requireNumber(
          difficulty.difficulty,
          `${context}.difficultySets[${index}].difficulty`,
        ),
      };
    },
  );
}

export function adaptTragedyScript(
  value: unknown,
  options: ScenarioAdapterOptions = {},
): Scenario {
  const raw = requireRecord(value, "tragedy script");
  const title =
    typeof raw.title === "string" ? raw.title : "(untitled tragedy script)";
  const context = `tragedy script "${title}"`;

  const mainPlots = requireStringArray(raw.mainPlot, `${context}.mainPlot`);
  if (mainPlots.length !== 1) {
    throw new Error(`${context}.mainPlot must contain exactly one plot`);
  }

  const difficultySets = scriptDifficulties(raw);
  const difficultyIndex = options.difficultyIndex ?? 0;
  const selectedDifficulty = difficultySets[difficultyIndex];
  if (!selectedDifficulty) {
    throw new Error(
      `${context}.difficultySets has no entry at index ${difficultyIndex}`,
    );
  }
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
    loops: selectedDifficulty.numberOfLoops,
    difficultyIndex,
    difficulty: selectedDifficulty.difficulty,
    daysPerLoop: requireNumber(raw.daysPerLoop, `${context}.daysPerLoop`),
    scriptSpecified:
      Object.keys(scriptSpecified).length > 0 ? scriptSpecified : undefined,
  };
  if (options.scenarioId !== undefined) {
    applyScenarioErrata(options.scenarioId, title, scenario);
  }
  if (options.skipValidation !== true) {
    const validation = validateScenario(scenario);
    if (!validation.ok) {
      throw new Error(validation.errors.join("\n"));
    }
  }
  return scenario;
}

/** 이전 호출부 호환용. 새 코드는 참극 세트 공통 어댑터를 사용한다. */
export const adaptBasicTragedyScript = adaptTragedyScript;

const rawBasicTragedyScripts: readonly unknown[] = basicTragedyScriptsJson;
const rawFirstStepsScripts: readonly unknown[] = firstStepsScriptsJson;

export function loadBasicTragedyScenarios(
  options: ScenarioAdapterOptions = {},
): Scenario[] {
  return rawBasicTragedyScripts.map((script, index) =>
    adaptTragedyScript(script, {
      ...options,
      scenarioId: `basicTragedy:${index + 1}`,
    })
  );
}

export function loadFirstStepsScenarios(
  options: ScenarioAdapterOptions = {},
): Scenario[] {
  return rawFirstStepsScripts.map((script, index) =>
    adaptTragedyScript(script, {
      ...options,
      scenarioId: `firstSteps:${index + 1}`,
    })
  );
}
