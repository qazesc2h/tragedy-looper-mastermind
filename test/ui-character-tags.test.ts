import { describe, expect, it } from "vitest";

import { characterTagLabels } from "../src/ui/character-tags";

describe("character detail tag labels", () => {
  it("uses the official translation data for requested character tags", () => {
    expect(characterTagLabels("boyStudent")).toEqual(["학생", "소년"]);
    expect(characterTagLabels("shrineMaiden")).toEqual(["학생", "소녀"]);
    expect(characterTagLabels("doctor")).toEqual(["성인", "남성"]);
  });

  it("keeps both FAQ Q4 tags for the godly being", () => {
    expect(characterTagLabels("godlyBeing")).toEqual(["남성", "여성"]);
  });
});
