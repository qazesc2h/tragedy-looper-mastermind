import errataJson from "../data/errata.json";
import type { CharacterId, RoleId, Scenario } from "./types";

interface ScenarioErratumBase {
  scenario: string;
  title: string;
  source: string;
  verifiedBy: string;
}

export interface ScenarioCastErratum extends ScenarioErratumBase {
  field: `cast.${string}`;
  printed: RoleId;
  corrected: RoleId;
}

export interface ScenarioIncidentDayErratum extends ScenarioErratumBase {
  field: `incidents[${number}].day`;
  printed: number;
  corrected: number;
}

export type ScenarioErratum =
  | ScenarioCastErratum
  | ScenarioIncidentDayErratum;

export interface CharacterAbilityErratum {
  character: CharacterId;
  ability: string;
  field: string;
  printed: string;
  corrected: string;
  interpretation: "mandatory" | "optional";
  source: string;
  answeredAt: string;
  verifiedBy: string;
  implementation: string;
  runtimeChangeRequired: boolean;
}

interface ErrataFile {
  _note: string;
  corrections: ScenarioErratum[];
  characterAbilityCorrections: CharacterAbilityErratum[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  value: unknown,
  context: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function requireBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${context} must be a boolean`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${context} must be a positive integer`);
  }
  return value;
}

function incidentDayIndex(field: string): number | undefined {
  const match = /^incidents\[(\d+)\]\.day$/.exec(field);
  return match === null ? undefined : Number(match[1]);
}

function parseErrataFile(value: unknown): ErrataFile {
  if (!isRecord(value)) throw new Error("errata must be an object");
  if (!Array.isArray(value.corrections)) {
    throw new Error("errata.corrections must be an array");
  }
  if (!Array.isArray(value.characterAbilityCorrections)) {
    throw new Error("errata.characterAbilityCorrections must be an array");
  }

  const seenFields = new Set<string>();
  const corrections = value.corrections.map((entry, index): ScenarioErratum => {
    const context = `errata.corrections[${index}]`;
    if (!isRecord(entry)) throw new Error(`${context} must be an object`);
    const scenario = requireString(entry.scenario, `${context}.scenario`);
    const title = requireString(entry.title, `${context}.title`);
    const field = requireString(entry.field, `${context}.field`);
    const key = `${scenario}:${field}`;
    if (seenFields.has(key)) {
      throw new Error(`errata duplicates correction "${key}"`);
    }
    seenFields.add(key);
    const source = requireString(entry.source, `${context}.source`);
    const verifiedBy = requireString(
      entry.verifiedBy,
      `${context}.verifiedBy`,
    );
    if (field.startsWith("cast.") && field.length > "cast.".length) {
      return {
        scenario,
        title,
        field: field as `cast.${string}`,
        printed: requireString(entry.printed, `${context}.printed`),
        corrected: requireString(entry.corrected, `${context}.corrected`),
        source,
        verifiedBy,
      };
    }
    if (incidentDayIndex(field) !== undefined) {
      return {
        scenario,
        title,
        field: field as `incidents[${number}].day`,
        printed: requirePositiveInteger(entry.printed, `${context}.printed`),
        corrected: requirePositiveInteger(
          entry.corrected,
          `${context}.corrected`,
        ),
        source,
        verifiedBy,
      };
    }
    throw new Error(`${context}.field is not a supported scenario field`);
  });

  const characterAbilityCorrections = value.characterAbilityCorrections.map(
    (entry, index): CharacterAbilityErratum => {
      const context = `errata.characterAbilityCorrections[${index}]`;
      if (!isRecord(entry)) throw new Error(`${context} must be an object`);
      const interpretation = requireString(
        entry.interpretation,
        `${context}.interpretation`,
      );
      if (interpretation !== "mandatory" && interpretation !== "optional") {
        throw new Error(
          `${context}.interpretation must be mandatory or optional`,
        );
      }
      return {
        character: requireString(entry.character, `${context}.character`),
        ability: requireString(entry.ability, `${context}.ability`),
        field: requireString(entry.field, `${context}.field`),
        printed: requireString(entry.printed, `${context}.printed`),
        corrected: requireString(entry.corrected, `${context}.corrected`),
        interpretation,
        source: requireString(entry.source, `${context}.source`),
        answeredAt: requireString(entry.answeredAt, `${context}.answeredAt`),
        verifiedBy: requireString(entry.verifiedBy, `${context}.verifiedBy`),
        implementation: requireString(
          entry.implementation,
          `${context}.implementation`,
        ),
        runtimeChangeRequired: requireBoolean(
          entry.runtimeChangeRequired,
          `${context}.runtimeChangeRequired`,
        ),
      };
    },
  );

  return {
    _note: requireString(value._note, "errata._note"),
    corrections,
    characterAbilityCorrections,
  };
}

const errata = parseErrataFile(errataJson);

export const ERRATA_NOTE = errata._note;
export const CHARACTER_ABILITY_ERRATA: readonly CharacterAbilityErratum[] =
  errata.characterAbilityCorrections;

export function scenarioErrataFor(
  scenarioId: string,
): readonly ScenarioErratum[] {
  return errata.corrections.filter(({ scenario }) => scenario === scenarioId);
}

/** 원본 각본을 파싱한 뒤, 검증 전에 확인된 정정값을 덮어쓴다. */
export function applyScenarioErrata(
  scenarioId: string,
  title: string,
  scenario: Scenario,
): readonly ScenarioErratum[] {
  const corrections = scenarioErrataFor(scenarioId);
  for (const correction of corrections) {
    if (correction.title !== title) {
      throw new Error(
        `errata title mismatch for "${scenarioId}": ` +
          `expected "${correction.title}", got "${title}"`,
      );
    }
  }
  applyScenarioErrataToLoadedScenario(scenarioId, scenario);
  return corrections;
}

/** 저장 데이터가 정정 전 값을 보존하고 있어도 현재 정오표로 이행한다. */
export function applyScenarioErrataToLoadedScenario(
  scenarioId: string,
  scenario: Scenario,
): readonly ScenarioErratum[] {
  const corrections = scenarioErrataFor(scenarioId);
  for (const correction of corrections) {
    if (typeof correction.corrected === "number") {
      const index = incidentDayIndex(correction.field);
      if (index === undefined) {
        throw new Error(`invalid incident day errata field "${correction.field}"`);
      }
      const incident = scenario.incidents[index];
      if (incident === undefined) {
        throw new Error(
          `errata incident index out of range for "${scenarioId}.${correction.field}"`,
        );
      }
      if (incident.day === correction.corrected) continue;
      if (incident.day !== correction.printed) {
        throw new Error(
          `errata printed value mismatch for "${scenarioId}.${correction.field}": ` +
            `expected "${correction.printed}", got "${incident.day}"`,
        );
      }
      incident.day = correction.corrected;
      continue;
    }
    const character: CharacterId = correction.field.slice("cast.".length);
    const current = scenario.cast[character];
    if (current === correction.corrected) continue;
    if (current !== correction.printed) {
      throw new Error(
        `errata printed value mismatch for "${scenarioId}.${correction.field}": ` +
          `expected "${correction.printed}", got "${String(current)}"`,
      );
    }
    scenario.cast[character] = correction.corrected;
  }
  return corrections;
}
