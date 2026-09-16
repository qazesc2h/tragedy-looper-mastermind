import { CHARACTERS } from "./data";
import {
  validateScenario,
  type ScenarioDiagnostic,
  type ScenarioDiagnosticCode,
  type ScenarioDiagnosticSeverity,
  type ScenarioValidationInput,
  type ScenarioValidationResult,
} from "./engine/validate";
import { PLOT_IMPL } from "./impl/plots";
import { ROLE_IMPL } from "./impl/roles";
import {
  rolesForTragedySet,
  TRAGEDY_SETS,
  type TragedySetDefinition,
} from "./tragedy-sets";
import {
  LOCATIONS,
  type CharacterId,
  type IncidentId,
  type Location,
  type PlotId,
  type RoleId,
  type Scenario,
  type ScenarioSpecialRuleId,
} from "./types";

export type ScenarioDraftValueSource = "automatic" | "user";

export interface ScenarioDraftValue<T> {
  value: T;
  source: ScenarioDraftValueSource;
}

export interface ScenarioDraftSubPlotRow {
  rowId: string;
  plot?: PlotId;
}

export interface ScenarioDraftCastRow {
  rowId: string;
  character?: CharacterId;
  role?: RoleId;
}

export interface ScenarioDraftIncidentRow {
  rowId: string;
  day?: number;
  incident?: IncidentId;
  culprit?: CharacterId;
}

export interface ScenarioDraftMetadata {
  startLocations?: Readonly<Record<string, ScenarioDraftValue<Location>>>;
  turfLocations?: Readonly<Record<string, ScenarioDraftValue<Location>>>;
  entryLoops?: Readonly<Record<string, ScenarioDraftValue<number>>>;
  entryDays?: Readonly<Record<string, ScenarioDraftValue<number>>>;
  /** 알려진 편집 필드로 옮기지 못한 기존 Scenario 값을 왕복 보존한다. */
  extraScriptSpecified?: Readonly<Record<string, unknown>>;
}

/**
 * 편집 행과 빈 선택을 보존해야 하므로 Partial<Scenario>와 분리한다.
 * Scenario의 객체형 cast로는 중복 캐릭터 행과 미배정 역할을 표현할 수 없다.
 */
export interface ScenarioDraft {
  title?: string;
  creator?: string;
  mastermindHints?: string;
  tragedySet?: string;
  loops?: number;
  daysPerLoop?: number;
  mainPlot?: PlotId;
  subPlots?: readonly ScenarioDraftSubPlotRow[];
  cast?: readonly ScenarioDraftCastRow[];
  incidents?: readonly ScenarioDraftIncidentRow[];
  difficultyIndex?: number;
  difficulty?: number;
  specialRules?: readonly string[];
  specialRuleIds?: readonly ScenarioSpecialRuleId[];
  metadata?: ScenarioDraftMetadata;
}

export type ScenarioDraftValidationMode = "editing" | "finalize";

export interface ScenarioDraftOptions {
  mainPlots: readonly PlotId[];
  subPlots: readonly PlotId[];
  roles: readonly RoleId[];
  incidents: readonly IncidentId[];
}

export interface ScenarioDraftRequiredRole {
  role: RoleId;
  minimum: number;
  maximum: number;
}

export interface ScenarioDraftRoleAvailability
  extends ScenarioDraftRequiredRole {
  assigned: number;
  remainingRequired: number;
  /** undefined는 엑스트라처럼 정원 제한이 없거나 룰 선택이 미완성임을 뜻한다. */
  remainingCapacity?: number;
  exact: boolean;
}

export type FinalizeScenarioDraftResult =
  | { ok: true; scenario: Scenario; diagnostics: ScenarioDiagnostic[] }
  | { ok: false; diagnostics: ScenarioDiagnostic[] };

