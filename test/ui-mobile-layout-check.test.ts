import { describe, expect, it } from "vitest";

import { horizontallyContained } from "../src/ui/mobile-layout-check";

describe("mobile character chip layout guard", () => {
  it("accepts a child inside its rendered parent boundary", () => {
    expect(horizontallyContained(20, 96, 20, 96)).toBe(true);
  });

  it("fails when a child crosses either rendered parent boundary", () => {
    expect(horizontallyContained(19, 96, 20, 96)).toBe(false);
    expect(horizontallyContained(20, 97, 20, 96)).toBe(false);
  });
});
