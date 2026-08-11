import type { GameState, PhaseLogEntry } from "../types";

export interface PhaseLogDayGroup {
  key: string;
  loop: number;
  day: number;
  entries: PhaseLogEntry[];
}

export interface PhaseLogLoopGroup {
  key: string;
  loop: number;
  days: PhaseLogDayGroup[];
}

export function phaseLogLoopGroups(state: GameState): PhaseLogLoopGroup[] {
  const entries = [
    ...state.history.flatMap((loop) => loop.phaseLog ?? []),
    ...(state.loop.phaseLog ?? []),
  ];
  const loops = new Map<number, Map<number, PhaseLogEntry[]>>();

  for (const entry of entries) {
    const days = loops.get(entry.loop) ?? new Map<number, PhaseLogEntry[]>();
    const dayEntries = days.get(entry.day) ?? [];
    dayEntries.push(entry);
    days.set(entry.day, dayEntries);
    loops.set(entry.loop, days);
  }

  return [...loops.entries()]
    .sort(([left], [right]) => right - left)
    .map(([loop, days]) => ({
      key: String(loop),
      loop,
      days: [...days.entries()]
        .sort(([left], [right]) => right - left)
        .map(([day, dayEntries]) => ({
          key: `${loop}:${day}`,
          loop,
          day,
          entries: dayEntries,
        })),
    }));
}

export function phaseLogLoopIsOpen(
  _state: GameState,
  _group: PhaseLogLoopGroup,
): boolean {
  return false;
}

export function phaseLogDayIsOpen(
  _state: GameState,
  _group: PhaseLogDayGroup,
): boolean {
  return false;
}
