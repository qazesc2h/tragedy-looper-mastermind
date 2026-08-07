import { describe, expect, it } from "vitest";

import { killCharacter, withDeathBatch } from "../src/engine/death";
import { resolveGoodwillAbility } from "../src/engine/goodwill";
import {
  advanceGame,
  chooseInitialLeader,
  continueAfterLoopJudgment,
  continueFromTimeGap,
  createGameState,
  loopStartTraitChoicesComplete,
  settleGameFlow,
  setLoopStartTraitCounterChoice,
  setLoopStartTraitLocationChoice,
  skipToFinalGuess,
  startHouseRuleExtraLoop,
  submitFinalGuess,
} from "../src/engine/game";
import { setOptionalLossActivation } from "../src/engine/loss";
import { validatePlacement } from "../src/engine/legal";
import {
  effectiveRole,
  isCharacterPresent,
  resolvePlaceX,
  type GameState,
  type Scenario,
} from "../src/types";
import {
  boardIsAlive,
  boardLocation,
  setBoardLife,
  setBoardLocation,
} from "./helpers";

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    tragedySet: "basicTragedy",
    mainPlot: "",
    subPlots: [],
    cast: { boyStudent: "person" },
    incidents: [],
    loops: 3,
    daysPerLoop: 3,
    ...overrides,
  };
}

function startRound(state: GameState, leader: 0 | 1 | 2 = 0): void {
  chooseInitialLeader(state, leader);
  continueFromTimeGap(state);
}