const CANDIDATE_BLOCKING_CODES = new Set<ScenarioDiagnosticCode>([
  "ROLE_NOT_IN_TRAGEDY_SET",
  "SIGN_WITH_ME_KEY_PERSON_NOT_GIRL",
  "AI_ROLE_IS_PERSON",
  "LITTLE_SISTER_GOODWILL_REFUSAL_ROLE",
  "MYSTERY_BOY_ROLE_IS_PERSON",
  "MYSTERY_BOY_ROLE_NOT_IN_TRAGEDY_SET",
  "MYSTERY_BOY_ROLE_IN_PLOT",
  "COPYCAT_ROLE_NOT_COPIED",
]);

function diagnostic(
  path: string,
  code: ScenarioDiagnosticCode,
  severity: ScenarioDiagnosticSeverity,
  message: string,
): ScenarioDiagnostic {
  return { path, code, severity, message };
}

function completenessSeverity(
  mode: ScenarioDraftValidationMode,
): ScenarioDiagnosticSeverity {
  return mode === "editing" ? "warning" : "error";
}

function definitionOf(
  draft: ScenarioDraft,
): TragedySetDefinition | undefined {
  return draft.tragedySet === undefined
    ? undefined
    : TRAGEDY_SETS[draft.tragedySet];
}

function activePlots(draft: ScenarioDraft): PlotId[] {
  return [
    draft.mainPlot,
    ...(draft.subPlots ?? []).map(({ plot }) => plot),
  ].filter((plot): plot is PlotId => plot !== undefined);
}

function roleRange(raw: number | [number, number]): [number, number] {
  return Array.isArray(raw) ? raw : [raw, raw];
}

function selectedRoleRequirements(
  draft: ScenarioDraft,
): Map<RoleId, { minimum: number; maximum: number }> {
  const requirements = new Map<
    RoleId,
    { minimum: number; maximum: number }
  >();
  for (const plot of activePlots(draft)) {
    for (const [role, raw] of Object.entries(PLOT_IMPL[plot]?.addsRoles ?? {})) {
      const [minimum, maximum] = roleRange(raw);
      const previous = requirements.get(role) ?? { minimum: 0, maximum: 0 };
      const absoluteMaximum = ROLE_IMPL[role]?.max ?? Number.POSITIVE_INFINITY;
      requirements.set(role, {
        minimum: Math.min(previous.minimum + minimum, absoluteMaximum),
        maximum: Math.min(previous.maximum + maximum, absoluteMaximum),
      });
    }
  }
  return requirements;
}

function plotSelectionComplete(
  draft: ScenarioDraft,
  definition: TragedySetDefinition,
): boolean {
  if (
    draft.mainPlot === undefined ||
    !definition.mainPlots.includes(draft.mainPlot) ||
    draft.subPlots === undefined ||
    draft.subPlots.length !== definition.numberOfSubPlots ||
    draft.subPlots.some(
      ({ plot }) => plot === undefined || !definition.subPlots.includes(plot),
    )
  ) {
    return false;
  }
  const plots = activePlots(draft);
  return new Set(plots).size === plots.length;
}

function assignedRoleCounts(
  draft: ScenarioDraft,
  ignoredRowId?: string,
): Map<RoleId, number> {
  const counts = new Map<RoleId, number>();
  for (const row of draft.cast ?? []) {
    if (
      row.rowId === ignoredRowId ||
      row.character === undefined ||
      row.role === undefined ||
      row.role === "person" ||
      row.character === "copycat" ||
      row.character === "mysteryBoy"
    ) {
      continue;
    }
    counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
  }
  return counts;
}

export function scenarioDraftOptions(
  draft: ScenarioDraft,
): ScenarioDraftOptions | undefined {
  const definition = definitionOf(draft);
  if (definition === undefined) return undefined;
  return {
    mainPlots: definition.mainPlots,
    subPlots: definition.subPlots,
    roles: rolesForTragedySet(definition.id),
    incidents: definition.incidents,
  };
}

