import { describe, expect, it } from "vitest";

import basicTragedyScriptsJson from "../data/basic-tragedy-scripts.json";
import errataJson from "../data/errata.json";
import { adaptTragedyScript } from "../src/data";
import { ERRATA_NOTE } from "../src/errata";
import { validateScenario } from "../src/engine/validate";
import {
  loadBasicTragedyScenarioCatalog,
  loadScenarioCatalog,
} from "../src/scenario-catalog";

describe("scenario errata overlay", () => {
  it("keeps the printed source and corrects basicTragedy:12 while loading", () => {
    const printed = basicTragedyScriptsJson[11];
    expect(printed.title).toBe("Those with Antibodies");
    expect(printed.cast.informer).toBe("conspiracyTheorist");

    const entry = loadBasicTragedyScenarioCatalog().find(
      ({ id }) => id === "basicTragedy:12",
    );
    expect(entry?.scenario.cast.informer).toBe("person");
    expect(entry?.difficulties.every(({ scenario }) =>
      scenario.cast.informer === "person"
    )).toBe(true);
    expect(entry?.errata).toEqual(errataJson.corrections);
    expect(ERRATA_NOTE).toBe(errataJson._note);
  });

  it("shows why validation must run after the errata overlay", () => {
    const printed = adaptTragedyScript(basicTragedyScriptsJson[11], {
      skipValidation: true,
    });
    expect(validateScenario(printed)).toEqual({
      ok: false,
      errors: [
        "역할 수: 선동가 역할은 선택된 룰에서 최대 1명까지 " +
          "배정할 수 있지만 현재 2명입니다.",
      ],
    });

    const corrected = adaptTragedyScript(basicTragedyScriptsJson[11], {
      scenarioId: "basicTragedy:12",
    });
    expect(corrected.cast.informer).toBe("person");
    expect(validateScenario(corrected)).toEqual({ ok: true, errors: [] });
  });
});

describe("maximum role count validation", () => {
  it("clamps summed plot additions to the role maximum", () => {
    const scenario = adaptTragedyScript(basicTragedyScriptsJson[0], {
      skipValidation: true,
    });
    scenario.mainPlot = "murderPlan";
    scenario.subPlots = ["circleFriends", "paranoiaVirus"];
    for (const character of Object.keys(scenario.cast)) {
      scenario.cast[character] = "person";
    }
    scenario.cast.boyStudent = "conspiracyTheorist";
    scenario.cast.girlStudent = "conspiracyTheorist";

    expect(validateScenario(scenario).errors).toContain(
      "역할 수: 선동가 역할은 선택된 룰에서 최대 1명까지 " +
        "배정할 수 있지만 현재 2명입니다.",
    );
  });

  it("does not count plot-less copycat and outsider assignments", () => {
    const catalog = loadScenarioCatalog();
    for (const id of ["basicTragedy:7", "basicTragedy:17"]) {
      const entry = catalog.find((candidate) => candidate.id === id);
      expect(entry?.validation.errors.filter((error) =>
        error.startsWith("역할 수:")
      ), id).toEqual([]);
    }
  });

  it("finds no remaining role-count violations in all 29 corrected scripts", () => {
    const failures = loadScenarioCatalog().flatMap((entry) =>
      entry.difficulties.flatMap(({ index, validation }) =>
        validation.errors
          .filter((error) => error.startsWith("역할 수:"))
          .map((error) => ({ id: entry.id, difficulty: index, error }))
      )
    );
    expect(failures).toEqual([]);
  });
});
