import { describe, expect, it } from "vitest";

import { initLoop } from "../src/engine/setup";
import { loadBasicTragedyScenarioCatalog } from "../src/scenario-catalog";
import {
  APP_STORAGE_PREFIX,
  clearAppStorage,
  emptyTrackerStore,
  loadTrackerStore,
  prepareNewGame,
  persistGameState,
  RETIRED_TRACKER_STORAGE_KEYS,
  STORAGE_RESET_NOTICE,
  STORAGE_WRITE_WARNING,
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

  get length(): number {
    return this.values.size;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class QuotaExceededStorage implements LocalKeyValueStore {
  get length(): number {
    return 0;
  }

  getItem(): string | null {
    return null;
  }

  key(): string | null {
    return null;
  }

  setItem(): void {
    throw new DOMException("quota exceeded", "QuotaExceededError");
  }

  removeItem(): void {
    // 저장할 수 없으므로 지울 값도 없다.
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
    extraLoopsPlayed: 0,
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

function antibodiesDefaults(scenarioId: string): StoredGame | undefined {
  if (scenarioId !== "basicTragedy:12") return undefined;
  const entry = loadBasicTragedyScenarioCatalog().find(
    ({ id }) => id === scenarioId,
  );
  if (entry === undefined) throw new Error("missing antibodies scenario");
  const scenario = entry.scenario;
  return {
    state: {
      scenario,
      gamePhase: "ROUND",
      loop: initLoop(scenario),
      history: [],
      loopOutcomes: [],
      extraLoopsPlayed: 0,
    },
    observationsByLoop: {},
    updatedAt: new Date(0).toISOString(),
  };
}

describe("UI localStorage snapshots", () => {
  it("uses a project-specific key namespace", () => {
    expect(APP_STORAGE_PREFIX).toBe("tragedy-looper-mastermind:");
    expect(TRACKER_STORAGE_KEY)
      .toBe("tragedy-looper-mastermind:tracker");
    expect(RETIRED_TRACKER_STORAGE_KEYS).toEqual([
      "tragedy-looper:tracker:v1",
      "tragedy-looper-mastermind:tracker:v1",
    ]);
    expect(emptyTrackerStore()).not.toHaveProperty("version");
  });

  it("starts a new game without retaining the active game's progress", () => {
    const storage = new MemoryStorage();
    const tracker = emptyTrackerStore();
    const game = state();
    game.loop.day = 3;
    game.loop.charCounters.boyStudent.intrigue = 2;
    persistGameState(
      storage,
      tracker,
      "basicTragedy:1",
      game,
      "in-progress",
    );

    prepareNewGame(storage, tracker);

    expect(tracker.activeScenarioId).toBe("");
    expect(tracker.games).not.toHaveProperty("basicTragedy:1");
    expect(loadTrackerStore(storage, storedGameDefaults)).toEqual({
      activeScenarioId: "",
      mastermindOverlay: true,
      games: {},
    });
  });

  it("deletes every app-prefixed key and preserves the Korean site keys", () => {
    const storage = new MemoryStorage();
    storage.setItem(TRACKER_STORAGE_KEY, "tracker");
    storage.setItem("tragedy-looper-mastermind:debug:v1", "debug");
    storage.setItem("tragedy-looper-ko:tracker:v1", "keep-ko-data");
    storage.setItem("unrelated:key", "keep-unrelated-data");

    clearAppStorage(storage);

    expect(storage.getItem(TRACKER_STORAGE_KEY)).toBeNull();
    expect(storage.getItem("tragedy-looper-mastermind:debug:v1")).toBeNull();
    expect(storage.getItem("tragedy-looper-ko:tracker:v1"))
      .toBe("keep-ko-data");
    expect(storage.getItem("unrelated:key")).toBe("keep-unrelated-data");
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
    const observation =
      restored.games["basicTragedy:1"].observationsByLoop["1"][1];
    expect(observation).toMatchObject({
      reason: "character-counter",
      loop: 1,
      day: 1,
      phase: "P1_ROUND_START",
    });
    expect(observation.stateSignature).toMatch(/^[0-9a-f]{8}$/);
    expect(observation).not.toHaveProperty("state");
  });

  it("migrates legacy full observation snapshots to compact metadata", () => {
    const storage = new MemoryStorage();
    const defaults = storedGameDefaults("basicTragedy:1");
    if (defaults === undefined) throw new Error("missing defaults");
    const observed = structuredClone(defaults.state.loop);
    observed.charCounters.boyStudent.goodwill = 2;
    storage.setItem(TRACKER_STORAGE_KEY, JSON.stringify({
      activeScenarioId: "basicTragedy:1",
      mastermindOverlay: true,
      games: {
        "basicTragedy:1": {
          ...defaults,
          observationsByLoop: {
            "1": [{
              recordedAt: "2026-08-24T00:00:00.000Z",
              reason: "legacy-full-snapshot",
              loop: 1,
              day: 1,
              phase: "P1_ROUND_START",
              state: observed,
            }],
          },
        },
      },
    }));

    const restored = loadTrackerStore(storage, storedGameDefaults);
    const observation =
      restored.games["basicTragedy:1"].observationsByLoop["1"][0];
    expect(observation).not.toHaveProperty("state");
    expect(observation.stateSignature).toMatch(/^[0-9a-f]{8}$/);

    expect(persistGameState(
      storage,
      restored,
      "basicTragedy:1",
      restored.games["basicTragedy:1"].state,
      "post-migration",
    )).toBe(true);
    const compacted = JSON.parse(storage.getItem(TRACKER_STORAGE_KEY) ?? "");
    expect(compacted.games["basicTragedy:1"].observationsByLoop["1"][0])
      .not.toHaveProperty("state");
  });

  it("removes the retired Servant decline choice from saved P4 state", () => {
    const storage = new MemoryStorage();
    const defaults = storedGameDefaults("basicTragedy:1");
    if (defaults === undefined) throw new Error("missing defaults");
    const legacy = structuredClone(defaults);
    legacy.state.loop.phase = "P4_RESOLVE";
    Reflect.set(legacy.state.loop, "servantMovementChoice", "decline");
    storage.setItem(TRACKER_STORAGE_KEY, JSON.stringify({
      activeScenarioId: "basicTragedy:1",
      mastermindOverlay: true,
      games: { "basicTragedy:1": legacy },
    }));

    const restored = loadTrackerStore(storage, storedGameDefaults);

    expect(restored.games["basicTragedy:1"].state.loop.servantMovementChoice)
      .toBeUndefined();
  });

  it("keeps in-memory progress when localStorage rejects a write", () => {
    const storage = new QuotaExceededStorage();
    const tracker = emptyTrackerStore();
    const game = state();
    game.loop.day = 4;
    game.loop.phase = "P4_RESOLVE";

    expect(() => persistGameState(
      storage,
      tracker,
      "basicTragedy:1",
      game,
      "quota-regression",
    )).not.toThrow();
    expect(persistGameState(
      storage,
      tracker,
      "basicTragedy:1",
      game,
      "quota-regression",
    )).toBe(false);
    expect(tracker.games["basicTragedy:1"].state.loop).toMatchObject({
      day: 4,
      phase: "P4_RESOLVE",
    });
    expect(STORAGE_WRITE_WARNING).toBe(
      "저장 공간이 부족합니다. 진행은 계속되지만 새로고침하면 복원되지 않습니다",
    );
  });

  it("deletes invalid JSON and reports that the app will start over", () => {
    const storage = new MemoryStorage();
    storage.setItem(TRACKER_STORAGE_KEY, "not-json");
    expect(() => loadTrackerStore(storage, storedGameDefaults))
      .toThrow(STORAGE_RESET_NOTICE);
    expect(storage.getItem(TRACKER_STORAGE_KEY)).toBeNull();
  });

  it("discards the whole save when the board uses the retired alive format", () => {
    const storage = new MemoryStorage();
    const validDefaults = storedGameDefaults("basicTragedy:1");
    if (validDefaults === undefined) {
      throw new Error("missing test defaults");
    }
    const legacyState = structuredClone(validDefaults.state);
    const legacyLoop = {
      ...legacyState.loop,
      board: { boyStudent: { at: "School", alive: true } },
    };
    storage.setItem(TRACKER_STORAGE_KEY, JSON.stringify({
      activeScenarioId: "basicTragedy:1",
      mastermindOverlay: true,
      games: {
        "basicTragedy:1": {
          ...validDefaults,
          state: { ...legacyState, loop: legacyLoop },
        },
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
      abilitiesUsedThisRound: _abilitiesUsedThisRound,
      ...savedLoop
    } = current.loop;
    const {
      loopOutcomes: _loopOutcomes,
      extraLoopsPlayed: _extraLoopsPlayed,
      ...savedState
    } = current;
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
    expect(restored.games["basicTragedy:1"].state.loop.abilitiesUsedThisRound)
      .toEqual([]);
    expect(restored.games["basicTragedy:1"].state.loopOutcomes).toEqual([]);
    expect(restored.games["basicTragedy:1"].state.extraLoopsPlayed).toBe(0);
  });

  it("applies scenario errata when restoring a save made from printed data", () => {
    const storage = new MemoryStorage();
    const defaults = antibodiesDefaults("basicTragedy:12");
    if (defaults === undefined) throw new Error("missing test defaults");
    const printed = structuredClone(defaults);
    printed.state.scenario.cast.informer = "conspiracyTheorist";
    storage.setItem(TRACKER_STORAGE_KEY, JSON.stringify({
      activeScenarioId: "basicTragedy:12",
      mastermindOverlay: true,
      games: { "basicTragedy:12": printed },
    }));

    const restored = loadTrackerStore(storage, antibodiesDefaults);

    expect(restored.games["basicTragedy:12"].state.scenario.cast.informer)
      .toBe("person");
  });

});

describe("UI terminology", () => {
  it("uses ko-terms and the approved local UI fallback", () => {
    expect(term("characters", "boyStudent", "Boy Student")).toBe("남학생");
    expect(misc("Mastermind")).toBe("각본가");
    expect(misc("Next phase", "Next phase")).toBe("다음 단계");
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
