import tragedySetsJson from "../data/tragedy-sets.json";
import { PLOT_IMPL } from "./impl/plots";

import type { IncidentId, PlotId, RoleId } from "./types";

export interface TragedySetDefinition {
  id: string;
  name: string;
  numberOfMainPlots: number;
  numberOfSubPlots: number;
  mainPlots: readonly PlotId[];
  subPlots: readonly PlotId[];
  incidents: readonly IncidentId[];
  hasFinalGuess: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, context: string): string {
  if (typeof value !== "string") throw new Error(`${context} must be a string`);
  return value;
}

function requireCount(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${context} must be a non-negative integer`);
  }
  return value;
}

function requireStrings(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  return value.map((entry, index) =>
    requireString(entry, `${context}[${index}]`)
  );
}

function parseDefinition(id: string, value: unknown): TragedySetDefinition {
  if (!isRecord(value)) throw new Error(`tragedy set "${id}" must be an object`);
  const rawId = requireString(value.id, `tragedy set "${id}".id`);
  if (rawId !== id) {
    throw new Error(`tragedy set key "${id}" does not match id "${rawId}"`);
  }
  if (typeof value.hasFinalGuess !== "boolean") {
    throw new Error(`tragedy set "${id}".hasFinalGuess must be a boolean`);
  }
  return {
    id,
    name: requireString(value.name, `tragedy set "${id}".name`),
    numberOfMainPlots: requireCount(
      value.numberOfMainPlots,
      `tragedy set "${id}".numberOfMainPlots`,
    ),
    numberOfSubPlots: requireCount(
      value.numberOfSubPlots,
      `tragedy set "${id}".numberOfSubPlots`,
    ),
    mainPlots: requireStrings(
      value.mainPlots,
      `tragedy set "${id}".mainPlots`,
    ),
    subPlots: requireStrings(
      value.subPlots,
      `tragedy set "${id}".subPlots`,
    ),
    incidents: requireStrings(
      value.incidents,
      `tragedy set "${id}".incidents`,
    ),
    hasFinalGuess: value.hasFinalGuess,
  };
}

export const TRAGEDY_SETS: Readonly<Record<string, TragedySetDefinition>> =
  Object.fromEntries(
    Object.entries(tragedySetsJson as Record<string, unknown>).map(
      ([id, value]) => [id, parseDefinition(id, value)],
    ),
  );

export function tragedySetDefinition(id: string): TragedySetDefinition {
  const definition = TRAGEDY_SETS[id];
  if (definition === undefined) throw new Error(`unknown tragedy set "${id}"`);
  return definition;
}

export function rolesForTragedySet(id: string): RoleId[] {
  const definition = tragedySetDefinition(id);
  const roles = new Set<RoleId>(["person"]);
  for (const plot of [...definition.mainPlots, ...definition.subPlots]) {
    for (const role of Object.keys(PLOT_IMPL[plot]?.addsRoles ?? {})) {
      roles.add(role);
    }
  }
  return [...roles];
}
