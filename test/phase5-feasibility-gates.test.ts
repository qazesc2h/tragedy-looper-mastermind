import { describe, expect, it } from "vitest";

import { collectProtagonistObservations } from "../src/engine/hypothesis";
import {
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
} from "../src/engine/game";
import { validatePlacement } from "../src/engine/legal";
import { initLoop } from "../src/engine/setup";
import { loadScenarioCatalog } from "../src/scenario-catalog";
import type {
  CharacterId,
  GameState,
  Phase,
  PlacedCard,
  RoleId,
  Scenario,
} from "../src/types";
import {
  enumerateP2Transitions,
  enumerateP3Transitions,
  enumerateP5Transitions,
  enumerateP6Transitions,
  enumerateP7Transitions,
  enumerateP9Transitions,
  headlessNode,
  resolveP4Transition,
  type HeadlessTransition,
} from "../tools/phase5-feasibility/headless-transitions";
import {
  PublicEventCollector,
  canonicalizePublicEventTrace,
} from "../tools/phase5-feasibility/public-events";

function stateFor(
  cast: Record<CharacterId, RoleId>,
  phase: Phase,
  options: {
    incidents?: Scenario["incidents"];
    daysPerLoop?: number;
  } = {},
): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "",
    subPlots: [],
    cast,
    incidents: options.incidents ?? [],
    loops: 3,
    daysPerLoop: options.daysPerLoop ?? 3,
  };
  const loop = initLoop(scenario);
  loop.phase = phase;
  return {
    scenario,
    gamePhase: "ROUND",
    loop,
    history: [],
    loopOutcomes: [],
  };
}

function countTransitions(
  transitions: Generator<HeadlessTransition>,
): { count: number; first: HeadlessTransition | undefined } {
  let count = 0;
  let first: HeadlessTransition | undefined;
  for (const transition of transitions) {
    first ??= transition;
    count += 1;
  }
  return { count, first };
}

describe("Phase 5 gate 2-A public event trace", () => {
  it("records each simultaneous face-down profile without an internal order", () => {
    const state = stateFor({}, "P2_MASTERMIND_ACTION");
    const placement: PlacedCard = {
      owner: "mastermind",
      card: "intriguePlus2",
      target: { kind: "location", at: "School" },
    };
    const collector = new PublicEventCollector();
    collector.recordFaceDownPlacements(state, [placement]);
    state.loop.phase = "P4_RESOLVE";
    collector.recordCardsRevealed(state, [placement]);

    expect(collector.trace.map(({ sequence }) => sequence)).toEqual([0, 1]);
    expect(collector.trace[0]).toMatchObject({
      visibility: "public-card-identity-masked",
      payload: {
        kind: "cardsPlacedFaceDown",
        placements: [{
          owner: "mastermind",
          target: { kind: "location", at: "School" },
        }],
      },
    });
    expect(JSON.stringify(collector.trace[0])).not.toContain("intriguePlus2");
    expect(collector.trace[1]).toMatchObject({
      visibility: "public",
      payload: {
        kind: "cardsRevealed",
        placements: [{ card: "intriguePlus2" }],
      },
    });

    expect(canonicalizePublicEventTrace([
      collector.trace[0],
      structuredClone(collector.trace[0]),
      collector.trace[1],
    ])).toHaveLength(2);
  });

  it("records public board results and exact role-reveal time without a cause", () => {
    const before = stateFor({ girlStudent: "person" }, "P6_GOODWILL");
    const after = structuredClone(before);
    after.loop.charCounters.girlStudent.paranoia += 1;
    after.loop.publicInformationThisLoop = [{
      kind: "roleReveal",
      character: "girlStudent",
      role: "person",
      loop: 1,
      day: 1,
    }];

    const collector = new PublicEventCollector();
    collector.recordStateDelta(
      before,
      after,
      "public-cause-masked",
      "P6_GOODWILL",
    );

    expect(collector.trace).toHaveLength(2);
    expect(collector.trace[0]).toMatchObject({
      loop: 1,
      day: 1,
      phase: "P6_GOODWILL",
      visibility: "public-cause-masked",
      payload: {
        kind: "boardChanged",
        changes: [{ kind: "counter", counter: "paranoia", delta: 1 }],
      },
    });
    expect(collector.trace[1]).toMatchObject({
      sequence: 1,
      visibility: "public",
      payload: {
        kind: "publicInformation",
        information: {
          kind: "roleReveal",
          character: "girlStudent",
          role: "person",
          day: 1,
        },
      },
    });

    const compatibilityState = structuredClone(after);
    compatibilityState.loop.day = 2;
    const oldObservation = collectProtagonistObservations(
      compatibilityState,
    ).find(({ kind }) => kind === "roleRevealed");
    expect(oldObservation).toBeDefined();
    expect(oldObservation).not.toHaveProperty("day");
  });
});

