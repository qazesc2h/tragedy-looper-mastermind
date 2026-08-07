import { describe, expect, it } from "vitest";

import { initLoop } from "../src/engine/setup";
import { characterLocationInformation } from "../src/ui/character-locations";
import type { GameState, Scenario } from "../src/types";

function createState(): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "murderPlan",
    subPlots: [],
    cast: {
      henchman: "person",
      patient: "person",
      doctor: "person",
    },
    incidents: [],
    loops: 2,
    daysPerLoop: 4,
  };
  const state: GameState = {
    scenario,
    gamePhase: "ROUND",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
  };
  state.loop.loopStartTraitLocationChoices = { henchman: "Shrine" };
  return state;
}

describe("character location information", () => {
  it("marks a multi-location start as a mastermind choice", () => {
    expect(characterLocationInformation(createState(), "henchman"))
      .toMatchObject({
        startLocations: ["City", "School", "Shrine", "Hospital"],
        startLocationIsMastermindChoice: true,
        selectedStartLocation: "Shrine",
      });
  });

  it("lists every patient restriction and reflects doctor rank 3 removal", () => {
    const state = createState();

    expect(characterLocationInformation(state, "patient")).toMatchObject({
      startLocations: ["Hospital"],
      startLocationIsMastermindChoice: false,
      selectedStartLocation: "Hospital",
      forbiddenLocations: ["City", "School", "Shrine"],
      restrictionsRemoved: false,
    });

    state.loop.locationRestrictionsRemoved = ["patient"];
    expect(characterLocationInformation(state, "patient").restrictionsRemoved)
      .toBe(true);
  });
});
