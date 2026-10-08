import { describe, expect, it } from "vitest";

import {
  anonymousCorpseCountAt,
  characterCorpseCountAt,
  corpseCountAt,
} from "../src/engine/corpses";
import {
  CURSE_ROUND_END_SOURCE,
  locationCurseChoices,
  resolveRoundEndCurses,
  roundEndCurseStage,
} from "../src/engine/curses";
import { placeExtraCard } from "../src/engine/extra-cards";
import { resolveGoodwillAbility } from "../src/engine/goodwill";
import { collectProtagonistObservations } from "../src/engine/hypothesis";
import { incidentFailureReasons } from "../src/engine/incident";
import { advance } from "../src/engine/phases";
import { initLoop } from "../src/engine/setup";
import { goodwillAbilityViews } from "../src/ui/goodwill-abilities";
import type {
  AttachmentTarget,
  ExtraCardInstance,
  GameState,
  Scenario,
} from "../src/types";
import { setBoardLife, setBoardLocation } from "./helpers";

function scenario(tragedySet = "primeEvil"): Scenario {
  return {
    tragedySet,
    mainPlot: "",
    subPlots: [],
    cast: {
      alien: "person",
      boyStudent: "person",
      girlStudent: "person",
      officeWorker: "person",
    },
    incidents: [],
    loops: 3,
    daysPerLoop: 5,
  };
}

function state(tragedySet = "primeEvil"): GameState {
  const value = scenario(tragedySet);
  const result: GameState = {
    scenario: value,
    gamePhase: "ROUND",
    loop: initLoop(value),
    history: [],
    loopOutcomes: [],
  };
  for (const character of Object.keys(result.loop.board)) {
    setBoardLocation(result.loop, character, "City");
  }
  return result;
}

function curse(
  instanceId: string,
  target: AttachmentTarget,
): ExtraCardInstance {
  return {
    instanceId,
    cardId: "curse",
    controller: "mastermind",
    source: { kind: "system", id: "primeEvil" },
    target,
    expiresAt: "loopEnd",
  };
}

describe("Prime Evil anonymous corpses", () => {
  it("adds location Intrigue corpses to actual character corpses only in Prime Evil", () => {
    const prime = state();
    prime.loop.locIntrigue.City = 2;
    setBoardLife(prime.loop, "boyStudent", false);

    expect(anonymousCorpseCountAt(prime, "City")).toBe(2);
    expect(characterCorpseCountAt(prime, "City")).toBe(1);
    expect(corpseCountAt(prime, "City")).toBe(3);

    const basic = state("basicTragedy");
    basic.loop.locIntrigue.City = 2;
    setBoardLife(basic.loop, "boyStudent", false);
    expect(anonymousCorpseCountAt(basic, "City")).toBe(0);
    expect(corpseCountAt(basic, "City")).toBe(1);
  });

  it("uses the combined count for location-corpse incident trigger policies", () => {
    const prime = state();
    prime.loop.locIntrigue.City = 1;
    setBoardLife(prime.loop, "boyStudent", false);
    expect(incidentFailureReasons(
      prime,
      { kind: "location", at: "City" },
      "fountainFilth",
    )).toEqual([]);

    const basic = state("basicTragedy");
    basic.loop.locIntrigue.City = 1;
    setBoardLife(basic.loop, "boyStudent", false);
    expect(incidentFailureReasons(
      basic,
      { kind: "location", at: "City" },
      "fountainFilth",
    )).toEqual(["insufficientCorpses"]);
  });

  it("lets Alien rank 5 remove one anonymous corpse in the same location", () => {
    const prime = state();
    prime.loop.phase = "P6_GOODWILL";
    prime.loop.charCounters.alien.goodwill = 5;
    prime.loop.locIntrigue.City = 2;

    const view = goodwillAbilityViews(prime).find(
      ({ character, abilityIndex }) =>
        character === "alien" && abilityIndex === 1,
    );
    expect(view?.targets).toContainEqual({ kind: "location", at: "City" });

    resolveGoodwillAbility(prime, {
      user: "alien",
      rank: 5,
      abilityIndex: 1,
      target: { kind: "location", at: "City" },
    }, "resolve");
    expect(prime.loop.locIntrigue.City).toBe(1);
    expect(prime.loop.phaseLog?.at(-1)).toMatchObject({
      kind: "goodwillUsed",
      targets: [{ kind: "location", at: "City" }],
      publicChanges: [{
        kind: "counter",
        target: { kind: "location", at: "City" },
        counter: "intrigue",
        delta: -1,
      }],
    });

    const basic = state("basicTragedy");
    basic.loop.phase = "P6_GOODWILL";
    basic.loop.charCounters.alien.goodwill = 5;
    basic.loop.locIntrigue.City = 1;
    expect(goodwillAbilityViews(basic).find(
      ({ character, abilityIndex }) =>
        character === "alien" && abilityIndex === 1,
    )?.targets).not.toContainEqual({ kind: "location", at: "City" });
    expect(() => resolveGoodwillAbility(basic, {
      user: "alien",
      rank: 5,
      abilityIndex: 1,
      target: { kind: "location", at: "City" },
    }, "resolve")).toThrow("requires a corpse in the same location");
    expect(basic.loop.locIntrigue.City).toBe(1);
  });
});

