import charactersJson from "../../data/characters.json";
import { PLOT_IMPL } from "../impl/plots";
import { ROLE_IMPL } from "../impl/roles";
import {
  rolesForTragedySet,
  TRAGEDY_SETS,
  type TragedySetDefinition,
} from "../tragedy-sets";

import { LOCATIONS, type CharacterId } from "../types";

interface ValidationCharacterData {
  en?: unknown;
  ko?: unknown;
  tags?: unknown;
  plotLessRole?: unknown;
  startLocation?: unknown;
}

export type ScenarioDiagnosticSeverity = "error" | "warning";

export type ScenarioDiagnosticCode =
  | "TRAGEDY_SET_UNKNOWN"
  | "MAIN_PLOT_COUNT_UNSUPPORTED"
  | "MAIN_PLOT_NOT_IN_TRAGEDY_SET"
  | "SUBPLOT_COUNT_MISMATCH"
  | "SUBPLOT_NOT_IN_TRAGEDY_SET"
  | "PLOT_DUPLICATED"
  | "INCIDENT_NOT_IN_TRAGEDY_SET"
  | "ROLE_NOT_IN_TRAGEDY_SET"
  | "SIGN_WITH_ME_KEY_PERSON_NOT_GIRL"
  | "AI_ROLE_IS_PERSON"
  | "LITTLE_SISTER_GOODWILL_REFUSAL_ROLE"
  | "MYSTERY_BOY_ROLE_IS_PERSON"
  | "MYSTERY_BOY_ROLE_NOT_IN_TRAGEDY_SET"
  | "MYSTERY_BOY_ROLE_IN_PLOT"
  | "COPYCAT_ROLE_NOT_COPIED"
  | "ROLE_COUNT_EXCEEDED"
  | "HIDEOUS_SCRIPT_CURMUDGEON_COUNT_EXCEEDED"
  | "BOSS_TURF_INVALID"
  | "SERVANT_START_MISSING"
  | "SERVANT_START_INVALID"
  | "FIXED_START_MISSING"
  | "FIXED_START_INVALID"
  | "ENTRY_TIMING_OUT_OF_RANGE";

export interface ScenarioDiagnostic {
  path: string;
  code: ScenarioDiagnosticCode;
  severity: ScenarioDiagnosticSeverity;
  message: string;
}

/** 작성 중 비어 있는 필드를 그대로 넘겨도 독립적으로 검사 가능한 값만 검증한다. */
export interface ScenarioValidationInput {
  tragedySet?: string;
  mainPlot?: string;
  subPlots?: readonly (string | undefined)[];
  cast?: Readonly<Record<string, string | undefined>>;
  incidents?: readonly Readonly<{
    day?: number;
    incident?: string;
    culprit?: string;
  }>[];
  loops?: number;
  daysPerLoop?: number;
  scriptSpecified?: Readonly<Record<string, unknown>>;
}

export interface ScenarioValidationResult {
  ok: boolean;
  diagnostics: ScenarioDiagnostic[];
}

function errorDiagnostic(
  path: string,
  code: ScenarioDiagnosticCode,
  message: string,
): ScenarioDiagnostic {
  return { path, code, severity: "error", message };
}

export function scenarioValidationErrorMessages(
  validation: ScenarioValidationResult,
): string[] {
  return validation.diagnostics
    .filter(({ severity }) => severity === "error")
    .map(({ message }) => message);
}

const characters = charactersJson as unknown as Record<
  CharacterId,
  ValidationCharacterData
>;

function activePlots(scenario: ScenarioValidationInput): string[] {
  return [scenario.mainPlot, ...(scenario.subPlots ?? [])].filter(
    (plot): plot is string => typeof plot === "string" && plot.length > 0,
  );
}

function characterHasTag(character: string, tag: string): boolean {
  const tags = characters[character as CharacterId]?.tags;
  return Array.isArray(tags) && tags.includes(tag);
}

function characterLabel(character: string): string {
  const data = characters[character as CharacterId];
  if (typeof data?.ko === "string" && data.ko.length > 0) return data.ko;
  if (typeof data?.en === "string" && data.en.length > 0) return data.en;
  return character;
}

