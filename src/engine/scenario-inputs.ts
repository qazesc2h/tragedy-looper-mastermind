import { characterDataOf } from "../data";
import type { CharacterId, Location, Scenario } from "../types";

export interface ScenarioStartLocationInput {
  character: CharacterId;
  choices: readonly Location[];
}

/** 원본 각본이 빠뜨린 복수 시작 장소 입력을 임의 기본값 없이 나열한다. */
export function requiredScenarioStartLocationInputs(
  scenario: Scenario,
): ScenarioStartLocationInput[] {
  return Object.keys(scenario.cast).flatMap((character) => {
    if (character === "henchman") return [];
    const choices = characterDataOf(character).startLocation;
    if (
      choices.length <= 1 ||
      scenario.scriptSpecified?.[`startLocation:${character}`] !== undefined
    ) {
      return [];
    }
    return [{ character, choices }];
  });
}

/** 시작 화면에서 받은 필수 입력을 시나리오의 구조화된 값으로 확정한다. */
export function applyScenarioStartLocationInputs(
  scenario: Scenario,
  selections: Readonly<Partial<Record<CharacterId, Location>>>,
): Scenario {
  const resolved = structuredClone(scenario);
  const inputs = requiredScenarioStartLocationInputs(resolved);
  if (inputs.length === 0) return resolved;
  const scriptSpecified = resolved.scriptSpecified ??= {};
  for (const input of inputs) {
    const selected = selections[input.character];
    if (selected === undefined || !input.choices.includes(selected)) {
      throw new Error(
        `${input.character} start location must be one of ` +
        input.choices.join(", "),
      );
    }
    scriptSpecified[`startLocation:${input.character}`] = selected;
  }
  return resolved;
}