describe("game setup and loop preparation", () => {
  it("stops at leader choice, then time gap, and preserves the chosen leader", () => {
    const state = createGameState(scenario());

    expect(state.gamePhase).toBe("SETUP_LEADER");
    chooseInitialLeader(state, 2);
    expect(state.gamePhase).toBe("LOOP_TIME_GAP");
    expect(state.timeGapTimer).toEqual({ remainingSeconds: 600 });

    continueFromTimeGap(state);
    expect(state.gamePhase).toBe("ROUND");
    expect(state.loop.phase).toBe("P2_MASTERMIND_ACTION");
    expect(state.loop.leader).toBe(2);
    expect(state.loop.phaseLog).toEqual([{
      loop: 1,
      day: 1,
      phase: "P1_ROUND_START",
      kind: "notApplicable",
    }]);
    expect(state.loop.spentOncePerLoop).toEqual({
      mastermind: [],
      protagonists: [[], [], []],
    });
  });

  it("keeps the leader and applies LOOP_START effects after counter reset", () => {
    const state = createGameState(scenario({
      mainPlot: "sealedItem",
      subPlots: ["threadsFate"],
      loops: 2,
      daysPerLoop: 1,
    }));
    startRound(state, 2);
    state.loop.charCounters.boyStudent.goodwill = 1;
    state.loop.locIntrigue.Shrine = 2;
    state.loop.phase = "P9_ROUND_END";

    advanceGame(state);
    expect(state.gamePhase).toBe("LOOP_JUDGMENT");
    continueAfterLoopJudgment(state);
    expect(state.gamePhase).toBe("LOOP_TIME_GAP");
    expect(state.loop.loop).toBe(2);
    expect(state.loop.leader).toBe(2);
    expect(state.timeGapTimer).toEqual({ remainingSeconds: 600 });

    continueFromTimeGap(state);
    expect(state.loop.charCounters.boyStudent.goodwill).toBe(0);
    expect(state.loop.charCounters.boyStudent.paranoia).toBe(2);
    expect(state.loop.leader).toBe(2);
  });

  it("applies blackCat's Shrine intrigue after reset in every loop", () => {
    const state = createGameState(scenario({
      mainPlot: "sealedItem",
      cast: { blackCat: "person" },
      loops: 2,
      daysPerLoop: 1,
    }));
    startRound(state);
    expect(state.loop.locIntrigue.Shrine).toBe(1);

    state.loop.locIntrigue.Shrine = 2;
    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);
    expect(state.gamePhase).toBe("LOOP_JUDGMENT");

    continueAfterLoopJudgment(state);
    expect(state.loop.loop).toBe(2);
    expect(state.loop.locIntrigue.Shrine).toBe(0);
    continueFromTimeGap(state);

    expect(state.loop.locIntrigue.Shrine).toBe(1);
  });

  it("places a henchman before its revealed friend loop-start ability", () => {
    const state = createGameState(scenario({
      cast: { henchman: "friend" },
    }));
    state.history.push({
      ...structuredClone(state.loop),
      revealedRoleCharacters: ["henchman"],
    });

    chooseInitialLeader(state, 0);
    setLoopStartTraitLocationChoice(state, "henchman", "Hospital");
    continueFromTimeGap(state);

    expect(boardIsAlive(state.loop, "henchman")).toBe(true);
    expect(state.loop.charCounters.henchman.goodwill).toBe(1);
  });

  it("blocks loop setup until the mastermind chooses henchman's location", () => {
    const state = createGameState(scenario({
      cast: { henchman: "person" },
    }));
    chooseInitialLeader(state, 0);

    expect(loopStartTraitChoicesComplete(state)).toBe(false);
    expect(() => continueFromTimeGap(state)).toThrow(
      "henchman loop-start location choice is required",
    );

    setLoopStartTraitLocationChoice(state, "henchman", "City");
    expect(loopStartTraitChoicesComplete(state)).toBe(true);
    continueFromTimeGap(state);
    expect(boardLocation(state.loop, "henchman")).toBe("City");
  });

  it("uses a fresh henchman start-location choice in every loop", () => {
    const state = createGameState(scenario({
      mainPlot: "sealedItem",
      cast: { henchman: "person" },
      loops: 2,
      daysPerLoop: 1,
    }));
    chooseInitialLeader(state, 0);
    setLoopStartTraitLocationChoice(state, "henchman", "Hospital");
    continueFromTimeGap(state);
    expect(boardLocation(state.loop, "henchman")).toBe("Hospital");

    state.loop.locIntrigue.Shrine = 2;
    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);
    continueAfterLoopJudgment(state);
    expect(state.loop.loopStartTraitLocationChoices).toBeUndefined();

    setLoopStartTraitLocationChoice(state, "henchman", "School");
    continueFromTimeGap(state);
    expect(boardLocation(state.loop, "henchman")).toBe("School");
    expect(state.history[0].loopStartTraitLocationChoices?.henchman)
      .toBe("Hospital");
  });

  it("keeps giantTimeBomb Place X at each loop's chosen henchman start", () => {
    const state = createGameState(scenario({
      mainPlot: "giantTimeBomb",
      cast: { henchman: "witch" },
      loops: 2,
      daysPerLoop: 1,
    }));
    chooseInitialLeader(state, 0);
    setLoopStartTraitLocationChoice(state, "henchman", "Hospital");
    continueFromTimeGap(state);
    expect(resolvePlaceX(state)).toBe("Hospital");

    setBoardLocation(state.loop, "henchman", "School");
    expect(boardLocation(state.loop, "henchman")).toBe("School");
    expect(resolvePlaceX(state)).toBe("Hospital");

    state.loop.locIntrigue.Hospital = 2;
    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);
    continueAfterLoopJudgment(state);
    setLoopStartTraitLocationChoice(state, "henchman", "Shrine");
    continueFromTimeGap(state);

    expect(boardLocation(state.loop, "henchman")).toBe("Shrine");
    expect(resolvePlaceX(state)).toBe("Shrine");
  });

  it("keeps godlyBeing absent until its scripted loop placement", () => {
    const state = createGameState(scenario({
      mainPlot: "sealedItem",
      cast: { godlyBeing: "person" },
      loops: 2,
      daysPerLoop: 1,
      scriptSpecified: { "enters on loop:godlyBeing": 2 },
    }));
    startRound(state);

    expect(isCharacterPresent(state.loop.board.godlyBeing)).toBe(false);
    expect(validatePlacement(state, {
      owner: "mastermind",
      card: "paranoiaPlus1",
      target: { kind: "character", id: "godlyBeing" },
    })).toEqual({
      ok: false,
      reason: "게임판에 없는 캐릭터에게는 행동 카드를 놓을 수 없습니다.",
    });

    state.loop.locIntrigue.Shrine = 2;
    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);
    continueAfterLoopJudgment(state);
    continueFromTimeGap(state);

    expect(state.loop.loop).toBe(2);
    expect(boardIsAlive(state.loop, "godlyBeing")).toBe(true);
  });

  it("keeps godlyBeing present after its entry in an extra loop", () => {
    const state = createGameState(scenario({
      mainPlot: "sealedItem",
      cast: { godlyBeing: "person" },
      loops: 3,
      daysPerLoop: 1,
      scriptSpecified: { "enters on loop:godlyBeing": 3 },
    }));
    chooseInitialLeader(state, 0);
    state.loop.loop = 3;
    continueFromTimeGap(state);
    expect(boardIsAlive(state.loop, "godlyBeing")).toBe(true);

    state.loop.locIntrigue.Shrine = 2;
    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);
    startHouseRuleExtraLoop(state);
    continueFromTimeGap(state);

    expect(state.loop.loop).toBe(4);
    expect(boardIsAlive(state.loop, "godlyBeing")).toBe(true);
  });

  it("makes transferStudent enter on the same scripted day every loop", () => {
    const state = createGameState(scenario({
      mainPlot: "sealedItem",
      cast: { transferStudent: "person" },
      loops: 2,
      daysPerLoop: 2,
      scriptSpecified: { "enters on day:transferStudent": 2 },
    }));
    startRound(state);
    expect(isCharacterPresent(state.loop.board.transferStudent)).toBe(false);

    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);
    expect(state.loop.day).toBe(2);
    expect(boardIsAlive(state.loop, "transferStudent")).toBe(true);

    state.loop.locIntrigue.Shrine = 2;
    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);
    continueAfterLoopJudgment(state);
    continueFromTimeGap(state);
    expect(state.loop.loop).toBe(2);
    expect(state.loop.day).toBe(1);
    expect(isCharacterPresent(state.loop.board.transferStudent)).toBe(false);

    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);
    expect(state.loop.day).toBe(2);
    expect(boardIsAlive(state.loop, "transferStudent")).toBe(true);
  });

  it("rewinds transferStudent before its scripted day in an extra loop", () => {
    const state = createGameState(scenario({
      mainPlot: "sealedItem",
      cast: { transferStudent: "person" },
      loops: 1,
      daysPerLoop: 2,
      scriptSpecified: { "enters on day:transferStudent": 2 },
    }));
    startRound(state);
    expect(isCharacterPresent(state.loop.board.transferStudent)).toBe(false);

    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);
    expect(boardIsAlive(state.loop, "transferStudent")).toBe(true);

    state.loop.locIntrigue.Shrine = 2;
    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);
    startHouseRuleExtraLoop(state);
    continueFromTimeGap(state);

    expect(state.loop.loop).toBe(2);
    expect(state.loop.day).toBe(1);
    expect(isCharacterPresent(state.loop.board.transferStudent)).toBe(false);
  });

  it("blocks goodwill use by and targeting an absent character", () => {
    const state = createGameState(scenario({
      cast: { transferStudent: "person", nurse: "person" },
      scriptSpecified: { "enters on day:transferStudent": 2 },
    }));
    startRound(state);
    state.loop.phase = "P6_GOODWILL";
    state.loop.charCounters.transferStudent.goodwill = 2;
    state.loop.charCounters.nurse.goodwill = 2;

    expect(() => resolveGoodwillAbility(state, {
      user: "transferStudent",
      rank: 2,
      abilityIndex: 1,
      target: "nurse",
    }, "resolve")).toThrow(
      'character "transferStudent" is absent and cannot use goodwill abilities',
    );
    expect(() => resolveGoodwillAbility(state, {
      user: "nurse",
      rank: 2,
      abilityIndex: 0,
      target: "transferStudent",
    }, "resolve")).toThrow(
      "goodwill ability cannot target an absent character",
    );
  });

  it("keeps Shrine intrigue at zero without blackCat", () => {
    const state = createGameState(scenario());
    startRound(state);

    expect(state.loop.locIntrigue.Shrine).toBe(0);
  });

  it.each([
    "paranoia",
    "goodwill",
    "intrigue",
  ] as const)("applies scientist's %s choice through loop setup", (counter) => {
    const state = createGameState(scenario({
      cast: { scientist: "keyPerson" },
    }));
    chooseInitialLeader(state, 0);
    expect(loopStartTraitChoicesComplete(state)).toBe(false);
    expect(() => continueFromTimeGap(state)).toThrow(
      "scientist loop-start counter choice is required",
    );

    setLoopStartTraitCounterChoice(state, "scientist", counter);
    expect(loopStartTraitChoicesComplete(state)).toBe(true);
    continueFromTimeGap(state);

    expect(state.loop.charCounters.scientist).toEqual({
      goodwill: counter === "goodwill" ? 1 : 0,
      paranoia: counter === "paranoia" ? 1 : 0,
      intrigue: counter === "intrigue" ? 1 : 0,
      protection: 0,
    });
  });
});

