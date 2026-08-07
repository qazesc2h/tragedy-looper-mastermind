import { describe, expect, it } from "vitest";

import { loadBasicTragedyScenarios } from "../src/data";
import { initLoop } from "../src/engine/setup";
import { validateScenario } from "../src/engine/validate";
import { PLOT_IMPL } from "../src/impl/plots";
import type { Scenario } from "../src/types";

const scenarios = loadBasicTragedyScenarios();

describe("validateScenario", () => {
  it("accepts all 22 bundled basic tragedy scripts", () => {
    expect(scenarios).toHaveLength(22);
    for (const scenario of scenarios) {
      expect(validateScenario(scenario)).toEqual({ ok: true, errors: [] });
    }
  });

  it("rejects a non-girl keyPerson when signWithMe is active", () => {
    const base = scenarios.find(
      ({ mainPlot }) => mainPlot === "signWithMe",
    );
    expect(base).toBeDefined();
    const scenario = structuredClone(base!) as Scenario;
    scenario.cast.shrineMaiden = "person";
    scenario.cast.boyStudent = "keyPerson";

    expect(validateScenario(scenario)).toEqual({
      ok: false,
      errors: [
        "나와 계약하자!: 핵심 인물로 배정된 캐릭터는 " +
        "소녀 속성이어야 합니다. 현재 배정: 남학생.",
      ],
    });
  });

  it("does not apply the signWithMe constraint to another plot", () => {
    const scenario = structuredClone(scenarios[0]);
    scenario.mainPlot = "murderPlan";
    scenario.cast.shrineMaiden = "person";
    scenario.cast.boyStudent = "keyPerson";

    expect(validateScenario(scenario)).toEqual({ ok: true, errors: [] });
  });

  it("rejects AI assigned the person role", () => {
    const scenario = structuredClone(scenarios[0]);
    scenario.cast.ai = "person";

    expect(validateScenario(scenario)).toEqual({
      ok: false,
      errors: [
        "AI: AI 캐릭터에는 엑스트라 역할을 배정할 수 없습니다.",
      ],
    });
  });

  it("accepts AI assigned a non-person role", () => {
    const scenario = structuredClone(scenarios[0]);
    scenario.cast.ai = "brain";

    expect(validateScenario(scenario)).toEqual({ ok: true, errors: [] });
  });

  it.each([
    ["missing", undefined],
    ["non-integer", 1.5],
    ["below range", 0],
    ["above range", 4],
  ])("rejects godlyBeing entry loop when %s", (_label, value) => {
    const scenario = structuredClone(scenarios[0]) as Scenario;
    scenario.cast.godlyBeing = "person";
    scenario.loops = 3;
    scenario.scriptSpecified = value === undefined
      ? undefined
      : { "enters on loop:godlyBeing": value };

    expect(validateScenario(scenario)).toEqual({
      ok: false,
      errors: [
        "신: \"enters on loop:godlyBeing\"은 1 이상 3 이하의 정수여야 " +
        `합니다. 현재 값: ${value === undefined ? "없음" : value}.`,
      ],
    });
  });

  it.each([
    ["missing", undefined],
    ["non-integer", 2.5],
    ["below range", 0],
    ["above range", 5],
  ])("rejects transferStudent entry day when %s", (_label, value) => {
    const scenario = structuredClone(scenarios[0]) as Scenario;
    scenario.cast.transferStudent = "person";
    scenario.daysPerLoop = 4;
    scenario.scriptSpecified = value === undefined
      ? undefined
      : { "enters on day:transferStudent": value };

    expect(validateScenario(scenario)).toEqual({
      ok: false,
      errors: [
        "전학생: \"enters on day:transferStudent\"은 1 이상 4 이하의 정수여야 " +
        `합니다. 현재 값: ${value === undefined ? "없음" : value}.`,
      ],
    });
  });

  it("accepts entry timing at both inclusive boundaries", () => {
    const scenario = structuredClone(scenarios[0]) as Scenario;
    scenario.cast.godlyBeing = "person";
    scenario.cast.transferStudent = "person";
    scenario.loops = 3;
    scenario.daysPerLoop = 4;
    scenario.scriptSpecified = {
      "enters on loop:godlyBeing": 3,
      "enters on day:transferStudent": 1,
    };

    expect(validateScenario(scenario)).toEqual({ ok: true, errors: [] });
  });
});

describe("signWithMe scriptBuild source hook", () => {
  const sourceHook = PLOT_IMPL.signWithMe.hooks[0];

  it("stays disabled at runtime and is safe if called", () => {
    const scenario = scenarios.find(
      ({ mainPlot }) => mainPlot === "signWithMe",
    );
    expect(scenario).toBeDefined();
    const state = {
      scenario: scenario!,
      gamePhase: "ROUND" as const,
      loop: initLoop(scenario!),
      history: [],
      loopOutcomes: [],
    };
    const before = structuredClone(state);

    expect(sourceHook.when(state, "")).toBe(false);
    expect(() => sourceHook.effect(state, "")).not.toThrow();
    expect(state).toEqual(before);
  });
});
