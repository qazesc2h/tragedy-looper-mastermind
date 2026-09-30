import type { SpecialGaugeState } from "../types";

export interface SpecialGaugeDefinition {
  initialValue: number;
  lifetime: "loop" | "game";
}

/**
 * 한국어판 대상 중 특수 게이지를 쓰는 세트의 수명 계약.
 * 실제 증감 트리거와 세트별 승패 효과는 각 세트 구현 단계에서 연결한다.
 */
export const SPECIAL_GAUGE_DEFINITIONS: Readonly<
  Record<string, SpecialGaugeDefinition | undefined>
> = {
  mysteryCircle: { initialValue: 0, lifetime: "loop" },
  cosmicMythology: { initialValue: 0, lifetime: "game" },
  hauntedStage: { initialValue: 0, lifetime: "game" },
};

export function specialGaugeDefinition(
  tragedySet: string,
): SpecialGaugeDefinition | undefined {
  return SPECIAL_GAUGE_DEFINITIONS[tragedySet];
}

export function initialSpecialGauge(
  tragedySet: string,
  previous?: SpecialGaugeState,
): SpecialGaugeState | undefined {
  const definition = specialGaugeDefinition(tragedySet);
  if (definition === undefined) return undefined;
  return {
    value: definition.lifetime === "game" && previous !== undefined
      ? previous.value
      : definition.initialValue,
    increasedThisLoop: false,
  };
}

export function adjustSpecialGauge(
  gauge: SpecialGaugeState,
  delta: -1 | 1,
): void {
  const nextValue = gauge.value + delta;
  if (nextValue < 0) {
    throw new Error("special gauge cannot be negative");
  }
  gauge.value = nextValue;
  if (delta > 0) gauge.increasedThisLoop = true;
}
