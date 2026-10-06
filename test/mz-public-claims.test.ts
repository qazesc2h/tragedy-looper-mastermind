import { describe, expect, it } from "vitest";

import { adaptTragedyScript } from "../src/data";
import { advanceGame, createGameState } from "../src/engine/game";
import { collectProtagonistObservations } from "../src/engine/hypothesis";
import { resolveRoleReveal } from "../src/engine/role-reveal";

describe("MZ-1 public claims and private facts", () => {
  it("records a public role claim separately from the mastermind resolution", () => {
    const state = createGameState({
      tragedySet: "basicTragedy",
      mainPlot: "murderPlan",
      subPlots: [],
      cast: { girlStudent: "friend" },
      incidents: [],
      loops: 3,
      daysPerLoop: 4,
    });
    state.loop.phase = "P6_GOODWILL";

    expect(resolveRoleReveal(state, "girlStudent")).toBe(true);

    const claim = state.loop.publicInformationThisLoop?.[0];
    const resolution = state.loop.roleRevealResolutionsThisLoop?.[0];
    expect(claim).toMatchObject({
      kind: "roleClaim",
      character: "girlStudent",
      claimedRole: "friend",
    });
    expect(claim).not.toHaveProperty("actualRoleAtReveal");
    expect(claim).not.toHaveProperty("result");
    expect(resolution).toMatchObject({
      character: "girlStudent",
      actualRoleAtReveal: "friend",
      claimedRole: "friend",
      result: "truthful",
    });
    expect(resolution?.observedAt).toEqual(claim?.observedAt);
  });

  it("builds protagonist observations from the claim, not the private fact", () => {
    const state = createGameState({
      tragedySet: "basicTragedy",
      mainPlot: "murderPlan",
      subPlots: [],
      cast: { girlStudent: "friend" },
      incidents: [],
      loops: 3,
      daysPerLoop: 4,
    });
    state.loop.publicInformationThisLoop = [{
      kind: "roleClaim",
      character: "girlStudent",
      claimedRole: "killer",
      loop: 1,
      day: 1,
    }];
    state.loop.roleRevealResolutionsThisLoop = [{
      character: "girlStudent",
      actualRoleAtReveal: "friend",
      claimedRole: "killer",
      result: "ninjaLie",
    }];

    expect(collectProtagonistObservations(state)).toContainEqual(
      expect.objectContaining({
        kind: "roleRevealed",
        character: "girlStudent",
        role: "killer",
      }),
    );
  });

  it("adapts disguised incidents and resolves only the actual incident", () => {
    const scenario = adaptTragedyScript({
      title: "MZ disguised incident fixture",
      tragedySet: "midnightZone",
      mainPlot: ["secretRecord"],
      subPlots: ["loveHateSpiral", "showtimeDeath"],
      cast: { boyStudent: "person", doctor: "person" },
      incidents: [{
        day: 1,
        incident: ["fakeIncident", "hospitalIncident"],
        culprit: "boyStudent",
      }],
      difficultySets: [{ numberOfLoops: 3, difficulty: 1 }],
      daysPerLoop: 4,
    }, { skipValidation: true });
    expect(scenario.incidents).toEqual([expect.objectContaining({
      incident: "hospitalIncident",
      declaredIncident: "hospitalIncident",
      actualIncident: "fakeIncident",
    })]);

    const state = createGameState(scenario);
    state.gamePhase = "ROUND";
    state.loop.phase = "P7_INCIDENT";
    state.loop.charCounters.boyStudent.paranoia = 3;
    state.loop.locIntrigue.School = 2;

    expect(advanceGame(state, undefined, { deferSettlement: true }))
      .toMatchObject({
        occurrences: [{
          declaredIncident: "hospitalIncident",
          actualIncident: "fakeIncident",
          fired: true,
          effectApplied: true,
        }],
      });
    expect(state.pendingLoopEnd?.reason).toBe("protagonistDeath");
    expect(state.loop.phaseLog).toContainEqual(expect.objectContaining({
      kind: "incidentJudged",
      declaredIncident: "hospitalIncident",
      actualIncident: "fakeIncident",
    }));
    expect(collectProtagonistObservations(state)).toContainEqual(
      expect.objectContaining({
        kind: "incidentOccurred",
        incident: "hospitalIncident",
      }),
    );
  });
});
