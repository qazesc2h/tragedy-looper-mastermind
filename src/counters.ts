/** 캐릭터 위에 놓이는 카운터의 공통 계약. */
export const CHARACTER_COUNTER_DEFINITIONS = {
  goodwill: {
    incidentSelectable: true,
    transferable: true,
    summary: "always",
  },
  paranoia: {
    incidentSelectable: true,
    transferable: true,
    summary: "always",
  },
  intrigue: {
    incidentSelectable: true,
    transferable: true,
    summary: "always",
  },
  protection: {
    incidentSelectable: false,
    // USER_CONFIRMED Q6 A: 신수의 "1 counter"에는 보호도 포함한다.
    transferable: true,
    summary: "whenPositive",
  },
} as const;

export type CharacterCounter = keyof typeof CHARACTER_COUNTER_DEFINITIONS;

type CounterWithFlag<
  Flag extends "incidentSelectable" | "transferable",
> = {
  [Counter in CharacterCounter]:
    typeof CHARACTER_COUNTER_DEFINITIONS[Counter][Flag] extends true
      ? Counter
      : never;
}[CharacterCounter];

export type IncidentSelectableCounter = CounterWithFlag<
  "incidentSelectable"
>;
export type TransferableCharacterCounter = CounterWithFlag<"transferable">;
export type CharacterCounters = Record<CharacterCounter, number>;

export const CHARACTER_COUNTERS = Object.freeze(
  Object.keys(CHARACTER_COUNTER_DEFINITIONS) as CharacterCounter[],
);

export const INCIDENT_SELECTABLE_COUNTERS = Object.freeze(
  CHARACTER_COUNTERS.filter((counter): counter is IncidentSelectableCounter =>
    CHARACTER_COUNTER_DEFINITIONS[counter].incidentSelectable
  ),
);

export function isIncidentSelectableCounter(
  value: string,
): value is IncidentSelectableCounter {
  return (INCIDENT_SELECTABLE_COUNTERS as readonly string[]).includes(value);
}

export const TRANSFERABLE_CHARACTER_COUNTERS = Object.freeze(
  CHARACTER_COUNTERS.filter((counter): counter is TransferableCharacterCounter =>
    CHARACTER_COUNTER_DEFINITIONS[counter].transferable
  ),
);

export function emptyCharacterCounters(): CharacterCounters {
  return Object.fromEntries(
    CHARACTER_COUNTERS.map((counter) => [counter, 0]),
  ) as CharacterCounters;
}

export function totalCharacterCounters(counters: CharacterCounters): number {
  return CHARACTER_COUNTERS.reduce(
    (total, counter) => total + counters[counter],
    0,
  );
}
