import { describe, expect, it } from "vitest";

import scenarioSourceJson from "../data/scenario-source.json";
import {
  characterDataOf,
} from "../src/data";
import { initLoop } from "../src/engine/setup";
import {
  scenarioValidationErrorMessages,
  validateScenario,
  type ScenarioDiagnosticCode,
  type ScenarioValidationResult,
} from "../src/engine/validate";
import { PLOT_IMPL } from "../src/impl/plots";
import { ROLE_IMPL } from "../src/impl/roles";
import {
  COPYCAT_GOODWILL_KO,
  COPYCAT_GOODWILL_SOURCE,
  COPYCAT_TRAIT_KO,
  COPYCAT_TRAIT_SOURCE,
  TRAIT_IMPL,
} from "../src/impl/traits";
import {
  assertOfficialScenariosValid,
  loadBasicTragedyScenarioCatalog,
} from "../src/scenario-catalog";
import type { Scenario } from "../src/types";

const scenarioCatalog = loadBasicTragedyScenarioCatalog();
const scenarios = scenarioCatalog.map(({ scenario }) => scenario);

function invalidResult(
  path: string,
  code: ScenarioDiagnosticCode,
  message: string,
): ScenarioValidationResult {
  return {
    ok: false,
    diagnostics: [{ path, code, severity: "error", message }],
  };
}

function errorMessages(scenario: Scenario): string[] {
  return scenarioValidationErrorMessages(validateScenario(scenario));
}