describe("automatic empty round phases", () => {
  it("skips an unavailable mastermind ability after resolving cards", () => {
    const state = createGameState(scenario());
    startRound(state);
    state.loop.phase = "P4_RESOLVE";

    advanceGame(state);

    expect(state.loop.phase).toBe("P6_GOODWILL");
    expect(state.loop.phaseLog).toContainEqual({
      loop: 1,
      day: 1,
      phase: "P5_MASTERMIND_ABILITY",
      kind: "notApplicable",
    });
  });

  it("stops when a mastermind ability can fire", () => {
    const state = createGameState(scenario({
      cast: { boyStudent: "brain" },
    }));
    startRound(state);
    state.loop.phase = "P4_RESOLVE";

    advanceGame(state);

    expect(state.loop.phase).toBe("P5_MASTERMIND_ABILITY");
    expect(state.loop.phaseLog).not.toContainEqual(
      expect.objectContaining({ phase: "P5_MASTERMIND_ABILITY" }),
    );
  });

  it("skips a day without an incident and automatically passes the leader", () => {
    const state = createGameState(scenario());
    startRound(state);
    state.loop.phase = "P6_GOODWILL";

    advanceGame(state);

    expect(state.loop.phase).toBe("P9_ROUND_END");
    expect(state.loop.leader).toBe(1);
    expect(state.loop.phaseLog).toEqual(expect.arrayContaining([
      {
        loop: 1,
        day: 1,
        phase: "P7_INCIDENT",
        kind: "notApplicable",
      },
      {
        loop: 1,
        day: 1,
        phase: "P8_LEADER_PASS",
        kind: "leaderPassed",
        from: 0,
        to: 1,
      },
    ]));
  });

  it("does not auto-skip a scheduled incident whose condition is unmet", () => {
    const state = createGameState(scenario({
      incidents: [{
        day: 1,
        incident: "foulEvil",
        culprit: "boyStudent",
      }],
    }));
    startRound(state);
    state.loop.phase = "P6_GOODWILL";

    advanceGame(state);
    expect(state.loop.phase).toBe("P7_INCIDENT");
    expect(state.loop.phaseLog).not.toContainEqual(
      expect.objectContaining({ phase: "P7_INCIDENT" }),
    );

    expect(advanceGame(state)).toEqual({
      incident: "foulEvil",
      culprit: "boyStudent",
      fired: false,
      effectApplied: false,
    });
    expect(state.loop.phase).toBe("P9_ROUND_END");
    expect(state.loop.phaseLog).toContainEqual({
      loop: 1,
      day: 1,
      phase: "P7_INCIDENT",
      kind: "incidentJudged",
      incident: "foulEvil",
      culprit: "boyStudent",
      fired: false,
      effectApplied: false,
      failureReasons: ["insufficientParanoia"],
    });
  });

  it("records an absent culprit as the reason an incident did not fire", () => {
    const state = createGameState(scenario({
      cast: { transferStudent: "person" },
      incidents: [{
        day: 1,
        incident: "foulEvil",
        culprit: "transferStudent",
      }],
      scriptSpecified: { "enters on day:transferStudent": 2 },
    }));
    startRound(state);
    state.loop.phase = "P6_GOODWILL";

    advanceGame(state);
    expect(state.loop.phase).toBe("P7_INCIDENT");
    expect(advanceGame(state)).toEqual({
      incident: "foulEvil",
      culprit: "transferStudent",
      fired: false,
      effectApplied: false,
    });
    expect(state.loop.phaseLog).toContainEqual({
      loop: 1,
      day: 1,
      phase: "P7_INCIDENT",
      kind: "incidentJudged",
      incident: "foulEvil",
      culprit: "transferStudent",
      fired: false,
      effectApplied: false,
      failureReasons: ["culpritAbsent"],
    });
  });
});