describe("Phase 5 gate 2-B headless placement enumeration", () => {
  it("streams every semantic P2 profile through legal.ts", () => {
    const state = stateFor({}, "P2_MASTERMIND_ACTION");
    const { count, first } = countTransitions(
      enumerateP2Transitions(headlessNode(state)),
    );

    // 의미가 다른 카드 멀티셋/대상 배정 528개 × 대상 집합 C(4, 3).
    // 예전 순차 생성의 528 × P(4, 3)는 같은 완성 집합을 3!번 셌다.
    expect(count).toBe(528 * 4);
    expect(first?.action.kind).toBe("P2_PROFILE");
    expect(first?.node.state.loop.phase).toBe("P3_PROTAGONIST_ACTION");
    expect(first?.node.publicTrace).toHaveLength(1);

    const replay = structuredClone(state);
    if (first?.action.kind !== "P2_PROFILE") {
      throw new Error("missing first P2 profile");
    }
    for (const placement of first.action.placements) {
      expect(validatePlacement(replay, placement)).toEqual({ ok: true });
      replay.loop.placed.push(structuredClone(placement));
    }
  });

  it("resolves and reveals P4 through the actual two-step engine path", () => {
    const state = stateFor({}, "P4_RESOLVE");
    state.loop.placed = [{
      owner: "mastermind",
      card: "intriguePlus1",
      target: { kind: "location", at: "Hospital" },
    }];

    const transition = resolveP4Transition(headlessNode(state));

    expect(transition.action.kind).toBe("P4_RESOLVE");
    expect(transition.node.state.loop.locIntrigue.Hospital).toBe(1);
    expect(transition.node.state.loop.placed).toEqual([]);
    expect(transition.node.state.loop.phase).toBe("P6_GOODWILL");
    expect(transition.node.publicTrace.map(({ payload }) => payload.kind)).toEqual([
      "cardsRevealed",
      "boardChanged",
    ]);
  });

  it("streams every P3 profile in leader order through legal.ts", () => {
    const state = stateFor({}, "P3_PROTAGONIST_ACTION");
    state.loop.leader = 1;
    state.loop.placed = [
      {
        owner: "mastermind",
        card: "paranoiaPlus1",
        target: { kind: "location", at: "Hospital" },
      },
      {
        owner: "mastermind",
        card: "intriguePlus1",
        target: { kind: "location", at: "Shrine" },
      },
      {
        owner: "mastermind",
        card: "moveVertical",
        target: { kind: "location", at: "City" },
      },
    ];
    const { count, first } = countTransitions(
      enumerateP3Transitions(headlessNode(state)),
    );

    // 세 주인공의 카드 8^3 × 서로 다른 장소 대상 순열 P(4, 3)=24.
    expect(count).toBe(8 ** 3 * 24);
    expect(first?.action.kind).toBe("P3_PROFILE");
    if (first?.action.kind !== "P3_PROFILE") {
      throw new Error("missing first P3 profile");
    }
    expect(first.action.placements.map(({ owner }) => owner)).toEqual([0, 1, 2]);
    expect(first.node.publicTrace).toHaveLength(1);
    expect(first?.node.state.loop.phase).toBe("P4_RESOLVE");
  });

  it("counts firstSteps:2 P3 constraints without submission-order duplicates", () => {
    const entry = loadScenarioCatalog().find(({ id }) => id === "firstSteps:2");
    if (entry === undefined) throw new Error("missing firstSteps:2");
    const state = createGameState(structuredClone(entry.scenario));
    chooseInitialLeader(state, 0);
    continueFromTimeGap(state);
    state.loop.placed = [
      {
        owner: "mastermind",
        card: "paranoiaPlus1",
        target: { kind: "location", at: "Hospital" },
      },
      {
        owner: "mastermind",
        card: "intriguePlus1",
        target: { kind: "location", at: "Shrine" },
      },
      {
        owner: "mastermind",
        card: "moveVertical",
        target: { kind: "location", at: "City" },
      },
    ];
    state.loop.phase = "P3_PROTAGONIST_ACTION";

    const initial = countTransitions(enumerateP3Transitions(headlessNode(state)));
    // 카드 8^3 × 세 소유자의 서로 다른 대상 P(10, 3).
    expect(initial.count).toBe(8 ** 3 * 10 * 9 * 8);

    const constrained = structuredClone(state);
    const firstCharacter = Object.keys(constrained.loop.board)[0];
    if (firstCharacter === undefined) throw new Error("missing cast");
    const firstPosition = constrained.loop.board[firstCharacter];
    if (firstPosition === undefined || firstPosition.status === "absent") {
      throw new Error("missing initial character position");
    }
    constrained.loop.board[firstCharacter] = {
      status: "dead",
      at: firstPosition.at,
    };
    expect(validatePlacement(constrained, {
      owner: 0,
      card: "goodwillPlus1",
      target: { kind: "character", id: firstCharacter },
    }).ok).toBe(false);

    constrained.loop.spentOncePerLoop.protagonists[0].push("goodwillPlus2");
    expect(validatePlacement(constrained, {
      owner: 0,
      card: "goodwillPlus2",
      target: { kind: "location", at: "School" },
    }).ok).toBe(false);

    constrained.loop.placed.push({
      owner: 1,
      card: "goodwillPlus1",
      target: { kind: "location", at: "School" },
    });
    expect(validatePlacement(constrained, {
      owner: 2,
      card: "goodwillPlus1",
      target: { kind: "location", at: "School" },
    }).ok).toBe(false);

    const overlapsMastermind = validatePlacement(state, {
      owner: 0,
      card: "goodwillPlus1",
      target: { kind: "location", at: "Hospital" },
    });
    expect(overlapsMastermind).toEqual({ ok: true });
  // 368,640개 실제 전이를 검사한다. timeout은 성능 판정값이 아니라 CI 실행 여유다.
  }, 120_000);
});

