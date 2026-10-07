import { describe, expect, it } from "vitest";

import { incidentParanoia } from "../src/engine/incident";
import { evaluateLoss } from "../src/engine/loss";
import { initLoop } from "../src/engine/setup";
import { PLOT_IMPL } from "../src/impl/plots";
import {
  rolesForTragedySet,
  tragedySetDefinition,
} from "../src/tragedy-sets";
import type { GameState, Scenario } from "../src/types";
import { setBoardLife } from "./helpers";

function stateFor(
  mainPlot: string,
  subPlots: string[] = [],
  cast: Scenario["cast"] = {
    boyStudent: "person",
    girlStudent: "person",
  },
): GameState {
  const scenario: Scenario = {
    tragedySet: "mysteryCircle",
    mainPlot,
    subPlots,
    cast,
    incidents: [],
    loops: 4,
    daysPerLoop: 3,
  };
  return {
    scenario,
    gamePhase: "ROUND",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
  };
}

describe("Mystery Circle tragedy set and plots", () => {
  it("matches the fixed upstream plot and incident lists", () => {
    expect(tragedySetDefinition("mysteryCircle")).toEqual({
      id: "mysteryCircle",
      name: "Mystery Circle",
      numberOfMainPlots: 1,
      numberOfSubPlots: 2,
      mainPlots: [
        "murderPlan",
        "tightropePlan",
        "dropStrychnine",
        "quiltIncidents",
        "blackSchool",
      ],
      subPlots: [
        "hiddenFreak",
        "danceFools",
        "isolatedInstitutionPsycho",
        "anAbsoluteWill",
        "trickyTwins",
        "smellGunpowder",
        "masterDetective",
      ],
      incidents: [
        "serialMurder",
        "hospitalIncident",
        "portent",
        "increasingUnease",
        "terrorism",
        "bestialMurder",
        "suicide",
        "suspiciousLetter",
        "fakedSuicide",
        "closedCircle",
        "silverBullet",
      ],
      hasFinalGuess: true,
    });
  });

  it("supplies all seven new roles through the ten new plots", () => {
    expect(rolesForTragedySet("mysteryCircle")).toEqual(expect.arrayContaining([
      "poisoner",
      "fool",
      "therapist",
      "paranoiac",
      "obstinate",
      "twin",
      "privateInvestigator",
    ]));
    expect(PLOT_IMPL.danceFools.addsRoles).toEqual({ friend: 1, fool: 1 });
    expect(PLOT_IMPL.anAbsoluteWill.addsRoles).toEqual({ obstinate: 1 });
    expect(PLOT_IMPL.trickyTwins.addsRoles).toEqual({
      twin: 1,
      paranoiac: 1,
    });
    expect(PLOT_IMPL.masterDetective.addsRoles).toEqual({
      conspiracyTheorist: 1,
      friend: 1,
      privateInvestigator: 1,
    });
  });

  it("counts intrigue as paranoia only for Strychnine Serial Murder and Suicide", () => {
    const state = stateFor("dropStrychnine");
    state.loop.charCounters.boyStudent.paranoia = 1;
    state.loop.charCounters.boyStudent.intrigue = 2;

    expect(incidentParanoia(state, "boyStudent", "serialMurder")).toBe(3);
    expect(incidentParanoia(state, "boyStudent", "suicide")).toBe(3);
    expect(incidentParanoia(state, "boyStudent", "murder")).toBe(1);

    state.scenario.mainPlot = "murderPlan";
    expect(incidentParanoia(state, "boyStudent", "serialMurder")).toBe(1);
  });

  it("uses the current loop number as Black School's exact intrigue boundary", () => {
    const state = stateFor("blackSchool");
    state.loop.loop = 3;
    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";
    state.loop.locIntrigue.School = 2;

    expect(evaluateLoss(state).some(({ id }) => id === "blackSchool"))
      .toBe(false);
    state.loop.locIntrigue.School = 3;
    expect(evaluateLoss(state)).toContainEqual(expect.objectContaining({
      id: "blackSchool",
      met: true,
    }));
  });

  it("counts only remaining living characters for Smell of Gunpowder", () => {
    const state = stateFor("murderPlan", ["smellGunpowder"]);
    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";
    state.loop.charCounters.boyStudent.paranoia = 6;
    state.loop.charCounters.girlStudent.paranoia = 6;

    expect(evaluateLoss(state)).toContainEqual(expect.objectContaining({
      id: "smellGunpowder",
      met: true,
    }));

    setBoardLife(state.loop, "girlStudent", false);
    expect(evaluateLoss(state).some(({ id }) => id === "smellGunpowder"))
      .toBe(false);
  });
});
