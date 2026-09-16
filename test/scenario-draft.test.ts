import { describe, expect, it } from "vitest";

import {
  autoCompleteScenarioDraft,
  candidateCharactersForScenarioDraftRole,
  candidateRolesForScenarioDraftCharacter,
  canFinalizeScenarioDraft,
  finalizeScenarioDraft,
  scenarioDraftOptions,
  scenarioDraftRequiredRoles,
  scenarioDraftRoleAvailability,
  scenarioToDraft,
  validateScenarioDraft,
  type ScenarioDraft,
} from "../src/scenario-draft";
import { loadScenarioCatalog } from "../src/scenario-catalog";

function diagnosticOf(draft: ScenarioDraft, code: string) {
  return validateScenarioDraft(draft).diagnostics.find(
    (diagnostic) => diagnostic.code === code,
  );
}

function completeRuleDraft(cast: ScenarioDraft["cast"]): ScenarioDraft {
  return {
    tragedySet: "basicTragedy",
    loops: 3,
    daysPerLoop: 5,
    mainPlot: "murderPlan",
    subPlots: [
      { rowId: "x1", plot: "loveAffair" },
      { rowId: "x2", plot: "unsettlingRumor" },
    ],
    cast,
    incidents: [],
  };
}

describe("ScenarioDraft validation and finalization", () => {
  it("accepts an empty draft without throwing and reports editable warnings", () => {
    expect(() => validateScenarioDraft({})).not.toThrow();
    const validation = validateScenarioDraft({});

    expect(validation.ok).toBe(true);
    expect(validation.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "tragedySet",
        code: "TRAGEDY_SET_MISSING",
        severity: "warning",
      }),
      expect.objectContaining({
        path: "mainPlot",
        code: "MAIN_PLOT_MISSING",
        severity: "warning",
      }),
      expect.objectContaining({
        path: "cast",
        code: "CAST_MISSING",
        severity: "warning",
      }),
    ]));
    expect(canFinalizeScenarioDraft({})).toBe(false);
  });

  it("uses warnings for normal partial rows and errors for finalization", () => {
    const draft: ScenarioDraft = {
      tragedySet: "basicTragedy",
      loops: 3,
      daysPerLoop: 5,
      mainPlot: "murderPlan",
      subPlots: [
        { rowId: "x1", plot: "loveAffair" },
        { rowId: "x2" },
      ],
      cast: [{ rowId: "cast-a", character: "informer" }],
      incidents: [{
        rowId: "incident-a",
        day: 2,
        incident: "suicide",
      }],
    };

    const editing = validateScenarioDraft(draft);
    expect(editing.ok).toBe(true);
    expect(editing.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "subPlots.x2.plot",
        code: "SUBPLOT_MISSING",
        severity: "warning",
      }),
      expect.objectContaining({
        path: "cast.cast-a.role",
        code: "CAST_ROLE_MISSING",
        severity: "warning",
      }),
      expect.objectContaining({
        path: "incidents.incident-a.culprit",
        code: "INCIDENT_CULPRIT_MISSING",
        severity: "warning",
      }),
      expect.objectContaining({
        path: "cast",
        code: "REQUIRED_ROLE_MISSING",
        severity: "warning",
      }),
    ]));

    const finalized = finalizeScenarioDraft(draft);
    expect(finalized.ok).toBe(false);
    expect(finalized.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "subPlots.x2.plot",
        code: "SUBPLOT_MISSING",
        severity: "error",
      }),
      expect.objectContaining({
        path: "cast.cast-a.role",
        code: "CAST_ROLE_MISSING",
        severity: "error",
      }),
      expect.objectContaining({
        path: "incidents.incident-a.culprit",
        code: "INCIDENT_CULPRIT_MISSING",
        severity: "error",
      }),
    ]));
  });

  it("converts a complete draft and returns exact diagnostics on failure", () => {
    const source = loadScenarioCatalog().find(({ validation }) => validation.ok)
      ?.scenario;
    if (source === undefined) throw new Error("missing valid bundled scenario");
    const draft = scenarioToDraft(source);

    expect(canFinalizeScenarioDraft(draft)).toBe(true);
    const finalized = finalizeScenarioDraft(draft);
    expect(finalized.ok).toBe(true);
    if (finalized.ok) expect(finalized.scenario).toEqual(source);

    const incomplete = { ...draft, mainPlot: undefined };
    const failed = finalizeScenarioDraft(incomplete);
    expect(failed.ok).toBe(false);
    expect(failed.diagnostics).toContainEqual(expect.objectContaining({
      path: "mainPlot",
      code: "MAIN_PLOT_MISSING",
      severity: "error",
    }));
  });

  it("round-trips every valid bundled difficulty without loss", () => {
    const difficulties = loadScenarioCatalog().flatMap((entry) =>
      entry.difficulties.map(({ scenario, validation, index }) => ({
        id: entry.id,
        index,
        scenario,
        validation,
      }))
    );
    const valid = difficulties.filter(({ validation }) => validation.ok);
    expect(valid).toHaveLength(46);

    for (const { id, index, scenario } of valid) {
      const result = finalizeScenarioDraft(scenarioToDraft(scenario));
      expect(result.ok, `${id} difficulty ${index}`).toBe(true);
      if (result.ok) expect(result.scenario).toEqual(scenario);
    }
  });

  it("keeps Trouble in Paradise rejected after conversion to a draft", () => {
    const trouble = loadScenarioCatalog().find(
      ({ rawTitle }) => rawTitle === "Trouble in Paradise",
    );
    if (trouble === undefined) throw new Error("missing Trouble in Paradise");

    const result = finalizeScenarioDraft(scenarioToDraft(trouble.scenario));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      path: "cast.cast-6.role",
      code: "MYSTERY_BOY_ROLE_IS_PERSON",
      severity: "error",
    }));
  });
});