describe("validateScenario", () => {
  it("loads all 23 bundled basic tragedy scripts for validation", () => {
    expect(scenarios).toHaveLength(23);
  });

  it("keeps plotLessRole in runtime character data", () => {
    expect(characterDataOf("mysteryBoy").plotLessRole).toBe(true);
    expect(characterDataOf("boyStudent").plotLessRole).toBe(false);
  });

  it("preserves copycat's exact source and Korean translation text", () => {
    expect(characterDataOf("copycat").goodwillAbilities[1]).toMatchObject({
      minLoop: 2,
      immuneToGoodwillRefusel: true,
    });
    expect(TRAIT_IMPL.copycat.hooks[0].source.description)
      .toBe(COPYCAT_TRAIT_SOURCE);
    expect(COPYCAT_TRAIT_KO).toBe(
      "시나리오 작성 시: 이 캐릭터는 시나리오에 있는 다른 캐릭터의 역할을 반드시 복사해야 합니다(최대 인원 무시).",
    );
    expect(COPYCAT_GOODWILL_SOURCE).toBe(
      "Loop 2 or later: Reveal the name of all characters with the same Role as :copycat:. This cannot be refused by :goodwill: Refusel.",
    );
    expect(COPYCAT_GOODWILL_KO).toBe(
      "2번째 루프부터: :copycat:와(과) 같은 역할을 지닌 모든 캐릭터의 이름을 공개합니다. 이 능력은 :goodwill: 무시로 거부할 수 없습니다.",
    );
  });

  it("loads the boss turf counter location into loop state", () => {
    const scenario = scenarios.find(({ cast }) => "boss" in cast);
    if (scenario === undefined) throw new Error("missing boss scenario");

    expect(validateScenario(scenario)).toEqual({ ok: true, diagnostics: [] });
    expect(initLoop(scenario).turfLocations.boss).toBe(
      scenario.scriptSpecified?.["Turf:boss"],
    );
  });

  it("rejects a missing boss turf location", () => {
    const source = scenarios.find(({ cast }) => "boss" in cast);
    if (source === undefined) throw new Error("missing boss scenario");
    const scenario = structuredClone(source);
    delete scenario.scriptSpecified?.["Turf:boss"];

    expect(validateScenario(scenario)).toEqual(invalidResult(
      "scriptSpecified.Turf:boss",
      "BOSS_TURF_INVALID",
        '거물: "Turf:boss"은 Hospital, Shrine, City, School 중 하나여야 합니다. ' +
        "현재 값: 없음.",
    ));
    expect(() => initLoop(scenario)).toThrow(
      'scenario.scriptSpecified["Turf:boss"]',
    );
  });

  it("rejects a missing fixed start location for a multi-location character", () => {
    const entry = loadBasicTragedyScenarioCatalog().find(({ id }) =>
      id === "community:naughty-cat"
    );
    if (entry === undefined) throw new Error("missing community:naughty-cat");
    const scenario = structuredClone(entry.scenario);
    delete scenario.scriptSpecified?.["startLocation:servant"];

    expect(validateScenario(scenario)).toEqual(invalidResult(
      "scriptSpecified.startLocation:servant",
      "SERVANT_START_MISSING",
        "메이드의 시작 장소가 지정되지 않았습니다. 도심 또는 학교 중 " +
        "하나를 선택하세요.",
    ));
  });

  it("rejects a fixed start location outside the character's candidates", () => {
    const entry = loadBasicTragedyScenarioCatalog().find(({ id }) =>
      id === "community:naughty-cat"
    );
    if (entry === undefined) throw new Error("missing community:naughty-cat");
    const scenario = structuredClone(entry.scenario);
    if (scenario.scriptSpecified === undefined) {
      throw new Error("missing scenario metadata");
    }
    scenario.scriptSpecified["startLocation:servant"] = "Shrine";

    expect(validateScenario(scenario)).toEqual(invalidResult(
      "scriptSpecified.startLocation:servant",
      "SERVANT_START_INVALID",
        "메이드의 시작 장소가 올바르지 않습니다. 도심 또는 학교 중 " +
        '하나를 선택하세요. 현재 값: "Shrine".',
    ));
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

    expect(validateScenario(scenario)).toEqual(invalidResult(
      "cast.mysteryBoy",
      "MYSTERY_BOY_ROLE_IN_PLOT",
        "아웃사이더: 현재 시나리오의 룰에서 추가되는 역할을 배정할 수 없습니다. " +
        "참극 세트의 역할 중 현재 룰에서 추가되지 않는 역할을 배정해야 합니다.",
    ));
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

    expect(validateScenario(scenario)).toEqual({ ok: true, diagnostics: [] });
  });

  it("rejects person for mysteryBoy with a distinct error", () => {
    const scenario = scenarios.find(
      ({ cast }) => cast.mysteryBoy === "person",
    );
    if (scenario === undefined) {
      throw new Error("missing bundled mysteryBoy person scenario");
    }

    expect(validateScenario(scenario)).toEqual(invalidResult(
      "cast.mysteryBoy",
      "MYSTERY_BOY_ROLE_IS_PERSON",
        "아웃사이더: 엑스트라 역할을 배정할 수 없습니다. " +
        "참극 세트의 역할 중 현재 룰에서 추가되지 않는 역할을 배정해야 합니다.",
    ));
  });

  it("rejects a role outside the basic tragedy set for mysteryBoy", () => {
    const source = scenarios.find(({ cast }) => "mysteryBoy" in cast);
    if (source === undefined) throw new Error("missing mysteryBoy scenario");
    const scenario = structuredClone(source);
    scenario.cast.mysteryBoy = "notABasicRole";

    expect(validateScenario(scenario)).toEqual(invalidResult(
      "cast.mysteryBoy",
      "MYSTERY_BOY_ROLE_NOT_IN_TRAGEDY_SET",
        "아웃사이더: 현재 참극 세트에 없는 역할을 배정할 수 없습니다. " +
        "현재 참극 세트의 역할 중 활성 룰에서 추가되지 않는 역할을 " +
        "배정해야 합니다.",
    ));
  });

  it("requires copycat to copy another cast character's role", () => {
    const scenario = structuredClone(scenarios[0]);
    scenario.cast.copycat = "killer";

    expect(errorMessages(scenario)).toContain(
      "모방자: 시나리오에 등장하는 다른 캐릭터와 같은 역할을 " +
        "배정해야 합니다. 현재 배정: 살인 청부업자.",
    );
  });

  it("allows copycat to copy person because the source has no exception", () => {
    const scenario = structuredClone(scenarios[0]);
    scenario.cast.copycat = "person";

    expect(validateScenario(scenario)).toEqual({ ok: true, diagnostics: [] });
  });

  it("allows copycat to copy mysteryBoy's inactive role", () => {
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
    scenario.cast.copycat = "witch";

    expect(validateScenario(scenario)).toEqual({ ok: true, diagnostics: [] });
  });

  it("adds exactly one copycat allowance to an active role maximum", () => {
    const source = scenarios.find(({ cast }) => "copycat" in cast);
    if (source === undefined) throw new Error("missing copycat scenario");
    const allowed = structuredClone(source);
    expect(validateScenario(allowed)).toEqual({ ok: true, diagnostics: [] });

    allowed.cast.doctor = "killer";
    expect(errorMessages(allowed)).toContain(
      "역할 수: 살인 청부업자 역할은 선택된 룰에서 최대 1명까지 " +
        "배정할 수 있지만 현재 2명입니다.",
    );
  });

  it.each([
    {
      role: "conspiracyTheorist",
      mainPlot: "murderPlan",
      subPlots: ["unsettlingRumor", "loveAffair"],
      label: "선동가",
    },
    {
      role: "timeTraveler",
      mainPlot: "changeOfFuture",
      subPlots: ["unsettlingRumor", "loveAffair"],
      label: "시간 여행자",
    },
  ])("allows one $label plus its copycat, but not another ordinary holder", ({
    role,
    mainPlot,
    subPlots,
    label,
  }) => {
    const scenario: Scenario = {
      tragedySet: "basicTragedy",
      mainPlot,
      subPlots,
      cast: {
        journalist: role,
        copycat: role,
      },
      incidents: [],
      loops: 3,
      daysPerLoop: 5,
    };

    expect(validateScenario(scenario)).toEqual({ ok: true, diagnostics: [] });
    scenario.cast.doctor = role;
    expect(errorMessages(scenario)).toContain(
      `역할 수: ${label} 역할은 선택된 룰에서 최대 1명까지 ` +
        "배정할 수 있지만 현재 2명입니다.",
    );
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
    expect(results.filter(({ ok }) => !ok)).toEqual([invalidResult(
      "cast.mysteryBoy",
      "MYSTERY_BOY_ROLE_IS_PERSON",
        "아웃사이더: 엑스트라 역할을 배정할 수 없습니다. " +
        "참극 세트의 역할 중 현재 룰에서 추가되지 않는 역할을 배정해야 합니다.",
    )]);
  });

  it("rejects a non-girl keyPerson when signWithMe is active", () => {
    const base = scenarios.find(
      ({ mainPlot }) => mainPlot === "signWithMe",
    );
    expect(base).toBeDefined();
    const scenario = structuredClone(base!) as Scenario;
    scenario.cast.shrineMaiden = "person";
    scenario.cast.boyStudent = "keyPerson";

    expect(validateScenario(scenario)).toEqual(invalidResult(
      "cast.boyStudent",
      "SIGN_WITH_ME_KEY_PERSON_NOT_GIRL",
        "나와 계약하자!: 핵심 인물로 배정된 캐릭터는 " +
        "소녀 속성이어야 합니다. 현재 배정: 남학생.",
    ));
  });

  it("does not apply the signWithMe constraint to another plot", () => {
    const scenario = structuredClone(scenarios[0]);
    scenario.mainPlot = "murderPlan";
    scenario.cast.shrineMaiden = "person";
    scenario.cast.boyStudent = "keyPerson";

    expect(validateScenario(scenario)).toEqual({ ok: true, diagnostics: [] });
  });

  it("rejects AI assigned the person role", () => {
    const scenario = structuredClone(scenarios[0]);
    scenario.cast.ai = "person";

    expect(validateScenario(scenario)).toEqual(invalidResult(
      "cast.ai",
      "AI_ROLE_IS_PERSON",
      "AI: AI 캐릭터에는 엑스트라 역할을 배정할 수 없습니다.",
    ));
  });

  it("accepts AI assigned a non-person role", () => {
    const scenario = structuredClone(scenarios[0]);
    scenario.cast.informer = "person";
    scenario.cast.ai = "serialKiller";

    expect(validateScenario(scenario)).toEqual({ ok: true, diagnostics: [] });
  });

  it.each(["killer", "witch"])(
    "rejects littleSister assigned the goodwill-refusal role %s",
    (role) => {
      const scenario = structuredClone(scenarios[0]) as Scenario;
      scenario.cast.littleSister = role;

      expect(errorMessages(scenario)).toContain(
        "여동생: 우호 무시 또는 절대 우호 무시 능력을 지닌 역할을 " +
          `배정할 수 없습니다. 현재 배정: ${ROLE_IMPL[role]?.ko ?? role}.`,
      );
    },
  );

  it("accepts littleSister assigned a role without goodwill refusal", () => {
    const scenario = structuredClone(scenarios[0]) as Scenario;
    scenario.cast.littleSister = "person";

    expect(validateScenario(scenario).diagnostics.some(({ message }) =>
      message.startsWith("여동생:")
    )).toBe(false);
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

    expect(validateScenario(scenario)).toEqual(invalidResult(
      "scriptSpecified.enters on loop:godlyBeing",
      "ENTRY_TIMING_OUT_OF_RANGE",
        "신: \"enters on loop:godlyBeing\"은 1 이상 3 이하의 정수여야 " +
        `합니다. 현재 값: ${value === undefined ? "없음" : value}.`,
    ));
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

    expect(validateScenario(scenario)).toEqual(invalidResult(
      "scriptSpecified.enters on day:transferStudent",
      "ENTRY_TIMING_OUT_OF_RANGE",
        "전학생: \"enters on day:transferStudent\"은 1 이상 4 이하의 정수여야 " +
        `합니다. 현재 값: ${value === undefined ? "없음" : value}.`,
    ));
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

    expect(validateScenario(scenario)).toEqual({ ok: true, diagnostics: [] });
  });

  it("returns stable paths and codes for plot, incident, and role fields", () => {
    const base = structuredClone(scenarios[0]) as Scenario;

    const unknownSet = validateScenario({ tragedySet: "unknown" });
    expect(unknownSet.diagnostics).toContainEqual(expect.objectContaining({
      path: "tragedySet",
      code: "TRAGEDY_SET_UNKNOWN",
      severity: "error",
    }));

    const mainPlot = { ...base, mainPlot: "notAPlot" };
    expect(validateScenario(mainPlot).diagnostics).toContainEqual(
      expect.objectContaining({
        path: "mainPlot",
        code: "MAIN_PLOT_NOT_IN_TRAGEDY_SET",
      }),
    );

    const subPlotCount = { ...base, subPlots: base.subPlots.slice(0, 1) };
    expect(validateScenario(subPlotCount).diagnostics).toContainEqual(
      expect.objectContaining({
        path: "subPlots",
        code: "SUBPLOT_COUNT_MISMATCH",
      }),
    );

    const subPlot = { ...base, subPlots: [base.subPlots[0], "notAPlot"] };
    expect(validateScenario(subPlot).diagnostics).toContainEqual(
      expect.objectContaining({
        path: "subPlots[1]",
        code: "SUBPLOT_NOT_IN_TRAGEDY_SET",
      }),
    );

    const duplicatePlot = {
      ...base,
      subPlots: [base.subPlots[0], base.subPlots[0]],
    };
    expect(validateScenario(duplicatePlot).diagnostics).toContainEqual(
      expect.objectContaining({
        path: "subPlots[1]",
        code: "PLOT_DUPLICATED",
      }),
    );

    const incident = structuredClone(base);
    incident.incidents[2] = {
      ...incident.incidents[2],
      incident: "notAnIncident",
    };
    expect(validateScenario(incident).diagnostics).toContainEqual(
      expect.objectContaining({
        path: "incidents[2].incident",
        code: "INCIDENT_NOT_IN_TRAGEDY_SET",
      }),
    );

    const role = structuredClone(base);
    role.cast.informer = "notARole";
    expect(validateScenario(role).diagnostics).toContainEqual(
      expect.objectContaining({
        path: "cast.informer",
        code: "ROLE_NOT_IN_TRAGEDY_SET",
      }),
    );
  });

  it("returns stable paths and codes for character-specific constraints", () => {
    const base = structuredClone(scenarios[0]) as Scenario;

    const littleSister = structuredClone(base);
    littleSister.cast.littleSister = "killer";
    expect(validateScenario(littleSister).diagnostics).toContainEqual(
      expect.objectContaining({
        path: "cast.littleSister",
        code: "LITTLE_SISTER_GOODWILL_REFUSAL_ROLE",
      }),
    );

    const copycat = structuredClone(base);
    copycat.cast.copycat = "killer";
    expect(validateScenario(copycat).diagnostics).toContainEqual(
      expect.objectContaining({
        path: "cast.copycat",
        code: "COPYCAT_ROLE_NOT_COPIED",
      }),
    );

    const roleCount: Scenario = {
      tragedySet: "basicTragedy",
      mainPlot: "murderPlan",
      subPlots: ["loveAffair", "unsettlingRumor"],
      cast: { journalist: "killer", informer: "killer" },
      incidents: [],
      loops: 3,
      daysPerLoop: 5,
    };
    expect(validateScenario(roleCount).diagnostics).toContainEqual(
      expect.objectContaining({
        path: "cast.informer",
        code: "ROLE_COUNT_EXCEEDED",
      }),
    );
  });

  it("does not throw for empty or partially entered scenarios", () => {
    expect(validateScenario({})).toEqual({ ok: true, diagnostics: [] });
    expect(validateScenario({
      tragedySet: "basicTragedy",
      cast: { informer: "killer" },
    })).toEqual({ ok: true, diagnostics: [] });
    expect(() => validateScenario({
      tragedySet: "basicTragedy",
      cast: {},
      incidents: [{ day: 2 }, {}],
    })).not.toThrow();
    expect(() => validateScenario({
      tragedySet: "basicTragedy",
      subPlots: [],
      cast: { godlyBeing: "person" },
    })).not.toThrow();

    expect(validateScenario({
      tragedySet: "unknown",
      cast: { ai: "person" },
    }).diagnostics.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: "tragedySet", code: "TRAGEDY_SET_UNKNOWN" },
      { path: "cast.ai", code: "AI_ROLE_IS_PERSON" },
    ]);
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
        diagnostics: [],
      });
    }
  });

  it("keeps the invalid fan scenario in the catalog but blocks its start", () => {
    const trouble = scenarioCatalog.find(
      ({ rawTitle }) => rawTitle === "Trouble in Paradise",
    );
    expect(trouble?.source).toBe("community");
    expect(trouble?.validation).toEqual(invalidResult(
      "cast.mysteryBoy",
      "MYSTERY_BOY_ROLE_IS_PERSON",
        "아웃사이더: 엑스트라 역할을 배정할 수 없습니다. " +
        "참극 세트의 역할 중 현재 룰에서 추가되지 않는 역할을 배정해야 합니다.",
    ));
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
