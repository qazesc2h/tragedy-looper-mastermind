import charactersJson from "../../data/characters.json";
import { PLOT_IMPL } from "../impl/plots";
import { ROLE_IMPL } from "../impl/roles";
import {
  rolesForTragedySet,
  TRAGEDY_SETS,
  type TragedySetDefinition,
} from "../tragedy-sets";

import { LOCATIONS, type CharacterId, type Scenario } from "../types";

interface ValidationCharacterData {
  en?: unknown;
  ko?: unknown;
  tags?: unknown;
  plotLessRole?: unknown;
  startLocation?: unknown;
}

export interface ScenarioValidationResult {
  ok: boolean;
  errors: string[];
}

const characters = charactersJson as unknown as Record<
  CharacterId,
  ValidationCharacterData
>;

function activePlots(scenario: Scenario): string[] {
  return [scenario.mainPlot, ...scenario.subPlots];
}

function characterHasTag(character: CharacterId, tag: string): boolean {
  const tags = characters[character]?.tags;
  return Array.isArray(tags) && tags.includes(tag);
}

function characterLabel(character: CharacterId): string {
  const data = characters[character];
  if (typeof data?.ko === "string" && data.ko.length > 0) return data.ko;
  if (typeof data?.en === "string" && data.en.length > 0) return data.en;
  return character;
}

function validateSignWithMe(scenario: Scenario): string[] {
  if (!activePlots(scenario).includes("signWithMe")) return [];

  return Object.entries(scenario.cast)
    .filter(([, role]) => role === "keyPerson")
    .filter(([character]) => !characterHasTag(character, "girl"))
    .map(([character]) =>
      "나와 계약하자!: 핵심 인물로 배정된 캐릭터는 " +
      `소녀 속성이어야 합니다. 현재 배정: ${characterLabel(character)}.`
    );
}

function validateAiRole(scenario: Scenario): string[] {
  if (scenario.cast.ai !== "person") return [];
  return ["AI: AI 캐릭터에는 엑스트라 역할을 배정할 수 없습니다."];
}

function rolesAssociatedWithActivePlots(scenario: Scenario): Set<string> {
  const roles = new Set<string>();
  for (const plot of activePlots(scenario)) {
    for (const role of Object.keys(PLOT_IMPL[plot]?.addsRoles ?? {})) {
      roles.add(role);
    }
  }
  return roles;
}

function validateMysteryBoyRole(
  scenario: Scenario,
  definition: TragedySetDefinition,
): string[] {
  if (!("mysteryBoy" in scenario.cast)) return [];
  if (scenario.cast.mysteryBoy === "person") {
    return [
      "아웃사이더: 엑스트라 역할을 배정할 수 없습니다. " +
      "참극 세트의 역할 중 현재 룰에서 추가되지 않는 역할을 배정해야 합니다.",
    ];
  }
  if (!rolesForTragedySet(definition.id).includes(
    scenario.cast.mysteryBoy,
  )) {
    return [
      "아웃사이더: 현재 참극 세트에 없는 역할을 배정할 수 없습니다. " +
      "현재 참극 세트의 역할 중 활성 룰에서 추가되지 않는 역할을 " +
      "배정해야 합니다.",
    ];
  }
  if (!rolesAssociatedWithActivePlots(scenario).has(
    scenario.cast.mysteryBoy,
  )) {
    return [];
  }
  return [
    "아웃사이더: 현재 시나리오의 룰에서 추가되는 역할을 배정할 수 없습니다. " +
    "참극 세트의 역할 중 현재 룰에서 추가되지 않는 역할을 배정해야 합니다.",
  ];
}

function validateTragedySetPlots(
  scenario: Scenario,
  definition: TragedySetDefinition,
): string[] {
  const errors: string[] = [];
  if (definition.numberOfMainPlots !== 1) {
    errors.push(
      `참극 세트 ${definition.id}: 현재 엔진은 룰 Y 1개만 지원하지만 ` +
      `정의에는 ${definition.numberOfMainPlots}개가 지정되어 있습니다.`,
    );
  }
  if (!definition.mainPlots.includes(scenario.mainPlot)) {
    errors.push(
      `룰 Y: ${scenario.mainPlot}은(는) ${definition.id} 참극 세트에 없습니다.`,
    );
  }
  if (scenario.subPlots.length !== definition.numberOfSubPlots) {
    errors.push(
      `룰 X: ${definition.id} 참극 세트는 ` +
      `${definition.numberOfSubPlots}개를 사용해야 합니다. ` +
      `현재 ${scenario.subPlots.length}개입니다.`,
    );
  }
  for (const plot of scenario.subPlots) {
    if (!definition.subPlots.includes(plot)) {
      errors.push(
        `룰 X: ${plot}은(는) ${definition.id} 참극 세트에 없습니다.`,
      );
    }
  }
  if (new Set(activePlots(scenario)).size !== activePlots(scenario).length) {
    errors.push("룰 Y와 룰 X에는 같은 룰을 중복해서 사용할 수 없습니다.");
  }
  return errors;
}