function validateSignWithMe(
  scenario: ScenarioValidationInput,
): ScenarioDiagnostic[] {
  if (!activePlots(scenario).includes("signWithMe")) return [];

  return Object.entries(scenario.cast ?? {})
    .filter(([, role]) => role === "keyPerson")
    .filter(([character]) => !characterHasTag(character, "girl"))
    .map(([character]) =>
      errorDiagnostic(
        `cast.${character}`,
        "SIGN_WITH_ME_KEY_PERSON_NOT_GIRL",
        "나와 계약하자!: 핵심 인물로 배정된 캐릭터는 " +
          `소녀 속성이어야 합니다. 현재 배정: ${characterLabel(character)}.`,
      )
    );
}

function validateAiRole(
  scenario: ScenarioValidationInput,
): ScenarioDiagnostic[] {
  if (scenario.cast?.ai !== "person") return [];
  return [errorDiagnostic(
    "cast.ai",
    "AI_ROLE_IS_PERSON",
    "AI: AI 캐릭터에는 엑스트라 역할을 배정할 수 없습니다.",
  )];
}

function validateLittleSisterRole(
  scenario: ScenarioValidationInput,
): ScenarioDiagnostic[] {
  const role = scenario.cast?.littleSister;
  if (role === undefined || ROLE_IMPL[role]?.goodwillRefusal === undefined) {
    return [];
  }
  return [errorDiagnostic(
    "cast.littleSister",
    "LITTLE_SISTER_GOODWILL_REFUSAL_ROLE",
    "여동생: 우호 무시 또는 절대 우호 무시 능력을 지닌 역할을 " +
      `배정할 수 없습니다. 현재 배정: ${ROLE_IMPL[role]?.ko ?? role}.`,
  )];
}

function rolesAssociatedWithActivePlots(
  scenario: ScenarioValidationInput,
): Set<string> {
  const roles = new Set<string>();
  for (const plot of activePlots(scenario)) {
    for (const role of Object.keys(PLOT_IMPL[plot]?.addsRoles ?? {})) {
      roles.add(role);
    }
  }
  return roles;
}

function validateMysteryBoyRole(
  scenario: ScenarioValidationInput,
  definition: TragedySetDefinition | undefined,
): ScenarioDiagnostic[] {
  const role = scenario.cast?.mysteryBoy;
  if (role === undefined) return [];
  if (role === "person") {
    return [errorDiagnostic(
      "cast.mysteryBoy",
      "MYSTERY_BOY_ROLE_IS_PERSON",
      "아웃사이더: 엑스트라 역할을 배정할 수 없습니다. " +
        "참극 세트의 역할 중 현재 룰에서 추가되지 않는 역할을 배정해야 합니다.",
    )];
  }
  if (definition === undefined) return [];
  if (!rolesForTragedySet(definition.id).includes(role)) {
    return [errorDiagnostic(
      "cast.mysteryBoy",
      "MYSTERY_BOY_ROLE_NOT_IN_TRAGEDY_SET",
      "아웃사이더: 현재 참극 세트에 없는 역할을 배정할 수 없습니다. " +
        "현재 참극 세트의 역할 중 활성 룰에서 추가되지 않는 역할을 " +
        "배정해야 합니다.",
    )];
  }
  if (!rolesAssociatedWithActivePlots(scenario).has(role)) {
    return [];
  }
  return [errorDiagnostic(
    "cast.mysteryBoy",
    "MYSTERY_BOY_ROLE_IN_PLOT",
    "아웃사이더: 현재 시나리오의 룰에서 추가되는 역할을 배정할 수 없습니다. " +
      "참극 세트의 역할 중 현재 룰에서 추가되지 않는 역할을 배정해야 합니다.",
  )];
}

function validateCopycatRole(
  scenario: ScenarioValidationInput,
): ScenarioDiagnostic[] {
  const role = scenario.cast?.copycat;
  if (role === undefined) return [];

  const copiedCharacter = Object.entries(scenario.cast ?? {}).find(
    ([character, candidateRole]) =>
      character !== "copycat" && candidateRole === role,
  );
  if (copiedCharacter !== undefined) return [];

  return [errorDiagnostic(
    "cast.copycat",
    "COPYCAT_ROLE_NOT_COPIED",
    "모방자: 시나리오에 등장하는 다른 캐릭터와 같은 역할을 " +
      `배정해야 합니다. 현재 배정: ${ROLE_IMPL[role]?.ko ?? role}.`,
  )];
}