describe("Prime Evil Curse P9 priority", () => {
  it("captures the Curse targets when P8 advances into P9", () => {
    const game = state();
    game.loop.phase = "P8_LEADER_PASS";
    placeExtraCard(game.loop, curse("entry", {
      kind: "location",
      at: "City",
    }));

    advance(game);

    expect(game.loop.phase).toBe("P9_ROUND_END");
    expect(game.loop.roundEndCurseResolution).toMatchObject({
      loop: 1,
      day: 1,
      curses: [{
        instanceId: "entry",
        target: { kind: "location", at: "City" },
      }],
    });
  });

  it("kills all initially possessed living characters in one death batch and detaches every Curse", () => {
    const game = state();
    game.loop.phase = "P9_ROUND_END";
    placeExtraCard(game.loop, curse("boy-curse", {
      kind: "character",
      id: "boyStudent",
    }));
    placeExtraCard(game.loop, curse("girl-curse", {
      kind: "character",
      id: "girlStudent",
    }));

    expect(CURSE_ROUND_END_SOURCE).toContain("at the same time");
    expect(resolveRoundEndCurses(game)).toBe("complete");
    expect(game.loop.board.boyStudent.status).toBe("dead");
    expect(game.loop.board.girlStudent.status).toBe("dead");
    expect(game.loop.roundEvidence?.[0]?.deathBatches?.[0]?.characters)
      .toEqual(["boyStudent", "girlStudent"]);
    expect(game.loop.extraCards.map(({ target }) => target)).toEqual([
      { kind: "location", at: "City" },
      { kind: "location", at: "City" },
    ]);
    expect(game.loop.phaseLog?.[0]).toMatchObject({
      kind: "abilityActivated",
      phase: "P9_ROUND_END",
      systemEffect: "primeEvilCurse",
      publicContext: {
        extraCards: [
          expect.objectContaining({
            instanceId: "boy-curse",
            target: { kind: "character", id: "boyStudent" },
          }),
          expect.objectContaining({
            instanceId: "girl-curse",
            target: { kind: "character", id: "girlStudent" },
          }),
        ],
      },
      publicChanges: expect.arrayContaining([
        expect.objectContaining({
          kind: "extraCard",
          action: "moved",
          from: { kind: "character", id: "boyStudent" },
          to: { kind: "location", at: "City" },
        }),
      ]),
    });
    expect(collectProtagonistObservations(game).some(
      ({ kind }) => kind === "mastermindAbilityResult",
    )).toBe(false);
  });

  it("snapshots P9 state, resolves possessed Curses before pair evidence, then attaches only the initially located Curse", () => {
    const game = state();
    game.loop.phase = "P9_ROUND_END";
    setBoardLocation(game.loop, "alien", "Hospital");
    setBoardLocation(game.loop, "officeWorker", "School");
    placeExtraCard(game.loop, curse("possessed", {
      kind: "character",
      id: "boyStudent",
    }));
    placeExtraCard(game.loop, curse("located", {
      kind: "location",
      at: "City",
    }));

    advance(game);

    expect(game.loop.phase).toBe("P9_ROUND_END");
    expect(game.loop.board.boyStudent.status).toBe("dead");
    expect(game.loop.extraCards.find(({ instanceId }) =>
      instanceId === "possessed"
    )?.target).toEqual({ kind: "location", at: "City" });
    expect(roundEndCurseStage(game)).toBe("location");
    expect(locationCurseChoices(game)).toEqual([{
      instanceId: "located",
      at: "City",
      candidates: ["girlStudent"],
    }]);
    expect(game.loop.roundEvidence).toEqual([{
      day: 1,
      deathBatches: [expect.objectContaining({
        characters: ["boyStudent"],
      })],
    }]);

    advance(game);

    expect(game.loop.day).toBe(2);
    expect(game.loop.extraCards.find(({ instanceId }) =>
      instanceId === "located"
    )?.target).toEqual({ kind: "character", id: "girlStudent" });
    expect(game.loop.extraCards.find(({ instanceId }) =>
      instanceId === "possessed"
    )?.target).toEqual({ kind: "location", at: "City" });
    expect(game.loop.roundEvidence?.[0]?.roundEndPairs).toEqual([]);
  });

  it("offers only living characters for a location Curse and leaves it in place when none live", () => {
    const oneLiving = state();
    oneLiving.loop.phase = "P9_ROUND_END";
    setBoardLife(oneLiving.loop, "boyStudent", false);
    setBoardLocation(oneLiving.loop, "alien", "Hospital");
    setBoardLocation(oneLiving.loop, "officeWorker", "School");
    placeExtraCard(oneLiving.loop, curse("located", {
      kind: "location",
      at: "City",
    }));

    expect(locationCurseChoices(oneLiving)[0]?.candidates)
      .toEqual(["girlStudent"]);
    expect(resolveRoundEndCurses(oneLiving)).toBe("complete");
    expect(oneLiving.loop.extraCards[0]?.target).toEqual({
      kind: "character",
      id: "girlStudent",
    });

    const noneLiving = state();
    noneLiving.loop.phase = "P9_ROUND_END";
    for (const character of Object.keys(noneLiving.loop.board)) {
      setBoardLife(noneLiving.loop, character, false);
    }
    placeExtraCard(noneLiving.loop, curse("stranded", {
      kind: "location",
      at: "City",
    }));
    expect(resolveRoundEndCurses(noneLiving)).toBe("complete");
    expect(noneLiving.loop.extraCards[0]?.target).toEqual({
      kind: "location",
      at: "City",
    });
  });

  it("requires a Mastermind selection among multiple living candidates", () => {
    const game = state();
    game.loop.phase = "P9_ROUND_END";
    setBoardLocation(game.loop, "alien", "Hospital");
    setBoardLocation(game.loop, "officeWorker", "School");
    placeExtraCard(game.loop, curse("located", {
      kind: "location",
      at: "City",
    }));

    expect(() => resolveRoundEndCurses(game)).toThrow(
      "requires a living character target",
    );
    expect(resolveRoundEndCurses(game, { located: "girlStudent" }))
      .toBe("complete");
    expect(game.loop.extraCards[0]?.target).toEqual({
      kind: "character",
      id: "girlStudent",
    });
  });

  it("does not apply Prime Evil Curse handling to other tragedy sets", () => {
    const game = state("mysteryCircle");
    game.loop.phase = "P9_ROUND_END";
    placeExtraCard(game.loop, curse("possessed", {
      kind: "character",
      id: "boyStudent",
    }));

    expect(resolveRoundEndCurses(game)).toBe("complete");
    expect(game.loop.board.boyStudent.status).toBe("alive");
    expect(game.loop.extraCards[0]?.target).toEqual({
      kind: "character",
      id: "boyStudent",
    });
  });
});
