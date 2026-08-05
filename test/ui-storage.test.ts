import { describe, expect, it } from "vitest";

import { initLoop } from "../src/engine/setup";
import {
  emptyTrackerStore,
  loadTrackerStore,
  persistGameState,
  RETIRED_TRACKER_STORAGE_KEYS,
  STORAGE_RESET_NOTICE,
  TRACKER_STORAGE_KEY,
  type LocalKeyValueStore,
  type StoredGame,
} from "../src/ui/storage";
import {
  actionCardTerm,
  gameText,
  incidentRuleText,
  misc,
  term,
  translatedText,
} from "../src/ui/terms";
import type { ActionCard, GameState, Scenario } from "../src/types";

class MemoryStorage implements LocalKeyValueStore {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
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
  return {
    scenario,
    gamePhase: "ROUND",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
  };
}

function storedGameDefaults(scenarioId: string): StoredGame | undefined {
  if (scenarioId !== "basicTragedy:1") return undefined;
  return {
    state: state(),
    observationsByLoop: {},
    updatedAt: new Date(0).toISOString(),
  };
}

describe("UI localStorage snapshots", () => {
  it("uses a project-specific key namespace", () => {
    expect(TRACKER_STORAGE_KEY)
      .toBe("tragedy-looper-mastermind:tracker");
    expect(RETIRED_TRACKER_STORAGE_KEYS).toEqual([
      "tragedy-looper:tracker:v1",
      "tragedy-looper-mastermind:tracker:v1",
    ]);
    expect(emptyTrackerStore()).not.toHaveProperty("version");
  });

  it("removes only the explicitly retired keys without reading them", () => {
    const storage = new MemoryStorage();
    const oldData = JSON.stringify({
      mastermindOverlay: false,
      games: { legacy: "must not be restored" },
    });
    for (const key of RETIRED_TRACKER_STORAGE_KEYS) {
      storage.setItem(key, oldData);
    }
    storage.setItem("tragedy-looper-ko:tracker:v1", "keep-ko-data");
    storage.setItem("tragedy-looper-mastermind:other:v1", "keep-other-data");

    expect(loadTrackerStore(storage, storedGameDefaults))
      .toEqual(emptyTrackerStore());
    for (const key of RETIRED_TRACKER_STORAGE_KEYS) {
      expect(storage.getItem(key)).toBeNull();
    }
    expect(storage.getItem("tragedy-looper-ko:tracker:v1"))
      .toBe("keep-ko-data");
    expect(storage.getItem("tragedy-looper-mastermind:other:v1"))
      .toBe("keep-other-data");
  });

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

    const restored = loadTrackerStore(storage, storedGameDefaults);
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

  it("deletes invalid JSON and reports that the app will start over", () => {
    const storage = new MemoryStorage();
    storage.setItem(TRACKER_STORAGE_KEY, "not-json");
    expect(() => loadTrackerStore(storage, storedGameDefaults))
      .toThrow(STORAGE_RESET_NOTICE);
    expect(storage.getItem(TRACKER_STORAGE_KEY)).toBeNull();
  });

  it("discards the whole save instead of partially restoring malformed data", () => {
    const storage = new MemoryStorage();
    const validDefaults = storedGameDefaults("basicTragedy:1");
    if (validDefaults === undefined) {
      throw new Error("missing test defaults");
    }
    storage.setItem(TRACKER_STORAGE_KEY, JSON.stringify({
      activeScenarioId: "basicTragedy:1",
      mastermindOverlay: true,
      games: {
        "basicTragedy:1": validDefaults,
        unknownScenario: { malformed: true },
      },
    }));

    expect(() => loadTrackerStore(storage, storedGameDefaults))
      .toThrow(STORAGE_RESET_NOTICE);
    expect(storage.getItem(TRACKER_STORAGE_KEY)).toBeNull();
  });

  it("fills missing state fields from current defaults without losing saved values", () => {
    const storage = new MemoryStorage();
    const current = state();
    current.loop.day = 2;
    current.loop.charCounters.boyStudent.goodwill = 2;
    const {
      spentOncePerLoop: _spentOncePerLoop,
      abilitiesUsedThisLoop: _abilitiesUsedThisLoop,
      ...savedLoop
    } = current.loop;
    const { loopOutcomes: _loopOutcomes, ...savedState } = current;
    storage.setItem(TRACKER_STORAGE_KEY, JSON.stringify({
      activeScenarioId: "basicTragedy:1",
      games: {
        "basicTragedy:1": {
          state: { ...savedState, loop: savedLoop },
          observationsByLoop: {},
          updatedAt: "2026-08-05T00:00:00.000Z",
        },
      },
    }));

    const restored = loadTrackerStore(storage, storedGameDefaults);
    expect(restored.mastermindOverlay).toBe(true);
    expect(restored.games["basicTragedy:1"].state.loop.day).toBe(2);
    expect(
      restored.games["basicTragedy:1"].state.loop.charCounters.boyStudent
        .goodwill,
    ).toBe(2);
    expect(restored.games["basicTragedy:1"].state.loop.spentOncePerLoop)
      .toEqual({ mastermind: [], protagonists: [[], [], []] });
    expect(restored.games["basicTragedy:1"].state.loop.abilitiesUsedThisLoop)
      .toEqual([]);
    expect(restored.games["basicTragedy:1"].state.loopOutcomes).toEqual([]);
  });

});

describe("UI terminology", () => {
  it("uses ko-terms and leaves missing terms in English", () => {
    expect(term("characters", "boyStudent", "Boy Student")).toBe("남학생");
    expect(misc("Mastermind")).toBe("각본가");
    expect(misc("Next phase", "Next phase")).toBe("Next phase");
  });

  it("uses card translations and resolves preserved icon tokens", () => {
    expect(translatedText("Reveal culprit for 1 incident."))
      .toBe("사건 1개의 범인을 공개합니다.");
    expect(gameText("-1 :paranoia: on student in same location."))
      .toBe("동일한 장소에 있는 다른 학생 1명에게서 불안 1개를 제거합니다.");
    expect(translatedText("not in the translation dictionary"))
      .toBe("not in the translation dictionary");
  });

  it("prefers per-ability Korean text and falls back to the description dictionary", () => {
    expect(gameText("Reveal own role.", "회사원의 역할 공개"))
      .toBe("회사원의 역할 공개");
    expect(gameText("Reveal culprit for 1 incident.", null))
      .toBe("사건 1개의 범인을 공개합니다.");
  });

  it("uses the complete manual detail in the incident resolution view", () => {
    expect(incidentRuleText("hospitalIncident", [
      "Kill all characters in the Hospital.",
    ])).toContain("주인공은 사망합니다");
  });

  it.each<[ActionCard, string]>([
    ["moveVertical", "이동↑↓"],
    ["moveHorizontal", "이동←→"],
    ["moveDiagonal", "대각 이동"],
    ["forbidMove", "이동 금지"],
    ["paranoiaPlus1", "불안+1"],
    ["paranoiaMinus1", "불안-1"],
    ["forbidParanoia", "불안 금지"],
    ["goodwillPlus1", "우호+1"],
    ["goodwillPlus2", "우호+2"],
    ["forbidGoodwill", "우호 금지"],
    ["intriguePlus1", "음모+1"],
    ["intriguePlus2", "음모+2"],
    ["forbidIntrigue", "음모 금지"],
  ])("uses the official action-card term for %s", (card, ko) => {
    expect(actionCardTerm(card, card)).toBe(ko);
  });
});
