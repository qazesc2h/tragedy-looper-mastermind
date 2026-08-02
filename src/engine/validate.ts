import charactersJson from "../../data/characters.json";

import type { CharacterId, Scenario } from "../types";

interface ValidationCharacterData {
  en?: unknown;
  ko?: unknown;
  tags?: unknown;
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

/** 시나리오 작성 시 적용되는 제약을 런타임 시작 전에 한 번 검증한다. */
export function validateScenario(
  scenario: Scenario,
): ScenarioValidationResult {
  const errors = [
    ...validateSignWithMe(scenario),
  ];
  return { ok: errors.length === 0, errors };
}