export function scenarioDraftRequiredRoles(
  draft: ScenarioDraft,
): ScenarioDraftRequiredRole[] {
  return [...selectedRoleRequirements(draft)].map(([
    role,
    { minimum, maximum },
  ]) => ({ role, minimum, maximum }));
}

export function scenarioDraftRoleAvailability(
  draft: ScenarioDraft,
): ScenarioDraftRoleAvailability[] {
  const definition = definitionOf(draft);
  if (definition === undefined) return [];
  const exact = plotSelectionComplete(draft, definition);
  const requirements = selectedRoleRequirements(draft);
  const assigned = assignedRoleCounts(draft);
  return rolesForTragedySet(definition.id).map((role) => {
    const range = requirements.get(role) ?? { minimum: 0, maximum: 0 };
    const assignedCount = role === "person" ? 0 : assigned.get(role) ?? 0;
    const maximum = role === "person" ? Number.POSITIVE_INFINITY : range.maximum;
    return {
      role,
      minimum: range.minimum,
      maximum,
      assigned: assignedCount,
      remainingRequired: Math.max(0, range.minimum - assignedCount),
      remainingCapacity: !exact || !Number.isFinite(maximum)
        ? undefined
        : Math.max(0, maximum - assignedCount),
      exact,
    };
  });
}

function withStartLocations(
  draft: ScenarioDraft,
  startLocations: Record<string, ScenarioDraftValue<Location>>,
): ScenarioDraft {
  const metadata = { ...(draft.metadata ?? {}) };
  if (Object.keys(startLocations).length === 0) {
    delete metadata.startLocations;
  } else {
    metadata.startLocations = startLocations;
  }
  return {
    ...draft,
    metadata: Object.keys(metadata).length === 0 ? undefined : metadata,
  };
}

/** 결정적인 단일 시작 장소만 채우며 사용자가 입력한 값은 보존한다. */
export function autoCompleteScenarioDraft(draft: ScenarioDraft): ScenarioDraft {
  const next = structuredClone(draft);
  const startLocations = {
    ...(next.metadata?.startLocations ?? {}),
  };
  for (const row of next.cast ?? []) {
    const existing = startLocations[row.rowId];
    if (existing?.source === "user") continue;
    const choices = row.character === undefined
      ? undefined
      : CHARACTERS[row.character]?.startLocation;
    if (
      row.character !== "servant" &&
      row.character !== "henchman" &&
      choices?.length === 1
    ) {
      startLocations[row.rowId] = {
        value: choices[0],
        source: "automatic",
      };
    } else if (existing?.source === "automatic") {
      delete startLocations[row.rowId];
    }
  }
  return withStartLocations(next, startLocations);
}

interface DraftProjection {
  input: ScenarioValidationInput;
  castRowByCharacter: ReadonlyMap<CharacterId, ScenarioDraftCastRow>;
}

function compileDraftMetadata(draft: ScenarioDraft): {
  value: Record<string, unknown>;
  present: boolean;
} {
  const metadata = draft.metadata;
  const value: Record<string, unknown> = {
    ...(metadata?.extraScriptSpecified ?? {}),
  };
  let present = metadata?.extraScriptSpecified !== undefined;
  for (const row of draft.cast ?? []) {
    if (row.character === undefined) continue;
    const start = metadata?.startLocations?.[row.rowId];
    if (start?.source === "user") {
      value[`startLocation:${row.character}`] = start.value;
      present = true;
    }
    const turf = metadata?.turfLocations?.[row.rowId];
    if (turf !== undefined) {
      value[`Turf:${row.character}`] = turf.value;
      present = true;
    }
    const entryLoop = metadata?.entryLoops?.[row.rowId];
    if (entryLoop !== undefined) {
      value[`enters on loop:${row.character}`] = entryLoop.value;
      present = true;
    }
    const entryDay = metadata?.entryDays?.[row.rowId];
    if (entryDay !== undefined) {
      value[`enters on day:${row.character}`] = entryDay.value;
      present = true;
    }
  }
  return { value, present };
}

