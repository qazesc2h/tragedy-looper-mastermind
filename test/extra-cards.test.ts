import { describe, expect, it } from "vitest";

import {
  expireExtraCards,
  extraCardsAt,
  moveExtraCard,
  placeExtraCard,
  removeExtraCard,
} from "../src/engine/extra-cards";
import { requestLoopEnd } from "../src/engine/flow";
import {
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
  finishLoop,
} from "../src/engine/game";
import {
  publicBoardChanges,
  publicObservationContext,
} from "../src/engine/public-observation";
import { initLoop } from "../src/engine/setup";
import type { ExtraCardInstance, GameState, Scenario } from "../src/types";

const scenario: Scenario = {
  tragedySet: "basicTragedy",
  mainPlot: "murderPlan",
  subPlots: [],
  cast: { girlStudent: "person", boyStudent: "person" },
  incidents: [],
  loops: 3,
  daysPerLoop: 3,
};

function card(
  instanceId: string,
  expiresAt: ExtraCardInstance["expiresAt"] = "manual",
): ExtraCardInstance {
  return {
    instanceId,
    cardId: `test-${instanceId}`,
    controller: "mastermind",
    source: { kind: "system", id: "extra-card-test" },
    target: { kind: "character", id: "girlStudent" },
    expiresAt,
  };
}

function state(): GameState {
  return {
    scenario,
    gamePhase: "ROUND",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
  };
}

describe("extra card state", () => {
  it("places multiple cards, moves one, and removes one", () => {
    const loop = initLoop(scenario);
    placeExtraCard(loop, card("one"));
    placeExtraCard(loop, card("two"));

    expect(extraCardsAt(loop, {
      kind: "character",
      id: "girlStudent",
    }).map(({ instanceId }) => instanceId)).toEqual(["one", "two"]);

    moveExtraCard(loop, "one", { kind: "location", at: "School" });
    expect(extraCardsAt(loop, { kind: "location", at: "School" }))
      .toHaveLength(1);
    expect(removeExtraCard(loop, "two").instanceId).toBe("two");
    expect(loop.extraCards.map(({ instanceId }) => instanceId)).toEqual(["one"]);
  });

  it("rejects duplicate and missing instance ids", () => {
    const loop = initLoop(scenario);
    placeExtraCard(loop, card("one"));
    expect(() => placeExtraCard(loop, card("one"))).toThrow("already exists");
    expect(() => moveExtraCard(
      loop,
      "missing",
      { kind: "location", at: "City" },
    )).toThrow("does not exist");
    expect(() => removeExtraCard(loop, "missing")).toThrow("does not exist");
  });

  it("expires only the requested lifetime", () => {
    const loop = initLoop(scenario);
    placeExtraCard(loop, card("start", "loopStart"));
    placeExtraCard(loop, card("end", "loopEnd"));
    placeExtraCard(loop, card("manual", "manual"));

    expect(expireExtraCards(loop, "loopStart").map(({ instanceId }) =>
      instanceId
    )).toEqual(["start"]);
    expect(loop.extraCards.map(({ instanceId }) => instanceId))
      .toEqual(["end", "manual"]);
    expect(expireExtraCards(loop, "loopEnd").map(({ instanceId }) =>
      instanceId
    )).toEqual(["end"]);
    expect(loop.extraCards.map(({ instanceId }) => instanceId))
      .toEqual(["manual"]);
  });

  it("records public placement, movement, and removal without hidden source", () => {
    const initial = initLoop(scenario);
    const placed = structuredClone(initial);
    placeExtraCard(placed, card("one"));
    const placedChanges = publicBoardChanges(initial, placed);
    expect(placedChanges).toEqual([{
      kind: "extraCard",
      action: "placed",
      card: {
        instanceId: "one",
        cardId: "test-one",
        controller: "mastermind",
        target: { kind: "character", id: "girlStudent" },
        expiresAt: "manual",
      },
    }]);
    expect(placedChanges[0]).not.toHaveProperty("card.source");

    const moved = structuredClone(placed);
    moveExtraCard(moved, "one", { kind: "location", at: "School" });
    expect(publicBoardChanges(placed, moved)).toEqual([{
      kind: "extraCard",
      action: "moved",
      card: expect.objectContaining({
        instanceId: "one",
        target: { kind: "location", at: "School" },
      }),
      from: { kind: "character", id: "girlStudent" },
      to: { kind: "location", at: "School" },
    }]);

    const removed = structuredClone(moved);
    removeExtraCard(removed, "one");
    expect(publicBoardChanges(moved, removed)).toEqual([{
      kind: "extraCard",
      action: "removed",
      card: expect.objectContaining({ instanceId: "one" }),
    }]);
    expect(publicObservationContext(placed).extraCards?.[0])
      .not.toHaveProperty("source");
  });

  it("expires loop-start cards before hooks and records the public removal", () => {
    const game = createGameState(scenario);
    chooseInitialLeader(game, 0);
    placeExtraCard(game.loop, card("start", "loopStart"));
    placeExtraCard(game.loop, card("manual", "manual"));

    continueFromTimeGap(game);

    expect(game.loop.extraCards.map(({ instanceId }) => instanceId))
      .toEqual(["manual"]);
    expect(game.loop.phaseLog).toContainEqual(expect.objectContaining({
      kind: "extraCardsExpired",
      timing: "loopStart",
      observedAt: expect.objectContaining({ phase: "LOOP_START" }),
      publicChanges: [expect.objectContaining({
        kind: "extraCard",
        action: "removed",
        card: expect.objectContaining({ instanceId: "start" }),
      })],
    }));
  });

  it("expires loop-end cards before the completed-loop snapshot", () => {
    const game = state();
    placeExtraCard(game.loop, card("end", "loopEnd"));
    placeExtraCard(game.loop, card("start", "loopStart"));
    placeExtraCard(game.loop, card("manual", "manual"));
    requestLoopEnd(game, "lastDay");

    finishLoop(game);

    expect(game.loop.extraCards.map(({ instanceId }) => instanceId))
      .toEqual(["start", "manual"]);
    expect(game.history[0]?.extraCards.map(({ instanceId }) => instanceId))
      .toEqual(["start", "manual"]);
    expect(game.loop.phaseLog).toContainEqual(expect.objectContaining({
      kind: "extraCardsExpired",
      timing: "loopEnd",
      observedAt: expect.objectContaining({ phase: "LOOP_END" }),
    }));
  });
});
