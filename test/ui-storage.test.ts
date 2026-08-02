import { describe, expect, it } from "vitest";

import { initLoop } from "../src/engine/setup";
import {
  emptyTrackerStore,
  loadTrackerStore,
  persistGameState,
  TRACKER_STORAGE_KEY,
  type LocalKeyValueStore,
} from "../src/ui/storage";
import { misc, term } from "../src/ui/terms";
import type { GameState, Scenario } from "../src/types";

class MemoryStorage implements LocalKeyValueStore {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function state(): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "murderPlan",
    subPlots: [],
    cast: { boyStudent: "person" },
    incidents: [],
    loops: 3,
    daysPerLoop: 4,
  };
  return { scenario, loop: initLoop(scenario), history: [] };
}

describe("UI localStorage snapshots", () => {
  it("stores observations under each loop and restores the current game", () => {
    const storage = new MemoryStorage();
    const tracker = emptyTrackerStore();
    const game = state();

    persistGameState(
      storage,
      tracker,
      "basicTragedy:1",
      game,
      "scenario-start",
      new Date("2026-08-03T00:00:00.000Z"),
    );
    persistGameState(
      storage,
      tracker,
      "basicTragedy:1",
      game,
      "unchanged",
      new Date("2026-08-03T00:01:00.000Z"),
    );
    game.loop.charCounters.boyStudent.goodwill = 1;
    persistGameState(
      storage,
      tracker,
      "basicTragedy:1",
      game,
      "character-counter",
      new Date("2026-08-03T00:02:00.000Z"),
    );
    game.loop = initLoop(game.scenario);
    game.loop.loop = 2;
    persistGameState(
      storage,
      tracker,
      "basicTragedy:1",
      game,
      "next-loop",
      new Date("2026-08-03T00:03:00.000Z"),
    );

    const restored = loadTrackerStore(storage);
    expect(restored.activeScenarioId).toBe("basicTragedy:1");
    expect(restored.games["basicTragedy:1"].state.loop.loop).toBe(2);
    expect(restored.games["basicTragedy:1"].observationsByLoop["1"])
      .toHaveLength(2);
    expect(restored.games["basicTragedy:1"].observationsByLoop["2"])
      .toHaveLength(1);
    expect(
      restored.games["basicTragedy:1"].observationsByLoop["1"][1]
        .state.charCounters.boyStudent.goodwill,
    ).toBe(1);
  });

  it("falls back to an empty store when saved JSON is invalid", () => {
    const storage = new MemoryStorage();
    storage.setItem(TRACKER_STORAGE_KEY, "not-json");
    expect(loadTrackerStore(storage)).toEqual(emptyTrackerStore());
  });
});

describe("UI terminology", () => {
  it("uses ko-terms and leaves missing terms in English", () => {
    expect(term("characters", "boyStudent", "Boy Student")).toBe("남학생");
    expect(misc("Mastermind")).toBe("각본가");
    expect(misc("Next phase", "Next phase")).toBe("Next phase");
  });
});
