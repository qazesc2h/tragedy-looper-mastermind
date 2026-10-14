import { describe, expect, it } from "vitest";

import { activeRulePlots } from "../src/engine/active-plots";
import { createGameState } from "../src/engine/game";
import { advanceGame } from "../src/engine/game";
import { distanceToLoss } from "../src/engine/loss";
import { resolveActions } from "../src/engine/resolve";
import { validateScenario } from "../src/engine/validate";
import { TRAGEDY_SETS } from "../src/tragedy-sets";
import type { GameState, PlotId, Scenario } from "../src/types";

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    tragedySet: "cosmicMythology",
    mainPlot: "kingYellow",
    subPlots: ["peopleWhoSaw", "greatRace"],
    cast: {
      boyStudent: "sacrifice",
      girlStudent: "cultist",
      officeWorker: "conspiracyTheorist",
      informer: "witness",
      doctor: "serialKiller",
      patient: "timeTraveler",
    },
    incidents: [{ day: 2, incident: "missingPerson", culprit: "boyStudent" }],
    loops: 3,
    daysPerLoop: 3,
    ...overrides,
  };
}

function loss(state: GameState, plot: PlotId) {
  return distanceToLoss(state).find((candidate) => candidate.id === plot);
}

describe("Cosmic Mythology rules", () => {
  it("registers exactly five main plots and seven subplots", () => {
    expect(TRAGEDY_SETS.cosmicMythology.mainPlots).toHaveLength(5);
    expect(TRAGEDY_SETS.cosmicMythology.subPlots).toHaveLength(7);
    expect(TRAGEDY_SETS.cosmicMythology.hasFinalGuess).toBe(true);
  });

  it("uses increasedThisLoop, not the current gauge value, for the King in Yellow", () => {
    const state = createGameState(scenario());
    state.loop.specialGauge!.value = 4;
    expect(loss(state, "kingYellow")?.met).toBe(false);
    state.loop.specialGauge!.increasedThisLoop = true;
    expect(loss(state, "kingYellow")?.met).toBe(true);
    state.loop.specialGauge!.value = 0;
    expect(loss(state, "kingYellow")?.met).toBe(true);
  });

  it("evaluates each other main-plot loss from the current loop state", () => {
    const choir = createGameState(scenario({ mainPlot: "choirOuterGod" }));
    for (const character of Object.keys(choir.scenario.cast).slice(0, 5)) {
      choir.loop.charCounters[character].intrigue = 1;
    }
    expect(loss(choir, "choirOuterGod")?.met).toBe(true);

    const dagon = createGameState(scenario({ mainPlot: "sacredWordsDagon" }));
    dagon.loop.specialGauge!.value = 2;
    dagon.loop.locIntrigue.Shrine = 2;
    expect(loss(dagon, "sacredWordsDagon")?.met).toBe(true);

    const bomb = createGameState(scenario({
      mainPlot: "giantTimeBombAgain",
      cast: { ...scenario().cast, shrineMaiden: "witch" },
    }));
    bomb.loop.locIntrigue.Shrine = 2;
    expect(loss(bomb, "giantTimeBombAgain")?.met).toBe(true);

    const rites = createGameState(scenario({ mainPlot: "bloodyRites" }));
    rites.loop.specialGauge!.value = 1;
    rites.loop.board.boyStudent = { status: "dead", at: "School" };
    expect(loss(rites, "bloodyRites")?.met).toBe(true);
  });

  it("replaces only the main plot at loop start when Twisted Truth reaches two", () => {
    const state = createGameState(scenario({
      mainPlot: "kingYellow",
      subPlots: ["twistedTruth", "greatRace"],
      scriptSpecified: { "Extra Plot": "bloodyRites" },
    }));
    expect(activeRulePlots(state)).toEqual([
      "kingYellow",
      "twistedTruth",
      "greatRace",
    ]);
    state.loop.specialGauge!.value = 2;
    expect(activeRulePlots(state)).toEqual([
      "bloodyRites",
      "twistedTruth",
      "greatRace",
    ]);
    expect(loss(state, "kingYellow")).toBeUndefined();
    expect(loss(state, "bloodyRites")).toBeDefined();
  });

  it("requires Informer and a valid extra main plot for Twisted Truth", () => {
    const invalid = scenario({
      subPlots: ["twistedTruth", "greatRace"],
      cast: { boyStudent: "sacrifice" },
    });
    expect(validateScenario(invalid).diagnostics.map(({ code }) => code))
      .toEqual(expect.arrayContaining([
        "TWISTED_TRUTH_INFORMER_MISSING",
        "TWISTED_TRUTH_EXTRA_PLOT_INVALID",
      ]));

    const valid = scenario({
      subPlots: ["twistedTruth", "greatRace"],
      scriptSpecified: { "Extra Plot": "bloodyRites" },
    });
    expect(validateScenario(valid).diagnostics.map(({ code }) => code))
      .not.toContain("TWISTED_TRUTH_EXTRA_PLOT_INVALID");
  });

  it("unlocks cumulative spells from the current gauge without adding a phase", () => {
    const sympathy = createGameState(scenario());
    sympathy.gamePhase = "ROUND";
    sympathy.loop.specialGauge!.value = 1;
    advanceGame(sympathy, undefined, { sympathySpellTarget: "girlStudent" });
    expect(sympathy.loop.charCounters.girlStudent.goodwill).toBe(2);
    expect(sympathy.loop.phase).toBe("P2_MASTERMIND_ACTION");

    const reminiscence = createGameState(scenario());
    reminiscence.gamePhase = "ROUND";
    reminiscence.loop.specialGauge!.value = 2;
    reminiscence.loop.day = reminiscence.scenario.daysPerLoop;
    reminiscence.loop.phase = "P9_ROUND_END";
    advanceGame(reminiscence);
    advanceGame(reminiscence);
    expect(reminiscence.history[0].publicInformationThisLoop).toContainEqual(
      expect.objectContaining({
        kind: "subplot",
        source: "reminiscenceForefathers",
        revealedSubplot: "peopleWhoSaw",
      }),
    );

    const madness = createGameState(scenario());
    madness.gamePhase = "ROUND";
    madness.loop.specialGauge!.value = 4;
    madness.loop.phase = "P9_ROUND_END";
    advanceGame(madness);
    if (madness.gamePhase === "ROUND") advanceGame(madness);
    expect(madness.gamePhase).toBe("FINAL_GUESS");
    expect(madness.finalGuess?.reason).toBe("madnessSpell");
    expect(madness.loopOutcomes[0].losses).toContainEqual(
      expect.objectContaining({ key: "spell:madness" }),
    );
  });

  it("keeps multiple Protagonist intrigue forbids active only at spell level three", () => {
    const placed = [
      { owner: 0 as const, card: "forbidIntrigue" as const, target: { kind: "character" as const, id: "boyStudent" } },
      { owner: 1 as const, card: "forbidIntrigue" as const, target: { kind: "character" as const, id: "boyStudent" } },
      { owner: "mastermind" as const, card: "intriguePlus1" as const, target: { kind: "character" as const, id: "boyStudent" } },
    ];

    const below = createGameState(scenario());
    below.loop.specialGauge!.value = 2;
    below.loop.placed = placed;
    resolveActions(below);
    expect(below.loop.charCounters.boyStudent.intrigue).toBe(1);

    const unlocked = createGameState(scenario());
    unlocked.loop.specialGauge!.value = 3;
    unlocked.loop.placed = placed;
    resolveActions(unlocked);
    expect(unlocked.loop.charCounters.boyStudent.intrigue).toBe(0);
  });
});
