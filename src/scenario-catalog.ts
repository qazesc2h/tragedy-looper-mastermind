import scriptsJson from "../data/basic-tragedy-scripts.json";
import scenarioSourceJson from "../data/scenario-source.json";
import { adaptBasicTragedyScript } from "./data";
import {
  validateScenario,
  type ScenarioValidationResult,
} from "./engine/validate";
import type { Scenario } from "./types";

export type ScenarioSource = "official" | "community" | "unknown";

export interface ScenarioCatalogEntry {
  id: string;
  rawTitle: string;
  scenario: Scenario;
  source: ScenarioSource;
  validation: ScenarioValidationResult;
}

const SCENARIO_SOURCES: readonly ScenarioSource[] = [
  "official",
  "community",
  "unknown",
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

export function loadBasicTragedyScenarioCatalog(): ScenarioCatalogEntry[] {
  const entries = (scriptsJson as readonly unknown[]).map((raw, index) => {
    const id = `basicTragedy:${index + 1}`;
    const source = scenarioSourceById.get(id);
    if (source === undefined) {
      throw new Error(`scenario-source is missing "${id}"`);
    }
    const scenario = adaptBasicTragedyScript(raw, { skipValidation: true });
    return {
      id,
      rawTitle: rawScriptTitle(raw, index),
      scenario,
      source,
      validation: validateScenario(scenario),
    };
  });

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

export function assertOfficialScenariosValid(
  entries: readonly ScenarioCatalogEntry[],
): void {
  const failures = entries.filter(
    ({ source, validation }) => source === "official" && !validation.ok,
  );
  if (failures.length === 0) return;

  throw new Error(failures.map(({ id, rawTitle, validation }) =>
    `${id} ${rawTitle}: ${validation.errors.join(" ")}`
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
