import { describe, expect, it } from "vitest";

import firstStepsScriptsJson from "../data/first-steps-scripts.json";

const EXPECTED_TITLES = [
  "The First Script",
  "The First Script (NT)",
  "In the Godless Temple",
  "Prevailing Secrecy",
  "Thunder in the City",
  "A Cruel Shrine Maiden's Thesis",
  "Tofu Murder Case",
];

describe("first steps source data", () => {
  it("contains the seven firstSteps scripts", () => {
    expect(firstStepsScriptsJson.map((script) => script.title)).toEqual(
      EXPECTED_TITLES,
    );
    expect(firstStepsScriptsJson.every(
      (script) => script.tragedySet === "firstSteps",
    )).toBe(true);
  });

  it("keeps each loop and difficulty variant from the source", () => {
    expect(firstStepsScriptsJson.map((script) => script.difficultySets)).toEqual([
      [{ numberOfLoops: 3, difficulty: 1 }],
      [{ numberOfLoops: 3, difficulty: 1 }],
      [{ numberOfLoops: 3, difficulty: 1 }],
      [
        { numberOfLoops: 4, difficulty: 1 },
        { numberOfLoops: 3, difficulty: 3 },
      ],
      [{ numberOfLoops: 5, difficulty: 0 }],
      [
        { numberOfLoops: 3, difficulty: 0 },
        { numberOfLoops: 4, difficulty: 0 },
      ],
      [{ numberOfLoops: 4, difficulty: 0 }],
    ]);
  });
});