function projectDraft(draft: ScenarioDraft): DraftProjection {
  const cast: Record<CharacterId, RoleId> = {};
  const castRowByCharacter = new Map<CharacterId, ScenarioDraftCastRow>();
  for (const row of draft.cast ?? []) {
    if (
      row.character === undefined ||
      row.role === undefined ||
      castRowByCharacter.has(row.character)
    ) {
      continue;
    }
    cast[row.character] = row.role;
    castRowByCharacter.set(row.character, row);
  }
  const scriptSpecified = compileDraftMetadata(draft);
  return {
    input: {
      tragedySet: draft.tragedySet,
      mainPlot: draft.mainPlot,
      subPlots: draft.subPlots?.map(({ plot }) => plot),
      cast,
      incidents: draft.incidents?.map(({ day, incident, culprit }) => ({
        day,
        incident,
        culprit,
      })),
      loops: draft.loops,
      daysPerLoop: draft.daysPerLoop,
      scriptSpecified: scriptSpecified.present
        ? scriptSpecified.value
        : undefined,
    },
    castRowByCharacter,
  };
}

function draftMetadataPath(
  draft: ScenarioDraft,
  character: CharacterId,
  kind: "startLocations" | "turfLocations" | "entryLoops" | "entryDays",
): string | undefined {
  const row = (draft.cast ?? []).find((candidate) =>
    candidate.character === character
  );
  return row === undefined ? undefined : `metadata.${kind}.${row.rowId}`;
}

function draftMetadataValue(
  draft: ScenarioDraft,
  character: CharacterId,
  kind: "startLocations" | "turfLocations" | "entryLoops" | "entryDays",
): ScenarioDraftValue<Location> | ScenarioDraftValue<number> | undefined {
  const row = (draft.cast ?? []).find((candidate) =>
    candidate.character === character
  );
  return row === undefined ? undefined : draft.metadata?.[kind]?.[row.rowId];
}

function translateScenarioDiagnostic(
  draft: ScenarioDraft,
  source: ScenarioDiagnostic,
  mode: ScenarioDraftValidationMode,
  castRowByCharacter: ReadonlyMap<CharacterId, ScenarioDraftCastRow>,
): ScenarioDiagnostic {
  let path = source.path;
  const castMatch = /^cast\.(.+)$/.exec(source.path);
  if (castMatch !== null) {
    const row = castRowByCharacter.get(castMatch[1]);
    if (row !== undefined) path = `cast.${row.rowId}.role`;
  }
  const subPlotMatch = /^subPlots\[(\d+)\]$/.exec(source.path);
  if (subPlotMatch !== null) {
    const row = draft.subPlots?.[Number(subPlotMatch[1])];
    if (row !== undefined) path = `subPlots.${row.rowId}.plot`;
  }
  const incidentMatch = /^incidents\[(\d+)\]\.(.+)$/.exec(source.path);
  if (incidentMatch !== null) {
    const row = draft.incidents?.[Number(incidentMatch[1])];
    if (row !== undefined) {
      path = `incidents.${row.rowId}.${incidentMatch[2]}`;
    }
  }

  const servantStart = source.path === "scriptSpecified.startLocation:servant";
  if (servantStart) {
    path = draftMetadataPath(draft, "servant", "startLocations") ?? path;
  }
  if (source.path === "scriptSpecified.Turf:boss") {
    path = draftMetadataPath(draft, "boss", "turfLocations") ?? path;
  }
  if (source.path === "scriptSpecified.enters on loop:godlyBeing") {
    path = draftMetadataPath(draft, "godlyBeing", "entryLoops") ?? path;
  }
  if (source.path === "scriptSpecified.enters on day:transferStudent") {
    path = draftMetadataPath(draft, "transferStudent", "entryDays") ?? path;
  }

  const missingMetadata =
    source.code === "SERVANT_START_MISSING" ||
    source.code === "FIXED_START_MISSING" ||
    (source.code === "BOSS_TURF_INVALID" &&
      draftMetadataValue(draft, "boss", "turfLocations") === undefined) ||
    (source.code === "ENTRY_TIMING_OUT_OF_RANGE" &&
      (source.path.includes("godlyBeing")
        ? draftMetadataValue(draft, "godlyBeing", "entryLoops") === undefined
        : draftMetadataValue(draft, "transferStudent", "entryDays") ===
          undefined));
  const canCompleteLater = source.code === "COPYCAT_ROLE_NOT_COPIED";
  return {
    ...source,
    path,
    severity: mode === "editing" && (missingMetadata || canCompleteLater)
      ? "warning"
      : source.severity,
  };
}

