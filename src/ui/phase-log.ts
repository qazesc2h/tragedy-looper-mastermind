import {
  PHASE_ORDER,
  type CharacterId,
  type GameState,
  type Location,
  type Phase,
  type PhaseLogEntry,
  type PlacedCard,
  type PublicBoardChange,
  type PublicObservationContext,
  type RoleId,
  type RoundEndPairEvidence,
  type Target,
} from "../types";

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

export type PhaseLogFilter = Target;

type AbilityLogEntry = Extract<
  PhaseLogEntry,
  {
    kind:
      | "abilityActivated"
      | "goodwillUsed"
      | "sacredTreeTransferJudged";
  }
>;

type IncidentLogEntry = Extract<PhaseLogEntry, { kind: "incidentJudged" }>;

interface PhaseLogTimelineBase {
  loop: number;
  day: number;
  phase: Phase;
  sequence?: number;
  characters: CharacterId[];
  locations: Location[];
  /** 관측 순번이 없는 구 기록 사이의 안정 정렬에만 쓴다. */
  sourceOrder: number;
}

export type PhaseLogTimelineItem = PhaseLogTimelineBase & (
  | { kind: "card"; placement: PlacedCard }
  | { kind: "change"; change: PublicBoardChange }
  | { kind: "ability"; entry: AbilityLogEntry }
  | { kind: "incident"; entry: IncidentLogEntry }
  | {
    kind: "roleReveal";
    character: CharacterId;
    role: RoleId;
  }
  | {
    kind: "incidentCulprit";
    incident: string;
    culprit: CharacterId;
  }
  | { kind: "roundEndPair"; pair: RoundEndPairEvidence }
);

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function targetReferences(targets: readonly Target[] | undefined): {
  characters: CharacterId[];
  locations: Location[];
} {
  return {
    characters: unique((targets ?? []).flatMap((target) =>
      target.kind === "character" ? [target.id] : []
    )),
    locations: unique((targets ?? []).flatMap((target) =>
      target.kind === "location" ? [target.at] : []
    )),
  };
}

function changeReferences(
  change: PublicBoardChange,
  context?: PublicObservationContext,
): { characters: CharacterId[]; locations: Location[] } {
  if (change.kind === "counter") {
    return targetReferences([change.target]);
  }
  if (change.kind === "movement") {
    return {
      characters: [change.character],
      locations: unique([change.from, change.to]),
    };
  }
  const at = change.at ?? context?.characters?.[change.character]?.location;
  return {
    characters: [change.character],
    locations: at === undefined ? [] : [at],
  };
}

function phaseFromObservation(
  phase: string | undefined,
  fallback: Phase,
): Phase {
  return PHASE_ORDER.includes(phase as Phase) ? phase as Phase : fallback;
}

/**
 * 캐릭터·장소 참조가 구조화된 회고 타임라인을 필요할 때만 만든다.
 * 표시 문자열은 포함하지 않아 이후 캐릭터 역할 후보를 같은 ID에 연결할 수 있다.
 */
