import type { GameState, LoopState, Phase } from "../types";

export const TRACKER_STORAGE_KEY = "tragedy-looper:tracker:v1";

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
  version: 1;
  activeScenarioId?: string;
  mastermindOverlay: boolean;
  games: Record<string, StoredGame>;
}

export interface LocalKeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function emptyTrackerStore(): TrackerStore {
  return { version: 1, mastermindOverlay: true, games: {} };
}

function isTrackerStore(value: unknown): value is TrackerStore {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TrackerStore>;
  return candidate.version === 1 &&
    typeof candidate.mastermindOverlay === "boolean" &&
    typeof candidate.games === "object" &&
    candidate.games !== null;
}

export function loadTrackerStore(storage: LocalKeyValueStore): TrackerStore {
  const raw = storage.getItem(TRACKER_STORAGE_KEY);
  if (raw === null) return emptyTrackerStore();

  try {
    const parsed: unknown = JSON.parse(raw);
    return isTrackerStore(parsed) ? parsed : emptyTrackerStore();
  } catch {
    return emptyTrackerStore();
  }
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
