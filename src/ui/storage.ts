import { LOCATIONS } from "../types";
import type { GameState, Location, LoopState, Phase } from "../types";

export const TRACKER_STORAGE_KEY = "tragedy-looper-mastermind:tracker";
export const APP_STORAGE_PREFIX = "tragedy-looper-mastermind:";
export const RETIRED_TRACKER_STORAGE_KEYS = [
  "tragedy-looper:tracker:v1",
  "tragedy-looper-mastermind:tracker:v1",
] as const;
export const STORAGE_RESET_NOTICE =
  "저장 데이터를 읽을 수 없어 새로 시작합니다.";

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
  activeScenarioId: string;
  mastermindOverlay: boolean;
  games: Record<string, StoredGame>;
}

export type StoredGameDefaults = (scenarioId: string) => StoredGame | undefined;

export interface LocalKeyValueStore {
  readonly length: number;
  getItem(key: string): string | null;
  key(index: number): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function emptyTrackerStore(): TrackerStore {
  return { activeScenarioId: "", mastermindOverlay: true, games: {} };
}

/** 현재 게임만 버리고 새 시나리오를 고를 수 있는 상태를 저장한다. */
export function prepareNewGame(
  storage: LocalKeyValueStore,
  tracker: TrackerStore,
): void {
  if (tracker.activeScenarioId !== "") {
    delete tracker.games[tracker.activeScenarioId];
  }
  tracker.activeScenarioId = "";
  storage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(tracker));
}

