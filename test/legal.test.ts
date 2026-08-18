import { describe, expect, it } from "vitest";

import { validatePlacement } from "../src/engine/legal";
import { initLoop } from "../src/engine/setup";
import type {
  GameState,
  PlacedCard,
  Scenario,
} from "../src/types";
import { setBoardLife } from "./helpers";

function createState(): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "",
    subPlots: [],
    cast: {
      boyStudent: "person",
      girlStudent: "person",
    },
    incidents: [],
    loops: 1,
    daysPerLoop: 1,
  };
  return {
    scenario,
    gamePhase: "ROUND",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
  };
}

function characterPlacement(
  owner: PlacedCard["owner"],
  card: PlacedCard["card"],
  id = "boyStudent",
): PlacedCard {
  return {
    owner,
    card,
    target: { kind: "character", id },
  };
}

function locationPlacement(
  owner: PlacedCard["owner"],
  card: PlacedCard["card"],
): PlacedCard {
  return {
    owner,
    card,
    target: { kind: "location", at: "Shrine" },
  };
}

describe("mastermind target duplication", () => {
  it("rejects a second mastermind card on the same character", () => {
    const state = createState();
    state.loop.placed.push(
      characterPlacement("mastermind", "paranoiaPlus1"),
    );

    expect(validatePlacement(
      state,
      characterPlacement("mastermind", "intriguePlus1"),
    )).toEqual({
      ok: false,
      reason: "각본가는 같은 대상에 행동 카드를 2장 이상 놓을 수 없습니다.",
    });
  });

  it("rejects a second mastermind card on the same location", () => {
    const state = createState();
    state.loop.placed.push(
      locationPlacement("mastermind", "intriguePlus1"),
    );

    expect(validatePlacement(
      state,
      locationPlacement("mastermind", "moveVertical"),
    ).ok).toBe(false);
  });

  it("allows a mastermind card over a protagonist card", () => {
    const state = createState();
    state.loop.placed.push(characterPlacement(0, "goodwillPlus1"));

    expect(validatePlacement(
      state,
      characterPlacement("mastermind", "paranoiaPlus1"),
    )).toEqual({ ok: true });
  });
});

describe("protagonist target duplication", () => {
  it("rejects protagonist cards sharing the same character", () => {
    const state = createState();
    state.loop.placed.push(characterPlacement(0, "goodwillPlus1"));

    expect(validatePlacement(
      state,
      characterPlacement(1, "paranoiaMinus1"),
    )).toEqual({
      ok: false,
      reason: "주인공끼리는 같은 대상에 행동 카드를 중복해서 놓을 수 없습니다.",
    });
  });

  it("rejects protagonist cards sharing the same location", () => {
    const state = createState();
    state.loop.placed.push(locationPlacement(0, "forbidIntrigue"));

    expect(validatePlacement(
      state,
      locationPlacement(2, "goodwillPlus1"),
    ).ok).toBe(false);
  });

  it("allows a protagonist card over a mastermind card", () => {
    const state = createState();
    state.loop.placed.push(
      characterPlacement("mastermind", "paranoiaPlus1"),
    );

    expect(validatePlacement(
      state,
      characterPlacement(1, "paranoiaMinus1"),
    )).toEqual({ ok: true });
  });
});

describe("dead character targets", () => {
  it("rejects a card placed on a dead character", () => {
    const state = createState();
    setBoardLife(state.loop, "boyStudent", false);

    expect(validatePlacement(
      state,
      characterPlacement(0, "goodwillPlus1"),
    )).toEqual({
      ok: false,
      reason: "사망한 캐릭터에게는 행동 카드를 놓을 수 없습니다.",
    });
  });

  it("allows a card placed on a living character", () => {
    const state = createState();

    expect(validatePlacement(
      state,
      characterPlacement(0, "goodwillPlus1"),
    )).toEqual({ ok: true });
  });
});

describe("illusion targets", () => {
  it("rejects every action card placed directly on illusion", () => {
    const state = createState();
    state.scenario.cast.illusion = "person";
    state.loop.board.illusion = { status: "alive", at: "Shrine" };
    state.loop.charCounters.illusion = {
      goodwill: 0,
      paranoia: 0,
      intrigue: 0,
      protection: 0,
    };

    expect(validatePlacement(
      state,
      characterPlacement("mastermind", "paranoiaPlus1", "illusion"),
    )).toEqual({
      ok: false,
      reason: "환상에게는 행동 카드를 직접 놓을 수 없습니다.",
    });
  });
});

describe("location targets", () => {
  it("allows cards that have an effect on a location", () => {
    const state = createState();

    expect(validatePlacement(
      state,
      locationPlacement(0, "forbidIntrigue"),
    )).toEqual({ ok: true });
    expect(validatePlacement(
      state,
      locationPlacement("mastermind", "intriguePlus2"),
    )).toEqual({ ok: true });
  });

  it("allows an ineffective location card as a mastermind bluff", () => {
    const state = createState();

    expect(validatePlacement(
      state,
      locationPlacement("mastermind", "moveVertical"),
    )).toEqual({ ok: true });
  });
});

describe("once-per-loop cards", () => {
  it("rejects a protagonist card spent by that protagonist", () => {
    const state = createState();
    state.loop.spentOncePerLoop.protagonists[0].push("goodwillPlus2");

    expect(validatePlacement(
      state,
      characterPlacement(0, "goodwillPlus2"),
    )).toEqual({
      ok: false,
      reason: "이미 사용한 1루프당 1회 카드는 다시 낼 수 없습니다.",
    });
  });

  it("allows the same card from a protagonist who has not spent it", () => {
    const state = createState();
    state.loop.spentOncePerLoop.protagonists[0].push("goodwillPlus2");

    expect(validatePlacement(
      state,
      characterPlacement(1, "goodwillPlus2"),
    )).toEqual({ ok: true });
  });

  it("rejects a spent mastermind card", () => {
    const state = createState();
    state.loop.spentOncePerLoop.mastermind.push("moveDiagonal");

    expect(validatePlacement(
      state,
      characterPlacement("mastermind", "moveDiagonal"),
    )).toEqual({
      ok: false,
      reason: "이미 사용한 1루프당 1회 카드는 다시 낼 수 없습니다.",
    });
  });

  it("allows an unspent mastermind card", () => {
    const state = createState();

    expect(validatePlacement(
      state,
      characterPlacement("mastermind", "moveDiagonal"),
    )).toEqual({ ok: true });
  });
});