function missingFieldDiagnostics(
  draft: ScenarioDraft,
  mode: ScenarioDraftValidationMode,
): ScenarioDiagnostic[] {
  const severity = completenessSeverity(mode);
  const diagnostics: ScenarioDiagnostic[] = [];
  if (draft.tragedySet === undefined) {
    diagnostics.push(diagnostic(
      "tragedySet",
      "TRAGEDY_SET_MISSING",
      severity,
      "참극 세트를 선택하지 않았습니다.",
    ));
  }
  if (draft.loops === undefined) {
    diagnostics.push(diagnostic(
      "loops",
      "LOOPS_MISSING",
      severity,
      "루프 수를 입력하지 않았습니다.",
    ));
  } else if (!Number.isInteger(draft.loops) || draft.loops < 1) {
    diagnostics.push(diagnostic(
      "loops",
      "LOOPS_INVALID",
      "error",
      "루프 수는 1 이상의 정수여야 합니다.",
    ));
  }
  if (draft.daysPerLoop === undefined) {
    diagnostics.push(diagnostic(
      "daysPerLoop",
      "DAYS_PER_LOOP_MISSING",
      severity,
      "루프당 날짜 수를 입력하지 않았습니다.",
    ));
  } else if (!Number.isInteger(draft.daysPerLoop) || draft.daysPerLoop < 1) {
    diagnostics.push(diagnostic(
      "daysPerLoop",
      "DAYS_PER_LOOP_INVALID",
      "error",
      "루프당 날짜 수는 1 이상의 정수여야 합니다.",
    ));
  }
  if (draft.mainPlot === undefined) {
    diagnostics.push(diagnostic(
      "mainPlot",
      "MAIN_PLOT_MISSING",
      severity,
      "룰 Y를 선택하지 않았습니다.",
    ));
  }

  const definition = definitionOf(draft);
  if (definition !== undefined) {
    for (let index = 0; index < definition.numberOfSubPlots; index += 1) {
      const row = draft.subPlots?.[index];
      if (row?.plot !== undefined) continue;
      diagnostics.push(diagnostic(
        row === undefined ? "subPlots" : `subPlots.${row.rowId}.plot`,
        "SUBPLOT_MISSING",
        severity,
        `룰 X${index + 1}을 선택하지 않았습니다.`,
      ));
    }
  }

  if ((draft.cast?.length ?? 0) === 0) {
    diagnostics.push(diagnostic(
      "cast",
      "CAST_MISSING",
      severity,
      "캐스트가 아직 배정되지 않았습니다.",
    ));
  }
  const firstCastRowByCharacter = new Map<CharacterId, ScenarioDraftCastRow>();
  for (const row of draft.cast ?? []) {
    if (row.character === undefined) {
      diagnostics.push(diagnostic(
        `cast.${row.rowId}.character`,
        "CAST_CHARACTER_MISSING",
        severity,
        "캐스트의 캐릭터를 선택하지 않았습니다.",
      ));
    } else if (firstCastRowByCharacter.has(row.character)) {
      diagnostics.push(diagnostic(
        `cast.${row.rowId}.character`,
        "CAST_CHARACTER_DUPLICATED",
        "error",
        "같은 캐릭터를 캐스트에 두 번 넣을 수 없습니다.",
      ));
    } else {
      firstCastRowByCharacter.set(row.character, row);
    }
    if (row.role === undefined) {
      diagnostics.push(diagnostic(
        `cast.${row.rowId}.role`,
        "CAST_ROLE_MISSING",
        severity,
        "캐스트의 역할을 배정하지 않았습니다.",
      ));
    }
    const start = draft.metadata?.startLocations?.[row.rowId];
    const choices = row.character === undefined
      ? undefined
      : CHARACTERS[row.character]?.startLocation;
    if (
      start !== undefined &&
      choices?.length === 1 &&
      !choices.includes(start.value)
    ) {
      diagnostics.push(diagnostic(
        `metadata.startLocations.${row.rowId}`,
        "FIXED_START_INVALID",
        "error",
        `${CHARACTERS[row.character!]?.ko ?? row.character}의 시작 장소는 ` +
          `${choices[0]}이어야 합니다.`,
      ));
    }
  }

  for (const row of draft.incidents ?? []) {
    if (row.day === undefined) {
      diagnostics.push(diagnostic(
        `incidents.${row.rowId}.day`,
        "INCIDENT_DAY_MISSING",
        severity,
        "사건 날짜를 입력하지 않았습니다.",
      ));
    } else if (
      !Number.isInteger(row.day) ||
      row.day < 1 ||
      (draft.daysPerLoop !== undefined && row.day > draft.daysPerLoop)
    ) {
      diagnostics.push(diagnostic(
        `incidents.${row.rowId}.day`,
        "INCIDENT_DAY_OUT_OF_RANGE",
        "error",
        "사건 날짜는 루프의 날짜 범위 안에 있는 정수여야 합니다.",
      ));
    }
    if (row.incident === undefined) {
      diagnostics.push(diagnostic(
        `incidents.${row.rowId}.incident`,
        "INCIDENT_TYPE_MISSING",
        severity,
        "사건을 선택하지 않았습니다.",
      ));
    }
    if (row.culprit === undefined) {
      diagnostics.push(diagnostic(
        `incidents.${row.rowId}.culprit`,
        "INCIDENT_CULPRIT_MISSING",
        severity,
        "사건 범인을 선택하지 않았습니다.",
      ));
    } else if (!firstCastRowByCharacter.has(row.culprit)) {
      diagnostics.push(diagnostic(
        `incidents.${row.rowId}.culprit`,
        "INCIDENT_CULPRIT_NOT_IN_CAST",
        "error",
        "사건 범인은 캐스트에 포함된 캐릭터여야 합니다.",
      ));
    }
  }

  const assigned = assignedRoleCounts(draft);
  for (const { role, minimum } of scenarioDraftRequiredRoles(draft)) {
    const missing = Math.max(0, minimum - (assigned.get(role) ?? 0));
    if (missing === 0) continue;
    diagnostics.push(diagnostic(
      "cast",
      "REQUIRED_ROLE_MISSING",
      severity,
      `${ROLE_IMPL[role]?.ko ?? role} 역할이 ${missing}명 부족합니다.`,
    ));
  }
  return diagnostics;
}

