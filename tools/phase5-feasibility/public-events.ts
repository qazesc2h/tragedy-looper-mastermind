import { publicBoardChanges } from "../../src/engine/public-observation";
import type { GoodwillDeclaration } from "../../src/engine/goodwill";
import type {
  GamePhase,
  GameState,
  HookPoint,
  IncidentId,
  LoopEndReason,
  Phase,
  PlacedCard,
  PublicBoardChange,
  PublicInformation,
  Target,
} from "../../src/types";
import { canonicalStringify } from "./canonical-state";

/**
 * public trace에는 공개 사실만 넣는다. 숨은 선택은 event 자체를 만들지 않는다.
 * masked 값은 공개된 payload 안에서 카드 정체나 효과 원인만 가려졌음을 뜻한다.
 */
export type PublicEventVisibility =
  | "public"
  | "public-card-identity-masked"
  | "public-cause-masked";

export type PublicEventPhase = Phase | HookPoint | GamePhase;

export type PublicEventPayload =
  | {
    kind: "cardPlaced";
    owner: PlacedCard["owner"];
    target: Target;
  }
  | {
    kind: "cardsRevealed";
    placements: PlacedCard[];
  }
  | {
    kind: "boardChanged";
    changes: PublicBoardChange[];
  }
  | {
    kind: "incidentOutcome";
    incident: IncidentId;
    occurred: boolean;
  }
  | {
    kind: "goodwillDeclared";
    declaration: GoodwillDeclaration;
  }
  | {
    kind: "publicInformation";
    information: PublicInformation;
  }
  | {
    kind: "lossObserved";
    timing: LoopEndReason;
  };

export interface PublicEvent {
  loop: number;
  day: number;
  phase: PublicEventPhase;
  sequence: number;
  visibility: PublicEventVisibility;
  payload: PublicEventPayload;
}

export interface PublicEventContext {
  loop: number;
  day: number;
  phase: PublicEventPhase;
}

function eventContext(
  state: GameState,
  phase: PublicEventPhase = state.loop.phase,
): PublicEventContext {
  return {
    loop: state.loop.loop,
    day: state.loop.day,
    phase,
  };
}

/** 객체 키 순서와 무관한 완전 중복만 제거하고, 최초 관측 순서는 보존한다. */
export function canonicalizePublicEventTrace(
  trace: readonly PublicEvent[],
): PublicEvent[] {
  const seen = new Set<string>();
  const result: PublicEvent[] = [];
  for (const event of trace) {
    const key = canonicalStringify(event);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(structuredClone(event));
  }
  return result;
}

/**
 * 새 게임을 headless로 전개하면서 authoritative 공개 trace를 쌓는 수집기다.
 * 기존 GameState만으로는 P2/P3 배치 순서를 복원할 수 없으므로 역복원 기능은 없다.
 */
export class PublicEventCollector {
  readonly trace: PublicEvent[];

  constructor(trace: readonly PublicEvent[] = []) {
    this.trace = canonicalizePublicEventTrace(trace);
  }

  append(
    context: PublicEventContext,
    visibility: PublicEventVisibility,
    payload: PublicEventPayload,
  ): PublicEvent {
    const previous = this.trace.at(-1);
    const event: PublicEvent = {
      ...context,
      sequence: previous === undefined ? 0 : previous.sequence + 1,
      visibility,
      payload: structuredClone(payload),
    };
    this.trace.push(event);
    return event;
  }

  recordCardPlacement(state: GameState, placement: PlacedCard): PublicEvent {
    return this.append(
      eventContext(state),
      "public-card-identity-masked",
      {
        kind: "cardPlaced",
        owner: placement.owner,
        target: structuredClone(placement.target),
      },
    );
  }

  recordCardsRevealed(
    state: GameState,
    placements: readonly PlacedCard[],
  ): PublicEvent {
    return this.append(eventContext(state, "P4_RESOLVE"), "public", {
      kind: "cardsRevealed",
      placements: structuredClone([...placements]),
    });
  }

