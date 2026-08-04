import { describe, expect, it } from "vitest";
import { ACTION_CARDS, isActionCard, LOCATIONS } from "../src/types";

describe("action card identifiers", () => {
  it("keeps the supported action-card count explicit", () => {
    expect(ACTION_CARDS).toHaveLength(13);
  });

  it("accepts a valid action-card identifier", () => {
    expect(isActionCard("moveVertical")).toBe(true);
  });

  it("rejects an unknown action-card identifier", () => {
    expect(isActionCard("unknownCard")).toBe(false);
  });
});

describe("board location order", () => {
  it("keeps the physical 2x2 board arrangement", () => {
    expect(LOCATIONS).toEqual(["Hospital", "Shrine", "City", "School"]);
  });
});