describe("immediate loop interruption and judgment", () => {
  it("ends immediately but still reveals a simultaneously dead friend (FAQ Q20)", () => {
    const state = createGameState(scenario({
      cast: {
        boyStudent: "keyPerson",
        boss: "friend",
      },
    }));
    startRound(state);
    state.loop.phase = "P7_INCIDENT";
    withDeathBatch(state, () => {
      expect(killCharacter(state, "boyStudent")).toBe(true);
      expect(killCharacter(state, "boss")).toBe(true);
    });

    settleGameFlow(state);

    expect(state.gamePhase).toBe("LOOP_JUDGMENT");
    expect(state.loop.phase).toBe("P7_INCIDENT");
    expect(state.history).toHaveLength(1);
    expect(state.history[0].revealedRoleCharacters).toEqual(["boss"]);
    expect(state.loopOutcomes[0].losses.map(({ id }) => id)).toEqual(
      expect.arrayContaining(["keyPerson", "friend"]),
    );
    expect(() => advanceGame(state)).toThrow(
      "round phase cannot advance during LOOP_JUDGMENT",
    );

    settleGameFlow(state);
    expect(state.history).toHaveLength(1);
    expect(state.loopOutcomes).toHaveLength(1);
  });

  it("keeps a manual keyPerson death deferred through P2, P3, and P4 until P9", () => {
    const state = createGameState(scenario({
      cast: { boyStudent: "keyPerson" },
    }));
    startRound(state);
    expect(state.loop.phase).toBe("P2_MASTERMIND_ACTION");

    setBoardLife(state.loop, "boyStudent", false);
    expect(settleGameFlow(state)).toBeUndefined();
    expect(state.loop.pendingImmediateLossKeys).toBeUndefined();
    expect(state.gamePhase).toBe("ROUND");

    advanceGame(state);
    expect(state.loop.phase).toBe("P3_PROTAGONIST_ACTION");
    expect(state.gamePhase).toBe("ROUND");
    advanceGame(state);
    expect(state.loop.phase).toBe("P4_RESOLVE");
    expect(state.gamePhase).toBe("ROUND");
    advanceGame(state);
    expect(state.gamePhase).toBe("ROUND");

    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);
    expect(state.gamePhase).toBe("LOOP_JUDGMENT");
    expect(state.loopOutcomes[0].losses).toContainEqual(
      expect.objectContaining({ id: "keyPerson" }),
    );
  });

  it("does not retain an immediate loss after a manual death is corrected", () => {
    const state = createGameState(scenario({
      cast: { boyStudent: "keyPerson" },
    }));
    startRound(state);

    setBoardLife(state.loop, "boyStudent", false);
    expect(settleGameFlow(state)).toBeUndefined();
    setBoardLife(state.loop, "boyStudent", true);
    expect(settleGameFlow(state)).toBeUndefined();
    expect(state.loop.pendingImmediateLossKeys).toBeUndefined();

    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);
    expect(state.gamePhase).toBe("ROUND");
    expect(state.loop.day).toBe(2);
  });

  it("does not promote a prior manual death when an unrelated character dies", () => {
    const state = createGameState(scenario({
      cast: { boyStudent: "keyPerson", boss: "person" },
    }));
    startRound(state);
    setBoardLife(state.loop, "boyStudent", false);

    expect(killCharacter(state, "boss")).toBe(true);
    expect(state.loop.pendingImmediateLossKeys).toBeUndefined();
    expect(settleGameFlow(state)).toBeUndefined();
    expect(state.gamePhase).toBe("ROUND");
  });

  it("still ends immediately when killCharacter kills a keyPerson", () => {
    const state = createGameState(scenario({
      cast: { boyStudent: "keyPerson" },
    }));
    startRound(state);

    expect(killCharacter(state, "boyStudent")).toBe(true);
    expect(state.loop.pendingImmediateLossKeys).toEqual([
      "role:keyPerson:boyStudent",
    ]);
    settleGameFlow(state);

    expect(state.gamePhase).toBe("LOOP_JUDGMENT");
  });

  it("does not end when protagonist death is blocked", () => {
    const state = createGameState(scenario({
      cast: { soldier: "person", girlStudent: "killer" },
    }));
    startRound(state);
    state.loop.phase = "P9_ROUND_END";
    state.loop.charCounters.girlStudent.intrigue = 4;
    state.loop.protagonistDeathPreventedBy = ["soldier"];
    const condition = setOptionalLossActivation(
      state,
      "role:killer:girlStudent",
      true,
    );

    expect(condition).toEqual({ died: false, blockedBy: "soldier" });
    expect(state.pendingLoopEnd).toBeUndefined();
    expect(settleGameFlow(state)).toBeUndefined();
    expect(state.gamePhase).toBe("ROUND");
  });

  it("resolves P9 mandatory effects before accepting an optional loss", () => {
    const state = createGameState(scenario({
      cast: { informer: "timeTraveler" },
      daysPerLoop: 1,
    }));
    startRound(state);
    state.loop.phase = "P9_ROUND_END";
    state.loop.charCounters.informer.goodwill = 2;

    advanceGame(state);
    expect(state.gamePhase).toBe("ROUND");
    expect(state.loop.phase).toBe("P9_ROUND_END");
    expect(state.loop.roundEndMandatoryResolved).toBe(true);

    setOptionalLossActivation(
      state,
      "role:timeTraveler:informer",
      true,
    );
    settleGameFlow(state);

    expect(state.gamePhase).toBe("LOOP_JUDGMENT");
    expect(state.loopOutcomes[0].losses).toContainEqual(
      expect.objectContaining({ id: "timeTraveler" }),
    );
  });
});

