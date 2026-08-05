import type { GameState, LoopState, Phase } from "../types";
import { prepareFinalGuess } from "../engine/game";

export const TRACKER_STORAGE_KEY = "tragedy-looper-mastermind:tracker:v2";
export const LEGACY_TRACKER_STORAGE_KEY =
  "tragedy-looper-mastermind:tracker:v1";

export interface LoopObservation {
  recordedAt: string;
  reason: string;
  loop: number;
  day: number;
  phase: Phase;
  state: LoopState;
}

export interface StoredGame {
  state: GameState;
  observationsByLoop: Record<string, LoopObservation[]>;
  updatedAt: string;
}

export interface TrackerStore {
  version: 2;
  activeScenarioId?: string;
  mastermindOverlay: boolean;
  games: Record<string, StoredGame>;
}

export interface LocalKeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function emptyTrackerStore(): TrackerStore {
  return { version: 2, mastermindOverlay: true, games: {} };
}

function isTrackerStore(value: unknown): value is TrackerStore {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TrackerStore>;
  return candidate.version === 2 &&
    typeof candidate.mastermindOverlay === "boolean" &&
    typeof candidate.games === "object" &&
    candidate.games !== null;
}

function migrateV1(value: unknown): TrackerStore | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as {
    version?: unknown;
    activeScenarioId?: unknown;
    mastermindOverlay?: unknown;
    games?: unknown;
  };
  if (
    candidate.version !== 1 ||
    typeof candidate.mastermindOverlay !== "boolean" ||
    typeof candidate.games !== "object" ||
    candidate.games === null
  ) {
    return undefined;
  }

  const games: TrackerStore["games"] = {};
  for (const [scenarioId, storedValue] of Object.entries(candidate.games)) {
    if (typeof storedValue !== "object" || storedValue === null) continue;
    const stored = storedValue as {
      state?: unknown;
      observationsByLoop?: unknown;
      updatedAt?: unknown;
    };
    if (typeof stored.state !== "object" || stored.state === null) continue;

    const state = structuredClone(stored.state) as GameState;
    state.loopOutcomes = [];
    const wasFinalLoopClosed =
      state.loop.loop === state.scenario.loops &&
      state.loop.day === state.scenario.daysPerLoop &&
      state.loop.phase === "P9_ROUND_END" &&
      state.history.some(({ loop }) => loop === state.loop.loop);
    state.gamePhase = wasFinalLoopClosed ? "LOOP_JUDGMENT" : "ROUND";
    if (wasFinalLoopClosed) {
      prepareFinalGuess(state, "finalLoopLoss");
    }

    games[scenarioId] = {
      state,
      observationsByLoop:
        typeof stored.observationsByLoop === "object" &&
          stored.observationsByLoop !== null
          ? stored.observationsByLoop as Record<string, LoopObservation[]>
          : {},
      updatedAt: typeof stored.updatedAt === "string"
        ? stored.updatedAt
        : new Date(0).toISOString(),
    };
  }

  return {
    version: 2,
    activeScenarioId: typeof candidate.activeScenarioId === "string"
      ? candidate.activeScenarioId
      : undefined,
    mastermindOverlay: candidate.mastermindOverlay,
    games,
  };
}

export function loadTrackerStore(storage: LocalKeyValueStore): TrackerStore {
  const raw = storage.getItem(TRACKER_STORAGE_KEY);

  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isTrackerStore(parsed)) return parsed;
    } catch {
      return emptyTrackerStore();
    }
  }

  const legacyRaw = storage.getItem(LEGACY_TRACKER_STORAGE_KEY);
  if (legacyRaw !== null) {
    try {
      return migrateV1(JSON.parse(legacyRaw)) ?? emptyTrackerStore();
    } catch {
      return emptyTrackerStore();
    }
  }
  return emptyTrackerStore();
}

function loopSignature(loop: LoopState): string {
  return JSON.stringify(loop);
}

/** 현재 게임과 관측 시점의 LoopState를 루프 번호별로 함께 저장한다. */
export function persistGameState(
  storage: LocalKeyValueStore,
  tracker: TrackerStore,
  scenarioId: string,
  state: GameState,
  reason: string,
  now = new Date(),
): void {
  const savedAt = now.toISOString();
  const previous = tracker.games[scenarioId];
  const observationsByLoop: Record<string, LoopObservation[]> =
    previous?.observationsByLoop ?? {};
  const loopKey = String(state.loop.loop);
  const observations = observationsByLoop[loopKey] ??= [];
  const latest = observations.at(-1);

  if (
    latest === undefined ||
    loopSignature(latest.state) !== loopSignature(state.loop)
  ) {
    observations.push({
      recordedAt: savedAt,
      reason,
      loop: state.loop.loop,
      day: state.loop.day,
      phase: state.loop.phase,
      state: structuredClone(state.loop),
    });
  }

  tracker.activeScenarioId = scenarioId;
  tracker.games[scenarioId] = {
    state: structuredClone(state),
    observationsByLoop,
    updatedAt: savedAt,
  };
  storage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(tracker));
}

export function persistTrackerPreferences(
  storage: LocalKeyValueStore,
  tracker: TrackerStore,
): void {
  storage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(tracker));
}