function validateIncidentsInTragedySet(
  scenario: Scenario,
  definition: TragedySetDefinition,
): string[] {
  return scenario.incidents
    .filter(({ incident }) => !definition.incidents.includes(incident))
    .map(({ day, incident }) =>
      `사건: ${day}일의 ${incident}은(는) ` +
      `${definition.id} 참극 세트에 없습니다.`
    );
}

function validateRolesInTragedySet(
  scenario: Scenario,
  definition: TragedySetDefinition,
): string[] {
  const rolePool = new Set(rolesForTragedySet(definition.id));
  return Object.entries(scenario.cast)
    .filter(([character, role]) =>
      character !== "mysteryBoy" && !rolePool.has(role)
    )
    .map(([character, role]) =>
      `역할: ${characterLabel(character)}에게 배정된 ${role}은(는) ` +
      `${definition.id} 참극 세트에 없습니다.`
    );
}

function validateHideousScript(scenario: Scenario): string[] {
  if (!activePlots(scenario).includes("hideousScript")) return [];
  const count = Object.values(scenario.cast).filter(
    (role) => role === "curmudgeon",
  ).length;
  return count <= 2
    ? []
    : [`최악의 시나리오: 골칫거리는 0~2명이어야 합니다. 현재 ${count}명입니다.`];
}

function maximumAddedRoleCounts(scenario: Scenario): Map<string, number> {
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
  scenario: Scenario,
  definition: TragedySetDefinition,
): string[] {
  const rolePool = new Set(rolesForTragedySet(definition.id));
  const allowed = maximumAddedRoleCounts(scenario);
  const actual = new Map<string, number>();
  for (const [character, role] of Object.entries(scenario.cast)) {
    // 모방자는 최대 인원을 무시해 역할을 복제하고, 아웃사이더는 활성 룰 외
    // 역할을 맡는다. 둘 다 룰이 공급하는 역할 정원에는 포함하지 않는다.
    if (characters[character]?.plotLessRole === true || role === "person") {
      continue;
    }
    if (!rolePool.has(role)) continue;
    actual.set(role, (actual.get(role) ?? 0) + 1);
  }

  return [...actual.entries()].flatMap(([role, count]) => {
    const limit = allowed.get(role) ?? 0;
    if (count <= limit) return [];
    const roleName = ROLE_IMPL[role]?.ko ?? role;
    return [
      `역할 수: ${roleName} 역할은 선택된 룰에서 최대 ${limit}명까지 ` +
        `배정할 수 있지만 현재 ${count}명입니다.`,
    ];
  });
}

function metadataValueLabel(value: unknown): string {
  return value === undefined ? "없음" : JSON.stringify(value);
}

function validateEntryTiming(
  scenario: Scenario,
  character: "godlyBeing" | "transferStudent",
  kind: "loop" | "day",
  maximum: number,
  characterName: string,
): string[] {
  if (!(character in scenario.cast)) return [];

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

  return [
    `${characterName}: "${key}"은 1 이상 ${maximum} 이하의 정수여야 ` +
    `합니다. 현재 값: ${metadataValueLabel(value)}.`,
  ];
}

function validateBossTurf(scenario: Scenario): string[] {
  if (!("boss" in scenario.cast)) return [];
  const key = "Turf:boss";
  const value = scenario.scriptSpecified?.[key];
  if (LOCATIONS.some((location) => location === value)) return [];
  return [
    `거물: "${key}"은 ${LOCATIONS.join(", ")} 중 하나여야 합니다. ` +
    `현재 값: ${metadataValueLabel(value)}.`,
  ];
}

const LOCATION_LABELS: Readonly<Record<string, string>> = {
  Hospital: "병원",
  Shrine: "신사",
  City: "도심",
  School: "학교",
};

/** 복수 시작 장소 중 시나리오가 확정해야 하는 값을 검사한다. */
function validateFixedStartLocations(scenario: Scenario): string[] {
  return Object.keys(scenario.cast).flatMap((character) => {
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
      return [
        `${characterLabel(character)}의 시작 장소가 지정되지 않았습니다. ` +
        `${choiceLabels} 중 하나를 선택하세요.`,
      ];
    }
    return [
      `${characterLabel(character)}의 시작 장소가 올바르지 않습니다. ` +
      `${choiceLabels} 중 하나를 선택하세요. 현재 값: ` +
      `${metadataValueLabel(selected)}.`,
    ];
  });
}

/** 시나리오 작성 시 적용되는 제약을 런타임 시작 전에 한 번 검증한다. */
export function validateScenario(
  scenario: Scenario,
): ScenarioValidationResult {
  const definition = TRAGEDY_SETS[scenario.tragedySet];
  if (definition === undefined) {
    return {
      ok: false,
      errors: [`알 수 없는 참극 세트: ${scenario.tragedySet}.`],
    };
  }
  const errors = [
    ...validateTragedySetPlots(scenario, definition),
    ...validateIncidentsInTragedySet(scenario, definition),
    ...validateRolesInTragedySet(scenario, definition),
    ...validateSignWithMe(scenario),
    ...validateAiRole(scenario),
    ...validateMysteryBoyRole(scenario, definition),
    ...validateRoleCounts(scenario, definition),
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
  return { ok: errors.length === 0, errors };
}
