import type { GameState, Phase, PhaseLogEntry } from "../types";

export interface PhaseLogGroup {
  key: string;
  loop: number;
  day: number;
  phase: Phase;
  entries: PhaseLogEntry[];
}

export function phaseLogGroups(state: GameState): PhaseLogGroup[] {
  const entries = [
    ...state.history.flatMap((loop) => loop.phaseLog ?? []),
    ...(state.loop.phaseLog ?? []),
  ];
  const groups = new Map<string, PhaseLogGroup>();

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const key = `${entry.loop}:${entry.day}:${entry.phase}`;
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    groups.set(key, {
      key,
      loop: entry.loop,
      day: entry.day,
      phase: entry.phase,
      entries: [entry],
    });
  }

  return [...groups.values()];
}

export function phaseLogGroupIsOpen(
  state: GameState,
  group: PhaseLogGroup,
): boolean {
  return group.loop === state.loop.loop && group.day === state.loop.day;
}