function validateTragedySetPlots(
  scenario: ScenarioValidationInput,
  definition: TragedySetDefinition,
): ScenarioDiagnostic[] {
  const diagnostics: ScenarioDiagnostic[] = [];
  if (definition.numberOfMainPlots !== 1) {
    diagnostics.push(errorDiagnostic(
      "tragedySet",
      "MAIN_PLOT_COUNT_UNSUPPORTED",
      `참극 세트 ${definition.id}: 현재 엔진은 룰 Y 1개만 지원하지만 ` +
        `정의에는 ${definition.numberOfMainPlots}개가 지정되어 있습니다.`,
    ));
  }
  if (
    scenario.mainPlot !== undefined &&
    !definition.mainPlots.includes(scenario.mainPlot)
  ) {
    diagnostics.push(errorDiagnostic(
      "mainPlot",
      "MAIN_PLOT_NOT_IN_TRAGEDY_SET",
      `룰 Y: ${scenario.mainPlot}은(는) ${definition.id} 참극 세트에 없습니다.`,
    ));
  }
  if (
    scenario.subPlots !== undefined &&
    scenario.subPlots.length !== definition.numberOfSubPlots
  ) {
    diagnostics.push(errorDiagnostic(
      "subPlots",
      "SUBPLOT_COUNT_MISMATCH",
      `룰 X: ${definition.id} 참극 세트는 ` +
        `${definition.numberOfSubPlots}개를 사용해야 합니다. ` +
        `현재 ${scenario.subPlots.length}개입니다.`,
    ));
  }
  for (const [index, plot] of (scenario.subPlots ?? []).entries()) {
    if (plot !== undefined && !definition.subPlots.includes(plot)) {
      diagnostics.push(errorDiagnostic(
        `subPlots[${index}]`,
        "SUBPLOT_NOT_IN_TRAGEDY_SET",
        `룰 X: ${plot}은(는) ${definition.id} 참극 세트에 없습니다.`,
      ));
    }
  }
  const selectedPlots = [
    ...(scenario.mainPlot === undefined
      ? []
      : [{ plot: scenario.mainPlot, path: "mainPlot" }]),
    ...(scenario.subPlots ?? []).flatMap((plot, index) =>
      plot === undefined ? [] : [{ plot, path: `subPlots[${index}]` }]
    ),
  ];
  const duplicate = selectedPlots.find(
    ({ plot }, index) =>
      selectedPlots.findIndex((candidate) => candidate.plot === plot) !== index,
  );
  if (duplicate !== undefined) {
    diagnostics.push(errorDiagnostic(
      duplicate.path,
      "PLOT_DUPLICATED",
      "룰 Y와 룰 X에는 같은 룰을 중복해서 사용할 수 없습니다.",
    ));
  }
  return diagnostics;
}

function validateIncidentsInTragedySet(
  scenario: ScenarioValidationInput,
  definition: TragedySetDefinition,
): ScenarioDiagnostic[] {
  return (scenario.incidents ?? []).flatMap(({ day, incident }, index) => {
    if (incident === undefined || definition.incidents.includes(incident)) {
      return [];
    }
    return [errorDiagnostic(
      `incidents[${index}].incident`,
      "INCIDENT_NOT_IN_TRAGEDY_SET",
      `사건: ${day}일의 ${incident}은(는) ` +
        `${definition.id} 참극 세트에 없습니다.`,
    )];
  });
}

function validateRolesInTragedySet(
  scenario: ScenarioValidationInput,
  definition: TragedySetDefinition,
): ScenarioDiagnostic[] {
  const rolePool = new Set(rolesForTragedySet(definition.id));
  return Object.entries(scenario.cast ?? {})
    .filter(([character, role]) =>
      character !== "mysteryBoy" && role !== undefined && !rolePool.has(role)
    )
    .map(([character, role]) =>
      errorDiagnostic(
        `cast.${character}`,
        "ROLE_NOT_IN_TRAGEDY_SET",
        `역할: ${characterLabel(character)}에게 배정된 ${role}은(는) ` +
          `${definition.id} 참극 세트에 없습니다.`,
      )
    );
}