export function validateScenarioDraft(
  draft: ScenarioDraft,
  mode: ScenarioDraftValidationMode = "editing",
): ScenarioValidationResult {
  const projection = projectDraft(draft);
  const scenarioDiagnostics = validateScenario(projection.input).diagnostics
    .filter((source) => {
      if (source.code !== "SUBPLOT_COUNT_MISMATCH") return true;
      const expected = definitionOf(draft)?.numberOfSubPlots;
      return expected === undefined || (draft.subPlots?.length ?? 0) > expected;
    })
    .map((source) =>
      translateScenarioDiagnostic(
        draft,
        source,
        mode,
        projection.castRowByCharacter,
      )
    );
  const diagnostics = [
    ...missingFieldDiagnostics(draft, mode),
    ...scenarioDiagnostics,
  ];
  return {
    ok: diagnostics.every(({ severity }) => severity !== "error"),
    diagnostics,
  };
}

export function canFinalizeScenarioDraft(draft: ScenarioDraft): boolean {
  return validateScenarioDraft(draft, "finalize").ok;
}

function finalizedScenario(draft: ScenarioDraft): Scenario {
  const cast = Object.fromEntries(
    (draft.cast ?? []).map(({ character, role }) => [character!, role!]),
  );
  const metadata = compileDraftMetadata(draft);
  const scenario: Scenario = {
    tragedySet: draft.tragedySet!,
    mainPlot: draft.mainPlot!,
    subPlots: (draft.subPlots ?? []).map(({ plot }) => plot!),
    cast,
    incidents: (draft.incidents ?? []).map(({ day, incident, culprit }) => ({
      day: day!,
      incident: incident!,
      culprit: culprit!,
    })),
    loops: draft.loops!,
    daysPerLoop: draft.daysPerLoop!,
  };
  if (draft.difficultyIndex !== undefined) {
    scenario.difficultyIndex = draft.difficultyIndex;
  }
  if (draft.difficulty !== undefined) scenario.difficulty = draft.difficulty;
  if (draft.specialRules !== undefined) {
    scenario.specialRules = [...draft.specialRules];
  }
  if (draft.specialRuleIds !== undefined) {
    scenario.specialRuleIds = [...draft.specialRuleIds];
  }
  if (metadata.present) scenario.scriptSpecified = metadata.value;
  return scenario;
}

