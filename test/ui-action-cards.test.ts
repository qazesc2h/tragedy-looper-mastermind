import scriptsJson from "../data/basic-tragedy-scripts.json";
import { describe, expect, it } from "vitest";
import { adaptBasicTragedyScript } from "../src/data";
import { initLoop } from "../src/engine/setup";
import {
  collectNoEffectCards,
  collectResolutionChanges,
  collectResolutionReport,
  cardPanelShouldReopenAfterPlacement,
  compactActionCardLabel,
  groupPlacementsByTarget,
  handCardIsPlaced,
  MASTERMIND_HAND,
  nextProtagonist,
  placedCardShowsName,
  recallPlacedCard,
  PROTAGONIST_HAND,
  protagonistOrder,
} from "../src/ui/action-cards";
import type { GameState, PlacedCard } from "../src/types";
import { boardLocation, setBoardLocation } from "./helpers";

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
  it.each([
    ["moveVertical", "이동↑↓", "이동↕"],
    ["moveHorizontal", "이동←→", "이동↔"],
    ["moveDiagonal", "대각 이동", "이동⤢"],
    ["forbidMove", "이동 금지", "이동 금지"],
  ] as const)("uses compact label for %s without changing its full name", (
    card,
    fullName,
    expected,
  ) => {
    expect(compactActionCardLabel(card, fullName)).toBe(expected);
  });

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

  it("shows mastermind card names face-down and protagonist names only from P4", () => {
    expect(placedCardShowsName(
      "P3_PROTAGONIST_ACTION",
      "mastermind",
      false,
    )).toBe(true);
    expect(placedCardShowsName(
      "P3_PROTAGONIST_ACTION",
      0,
      false,
    )).toBe(false);
    expect(placedCardShowsName("P4_RESOLVE", 0, false)).toBe(true);
  });

  it("groups overlapping cards under their shared target", () => {
    const character = Object.keys(createState().loop.board)[0];
    const placed: PlacedCard[] = [
      {
        owner: "mastermind",
        card: "moveHorizontal",
        target: { kind: "character", id: character },
      },
      {
        owner: 0,
        card: "moveVertical",
        target: { kind: "character", id: character },
      },
      {
        owner: 1,
        card: "goodwillPlus1",
        target: { kind: "location", at: "Shrine" },
      },
    ];

    expect(groupPlacementsByTarget(placed)).toEqual([
      {
        target: { kind: "character", id: character },
        placements: [placed[0], placed[1]],
      },
      {
        target: { kind: "location", at: "Shrine" },
        placements: [placed[2]],
      },
    ]);
  });

  it("recalls any placed card before P4 reveal and none after", () => {
    const state = createState();
    const character = Object.keys(state.loop.board)[0];
    state.loop.phase = "P2_MASTERMIND_ACTION";
    state.loop.placed.push({
      owner: "mastermind",
      card: "paranoiaPlus1",
      target: { kind: "character", id: character },
    });

    expect(recallPlacedCard(state, 0)?.card).toBe("paranoiaPlus1");
    expect(state.loop.placed).toEqual([]);

    state.loop.phase = "P3_PROTAGONIST_ACTION";
    state.loop.placed.push(
      {
        owner: "mastermind",
        card: "paranoiaPlus1",
        target: { kind: "character", id: character },
      },
      {
        owner: state.loop.leader,
        card: "goodwillPlus1",
        target: { kind: "character", id: character },
      },
    );

    expect(recallPlacedCard(state, 0)?.owner).toBe("mastermind");
    expect(recallPlacedCard(state, 0)?.owner).toBe(state.loop.leader);
    expect(nextProtagonist(state)).toBe(state.loop.leader);

    state.loop.placed.push({
      owner: "mastermind",
      card: "paranoiaPlus1",
      target: { kind: "character", id: character },
    });
    state.loop.phase = "P4_RESOLVE";
    expect(recallPlacedCard(state, 0)).toBeUndefined();
    expect(state.loop.placed).toHaveLength(1);
  });

  it("reopens the card panel only while placements remain", () => {
    const state = createState();
    const target = {
      kind: "character" as const,
      id: Object.keys(state.loop.board)[0],
    };
    state.loop.phase = "P2_MASTERMIND_ACTION";
    expect(cardPanelShouldReopenAfterPlacement(state, "mastermind")).toBe(true);
    state.loop.placed.push(
      { owner: "mastermind", card: "paranoiaPlus1", target },
      { owner: "mastermind", card: "paranoiaMinus1", target },
    );
    expect(cardPanelShouldReopenAfterPlacement(state, "mastermind")).toBe(false);
    state.loop.placed.push({
      owner: "mastermind",
      card: "forbidParanoia",
      target,
    });

    state.loop.phase = "P3_PROTAGONIST_ACTION";
    expect(cardPanelShouldReopenAfterPlacement(state, 0)).toBe(true);
    state.loop.placed.push(
      { owner: 0, card: "goodwillPlus1", target },
      { owner: 1, card: "goodwillPlus1", target },
    );
    expect(cardPanelShouldReopenAfterPlacement(state, 2)).toBe(false);
    state.loop.placed.push({ owner: 2, card: "goodwillPlus1", target });

    state.loop.placed.splice(0, 1);
    expect(cardPanelShouldReopenAfterPlacement(state, "mastermind")).toBe(false);
  });
});