  recordGoodwillDeclaration(
    state: GameState,
    declaration: GoodwillDeclaration,
  ): PublicEvent {
    return this.append(eventContext(state, "P6_GOODWILL"), "public", {
      kind: "goodwillDeclared",
      declaration: structuredClone(declaration),
    });
  }

  recordIncidentOutcome(
    state: GameState,
    incident: IncidentId,
    occurred: boolean,
  ): PublicEvent {
    return this.append(eventContext(state, "P7_INCIDENT"), "public", {
      kind: "incidentOutcome",
      incident,
      occurred,
    });
  }

  /**
   * 원자적 실제 엔진 전이 전후의 공개 결과를 기록한다. phaseLog의 role/source,
   * 사건 범인, 억제 선택과 lossKeys는 읽지 않으므로 숨은 원인이 trace에 새지 않는다.
   */
  recordStateDelta(
    before: GameState,
    after: GameState,
    visibility: Extract<
      PublicEventVisibility,
      "public" | "public-cause-masked"
    >,
    phase: PublicEventPhase = before.loop.phase,
  ): void {
    const context = eventContext(before, phase);
    const changes = publicBoardChanges(before.loop, after.loop);
    if (changes.length > 0) {
      this.append(context, visibility, {
        kind: "boardChanged",
        changes,
      });
    }

    for (const information of appendedPublicInformation(before, after)) {
      this.append(context, "public", {
        kind: "publicInformation",
        information: publicInformationPayload(information),
      });
    }

    const beforeImmediate = before.loop.pendingImmediateLossKeys ?? [];
    const afterImmediate = after.loop.pendingImmediateLossKeys ?? [];
    const newImmediateLoss = afterImmediate.some(
      (key) => !beforeImmediate.includes(key),
    );
    if (newImmediateLoss) {
      this.append(context, "public-cause-masked", {
        kind: "lossObserved",
        timing: "effect",
      });
    }

    const beforeLoss = before.pendingLoopEnd;
    const afterLoss = after.pendingLoopEnd;
    if (
      afterLoss !== undefined &&
      !newImmediateLoss &&
      (
        beforeLoss === undefined ||
        canonicalStringify(beforeLoss) !== canonicalStringify(afterLoss)
      )
    ) {
      this.append(context, "public-cause-masked", {
        kind: "lossObserved",
        timing: afterLoss.reason,
      });
      return;
    }

    const newOutcomes = appendedLoopOutcomes(before, after);
    for (const outcome of newOutcomes) {
      if (outcome.result !== "protagonistsLost") continue;
      this.append(
        {
          loop: outcome.loop,
          day: outcome.day,
          phase,
        },
        "public-cause-masked",
        { kind: "lossObserved", timing: outcome.reason },
      );
    }
  }
}

function publicInformationPayload(
  information: PublicInformation,
): PublicInformation {
  const payload = structuredClone(information);
  // trace 바깥의 호환 관측 순번은 authoritative trace sequence와 중복 저장하지 않는다.
  delete payload.observedAt;
  return payload;
}

function appendedPublicInformation(
  before: GameState,
  after: GameState,
): PublicInformation[] {
  const previous = before.loop.publicInformationThisLoop ?? [];
  const current = after.loop.publicInformationThisLoop ?? [];
  assertAppendOnlyPrefix(previous, current, "public information");
  return structuredClone(current.slice(previous.length));
}

function appendedLoopOutcomes(
  before: GameState,
  after: GameState,
): GameState["loopOutcomes"] {
  assertAppendOnlyPrefix(before.loopOutcomes, after.loopOutcomes, "loop outcomes");
  return structuredClone(after.loopOutcomes.slice(before.loopOutcomes.length));
}

function assertAppendOnlyPrefix(
  before: readonly unknown[],
  after: readonly unknown[],
  label: string,
): void {
  if (after.length < before.length) {
    throw new Error(`${label} is not append-only`);
  }
  for (let index = 0; index < before.length; index += 1) {
    if (
      canonicalStringify(before[index]) !== canonicalStringify(after[index])
    ) {
      throw new Error(`${label} prefix changed at index ${index}`);
    }
  }
}
