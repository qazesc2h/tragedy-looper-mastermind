import { describe, expect, it } from "vitest";

import { activeRulePlots } from "../src/engine/active-plots";
import { createGameState } from "../src/engine/game";
import { distanceToLoss } from "../src/engine/loss";
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
});