describe("last-day outcomes", () => {
  it("ends the whole game when no loss condition is met", () => {
    const state = createGameState(scenario({ loops: 3, daysPerLoop: 1 }));
    startRound(state);
    state.loop.phase = "P9_ROUND_END";

    advanceGame(state);

    expect(state.gamePhase).toBe("GAME_OVER");
    expect(state.result).toEqual({
      winner: "protagonists",
      reason: "loopVictory",
    });
    expect(state.loopOutcomes).toEqual([expect.objectContaining({
      loop: 1,
      result: "protagonistsWon",
      losses: [],
    })]);
    expect(state.loop.loop).toBe(1);
  });

  it("records a loss and goes to the next loop only after judgment", () => {
    const state = createGameState(scenario({
      mainPlot: "sealedItem",
      loops: 2,
      daysPerLoop: 1,
    }));
    startRound(state, 1);
    state.loop.locIntrigue.Shrine = 2;
    state.loop.phase = "P9_ROUND_END";

    advanceGame(state);

    expect(state.gamePhase).toBe("LOOP_JUDGMENT");
    expect(state.loopOutcomes[0]).toEqual(expect.objectContaining({
      result: "protagonistsLost",
      losses: [expect.objectContaining({ id: "sealedItem" })],
    }));
    expect(state.loop.loop).toBe(1);

    continueAfterLoopJudgment(state);
    expect(state.gamePhase).toBe("LOOP_TIME_GAP");
    expect(state.loop.loop).toBe(2);
    expect(state.loop.leader).toBe(1);
  });

  it("sends a final-loop loss to the final guess", () => {
    const state = createGameState(scenario({
      mainPlot: "sealedItem",
      loops: 1,
      daysPerLoop: 1,
    }));
    startRound(state);
    state.loop.locIntrigue.Shrine = 2;
    state.loop.phase = "P9_ROUND_END";

    advanceGame(state);
    expect(state.gamePhase).toBe("LOOP_JUDGMENT");
    continueAfterLoopJudgment(state);

    expect(state.gamePhase).toBe("FINAL_GUESS");
    expect(state.finalGuess).toEqual({
      reason: "finalLoopLoss",
      attempts: [],
    });
  });

  it("starts repeatable house-rule extra loops after the final loop", () => {
    const state = createGameState(scenario({
      mainPlot: "sealedItem",
      loops: 1,
      daysPerLoop: 1,
    }));
    startRound(state, 2);
    state.loop.locIntrigue.Shrine = 2;
    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);

    startHouseRuleExtraLoop(state);
    expect(state.gamePhase).toBe("LOOP_TIME_GAP");
    expect(state.loop.loop).toBe(2);
    expect(state.loop.leader).toBe(2);
    expect(state.extraLoopsPlayed).toBe(1);
    expect(state.timeGapTimer).toEqual({ remainingSeconds: 600 });
    expect(state.history.map(({ loop }) => loop)).toEqual([1]);

    continueFromTimeGap(state);
    state.loop.locIntrigue.Shrine = 2;
    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);
    startHouseRuleExtraLoop(state);

    expect(state.loop.loop).toBe(3);
    expect(state.extraLoopsPlayed).toBe(2);
    expect(state.history.map(({ loop }) => loop)).toEqual([1, 2]);
  });

  it("rejects a house-rule extra loop before the scripted final loop", () => {
    const state = createGameState(scenario({
      mainPlot: "sealedItem",
      loops: 2,
      daysPerLoop: 1,
    }));
    startRound(state);
    state.loop.locIntrigue.Shrine = 2;
    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);

    expect(() => startHouseRuleExtraLoop(state)).toThrow(
      "an extra loop can start only after the final loop",
    );
  });

  it("applies threadsFate history normally in a house-rule extra loop", () => {
    const state = createGameState(scenario({
      mainPlot: "sealedItem",
      subPlots: ["threadsFate"],
      loops: 1,
      daysPerLoop: 1,
    }));
    startRound(state);
    state.loop.charCounters.boyStudent.goodwill = 1;
    state.loop.locIntrigue.Shrine = 2;
    state.loop.phase = "P9_ROUND_END";
    advanceGame(state);

    startHouseRuleExtraLoop(state);
    continueFromTimeGap(state);

    expect(state.loop.loop).toBe(2);
    expect(state.loop.charCounters.boyStudent.paranoia).toBe(2);
  });
});

