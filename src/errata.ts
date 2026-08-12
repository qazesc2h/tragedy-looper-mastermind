import errataJson from "../data/errata.json";
import type { CharacterId, RoleId, Scenario } from "./types";

export interface ScenarioErratum {
  scenario: string;
  title: string;
  field: string;
  printed: RoleId;
  corrected: RoleId;
  source: string;
  verifiedBy: string;
}

interface ErrataFile {
  _note: string;
  corrections: ScenarioErratum[];
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

function parseErrataFile(value: unknown): ErrataFile {
  if (!isRecord(value)) throw new Error("errata must be an object");
  if (!Array.isArray(value.corrections)) {
    throw new Error("errata.corrections must be an array");
  }

  const seenFields = new Set<string>();
  const corrections = value.corrections.map((entry, index): ScenarioErratum => {
    const context = `errata.corrections[${index}]`;
    if (!isRecord(entry)) throw new Error(`${context} must be an object`);
    const scenario = requireString(entry.scenario, `${context}.scenario`);
    const title = requireString(entry.title, `${context}.title`);
    const field = requireString(entry.field, `${context}.field`);
    if (!field.startsWith("cast.") || field.length === "cast.".length) {
      throw new Error(`${context}.field is not a supported cast field`);
    }
    const key = `${scenario}:${field}`;
    if (seenFields.has(key)) {
      throw new Error(`errata duplicates correction "${key}"`);
    }
    seenFields.add(key);
    return {
      scenario,
      title,
      field,
      printed: requireString(entry.printed, `${context}.printed`),
      corrected: requireString(entry.corrected, `${context}.corrected`),
      source: requireString(entry.source, `${context}.source`),
      verifiedBy: requireString(entry.verifiedBy, `${context}.verifiedBy`),
    };
  });

  return {
    _note: requireString(value._note, "errata._note"),
    corrections,
  };
}

const errata = parseErrataFile(errataJson);

export const ERRATA_NOTE = errata._note;

export function scenarioErrataFor(
  scenarioId: string,
): readonly ScenarioErratum[] {
  return errata.corrections.filter(({ scenario }) => scenario === scenarioId);
}

/** 원본 각본을 파싱한 뒤, 검증 전에 확인된 게임사 정오표를 덮어쓴다. */
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

/** 저장 데이터가 원본 인쇄 역할을 보존하고 있어도 현재 정오표로 이행한다. */
export function applyScenarioErrataToLoadedScenario(
  scenarioId: string,
  scenario: Scenario,
): readonly ScenarioErratum[] {
  const corrections = scenarioErrataFor(scenarioId);
  for (const correction of corrections) {
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