export function finalizeScenarioDraft(
  draft: ScenarioDraft,
): FinalizeScenarioDraftResult {
  const validation = validateScenarioDraft(draft, "finalize");
  if (!validation.ok) return { ok: false, diagnostics: validation.diagnostics };
  return {
    ok: true,
    scenario: finalizedScenario(draft),
    diagnostics: validation.diagnostics,
  };
}

function sourced<T>(value: T): ScenarioDraftValue<T> {
  return { value, source: "user" };
}

export function scenarioToDraft(scenario: Scenario): ScenarioDraft {
  const cast = Object.entries(scenario.cast).map(
    ([character, role], index): ScenarioDraftCastRow => ({
      rowId: `cast-${index + 1}`,
      character,
      role,
    }),
  );
  const remainingScriptSpecified = { ...(scenario.scriptSpecified ?? {}) };
  const startLocations: Record<string, ScenarioDraftValue<Location>> = {};
  const turfLocations: Record<string, ScenarioDraftValue<Location>> = {};
  const entryLoops: Record<string, ScenarioDraftValue<number>> = {};
  const entryDays: Record<string, ScenarioDraftValue<number>> = {};
  for (const row of cast) {
    const character = row.character!;
    const known = [
      [`startLocation:${character}`, startLocations] as const,
      [`Turf:${character}`, turfLocations] as const,
      [`enters on loop:${character}`, entryLoops] as const,
      [`enters on day:${character}`, entryDays] as const,
    ];
    for (const [key, target] of known) {
      if (!Object.hasOwn(remainingScriptSpecified, key)) continue;
      const value = remainingScriptSpecified[key];
      if (
        (target === startLocations || target === turfLocations) &&
        typeof value === "string" &&
        LOCATIONS.includes(value as Location)
      ) {
        target[row.rowId] = sourced(value as Location);
        delete remainingScriptSpecified[key];
      } else if (
        (target === entryLoops || target === entryDays) &&
        typeof value === "number"
      ) {
        target[row.rowId] = sourced(value);
        delete remainingScriptSpecified[key];
      }
    }
  }
  const metadata: ScenarioDraftMetadata = {};
  if (Object.keys(startLocations).length > 0) {
    metadata.startLocations = startLocations;
  }
  if (Object.keys(turfLocations).length > 0) {
    metadata.turfLocations = turfLocations;
  }
  if (Object.keys(entryLoops).length > 0) metadata.entryLoops = entryLoops;
  if (Object.keys(entryDays).length > 0) metadata.entryDays = entryDays;
  if (scenario.scriptSpecified !== undefined) {
    metadata.extraScriptSpecified = remainingScriptSpecified;
  }

  const draft: ScenarioDraft = {
    tragedySet: scenario.tragedySet,
    loops: scenario.loops,
    daysPerLoop: scenario.daysPerLoop,
    mainPlot: scenario.mainPlot,
    subPlots: scenario.subPlots.map((plot, index) => ({
      rowId: `subplot-${index + 1}`,
      plot,
    })),
    cast,
    incidents: scenario.incidents.map((incident, index) => ({
      rowId: `incident-${index + 1}`,
      ...incident,
    })),
  };
  if (scenario.difficultyIndex !== undefined) {
    draft.difficultyIndex = scenario.difficultyIndex;
  }
  if (scenario.difficulty !== undefined) draft.difficulty = scenario.difficulty;
  if (scenario.specialRules !== undefined) {
    draft.specialRules = [...scenario.specialRules];
  }
  if (scenario.specialRuleIds !== undefined) {
    draft.specialRuleIds = [...scenario.specialRuleIds];
  }
  if (Object.keys(metadata).length > 0) draft.metadata = metadata;
  return autoCompleteScenarioDraft(draft);
}

