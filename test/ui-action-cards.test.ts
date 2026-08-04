import scriptsJson from "../data/basic-tragedy-scripts.json";
import { describe, expect, it } from "vitest";
import { adaptBasicTragedyScript } from "../src/data";
import { initLoop } from "../src/engine/setup";
import {
  collectNoEffectCards,
  collectResolutionChanges,
  handCardIsPlaced,
  MASTERMIND_HAND,
  nextProtagonist,
  PROTAGONIST_HAND,
  protagonistOrder,
} from "../src/ui/action-cards";
import type { GameState, PlacedCard } from "../src/types";

function createState(): GameState {
  const scenario = adaptBasicTragedyScript(scriptsJson[0]);
  return {
    scenario,
    gamePhase: "ROUND",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
  };
}

describe("UI action-card hands", () => {
  it("models the 10 mastermind cards and 8 protagonist cards", () => {
    expect(MASTERMIND_HAND).toHaveLength(10);
    expect(
      MASTERMIND_HAND.filter(({ card }) => card === "paranoiaPlus1"),
    ).toHaveLength(2);
    expect(PROTAGONIST_HAND).toHaveLength(8);
  });

  it("starts with the leader and advances to the first owner without a card", () => {
    const state = createState();
    state.loop.leader = 2;
    expect(protagonistOrder(state.loop.leader)).toEqual([2, 0, 1]);
    expect(nextProtagonist(state)).toBe(2);

    state.loop.placed.push({
      owner: 2,
      card: "goodwillPlus1",
      target: { kind: "character", id: Object.keys(state.loop.board)[0] },
    });
    expect(nextProtagonist(state)).toBe(0);
  });

  it("keeps the second mastermind Paranoia +1 available after the first is placed", () => {
    const state = createState();
    state.loop.placed.push({
      owner: "mastermind",
      card: "paranoiaPlus1",
      target: { kind: "character", id: Object.keys(state.loop.board)[0] },
    });

    expect(handCardIsPlaced(state, "mastermind", MASTERMIND_HAND, 0)).toBe(true);
    expect(handCardIsPlaced(state, "mastermind", MASTERMIND_HAND, 1)).toBe(false);
  });
});

describe("UI card-resolution report", () => {
  it("reports movement and counter changes from the resolved state", () => {
    const before = createState();
    const character = Object.keys(before.loop.board)[0];
    const after = structuredClone(before);
    const destination = before.loop.board[character].at === "City"
      ? "School"
      : "City";
    after.loop.board[character].at = destination;
    after.loop.charCounters[character].goodwill = 1;
    after.loop.locIntrigue.Shrine = 2;

    expect(collectResolutionChanges(before, after)).toEqual([
      {
        kind: "movement",
        character,
        before: before.loop.board[character].at,
        after: destination,
      },
      {
        kind: "characterCounter",
        character,
        counter: "goodwill",
        before: 0,
        after: 1,
      },
      {
        kind: "locationIntrigue",
        location: "Shrine",
        before: 0,
        after: 2,
      },
    ]);
  });

  it("labels an intrigue card blocked by the active round-wide forbid", () => {
    const before = createState();
    const placed: PlacedCard[] = [
      {
        owner: "mastermind",
        card: "intriguePlus1",
        target: { kind: "location", at: "Shrine" },
      },
      {
        owner: 0,
        card: "forbidIntrigue",
        target: { kind: "location", at: "Shrine" },
      },
    ];

    expect(collectNoEffectCards(before, structuredClone(before), placed)).toEqual([
      { placement: placed[0], blockedBy: "forbidIntrigue" },
    ]);
  });

  it("does not call an intrigue card blocked when two forbids cancel round-wide", () => {
    const before = createState();
    const after = structuredClone(before);
    after.loop.locIntrigue.Shrine = 1;
    const placed: PlacedCard[] = [
      {
        owner: "mastermind",
        card: "intriguePlus1",
        target: { kind: "location", at: "Shrine" },
      },
      {
        owner: 0,
        card: "forbidIntrigue",
        target: { kind: "location", at: "Shrine" },
      },
      {
        owner: 1,
        card: "forbidIntrigue",
        target: { kind: "location", at: "School" },
      },
    ];

    expect(collectNoEffectCards(before, after, placed)).toEqual([]);
  });
});
