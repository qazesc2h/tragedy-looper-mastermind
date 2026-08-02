import { describe, expect, it } from "vitest";

import { loadBasicTragedyScenarios } from "../src/data";
import { initLoop } from "../src/engine/setup";
import { validateScenario } from "../src/engine/validate";
import { PLOT_IMPL } from "../src/impl/plots";
import type { Scenario } from "../src/types";

const scenarios = loadBasicTragedyScenarios({
  scriptSpecified: {
    "startLocation:henchman": "Hospital",
  },
});

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
      loop: initLoop(scenario!),
      history: [],
    };
    const before = structuredClone(state);

    expect(sourceHook.when(state, "")).toBe(false);
    expect(() => sourceHook.effect(state, "")).not.toThrow();
    expect(state).toEqual(before);
  });
});