describe("final guess", () => {
  it("judges mysteryBoy by the plot-less role actually assigned", () => {
    const state = createGameState(scenario({
      cast: { mysteryBoy: "witch" },
    }));
    chooseInitialLeader(state, 0);
    skipToFinalGuess(state);

    const attempt = submitFinalGuess(state, "mysteryBoy", "witch");

    expect(attempt).toMatchObject({
      character: "mysteryBoy",
      guessedRole: "witch",
      actualRole: "witch",
      correct: true,
    });
    expect(state.gamePhase).toBe("GAME_OVER");
  });

  it("requires every scenario character, including a person", () => {
    const state = createGameState(scenario({
      cast: {
        boyStudent: "keyPerson",
        officeWorker: "person",
      },
    }));
    chooseInitialLeader(state, 0);
    skipToFinalGuess(state);

    expect(submitFinalGuess(state, "boyStudent", "keyPerson").correct)
      .toBe(true);
    expect(state.gamePhase).toBe("FINAL_GUESS");
    expect(submitFinalGuess(state, "officeWorker", "person").correct)
      .toBe(true);
    expect(state.gamePhase).toBe("GAME_OVER");
    expect(state.result).toEqual({
      winner: "protagonists",
      reason: "finalGuessSuccess",
    });
  });

  it("gives the mastermind the game on the first wrong answer", () => {
    const state = createGameState(scenario());
    chooseInitialLeader(state, 0);
    skipToFinalGuess(state);

    expect(submitFinalGuess(state, "boyStudent", "serialKiller").correct)
      .toBe(false);
    expect(state.result).toEqual({
      winner: "mastermind",
      reason: "finalGuessFailure",
    });
    expect(state.gamePhase).toBe("GAME_OVER");
  });

  it("resets paranoiaVirus before judging a transformed person as person", () => {
    const state = createGameState(scenario({
      mainPlot: "sealedItem",
      subPlots: ["paranoiaVirus"],
      loops: 1,
      daysPerLoop: 1,
    }));
    startRound(state);
    state.loop.charCounters.boyStudent.paranoia = 3;
    state.loop.locIntrigue.Shrine = 2;
    state.loop.phase = "P9_ROUND_END";
    expect(effectiveRole(state, "boyStudent")).toBe("serialKiller");

    advanceGame(state);
    continueAfterLoopJudgment(state);

    expect(state.gamePhase).toBe("FINAL_GUESS");
    expect(state.loop.charCounters.boyStudent.paranoia).toBe(0);
    expect(boardIsAlive(state.loop, "boyStudent")).toBe(true);
    expect(effectiveRole(state, "boyStudent")).toBe("person");
    expect(submitFinalGuess(state, "boyStudent", "person").correct).toBe(true);
  });
});
