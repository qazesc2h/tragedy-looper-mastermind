import { describe, expect, it } from "vitest";

import scenarioSourceJson from "../data/scenario-source.json";
import {
  characterDataOf,
} from "../src/data";
import { initLoop } from "../src/engine/setup";
import { validateScenario } from "../src/engine/validate";
import { PLOT_IMPL } from "../src/impl/plots";
import { TRAIT_IMPL } from "../src/impl/traits";
import {
  assertOfficialScenariosValid,
  loadBasicTragedyScenarioCatalog,
} from "../src/scenario-catalog";
import type { Scenario } from "../src/types";

const scenarioCatalog = loadBasicTragedyScenarioCatalog();
const scenarios = scenarioCatalog.map(({ scenario }) => scenario);

describe("validateScenario", () => {
  it("loads all 23 bundled basic tragedy scripts for validation", () => {
    expect(scenarios).toHaveLength(23);
  });

  it("keeps plotLessRole in runtime character data", () => {
    expect(characterDataOf("mysteryBoy").plotLessRole).toBe(true);
    expect(characterDataOf("boyStudent").plotLessRole).toBe(false);
  });

  it("loads the boss turf counter location into loop state", () => {
    const scenario = scenarios.find(({ cast }) => "boss" in cast);
    if (scenario === undefined) throw new Error("missing boss scenario");

    expect(validateScenario(scenario)).toEqual({ ok: true, errors: [] });
    expect(initLoop(scenario).turfLocations.boss).toBe(
      scenario.scriptSpecified?.["Turf:boss"],
    );
  });

  it("rejects a missing boss turf location", () => {
    const source = scenarios.find(({ cast }) => "boss" in cast);
    if (source === undefined) throw new Error("missing boss scenario");
    const scenario = structuredClone(source);
    delete scenario.scriptSpecified?.["Turf:boss"];

    expect(validateScenario(scenario)).toEqual({
      ok: false,
      errors: [
        '거물: "Turf:boss"은 Hospital, Shrine, City, School 중 하나여야 합니다. ' +
        "현재 값: 없음.",
      ],
    });
    expect(() => initLoop(scenario)).toThrow(
      'scenario.scriptSpecified["Turf:boss"]',
    );
  });

  it("rejects a role from an active plot for mysteryBoy", () => {
    const source = scenarios.find(({ cast }) => "mysteryBoy" in cast);
    if (source === undefined) throw new Error("missing mysteryBoy scenario");
    const scenario = structuredClone(source);
    scenario.mainPlot = "murderPlan";
    scenario.subPlots = ["loveAffair", "unsettlingRumor"];
    for (const character of Object.keys(scenario.cast)) {
      scenario.cast[character] = "person";
    }
    if ("ai" in scenario.cast) scenario.cast.ai = "killer";
    scenario.cast.mysteryBoy = "keyPerson";

    expect(validateScenario(scenario)).toEqual({
      ok: false,
      errors: [
        "아웃사이더: 현재 시나리오의 룰에서 추가되는 역할을 배정할 수 없습니다. " +
        "참극 세트의 역할 중 현재 룰에서 추가되지 않는 역할을 배정해야 합니다.",
      ],
    });
  });

  it("accepts a role not associated with any active plot for mysteryBoy", () => {
    const source = scenarios.find(({ cast }) => "mysteryBoy" in cast);
    if (source === undefined) throw new Error("missing mysteryBoy scenario");
    const scenario = structuredClone(source);
    scenario.mainPlot = "murderPlan";
    scenario.subPlots = ["loveAffair", "unsettlingRumor"];
    for (const character of Object.keys(scenario.cast)) {
      scenario.cast[character] = "person";
    }
    if ("ai" in scenario.cast) scenario.cast.ai = "killer";
    scenario.cast.mysteryBoy = "witch";

    expect(validateScenario(scenario)).toEqual({ ok: true, errors: [] });
  });

  it("rejects person for mysteryBoy with a distinct error", () => {
    const scenario = scenarios.find(
      ({ cast }) => cast.mysteryBoy === "person",
    );
    if (scenario === undefined) {
      throw new Error("missing bundled mysteryBoy person scenario");
    }

    expect(validateScenario(scenario)).toEqual({
      ok: false,
      errors: [
        "아웃사이더: 엑스트라 역할을 배정할 수 없습니다. " +
        "참극 세트의 역할 중 현재 룰에서 추가되지 않는 역할을 배정해야 합니다.",
      ],
    });
  });

  it("rejects a role outside the basic tragedy set for mysteryBoy", () => {
    const source = scenarios.find(({ cast }) => "mysteryBoy" in cast);
    if (source === undefined) throw new Error("missing mysteryBoy scenario");
    const scenario = structuredClone(source);
    scenario.cast.mysteryBoy = "notABasicRole";

    expect(validateScenario(scenario)).toEqual({
      ok: false,
      errors: [
        "아웃사이더: 현재 참극 세트에 없는 역할을 배정할 수 없습니다. " +
        "현재 참극 세트의 역할 중 활성 룰에서 추가되지 않는 역할을 " +
        "배정해야 합니다.",
      ],
    });
  });

  it("identifies script 18 as the only invalid bundled mysteryBoy assignment", () => {
    const mysteryBoyScenarios = scenarios.filter(
      ({ cast }) => "mysteryBoy" in cast,
    );
    expect(mysteryBoyScenarios).toHaveLength(8);
    const results = mysteryBoyScenarios.map((scenario) =>
      validateScenario(scenario)
    );
    expect(results.filter(({ ok }) => ok)).toHaveLength(7);
    expect(results.filter(({ ok }) => !ok)).toEqual([{
      ok: false,
      errors: [
        "아웃사이더: 엑스트라 역할을 배정할 수 없습니다. " +
        "참극 세트의 역할 중 현재 룰에서 추가되지 않는 역할을 배정해야 합니다.",
      ],
    }]);
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
    scenario.cast.informer = "person";
    scenario.cast.ai = "serialKiller";

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

describe("bundled scenario source policy", () => {
  it("classifies every bundled scenario exactly once", () => {
    expect(scenarioCatalog).toHaveLength(23);
    expect(new Set(scenarioCatalog.map(({ id }) => id)).size).toBe(23);
    expect(scenarioCatalog.filter(({ source }) => source === "official"))
      .toHaveLength(8);
    expect(scenarioCatalog.filter(({ source }) => source === "community"))
      .toHaveLength(15);
    expect(scenarioCatalog.filter(({ source }) => source === "unknown"))
      .toHaveLength(0);
    expect(scenarioSourceJson._basis).toEqual({
      official: "각본가 설명서 수록 확인",
      community: "공식 10편이 전부 식별되었으므로 소거법으로 판정. " +
        "입문편의 나머지 5편은 원본의 New Tragedies·작성자·외부 출처 " +
        "메타데이터를 함께 대조했다.",
    });
  });

  it("passes validation for every bundled official scenario", () => {
    expect(() => assertOfficialScenariosValid(scenarioCatalog)).not.toThrow();
    for (const entry of scenarioCatalog.filter(
      ({ source }) => source === "official",
    )) {
      expect(entry.validation, `${entry.id} ${entry.rawTitle}`).toEqual({
        ok: true,
        errors: [],
      });
    }
  });

  it("keeps the invalid fan scenario in the catalog but blocks its start", () => {
    const trouble = scenarioCatalog.find(
      ({ rawTitle }) => rawTitle === "Trouble in Paradise",
    );
    expect(trouble?.source).toBe("community");
    expect(trouble?.validation).toEqual({
      ok: false,
      errors: [
        "아웃사이더: 엑스트라 역할을 배정할 수 없습니다. " +
        "참극 세트의 역할 중 현재 룰에서 추가되지 않는 역할을 배정해야 합니다.",
      ],
    });
    expect(() => assertOfficialScenariosValid(scenarioCatalog)).not.toThrow();
  });

  it("keeps every other bundled community scenario startable", () => {
    const communityFailures = scenarioCatalog.filter(
      ({ source, validation }) => source === "community" && !validation.ok,
    );
    expect(communityFailures.map(({ rawTitle }) => rawTitle)).toEqual([
      "Trouble in Paradise",
    ]);
  });

  it("fails the official gate if the same invalid scenario is marked official", () => {
    const trouble = scenarioCatalog.find(
      ({ rawTitle }) => rawTitle === "Trouble in Paradise",
    );
    if (trouble === undefined) throw new Error("missing Trouble in Paradise");

    expect(() => assertOfficialScenariosValid([
      { ...trouble, source: "official" },
    ])).toThrow(
      "basicTragedy:18 Trouble in Paradise 난이도 1: " +
      "아웃사이더: 엑스트라 역할을 배정할 수 없습니다.",
    );
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

describe("mysteryBoy scriptBuild source hook", () => {
  const sourceHook = TRAIT_IMPL.mysteryBoy.hooks[0];

  it("stays disabled at runtime and is safe if called", () => {
    const scenario = scenarios.find(({ cast }) => "mysteryBoy" in cast);
    if (scenario === undefined) throw new Error("missing mysteryBoy scenario");
    const state = {
      scenario,
      gamePhase: "ROUND" as const,
      loop: initLoop(scenario),
      history: [],
      loopOutcomes: [],
    };
    const before = structuredClone(state);

    expect(sourceHook.when(state, "mysteryBoy")).toBe(false);
    expect(() => sourceHook.effect(state, "mysteryBoy")).not.toThrow();
    expect(state).toEqual(before);
  });
});
