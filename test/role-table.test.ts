import { describe, expect, it } from "vitest";

import {
  buildRolePossibilityTable,
  enumerateRuleCombinations,
  evaluateRoleTableHypotheses,
  evaluateRuleHypotheses,
  type ProtagonistObservation,
  type RuleCombination,
} from "../src/engine/hypothesis";

function combination(id: string): RuleCombination {
  const found = [
    ...enumerateRuleCombinations("firstSteps"),
    ...enumerateRuleCombinations("basicTragedy"),
  ].find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing combination ${id}`);
  return found;
}

function roleRevealed(
  character: string,
  role: string,
  confirmed = true,
): Extract<ProtagonistObservation, { kind: "roleRevealed" }> {
  return { kind: "roleRevealed", loop: 1, character, role, confirmed };
}

describe("role possibility table", () => {
  it("removes columns that no remaining rule combination supplies", () => {
    const withoutLoveAffair = enumerateRuleCombinations("basicTragedy")
      .filter(({ subPlots }) => !subPlots.includes("loveAffair"));
    const table = buildRolePossibilityTable(
      "basicTragedy",
      ["doctor", "girlStudent"],
      withoutLoveAffair,
      [],
    );

    expect(table.roles).toContain("person");
    expect(table.roles).not.toContain("lover");
    expect(table.roles).not.toContain("lovedOne");
  });

  it("applies active-rule and person exclusions to an outsider", () => {
    const table = buildRolePossibilityTable(
      "firstSteps",
      ["mysteryBoy", "doctor"],
      [combination("murderPlan+unsettlingRumor")],
      [],
    );

    for (const role of [
      "person",
      "keyPerson",
      "killer",
      "brain",
      "conspiracyTheorist",
    ]) {
      expect(table.cells.mysteryBoy[role].status).toBe("impossible");
    }
    expect(table.cells.doctor.person.status).toBe("possible");
    expect(table.cells.doctor.brain.status).toBe("possible");
  });

  it("confirms a revealed role and closes every other role in that row", () => {
    const revealed = roleRevealed("doctor", "keyPerson");
    const table = buildRolePossibilityTable(
      "firstSteps",
      ["doctor", "girlStudent", "shrineMaiden"],
      [combination("murderPlan+unsettlingRumor")],
      [revealed],
    );

    expect(table.cells.doctor.keyPerson).toMatchObject({
      status: "confirmed",
      reasons: [{ code: "roleRevealed", observation: revealed }],
    });
    expect(table.cells.doctor.brain).toMatchObject({
      status: "impossible",
      reasons: [{ code: "otherRoleConfirmed", observation: revealed }],
    });
  });

  it("closes the same role elsewhere when its maximum is confirmed", () => {
    const table = buildRolePossibilityTable(
      "firstSteps",
      ["doctor", "girlStudent", "shrineMaiden"],
      [combination("murderPlan+unsettlingRumor")],
      [roleRevealed("doctor", "keyPerson")],
    );

    expect(table.cells.girlStudent.keyPerson).toMatchObject({
      status: "impossible",
      reasons: [{
        code: "roleMaximumReached",
        maximum: 1,
        confirmedCharacters: ["doctor"],
      }],
    });
    expect(table.cells.shrineMaiden.keyPerson.status).toBe("impossible");
  });

  it("does not treat an inexact legacy reveal as confirmation", () => {
    const table = buildRolePossibilityTable(
      "firstSteps",
      ["doctor", "girlStudent"],
      [combination("murderPlan+unsettlingRumor")],
      [roleRevealed("doctor", "keyPerson", false)],
    );

    expect(table.cells.doctor.keyPerson.status).toBe("possible");
    expect(table.cells.girlStudent.keyPerson.status).toBe("possible");
  });
});

describe("role table to rule propagation", () => {
  it("keeps the existing 9 and 105 rule spaces without table evidence", () => {
    const cast = [
      "boyStudent",
      "girlStudent",
      "classRep",
      "shrineMaiden",
      "doctor",
      "patient",
      "officeWorker",
      "informer",
      "richStudent",
    ];

    expect(evaluateRoleTableHypotheses(
      "firstSteps",
      cast,
      [],
    ).remaining).toHaveLength(9);
    expect(evaluateRoleTableHypotheses(
      "basicTragedy",
      cast,
      [],
    ).remaining).toHaveLength(105);
  });

  it("excludes a rule when none of the characters can hold a required role", () => {
    const observations: ProtagonistObservation[] = [
      {
        kind: "subplotRevealed",
        loop: 1,
        declaredSubplot: "shadowRipper",
        revealedSubplot: "unsettlingRumor",
      },
      roleRevealed("mysteryBoy", "cultist"),
      roleRevealed("doctor", "person"),
    ];
    const rulesOnly = evaluateRuleHypotheses(
      "firstSteps",
      observations,
    );
    const evaluation = evaluateRoleTableHypotheses(
      "firstSteps",
      ["mysteryBoy", "doctor"],
      observations,
    );

    expect(rulesOnly.remaining.map(({ mainPlot }) => mainPlot)).toEqual([
      "murderPlan",
      "lightAvenger",
    ]);
    expect(evaluation.remaining).toEqual([]);
    expect(evaluation.propagationPasses).toBe(2);
    expect(evaluation.excluded.filter(({ tableContradictions }) =>
      tableContradictions.some(({ code, role }) =>
        code === "requiredRoleUnavailable" && role === "brain"
      )
    )).toHaveLength(2);
  });

  it("uses confirmed counts to reject only combinations with a lower maximum", () => {
    const observations = [
      roleRevealed("doctor", "friend"),
      roleRevealed("girlStudent", "friend"),
    ];
    const evaluation = evaluateRoleTableHypotheses(
      "basicTragedy",
      ["doctor", "girlStudent", "shrineMaiden"],
      observations,
    );

    expect(evaluation.remaining.length).toBeGreaterThan(0);
    expect(evaluation.remaining.every(({ subPlots }) =>
      subPlots.includes("circleFriends")
    )).toBe(true);
    expect(evaluation.excluded.some(({ tableContradictions }) =>
      tableContradictions.some((contradiction) =>
        contradiction.code === "confirmedRoleCountExceedsMaximum" &&
        contradiction.role === "friend" &&
        contradiction.maximum === 1
      )
    )).toBe(true);
  });

  it("does not require optional zero-minimum roles", () => {
    const observations: ProtagonistObservation[] = [
      {
        kind: "subplotRevealed",
        loop: 1,
        declaredSubplot: "shadowRipper",
        revealedSubplot: "hideousScript",
      },
      roleRevealed("doctor", "person"),
      roleRevealed("girlStudent", "person"),
    ];
    const evaluation = evaluateRoleTableHypotheses(
      "firstSteps",
      ["doctor", "girlStudent"],
      observations,
    );

    expect(evaluation.excluded.every(({ tableContradictions }) =>
      tableContradictions.every(({ role }) => role !== "curmudgeon")
    )).toBe(true);
  });
});
