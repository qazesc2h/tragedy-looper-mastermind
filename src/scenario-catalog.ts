import basicTragedyScriptsJson from "../data/basic-tragedy-scripts.json";
import firstStepsScriptsJson from "../data/first-steps-scripts.json";
import scenarioSourceJson from "../data/scenario-source.json";
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

const BUNDLED_SCRIPTS: Readonly<Record<string, readonly unknown[]>> = {
  firstSteps: firstStepsScriptsJson,
  basicTragedy: basicTragedyScriptsJson,
};

function requireScenarioSourceIds(
  value: unknown,
  source: ScenarioSource,
): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    throw new Error(`scenario-source.${source} must be a string array`);
  }
  return value;
}

function parseScenarioSourceOverlay(): ReadonlyMap<string, ScenarioSource> {
  const raw = scenarioSourceJson as Record<string, unknown>;
  const byId = new Map<string, ScenarioSource>();

  for (const source of SCENARIO_SOURCES) {
    for (const id of requireScenarioSourceIds(raw[source], source)) {
      const previous = byId.get(id);
      if (previous !== undefined) {
        throw new Error(
          `scenario-source duplicates "${id}" in ${previous} and ${source}`,
        );
      }
      byId.set(id, source);
    }
  }

  return byId;
}

const scenarioSourceById = parseScenarioSourceOverlay();

function rawScriptTitle(value: unknown, index: number): string {
  if (
    typeof value === "object" && value !== null && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).title === "string"
  ) {
    return (value as Record<string, unknown>).title as string;
  }
  return `Script ${index + 1}`;
}

function buildScenarioCatalog(): ScenarioCatalogEntry[] {
  const entries = Object.entries(BUNDLED_SCRIPTS).flatMap(
    ([tragedySet, scripts]) => scripts.map((raw, index) => {
      const id = `${tragedySet}:${index + 1}`;
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