describe("ScenarioDraft automatic completion", () => {
  it("derives tragedy-set options and required roles instead of storing copies", () => {
    const draft = completeRuleDraft([]);
    expect(scenarioDraftOptions(draft)).toMatchObject({
      mainPlots: expect.arrayContaining(["murderPlan"]),
      subPlots: expect.arrayContaining(["loveAffair", "unsettlingRumor"]),
      roles: expect.arrayContaining(["person", "killer", "lover"]),
      incidents: expect.any(Array),
    });
    expect(scenarioDraftRequiredRoles(draft)).toEqual(expect.arrayContaining([
      { role: "keyPerson", minimum: 1, maximum: 1 },
      { role: "killer", minimum: 1, maximum: 1 },
      { role: "brain", minimum: 1, maximum: 1 },
      { role: "lover", minimum: 1, maximum: 1 },
      { role: "lovedOne", minimum: 1, maximum: 1 },
      { role: "conspiracyTheorist", minimum: 1, maximum: 1 },
    ]));
  });

  it("fills only deterministic starts and never overwrites user input", () => {
    const draft: ScenarioDraft = {
      cast: [
        { rowId: "fixed", character: "youngGirl" },
        { rowId: "servant", character: "servant" },
        { rowId: "henchman", character: "henchman" },
      ],
    };
    const completed = autoCompleteScenarioDraft(draft);
    expect(completed.metadata?.startLocations).toEqual({
      fixed: { value: "School", source: "automatic" },
    });

    const userEdited: ScenarioDraft = {
      ...draft,
      metadata: {
        startLocations: {
          fixed: { value: "City", source: "user" },
        },
      },
    };
    expect(autoCompleteScenarioDraft(userEdited).metadata?.startLocations)
      .toMatchObject({ fixed: { value: "City", source: "user" } });
    expect(validateScenarioDraft(userEdited).diagnostics).toContainEqual(
      expect.objectContaining({
        path: "metadata.startLocations.fixed",
        code: "FIXED_START_INVALID",
        severity: "error",
      }),
    );
  });
});

describe("ScenarioDraft reverse candidate calculation", () => {
  it("excludes active plot roles and person from the outsider", () => {
    const draft = completeRuleDraft([
      { rowId: "outsider", character: "mysteryBoy" },
    ]);
    const candidates = candidateRolesForScenarioDraftCharacter(
      draft,
      "outsider",
    );
    expect(candidates).toContain("witch");
    expect(candidates).not.toContain("person");
    for (const activeRole of [
      "keyPerson",
      "killer",
      "brain",
      "lover",
      "lovedOne",
      "conspiracyTheorist",
    ]) {
      expect(candidates).not.toContain(activeRole);
    }
  });

  it("excludes goodwill-refusal roles from littleSister", () => {
    const draft = completeRuleDraft([
      { rowId: "sister", character: "littleSister" },
    ]);
    const candidates = candidateRolesForScenarioDraftCharacter(draft, "sister");
    expect(candidates).not.toContain("killer");
    expect(candidates).not.toContain("witch");
    expect(candidates).toContain("keyPerson");
  });

  it("offers copycat only roles already assigned to another character", () => {
    const draft = completeRuleDraft([
      { rowId: "killer", character: "journalist", role: "killer" },
      { rowId: "person", character: "doctor", role: "person" },
      { rowId: "copycat", character: "copycat" },
    ]);
    const candidates = candidateRolesForScenarioDraftCharacter(
      draft,
      "copycat",
    );
    expect(candidates).toEqual(expect.arrayContaining(["person", "killer"]));
    expect(candidates).not.toContain("brain");
  });

  it("removes a full role from ordinary candidates and reports zero capacity", () => {
    const draft = completeRuleDraft([
      { rowId: "killer", character: "journalist", role: "killer" },
      { rowId: "candidate", character: "informer" },
    ]);
    expect(candidateRolesForScenarioDraftCharacter(draft, "candidate"))
      .not.toContain("killer");
    expect(scenarioDraftRoleAvailability(draft).find(
      ({ role }) => role === "killer",
    )).toMatchObject({
      assigned: 1,
      remainingRequired: 0,
      remainingCapacity: 0,
      exact: true,
    });
  });

  it("calculates candidate characters with character-specific constraints", () => {
    const draft = completeRuleDraft([]);
    const candidates = candidateCharactersForScenarioDraftRole(draft, "killer");
    expect(candidates).not.toContain("littleSister");
    expect(candidates).not.toContain("mysteryBoy");
    expect(candidates).not.toContain("copycat");
    expect(candidates).toContain("journalist");
  });

  it("keeps required-role absence as a warning while editing", () => {
    const draft = completeRuleDraft([
      { rowId: "person", character: "journalist", role: "person" },
    ]);
    expect(diagnosticOf(draft, "REQUIRED_ROLE_MISSING")).toMatchObject({
      path: "cast",
      severity: "warning",
    });
    expect(validateScenarioDraft(draft, "finalize").diagnostics).toContainEqual(
      expect.objectContaining({
        path: "cast",
        code: "REQUIRED_ROLE_MISSING",
        severity: "error",
      }),
    );
  });
});
