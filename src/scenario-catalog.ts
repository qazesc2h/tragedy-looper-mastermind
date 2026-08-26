import basicTragedyScriptsJson from "../data/basic-tragedy-scripts.json";
import firstStepsScriptsJson from "../data/first-steps-scripts.json";
import scenarioSourceJson from "../data/scenario-source.json";
import communityScriptsJson from "../scenarios/community-scripts.json";
import communityScenarioSourceJson from "../scenarios/scenario-source.json";
import {
  adaptTragedyScript,
  scriptDifficulties,
  type ScriptDifficulty,
} from "./data";
import {
  validateScenario,
  type ScenarioValidationResult,
} from "./engine/validate";
import { scenarioErrataFor, type ScenarioErratum } from "./errata";
import type { Scenario } from "./types";

export type ScenarioSource = "official" | "community" | "unknown";

export interface ScenarioDifficultyOption extends ScriptDifficulty {
  scenario: Scenario;
  validation: ScenarioValidationResult;
}

export interface ScenarioCatalogEntry {
  id: string;
  rawTitle: string;
  creator?: string;
  victoryConditions?: string;
  mastermindHints?: string;
  scenario: Scenario;
  difficulties: readonly ScenarioDifficultyOption[];
  source: ScenarioSource;
  validation: ScenarioValidationResult;
  errata: readonly ScenarioErratum[];
}

const SCENARIO_SOURCES: readonly ScenarioSource[] = [
  "official",
  "community",
  "unknown",
];

interface BundledScriptGroup {
  scripts: readonly unknown[];
  idOf: (raw: unknown, index: number) => string;
}

const BUNDLED_SCRIPT_GROUPS: readonly BundledScriptGroup[] = [
  {
    scripts: firstStepsScriptsJson,
    idOf: (_raw, index) => `firstSteps:${index + 1}`,
  },
  {
    scripts: basicTragedyScriptsJson,
    idOf: (_raw, index) => `basicTragedy:${index + 1}`,
  },
  {
    scripts: communityScriptsJson,
    idOf: (raw, index) => rawScriptId(raw, index),
  },
];

function requireScenarioSourceIds(
  value: unknown,
  source: ScenarioSource,
): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    throw new Error(`scenario-source.${source} must be a string array`);
  }
  return value;
}

function addScenarioSourceOverlay(
  byId: Map<string, ScenarioSource>,
  value: unknown,
  label: string,
): void {
  const raw = value as Record<string, unknown>;

  for (const source of SCENARIO_SOURCES) {
    for (const id of requireScenarioSourceIds(raw[source], source)) {
      const previous = byId.get(id);
      if (previous !== undefined) {
        throw new Error(
          `${label} duplicates "${id}" in ${previous} and ${source}`,
        );
      }
      byId.set(id, source);
    }
  }
}

function parseScenarioSourceOverlays(): ReadonlyMap<string, ScenarioSource> {
  const byId = new Map<string, ScenarioSource>();
  addScenarioSourceOverlay(byId, scenarioSourceJson, "data/scenario-source");
  addScenarioSourceOverlay(
    byId,
    communityScenarioSourceJson,
    "scenarios/scenario-source",
  );
  return byId;
}

const scenarioSourceById = parseScenarioSourceOverlays();

function rawScriptRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function rawScriptId(value: unknown, index: number): string {
  const id = rawScriptRecord(value)?.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`community script ${index + 1} must have a non-empty id`);
  }
  return id;
}

function rawScriptTitle(value: unknown, index: number): string {
  const title = rawScriptRecord(value)?.title;
  if (typeof title === "string") return title;
  return `Script ${index + 1}`;
}

function optionalRawScriptString(
  value: unknown,
  field: string,
): string | undefined {
  const raw = rawScriptRecord(value)?.[field];
  return typeof raw === "string" ? raw : undefined;
}

function buildScenarioCatalog(): ScenarioCatalogEntry[] {
  const entries = BUNDLED_SCRIPT_GROUPS.flatMap(
    ({ scripts, idOf }) => scripts.map((raw, index) => {
      const id = idOf(raw, index);
      const source = scenarioSourceById.get(id);
      if (source === undefined) {
        throw new Error(`scenario-source is missing "${id}"`);
      }
      const difficulties = scriptDifficulties(raw).map(
        (difficulty): ScenarioDifficultyOption => {
          const scenario = adaptTragedyScript(raw, {
            difficultyIndex: difficulty.index,
            scenarioId: id,
            skipValidation: true,
          });
          return {
            ...difficulty,
            scenario,
            validation: validateScenario(scenario),
          };
        },
      );
      const defaultDifficulty = difficulties[0];
      if (defaultDifficulty === undefined) {
        throw new Error(`scenario "${id}" has no difficulty`);
      }
      return {
        id,
        rawTitle: rawScriptTitle(raw, index),
        creator: optionalRawScriptString(raw, "creator"),
        victoryConditions: optionalRawScriptString(raw, "victory-conditions"),
        mastermindHints: optionalRawScriptString(raw, "mastermindHints"),
        scenario: defaultDifficulty.scenario,
        difficulties,
        source,
        errata: scenarioErrataFor(id),
        validation: defaultDifficulty.validation,
      };
    }),
  );

  const bundledIds = new Set(entries.map(({ id }) => id));
  const unusedIds = [...scenarioSourceById.keys()].filter(
    (id) => !bundledIds.has(id),
  );
  if (unusedIds.length > 0) {
    throw new Error(
      `scenario-source contains unknown scenarios: ${unusedIds.join(", ")}`,
    );
  }

  return entries;
}

const scenarioCatalog = buildScenarioCatalog();

export function loadScenarioCatalog(): ScenarioCatalogEntry[] {
  return structuredClone(scenarioCatalog);
}

export function loadBasicTragedyScenarioCatalog(): ScenarioCatalogEntry[] {
  return loadScenarioCatalog().filter(
    ({ scenario }) => scenario.tragedySet === "basicTragedy",
  );
}

export function loadFirstStepsScenarioCatalog(): ScenarioCatalogEntry[] {
  return loadScenarioCatalog().filter(
    ({ scenario }) => scenario.tragedySet === "firstSteps",
  );
}

export function assertOfficialScenariosValid(
  entries: readonly ScenarioCatalogEntry[],
): void {
  const failures = entries.flatMap((entry) =>
    entry.source !== "official"
      ? []
      : entry.difficulties
        .filter(({ validation }) => !validation.ok)
        .map(({ index, validation }) => ({ entry, index, validation }))
  );
  if (failures.length === 0) return;

  throw new Error(failures.map(({ entry, index, validation }) =>
    `${entry.id} ${entry.rawTitle} 난이도 ${index + 1}: ` +
    validation.errors.join(" ")
  ).join("\n"));
}

export function scenarioSourceLabel(source: ScenarioSource): string {
  switch (source) {
    case "official":
      return "공식";
    case "community":
      return "팬 제작";
    case "unknown":
      return "출처 미확인";
  }
}

export function scenarioValidationHeading(source: ScenarioSource): string {
  switch (source) {
    case "official":
      return "공식 시나리오 검증 실패";
    case "community":
      return "팬 제작 시나리오 규칙 위반";
    case "unknown":
      return "출처 미확인 시나리오 규칙 위반";
  }
}
