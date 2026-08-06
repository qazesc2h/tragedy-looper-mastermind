import { describe, expect, it } from "vitest";

import { misc } from "../src/ui/terms";

describe("explicit UI translation fallbacks", () => {
  it("uses the user-specified labels missing from generated translation data", () => {
    expect(misc("Spent cards", "소진 카드")).toBe("소진 카드");
    expect(misc("Alive", "생존")).toBe("생존");
    expect(misc("Dead", "사망")).toBe("사망");
  });

  it("uses the existing official label for the final guess screen", () => {
    expect(misc("Final Guess")).toBe("최후의 싸움");
  });
});
