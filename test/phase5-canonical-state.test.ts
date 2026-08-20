import { describe, expect, it } from "vitest";

import { createGameState } from "../src/engine/game";
import { validatePlacement } from "../src/engine/legal";
import { resolveActions } from "../src/engine/resolve";
import { initLoop } from "../src/engine/setup";
import { loadFirstStepsScenarioCatalog } from "../src/scenario-catalog";
import type {
  GameState,
  PhaseLogEntry,
  PlacedCard,
} from "../src/types";
import {
  canonicalStringify,
  canonicalDecisionStateKey,
  canonicalizeProtagonistObservations,
  DEFAULT_PROTAGONIST_POLICY_MODEL,
  engineStateKey,
  protagonistPolicyStateKey,
  projectCurrentKnowledgeProbe,
  projectHypothesisSupport,
  strategySearchCacheKeys,
} from "../tools/phase5-feasibility/canonical-state";
import type { ProtagonistObservation } from "../src/engine/hypothesis";
import { PublicEventCollector } from "../tools/phase5-feasibility/public-events";

function firstStepsState(): GameState {
  const entry = loadFirstStepsScenarioCatalog()[0];
  if (entry === undefined) throw new Error("missing First Steps scenario");
  return createGameState(structuredClone(entry.scenario));
}

const protagonistPlacements: PlacedCard[] = [
  {
    owner: 0,
    card: "paranoiaPlus1",
    target: { kind: "location", at: "Hospital" },
  },
  {
    owner: 1,
    card: "goodwillPlus1",
    target: { kind: "location", at: "Shrine" },
  },
  {
    owner: 2,
    card: "moveVertical",
    target: { kind: "location", at: "City" },
  },
];

const mastermindProfileA: PlacedCard[] = [
  {
    owner: "mastermind",
    card: "paranoiaPlus1",
    target: { kind: "location", at: "Hospital" },
  },
  {
    owner: "mastermind",
    card: "goodwillPlus1",
    target: { kind: "location", at: "Shrine" },
  },
  {
    owner: "mastermind",
    card: "moveVertical",
    target: { kind: "location", at: "City" },
  },
];

const mastermindProfileB: PlacedCard[] = [
  {
    owner: "mastermind",
    card: "paranoiaPlus1",
    target: { kind: "location", at: "School" },
  },
  {
    owner: "mastermind",
    card: "goodwillPlus1",
    target: { kind: "location", at: "Hospital" },
  },
  {
    owner: "mastermind",
    card: "moveVertical",
    target: { kind: "location", at: "Shrine" },
  },
];

function resolveLegalNoOpProfile(mastermind: readonly PlacedCard[]): GameState {
  const state = firstStepsState();
  for (const placement of [...mastermind, ...protagonistPlacements]) {
    expect(validatePlacement(state, placement)).toEqual({ ok: true });
    state.loop.placed.push(structuredClone(placement));
  }
  const before = {
    board: structuredClone(state.loop.board),
    charCounters: structuredClone(state.loop.charCounters),
    locIntrigue: structuredClone(state.loop.locIntrigue),
  };
  resolveActions(state);
  expect({
    board: state.loop.board,
    charCounters: state.loop.charCounters,
    locIntrigue: state.loop.locIntrigue,
  }).toEqual(before);
  return state;
}

function nextLoopStateWithPublicProfile(
  mastermind: readonly PlacedCard[],
): GameState {
  const resolved = resolveLegalNoOpProfile(mastermind);
  const previousLoop = structuredClone(resolved.loop);
  previousLoop.loop = 1;
  previousLoop.day = 1;
  const entry: PhaseLogEntry = {
    loop: 1,
    day: 1,
    phase: "P4_RESOLVE",
    kind: "actionResolved",
    results: [],
    placements: [
      ...mastermind.map((placement) => structuredClone(placement)),
      ...protagonistPlacements.map((placement) => structuredClone(placement)),
    ],
    publicChanges: [],
  };
  previousLoop.phaseLog = [entry];

  return {
    ...resolved,
    loop: initLoop(resolved.scenario, 2),
    history: [previousLoop],
  };
}