describe("UI card-resolution report", () => {
  it("reports movement and counter changes from the resolved state", () => {
    const before = createState();
    const character = Object.keys(before.loop.board)[0];
    const after = structuredClone(before);
    const destination = boardLocation(before.loop, character) === "City"
      ? "School"
      : "City";
    setBoardLocation(after.loop, character, destination);
    after.loop.charCounters[character].goodwill = 1;
    after.loop.locIntrigue.Shrine = 2;

    expect(collectResolutionChanges(before, after)).toEqual([
      {
        kind: "movement",
        character,
        before: boardLocation(before.loop, character),
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

  it("does not call a bluff location card ineffective when it applies to illusion", () => {
    const before = createState();
    before.scenario.cast.illusion = "person";
    before.loop.board.illusion = { status: "alive", at: "Shrine" };
    before.loop.charCounters.illusion = {
      goodwill: 0,
      paranoia: 0,
      intrigue: 0,
      protection: 0,
    };
    const placed: PlacedCard[] = [{
      owner: "mastermind",
      card: "paranoiaPlus1",
      target: { kind: "location", at: "Shrine" },
    }];

    expect(collectNoEffectCards(
      before,
      structuredClone(before),
      placed,
    )).toEqual([]);
  });

  it("orders changes before publicly reported no-effects", () => {
    const before = createState();
    const [counterCharacter, movingCharacter] = Object.keys(before.loop.board);
    const after = structuredClone(before);
    after.loop.charCounters[counterCharacter].goodwill = 1;
    setBoardLocation(
      after.loop,
      movingCharacter,
      boardLocation(before.loop, movingCharacter) === "City"
        ? "School"
        : "City",
    );
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

    const report = collectResolutionReport(before, after, placed);

    expect(report.map(({ category, causeHidden }) => ({ category, causeHidden })))
      .toEqual([
        { category: "movement", causeHidden: false },
        { category: "counter", causeHidden: false },
        { category: "noEffect", causeHidden: false },
      ]);
  });

  it("marks a time traveler's visible counter result with a hidden cause", () => {
    const before = createState();
    const character = Object.keys(before.loop.board)[0];
    before.scenario.cast[character] = "timeTraveler";
    const after = structuredClone(before);
    after.loop.charCounters[character].goodwill = 2;
    const target = { kind: "character", id: character } as const;
    const placed: PlacedCard[] = [
      { owner: "mastermind", card: "forbidGoodwill", target },
      { owner: 0, card: "goodwillPlus2", target },
    ];

    expect(collectResolutionReport(before, after, placed)).toEqual([
      {
        category: "counter",
        change: {
          kind: "characterCounter",
          character,
          counter: "goodwill",
          before: 0,
          after: 2,
        },
        causeHidden: true,
      },
    ]);
  });

  it("marks a cultist's chosen forbid ignore with a hidden cause", () => {
    const before = createState();
    const cultist = Object.keys(before.loop.board)[0];
    const location = boardLocation(before.loop, cultist);
    before.loop.cultistsIgnoringForbidIntrigue = [cultist];
    const after = structuredClone(before);
    after.loop.locIntrigue[location] = 2;
    const target = { kind: "location", at: location } as const;
    const placed: PlacedCard[] = [
      { owner: "mastermind", card: "intriguePlus2", target },
      { owner: 0, card: "forbidIntrigue", target },
    ];

    expect(collectResolutionReport(before, after, placed)).toEqual([
      {
        category: "counter",
        change: {
          kind: "locationIntrigue",
          location,
          before: 0,
          after: 2,
        },
        causeHidden: true,
      },
    ]);
  });
});
