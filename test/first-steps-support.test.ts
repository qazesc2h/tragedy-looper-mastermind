import { describe, expect, it } from "vitest";

import { validateScenario } from "../src/engine/validate";
import {
  assertOfficialScenariosValid,
  loadBasicTragedyScenarioCatalog,
  loadFirstStepsScenarioCatalog,
  loadScenarioCatalog,
} from "../src/scenario-catalog";
import {
  rolesForTragedySet,
  tragedySetDefinition,
} from "../src/tragedy-sets";
import type { Scenario } from "../src/types";

describe("tragedy set definitions", () => {
  it("uses the source plot counts for firstSteps and basicTragedy", () => {
    expect(tragedySetDefinition("firstSteps")).toMatchObject({
      numberOfMainPlots: 1,
      numberOfSubPlots: 1,
      hasFinalGuess: false,
    });
    expect(tragedySetDefinition("basicTragedy")).toMatchObject({
      numberOfMainPlots: 1,
      numberOfSubPlots: 2,
      hasFinalGuess: true,
    });
  });

  it("derives each role pool from every plot in that tragedy set", () => {
    expect(rolesForTragedySet("firstSteps")).toEqual([
      "person",
      "keyPerson",
      "killer",
      "brain",
      "cultist",
      "conspiracyTheorist",
      "serialKiller",
      "curmudgeon",
      "friend",
    ]);
    expect(rolesForTragedySet("basicTragedy")).not.toContain("curmudgeon");
    expect(rolesForTragedySet("basicTragedy")).toContain("witch");
  });

  it("validates each set's subplot count from its definition", () => {
    const first = structuredClone(
      loadFirstStepsScenarioCatalog()[0].scenario,
    ) as Scenario;
    first.subPlots.push("unsettlingRumor");
    expect(validateScenario(first).errors).toContain(
      "룰 X: firstSteps 참극 세트는 1개를 사용해야 합니다. 현재 2개입니다.",
    );

    const basic = structuredClone(
      loadBasicTragedyScenarioCatalog()[0].scenario,
    ) as Scenario;
    basic.subPlots.pop();
    expect(validateScenario(basic).errors).toContain(
      "룰 X: basicTragedy 참극 세트는 2개를 사용해야 합니다. 현재 1개입니다.",
    );
  });

  it("rejects an outsider role outside the selected set's role pool", () => {
    const first = structuredClone(
      loadFirstStepsScenarioCatalog()[0].scenario,
    ) as Scenario;
    first.cast.mysteryBoy = "witch";
    expect(validateScenario(first).errors).toContain(
      "아웃사이더: 현재 참극 세트에 없는 역할을 배정할 수 없습니다. " +
        "현재 참극 세트의 역할 중 활성 룰에서 추가되지 않는 역할을 " +
        "배정해야 합니다.",
    );
  });
});

describe("bundled firstSteps scenarios", () => {
  const entries = loadFirstStepsScenarioCatalog();

  it("loads and validates all seven scripts at every difficulty", () => {
    expect(entries).toHaveLength(7);
    for (const entry of entries) {
      for (const difficulty of entry.difficulties) {
        expect(
          difficulty.validation,
          `${entry.id} ${entry.rawTitle} difficulty ${difficulty.index}`,
        ).toEqual({ ok: true, errors: [] });
      }
    }
    expect(() => assertOfficialScenariosValid(entries)).not.toThrow();
  });

  it("classifies exactly the two handbook scripts as official", () => {
    expect(entries.filter(({ source }) => source === "official").map(
      ({ rawTitle }) => rawTitle,
    )).toEqual(["The First Script", "Prevailing Secrecy"]);
    expect(entries.filter(({ source }) => source === "community").map(
      ({ rawTitle }) => rawTitle,
    )).toEqual([
      "The First Script (NT)",
      "In the Godless Temple",
      "Thunder in the City",
      "A Cruel Shrine Maiden's Thesis",
      "Tofu Murder Case",
    ]);
    expect(entries.filter(({ source }) => source === "unknown")).toEqual([]);
  });

  it("applies Prevailing Secrecy's selected difficulty to loops", () => {
    const prevailing = entries.find(
      ({ rawTitle }) => rawTitle === "Prevailing Secrecy",
    );
    expect(prevailing?.difficulties.map((option) => ({
      index: option.index,
      loops: option.scenario.loops,
      difficulty: option.scenario.difficulty,
    }))).toEqual([
      { index: 0, loops: 4, difficulty: 1 },
      { index: 1, loops: 3, difficulty: 3 },
    ]);
  });

  it("accepts 0, 1, or 2 curmudgeons and rejects 3", () => {
    const source = entries.find(
      ({ rawTitle }) => rawTitle === "In the Godless Temple",
    )?.scenario;
    if (source === undefined) throw new Error("missing hideousScript scenario");

    for (const count of [0, 1, 2]) {
      const scenario = structuredClone(source) as Scenario;
      for (const character of Object.keys(scenario.cast)) {
        if (scenario.cast[character] === "curmudgeon") {
          scenario.cast[character] = "person";
        }
      }
      for (const character of Object.keys(scenario.cast).slice(0, count)) {
        scenario.cast[character] = "curmudgeon";
      }
      expect(validateScenario(scenario), `curmudgeons=${count}`).toEqual({
        ok: true,
        errors: [],
      });
    }

    const invalid = structuredClone(source) as Scenario;
    for (const character of Object.keys(invalid.cast).slice(0, 3)) {
      invalid.cast[character] = "curmudgeon";
    }
    expect(validateScenario(invalid).errors).toContain(
      "최악의 시나리오: 골칫거리는 0~2명이어야 합니다. 현재 3명입니다.",
    );
  });
});

describe("basic tragedy regression", () => {
  it("keeps 22 upstream scripts plus the local community scenario", () => {
    const entries = loadBasicTragedyScenarioCatalog();
    expect(entries).toHaveLength(23);
    expect(entries.reduce(
      (sum, entry) => sum + entry.difficulties.length,
      0,
    )).toBe(39);
    expect(loadScenarioCatalog()).toHaveLength(30);
  });
});
