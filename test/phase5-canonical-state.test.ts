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
  canonicalizeProtagonistObservations,
  projectCurrentKnowledgeProbe,
  projectHypothesisSupport,
} from "../tools/phase5-feasibility/canonical-state";
import type { ProtagonistObservation } from "../src/engine/hypothesis";

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
  });
});