function validateHideousScript(
  scenario: ScenarioValidationInput,
): ScenarioDiagnostic[] {
  if (!activePlots(scenario).includes("hideousScript")) return [];
  const holders = Object.entries(scenario.cast ?? {})
    .filter(([, role]) => role === "curmudgeon")
    .map(([character]) => character);
  const count = holders.length;
  return count <= 2
    ? []
    : [errorDiagnostic(
      `cast.${holders[2]}`,
      "HIDEOUS_SCRIPT_CURMUDGEON_COUNT_EXCEEDED",
      `최악의 시나리오: 골칫거리는 0~2명이어야 합니다. 현재 ${count}명입니다.`,
    )];
}

function maximumAddedRoleCounts(
  scenario: ScenarioValidationInput,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const plot of activePlots(scenario)) {
    for (const [role, rawCount] of Object.entries(
      PLOT_IMPL[plot]?.addsRoles ?? {},
    )) {
      const addedMaximum = Array.isArray(rawCount) ? rawCount[1] : rawCount;
      const summed = (counts.get(role) ?? 0) + addedMaximum;
      counts.set(role, Math.min(
        summed,
        ROLE_IMPL[role]?.max ?? Number.POSITIVE_INFINITY,
      ));
    }
  }
  return counts;
}

function validateRoleCounts(
  scenario: ScenarioValidationInput,
  definition: TragedySetDefinition,
): ScenarioDiagnostic[] {
  const rolePool = new Set(rolesForTragedySet(definition.id));
  const allowed = maximumAddedRoleCounts(scenario);
  const holders = new Map<string, string[]>();
  for (const [character, role] of Object.entries(scenario.cast ?? {})) {
    // 모방자는 다른 등장 캐릭터의 역할을 최대 인원과 무관하게 복제한다.
    // 아웃사이더는 별도 검증에서 활성 룰 밖 역할만 허용한다.
    if (role === undefined || character === "copycat" ||
      character === "mysteryBoy" ||
      role === "person") {
      continue;
    }
    if (!rolePool.has(role)) continue;
    const roleHolders = holders.get(role) ?? [];
    roleHolders.push(character);
    holders.set(role, roleHolders);
  }

  return [...holders.entries()].flatMap(([role, roleHolders]) => {
    const count = roleHolders.length;
    const limit = allowed.get(role) ?? 0;
    if (count <= limit) return [];
    const roleName = ROLE_IMPL[role]?.ko ?? role;
    return [errorDiagnostic(
      `cast.${roleHolders[limit] ?? roleHolders[0]}`,
      "ROLE_COUNT_EXCEEDED",
      `역할 수: ${roleName} 역할은 선택된 룰에서 최대 ${limit}명까지 ` +
        `배정할 수 있지만 현재 ${count}명입니다.`,
    )];
  });
}

function plotSelectionComplete(
  scenario: ScenarioValidationInput,
  definition: TragedySetDefinition,
): boolean {
  if (
    scenario.mainPlot === undefined ||
    !definition.mainPlots.includes(scenario.mainPlot) ||
    scenario.subPlots === undefined ||
    scenario.subPlots.length !== definition.numberOfSubPlots ||
    scenario.subPlots.some(
      (plot) => plot === undefined || !definition.subPlots.includes(plot),
    )
  ) {
    return false;
  }
  const plots = activePlots(scenario);
  return new Set(plots).size === plots.length;
}

function metadataValueLabel(value: unknown): string {
  return value === undefined ? "없음" : JSON.stringify(value);
}

function validateEntryTiming(
  scenario: ScenarioValidationInput,
  character: "godlyBeing" | "transferStudent",
  kind: "loop" | "day",
  maximum: number | undefined,
  characterName: string,
): ScenarioDiagnostic[] {
  if (scenario.cast?.[character] === undefined || maximum === undefined) {
    return [];
  }

  const key = `enters on ${kind}:${character}`;
  const value = scenario.scriptSpecified?.[key];
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= maximum
  ) {
    return [];
  }

  return [errorDiagnostic(
    `scriptSpecified.${key}`,
    "ENTRY_TIMING_OUT_OF_RANGE",
    `${characterName}: "${key}"은 1 이상 ${maximum} 이하의 정수여야 ` +
      `합니다. 현재 값: ${metadataValueLabel(value)}.`,
  )];
}