export function phaseLogTimeline(state: GameState): PhaseLogTimelineItem[] {
  const items: PhaseLogTimelineItem[] = [];
  const loops = [...state.history, state.loop];
  let sourceOrder = 0;
  const pushChanges = (
    entry: PhaseLogEntry & {
      publicChanges?: PublicBoardChange[];
      publicContext?: PublicObservationContext;
    },
  ) => {
    for (const change of entry.publicChanges ?? []) {
      const references = changeReferences(change, entry.publicContext);
      items.push({
        kind: "change",
        loop: entry.loop,
        day: entry.day,
        phase: entry.phase,
        sequence: entry.observedAt?.sequence,
        sourceOrder: sourceOrder++,
        ...references,
        change,
      });
    }
  };

  for (const loop of loops) {
    for (const entry of loop.phaseLog ?? []) {
      if (entry.kind === "cardsPlaced") {
        for (const placement of entry.placements) {
          const references = targetReferences([placement.target]);
          items.push({
            kind: "card",
            loop: entry.loop,
            day: entry.day,
            phase: entry.phase,
            sequence: entry.observedAt?.sequence,
            sourceOrder: sourceOrder++,
            ...references,
            placement,
          });
        }
        continue;
      }
      if (entry.kind === "actionResolved") {
        pushChanges(entry);
        continue;
      }
      if (
        entry.kind === "abilityActivated" ||
        entry.kind === "goodwillUsed" ||
        entry.kind === "sacredTreeTransferJudged"
      ) {
        const explicitTargets = entry.kind === "sacredTreeTransferJudged"
          ? entry.target === undefined
            ? []
            : [{ kind: "character" as const, id: entry.target }]
          : entry.targets ?? [];
        const targetRefs = targetReferences(explicitTargets);
        const changeRefs = (entry.publicChanges ?? []).map((change) =>
          changeReferences(change, entry.publicContext)
        );
        const actor = entry.kind === "abilityActivated"
          ? entry.character
          : entry.kind === "goodwillUsed"
          ? entry.character
          : undefined;
        const triggerCharacters = entry.kind === "abilityActivated" &&
            entry.publicTrigger?.kind === "death"
          ? entry.publicTrigger.deadCharacters
          : [];
        items.push({
          kind: "ability",
          loop: entry.loop,
          day: entry.day,
          phase: entry.phase,
          sequence: entry.observedAt?.sequence,
          sourceOrder: sourceOrder++,
          characters: unique([
            ...(actor === undefined ? [] : [actor]),
            ...(entry.kind === "goodwillUsed" && entry.abilityOwner !== undefined
              ? [entry.abilityOwner]
              : []),
            ...targetRefs.characters,
            ...triggerCharacters,
            ...changeRefs.flatMap(({ characters }) => characters),
          ]),
          // 장소 필터는 능력 사용자의 현재 위치가 아니라 명시적 장소 대상만 본다.
          locations: targetRefs.locations,
          entry,
        });
        pushChanges(entry);
        continue;
      }
      if (entry.kind === "incidentJudged") {
        const targetRefs = targetReferences(entry.targets);
        const changeRefs = (entry.publicChanges ?? []).map((change) =>
          changeReferences(change, entry.publicContext)
        );
        items.push({
          kind: "incident",
          loop: entry.loop,
          day: entry.day,
          phase: entry.phase,
          sequence: entry.observedAt?.sequence,
          sourceOrder: sourceOrder++,
          characters: unique([
            entry.culprit,
            ...targetRefs.characters,
            ...(entry.deaths ?? []),
            ...changeRefs.flatMap(({ characters }) => characters),
          ]),
          locations: targetRefs.locations,
          entry,
        });
        pushChanges(entry);
      }
    }

    for (const information of loop.publicInformationThisLoop ?? []) {
      if (information.kind === "roleReveal") {
        items.push({
          kind: "roleReveal",
          loop: information.loop,
          day: information.day,
          phase: phaseFromObservation(
            information.observedAt?.phase,
            "P6_GOODWILL",
          ),
          sequence: information.observedAt?.sequence,
          sourceOrder: sourceOrder++,
          characters: [information.character],
          locations: [],
          character: information.character,
          role: information.role,
        });
      } else if (information.kind === "incidentCulprit") {
        items.push({
          kind: "incidentCulprit",
          loop: loop.loop,
          day: information.observedAt?.day ?? loop.day,
          phase: phaseFromObservation(
            information.observedAt?.phase,
            "P6_GOODWILL",
          ),
          sequence: information.observedAt?.sequence,
          sourceOrder: sourceOrder++,
          characters: [information.culprit],
          locations: [],
          incident: information.incident,
          culprit: information.culprit,
        });
      }
    }

    for (const evidence of loop.roundEvidence ?? []) {
      for (const pair of evidence.roundEndPairs ?? []) {
        items.push({
          kind: "roundEndPair",
          loop: loop.loop,
          day: evidence.day,
          phase: "P9_ROUND_END",
          sequence: evidence.observedAt?.sequence,
          sourceOrder: sourceOrder++,
          characters: [...pair.characters],
          locations: [pair.location],
          pair,
        });
      }
    }
  }

  return items.sort((left, right) =>
    left.loop - right.loop ||
    left.day - right.day ||
    (
      left.sequence !== undefined && right.sequence !== undefined
        ? left.sequence - right.sequence
        : PHASE_ORDER.indexOf(left.phase) - PHASE_ORDER.indexOf(right.phase)
    ) ||
    left.sourceOrder - right.sourceOrder
  );
}

export function phaseLogFilteredTimeline(
  state: GameState,
  filter: PhaseLogFilter,
): PhaseLogTimelineItem[] {
  return phaseLogTimeline(state).filter((item) =>
    filter.kind === "character"
      ? item.characters.includes(filter.id)
      : item.locations.includes(filter.at)
  );
}