/** 이 앱의 접두사가 붙은 저장 키만 모두 삭제한다. */
export function clearAppStorage(storage: LocalKeyValueStore): void {
  const appKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(APP_STORAGE_PREFIX)) appKeys.push(key);
  }
  for (const key of appKeys) storage.removeItem(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocation(value: unknown): value is Location {
  return typeof value === "string" && LOCATIONS.some(
    (location) => location === value,
  );
}

function validateBoard(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  for (const [character, rawPosition] of Object.entries(value)) {
    const positionPath = `${path}.${character}`;
    if (!isRecord(rawPosition)) {
      throw new Error(`${positionPath} must be an object`);
    }
    if ("alive" in rawPosition) {
      throw new Error(`${positionPath} uses the retired board format`);
    }
    if (rawPosition.status === "absent") {
      if ("at" in rawPosition) {
        throw new Error(`${positionPath} absent state must not have a location`);
      }
      continue;
    }
    if (
      rawPosition.status !== "alive" &&
      rawPosition.status !== "dead"
    ) {
      throw new Error(`${positionPath}.status is invalid`);
    }
    if (!isLocation(rawPosition.at)) {
      throw new Error(`${positionPath}.at is invalid`);
    }
  }
}

function validateLoopBoard(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  validateBoard(value.board, `${path}.board`);
}

function validateStoredBoardShapes(saved: unknown, path: string): void {
  if (!isRecord(saved)) throw new Error(`${path} must be an object`);
  if (!isRecord(saved.state)) throw new Error(`${path}.state must be an object`);
  validateLoopBoard(saved.state.loop, `${path}.state.loop`);

  if (saved.state.history !== undefined) {
    if (!Array.isArray(saved.state.history)) {
      throw new Error(`${path}.state.history must be an array`);
    }
    saved.state.history.forEach((loop, index) =>
      validateLoopBoard(loop, `${path}.state.history.${index}`)
    );
  }

  if (saved.observationsByLoop === undefined) return;
  if (!isRecord(saved.observationsByLoop)) {
    throw new Error(`${path}.observationsByLoop must be an object`);
  }
  for (const [loop, observations] of Object.entries(
    saved.observationsByLoop,
  )) {
    if (!Array.isArray(observations)) {
      throw new Error(`${path}.observationsByLoop.${loop} must be an array`);
    }
    observations.forEach((observation, index) => {
      const observationPath =
        `${path}.observationsByLoop.${loop}.${index}`;
      if (!isRecord(observation)) {
        throw new Error(`${observationPath} must be an object`);
      }
      validateLoopBoard(observation.state, `${observationPath}.state`);
    });
  }
}

/** 기본 객체의 구조를 따라 누락 값을 채우고 알려진 필드의 타입 충돌을 거부한다. */
function mergeDefaults<T>(defaults: T, saved: unknown, path: string): T {
  if (saved === undefined) return structuredClone(defaults);
  if (Array.isArray(defaults)) {
    if (!Array.isArray(saved)) {
      throw new Error(`${path} must be an array`);
    }
    return structuredClone(saved) as T;
  }
  if (isRecord(defaults)) {
    if (!isRecord(saved)) {
      throw new Error(`${path} must be an object`);
    }
    const merged = structuredClone(saved);
    for (const [key, defaultValue] of Object.entries(defaults)) {
      merged[key] = mergeDefaults(defaultValue, saved[key], `${path}.${key}`);
    }
    return merged as T;
  }
  if (typeof saved !== typeof defaults || saved === null) {
    throw new Error(`${path} has an invalid type`);
  }
  return structuredClone(saved) as T;
}

function restoreObservations(
  defaults: StoredGame,
  saved: unknown,
  path: string,
): Record<string, LoopObservation[]> {
  if (!isRecord(saved)) throw new Error(`${path} must be an object`);
  const observationDefaults: LoopObservation = {
    recordedAt: new Date(0).toISOString(),
    reason: "",
    loop: defaults.state.loop.loop,
    day: defaults.state.loop.day,
    phase: defaults.state.loop.phase,
    state: defaults.state.loop,
  };
  return Object.fromEntries(Object.entries(saved).map(([loop, observations]) => {
    if (!Array.isArray(observations)) {
      throw new Error(`${path}.${loop} must be an array`);
    }
    return [loop, observations.map((observation, index) =>
      mergeDefaults(observationDefaults, observation, `${path}.${loop}.${index}`)
    )];
  }));
}

function restoreStoredGame(
  defaults: StoredGame,
  saved: unknown,
  path: string,
): StoredGame {
  validateStoredBoardShapes(saved, path);
  const restored = mergeDefaults(defaults, saved, path);
  restored.state.history = restored.state.history.map((loop, index) =>
    mergeDefaults(defaults.state.loop, loop, `${path}.state.history.${index}`)
  );
  restored.observationsByLoop = restoreObservations(
    defaults,
    restored.observationsByLoop,
    `${path}.observationsByLoop`,
  );
  return restored;
}

function restoreTrackerStore(
  saved: unknown,
  storedGameDefaults: StoredGameDefaults,
): TrackerStore {
  const restored = mergeDefaults(emptyTrackerStore(), saved, "tracker");
  if (
    restored.activeScenarioId !== "" &&
    storedGameDefaults(restored.activeScenarioId) === undefined
  ) {
    throw new Error("tracker.activeScenarioId is unknown");
  }
  restored.games = Object.fromEntries(
    Object.entries(restored.games).map(([scenarioId, game]) => {
      const defaults = storedGameDefaults(scenarioId);
      if (defaults === undefined) {
        throw new Error(`tracker.games.${scenarioId} is unknown`);
      }
      return [
        scenarioId,
        restoreStoredGame(defaults, game, `tracker.games.${scenarioId}`),
      ];
    }),
  );
  return restored;
}

export function loadTrackerStore(
  storage: LocalKeyValueStore,
  storedGameDefaults: StoredGameDefaults,
): TrackerStore {
  for (const key of RETIRED_TRACKER_STORAGE_KEYS) {
    storage.removeItem(key);
  }
  const raw = storage.getItem(TRACKER_STORAGE_KEY);
  if (raw === null) return emptyTrackerStore();
  try {
    const parsed: unknown = JSON.parse(raw);
    return restoreTrackerStore(parsed, storedGameDefaults);
  } catch {
    storage.removeItem(TRACKER_STORAGE_KEY);
    throw new Error(STORAGE_RESET_NOTICE);
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