describe("Phase 5 canonical state Section 1", () => {
  it("keys sufficient transition state and public trace but not raw log text", () => {
    const base = firstStepsState();
    const rawLogVariant = structuredClone(base);
    base.loop.phaseLog = [{
      loop: 1,
      day: 1,
      phase: "P5_MASTERMIND_ABILITY",
      kind: "abilityActivated",
      description: "hidden source A",
    }];
    rawLogVariant.loop.phaseLog = [{
      loop: 1,
      day: 1,
      phase: "P5_MASTERMIND_ABILITY",
      kind: "abilityActivated",
      description: "hidden source B",
    }];

    expect(canonicalDecisionStateKey(base, [])).toBe(
      canonicalDecisionStateKey(rawLogVariant, []),
    );

    const placedVariant = structuredClone(base);
    placedVariant.loop.placed = structuredClone(mastermindProfileA);
    expect(canonicalDecisionStateKey(base, [])).not.toBe(
      canonicalDecisionStateKey(placedVariant, []),
    );

    const collector = new PublicEventCollector();
    const firstPlacement = mastermindProfileA[0];
    if (firstPlacement === undefined) throw new Error("missing placement");
    collector.recordFaceDownPlacements(base, [firstPlacement]);
    const traceVariant = collector.trace;
    expect(canonicalDecisionStateKey(base, [])).not.toBe(
      canonicalDecisionStateKey(base, traceVariant),
    );
  });

  it("separates the engine cache from policy-dependent public memory", () => {
    const state = firstStepsState();
    const collector = new PublicEventCollector();
    const firstPlacement = mastermindProfileA[0];
    if (firstPlacement === undefined) throw new Error("missing placement");
    collector.recordFaceDownPlacements(state, [firstPlacement]);

    expect(engineStateKey(state)).toBe(engineStateKey(structuredClone(state)));
    expect(protagonistPolicyStateKey(
      "perfect-recall",
      state,
      [],
    )).not.toBe(protagonistPolicyStateKey(
      "perfect-recall",
      state,
      collector.trace,
    ));
    expect(DEFAULT_PROTAGONIST_POLICY_MODEL).toBe("worst-legal-response");
    expect(protagonistPolicyStateKey(
      DEFAULT_PROTAGONIST_POLICY_MODEL,
      state,
      collector.trace,
    )).toBeUndefined();
    expect(strategySearchCacheKeys(state, collector.trace)).toEqual({
      engineStateKey: engineStateKey(state),
    });
    expect(strategySearchCacheKeys(
      state,
      collector.trace,
      "perfect-recall",
    )).toEqual({
      engineStateKey: engineStateKey(state),
      protagonistPolicyStateKey: protagonistPolicyStateKey(
        "perfect-recall",
        state,
        collector.trace,
      ),
    });
  });

  it("quotients cyclic leader labels and P2/P3 placement order only", () => {
    const left = firstStepsState();
    left.loop.leader = 0;
    left.loop.placed = [
      ...structuredClone(mastermindProfileA),
      ...structuredClone(protagonistPlacements),
    ];
    left.loop.spentOncePerLoop.protagonists = [
      ["goodwillPlus2"],
      ["forbidMove"],
      ["paranoiaMinus1"],
    ];

    const right = structuredClone(left);
    right.loop.leader = 1;
    right.loop.placed = [
      ...structuredClone(left.loop.placed).reverse().map((placement) => ({
        ...placement,
        owner: placement.owner === "mastermind"
          ? placement.owner
          : ((placement.owner + 1) % 3) as 0 | 1 | 2,
      })),
    ];
    right.loop.spentOncePerLoop.protagonists = [
      ["paranoiaMinus1"],
      ["goodwillPlus2"],
      ["forbidMove"],
    ];

    const leftTrace = new PublicEventCollector();
    leftTrace.recordFaceDownPlacements(left, left.loop.placed);
    const rightTrace = new PublicEventCollector();
    rightTrace.recordFaceDownPlacements(right, right.loop.placed);
    expect(canonicalDecisionStateKey(left, leftTrace.trace)).toBe(
      canonicalDecisionStateKey(right, rightTrace.trace),
    );

    const differentOwner = structuredClone(right);
    const protagonist = differentOwner.loop.placed.find(
      ({ owner }) => owner !== "mastermind",
    );
    if (protagonist === undefined || protagonist.owner === "mastermind") {
      throw new Error("missing protagonist placement");
    }
    protagonist.owner = ((protagonist.owner + 1) % 3) as 0 | 1 | 2;
    expect(canonicalDecisionStateKey(left, leftTrace.trace)).not.toBe(
      canonicalDecisionStateKey(differentOwner, rightTrace.trace),
    );
  });

  it("retains an owner swap when the first-day action creates different spent resources", () => {
    const left = firstStepsState();
    left.loop.leader = 0;
    left.loop.placed = [
      {
        owner: 0,
        card: "goodwillPlus1",
        target: { kind: "character", id: "shrineMaiden" },
      },
      {
        owner: 1,
        card: "paranoiaMinus1",
        target: { kind: "character", id: "doctor" },
      },
      {
        owner: 2,
        card: "forbidIntrigue",
        target: { kind: "character", id: "popIdol" },
      },
    ];
    const right = structuredClone(left);
    right.loop.placed = right.loop.placed.map((placement) => ({
      ...placement,
      owner: placement.owner === 0
        ? 1
        : placement.owner === 1
        ? 0
        : placement.owner,
    }));

    resolveActions(left);
    resolveActions(right);

    expect(left.loop.spentOncePerLoop.protagonists).toEqual([
      [],
      ["paranoiaMinus1"],
      [],
    ]);
    expect(right.loop.spentOncePerLoop.protagonists).toEqual([
      ["paranoiaMinus1"],
      [],
      [],
    ]);
    expect(canonicalDecisionStateKey(left, [])).not.toBe(
      canonicalDecisionStateKey(right, []),
    );
  });

  it("removes exact duplicates but preserves distinct observation order", () => {
    const role: ProtagonistObservation = {
      kind: "roleRevealed",
      loop: 1,
      character: "girlStudent",
      role: "keyPerson",
    };
    const incident: ProtagonistObservation = {
      kind: "incidentOccurred",
      loop: 1,
      day: 2,
      incident: "murder",
      occurred: true,
    };

    const left = canonicalizeProtagonistObservations([
      role,
      incident,
      structuredClone(role),
    ]);
    const sameTrace = canonicalizeProtagonistObservations([role, incident]);
    const reversed = canonicalizeProtagonistObservations([incident, role]);

    expect(canonicalStringify(left)).toBe(canonicalStringify(sameTrace));
    expect(canonicalStringify(left)).not.toBe(canonicalStringify(reversed));
    expect(left).toHaveLength(2);
  });

  it("rejects the three hypothesis tables as a sufficient decision key", () => {
    const stateA = nextLoopStateWithPublicProfile(mastermindProfileA);
    const stateB = nextLoopStateWithPublicProfile(mastermindProfileB);

    expect(stateA.loop).toEqual(stateB.loop);
    expect(projectHypothesisSupport(stateA)).toEqual(
      projectHypothesisSupport(stateB),
    );

    const knowledgeA = projectCurrentKnowledgeProbe(stateA);
    const knowledgeB = projectCurrentKnowledgeProbe(stateB);
    expect(knowledgeA.complete).toBe(false);
    expect(knowledgeB.complete).toBe(false);
    expect(knowledgeA.observations).toEqual(knowledgeB.observations);
    expect(knowledgeA.publicActionProfiles).not.toEqual(
      knowledgeB.publicActionProfiles,
    );

    const traceA = new PublicEventCollector();
    traceA.recordFaceDownPlacements(stateA, mastermindProfileA);
    traceA.recordCardsRevealed(stateA, mastermindProfileA);
    const traceB = new PublicEventCollector();
    traceB.recordFaceDownPlacements(stateB, mastermindProfileB);
    traceB.recordCardsRevealed(stateB, mastermindProfileB);
    expect(canonicalDecisionStateKey(stateA, traceA.trace)).not.toBe(
      canonicalDecisionStateKey(stateB, traceB.trace),
    );
  });
});