function validateBossTurf(
  scenario: ScenarioValidationInput,
): ScenarioDiagnostic[] {
  if (scenario.cast?.boss === undefined) return [];
  const key = "Turf:boss";
  const value = scenario.scriptSpecified?.[key];
  if (LOCATIONS.some((location) => location === value)) return [];
  return [errorDiagnostic(
    `scriptSpecified.${key}`,
    "BOSS_TURF_INVALID",
    `거물: "${key}"은 ${LOCATIONS.join(", ")} 중 하나여야 합니다. ` +
      `현재 값: ${metadataValueLabel(value)}.`,
  )];
}

const LOCATION_LABELS: Readonly<Record<string, string>> = {
  Hospital: "병원",
  Shrine: "신사",
  City: "도심",
  School: "학교",
};

/** 복수 시작 장소 중 시나리오가 확정해야 하는 값을 검사한다. */
function validateFixedStartLocations(
  scenario: ScenarioValidationInput,
): ScenarioDiagnostic[] {
  return Object.keys(scenario.cast ?? {}).flatMap((character) => {
    // 하수인은 공개 특성에 따라 각 루프 시작 때 각본가가 장소를 고른다.
    if (character === "henchman") return [];
    const rawChoices = characters[character]?.startLocation;
    if (!Array.isArray(rawChoices)) return [];
    const choices = rawChoices.filter(
      (choice): choice is string => typeof choice === "string",
    );
    if (choices.length <= 1) return [];

    const key = `startLocation:${character}`;
    const selected = scenario.scriptSpecified?.[key];
    if (typeof selected === "string" && choices.includes(selected)) return [];

    const choiceLabels = choices.map((choice) =>
      LOCATION_LABELS[choice] ?? choice
    ).join(" 또는 ");
    if (selected === undefined) {
      return [errorDiagnostic(
        `scriptSpecified.${key}`,
        character === "servant"
          ? "SERVANT_START_MISSING"
          : "FIXED_START_MISSING",
        `${characterLabel(character)}의 시작 장소가 지정되지 않았습니다. ` +
          `${choiceLabels} 중 하나를 선택하세요.`,
      )];
    }
    return [errorDiagnostic(
      `scriptSpecified.${key}`,
      character === "servant"
        ? "SERVANT_START_INVALID"
        : "FIXED_START_INVALID",
      `${characterLabel(character)}의 시작 장소가 올바르지 않습니다. ` +
        `${choiceLabels} 중 하나를 선택하세요. 현재 값: ` +
        `${metadataValueLabel(selected)}.`,
    )];
  });
}

/** 시나리오 작성 시 적용되는 제약을 런타임 시작 전에 한 번 검증한다. */
export function validateScenario(
  scenario: ScenarioValidationInput,
): ScenarioValidationResult {
  const definition = scenario.tragedySet === undefined
    ? undefined
    : TRAGEDY_SETS[scenario.tragedySet];
  const diagnostics = [
    ...(scenario.tragedySet === undefined || definition !== undefined
      ? []
      : [errorDiagnostic(
        "tragedySet",
        "TRAGEDY_SET_UNKNOWN",
        `알 수 없는 참극 세트: ${scenario.tragedySet}.`,
      )]),
    ...(definition === undefined
      ? []
      : [
        ...validateTragedySetPlots(scenario, definition),
        ...validateIncidentsInTragedySet(scenario, definition),
        ...validateRolesInTragedySet(scenario, definition),
        ...(plotSelectionComplete(scenario, definition)
          ? validateRoleCounts(scenario, definition)
          : []),
      ]),
    ...validateSignWithMe(scenario),
    ...validateAiRole(scenario),
    ...validateLittleSisterRole(scenario),
    ...validateMysteryBoyRole(scenario, definition),
    ...validateCopycatRole(scenario),
    ...validateHideousScript(scenario),
    ...validateBossTurf(scenario),
    ...validateFixedStartLocations(scenario),
    ...validateEntryTiming(
      scenario,
      "godlyBeing",
      "loop",
      scenario.loops,
      "신",
    ),
    ...validateEntryTiming(
      scenario,
      "transferStudent",
      "day",
      scenario.daysPerLoop,
      "전학생",
    ),
  ];
  return {
    ok: diagnostics.every(({ severity }) => severity !== "error"),
    diagnostics,
  };
}