describe("Phase 5 gate 2-B headless follow-up choices", () => {
  it("enumerates P5 skip and actual optional hook targets", () => {
    const state = stateFor({ doctor: "brain" }, "P5_MASTERMIND_ABILITY");
    state.loop.board.doctor = { status: "alive", at: "Hospital" };
    const transitions = [...enumerateP5Transitions(headlessNode(state))];

    expect(transitions[0]?.action).toEqual({
      kind: "P5_SEQUENCE",
      hooks: [],
    });
    const activated = transitions.find(
      ({ action }) => action.kind === "P5_SEQUENCE" && action.hooks.length === 1,
    );
    expect(activated).toBeDefined();
    expect(activated?.node.publicTrace.some(({ payload, visibility }) =>
      payload.kind === "boardChanged" &&
      visibility === "public-cause-masked"
    )).toBe(true);
    expect(JSON.stringify(activated?.node.publicTrace)).not.toContain("brain");
  });

  it("enumerates P6 declaration order and only engine-allowed responses", () => {
    const state = stateFor({ henchman: "killer" }, "P6_GOODWILL");
    state.loop.board.henchman = { status: "alive", at: "City" };
    state.loop.charCounters.henchman.goodwill = 3;
    const transitions = [...enumerateP6Transitions(headlessNode(state))];

    expect(transitions).toHaveLength(3);
    expect(transitions.map(({ action }) =>
      action.kind === "P6_SEQUENCE"
        ? action.uses.map(({ mastermindResponse }) => mastermindResponse)
        : []
    )).toEqual([[], ["resolve"], ["refuse"]]);
    const resolved = transitions[1];
    expect(resolved?.node.state.loop.incidentCulpritSuppressedFor).toEqual([
      "henchman",
    ]);
    expect(resolved?.node.publicTrace).toHaveLength(1);
    expect(resolved?.node.publicTrace[0]?.payload.kind).toBe(
      "goodwillDeclared",
    );
  });

  it("enumerates only P7 choices accepted by the actual incident transition", () => {
    const state = stateFor(
      {
        boyStudent: "person",
        girlStudent: "person",
        policeOfficer: "person",
      },
      "P7_INCIDENT",
      {
        incidents: [{ day: 1, incident: "murder", culprit: "boyStudent" }],
      },
    );
    for (const character of Object.keys(state.loop.board)) {
      state.loop.board[character] = { status: "alive", at: "City" };
    }
    state.loop.charCounters.boyStudent.paranoia = 10;
    const transitions = [...enumerateP7Transitions(headlessNode(state))];

    expect(transitions).toHaveLength(2);
    expect(transitions.map(({ action }) =>
      action.kind === "P7_INCIDENT" ? action.choice?.target : undefined
    ).sort()).toEqual(["girlStudent", "policeOfficer"]);
    expect(transitions.every(({ node }) =>
      node.publicTrace[0]?.payload.kind === "incidentOutcome"
    )).toBe(true);
    expect(JSON.stringify(transitions[0]?.node.publicTrace)).not.toContain(
      "boyStudent",
    );
  });

  it("resolves P9 mandatory effects first, then branches optional hooks", () => {
    const state = stateFor(
      { boyStudent: "killer", girlStudent: "keyPerson" },
      "P9_ROUND_END",
    );
    state.loop.board.boyStudent = { status: "alive", at: "City" };
    state.loop.board.girlStudent = { status: "alive", at: "City" };
    state.loop.charCounters.girlStudent.intrigue = 2;
    const transitions = [...enumerateP9Transitions(headlessNode(state))];

    expect(transitions.some(({ action }) =>
      action.kind === "P9_SEQUENCE" && action.hooks.length === 0
    )).toBe(true);
    const activated = transitions.find(({ action }) =>
      action.kind === "P9_SEQUENCE" && action.hooks.length === 1
    );
    expect(activated?.node.state.loop.board.girlStudent.status).toBe("dead");
    expect(activated?.node.publicTrace.map(({ payload }) => payload.kind)).toEqual(
      ["boardChanged", "lossObserved"],
    );
    expect(activated?.node.publicTrace.every(({ payload }) =>
      !("description" in payload) && !("character" in payload)
    )).toBe(true);
  });
});