function replaceCastRow(
  draft: ScenarioDraft,
  rowId: string,
  character: CharacterId,
  role: RoleId,
): ScenarioDraft {
  const rows = [...(draft.cast ?? [])];
  const index = rows.findIndex((row) => row.rowId === rowId);
  const replacement = { rowId, character, role };
  if (index < 0) rows.push(replacement);
  else rows[index] = replacement;
  return { ...draft, cast: rows };
}

export function candidateRolesForScenarioDraftCharacter(
  draft: ScenarioDraft,
  rowId: string,
): RoleId[] {
  const row = draft.cast?.find((candidate) => candidate.rowId === rowId);
  const definition = definitionOf(draft);
  if (row?.character === undefined || definition === undefined) return [];
  const exactCapacity = plotSelectionComplete(draft, definition);
  const requirements = selectedRoleRequirements(draft);
  const assignedWithoutRow = assignedRoleCounts(draft, rowId);
  return rolesForTragedySet(definition.id).filter((role) => {
    if (
      exactCapacity &&
      row.character !== "copycat" &&
      row.character !== "mysteryBoy" &&
      role !== "person"
    ) {
      const maximum = requirements.get(role)?.maximum ?? 0;
      if ((assignedWithoutRow.get(role) ?? 0) >= maximum) return false;
    }
    const candidate = replaceCastRow(draft, rowId, row.character!, role);
    const input = projectDraft(candidate).input;
    return !validateScenario(input).diagnostics.some((entry) =>
      entry.path === `cast.${row.character}` &&
      CANDIDATE_BLOCKING_CODES.has(entry.code)
    );
  });
}

export function candidateCharactersForScenarioDraftRole(
  draft: ScenarioDraft,
  role: RoleId,
  rowId = "candidate",
): CharacterId[] {
  const usedByOtherRows = new Set(
    (draft.cast ?? [])
      .filter((row) => row.rowId !== rowId && row.character !== undefined)
      .map((row) => row.character!),
  );
  return Object.keys(CHARACTERS).filter((character) => {
    if (usedByOtherRows.has(character)) return false;
    const candidate = replaceCastRow(draft, rowId, character, role);
    return candidateRolesForScenarioDraftCharacter(candidate, rowId).includes(
      role,
    );
  });
}
