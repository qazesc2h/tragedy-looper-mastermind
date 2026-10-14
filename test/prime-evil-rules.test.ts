import { describe, expect, it } from "vitest";

import {
  activeLoopStartCursePlots,
  continueFromTimeGap,
  setLoopStartCursePlacement,
} from "../src/engine/game";
import {
  collectProtagonistObservations,
  evaluateStateRoleTableHypotheses,
} from "../src/engine/hypothesis";
import { evaluateLoss } from "../src/engine/loss";
import { applyHookEffect, collectHooks, advance } from "../src/engine/phases";
import { initLoop } from "../src/engine/setup";
import { validateScenario } from "../src/engine/validate";
import { PLOT_IMPL } from "../src/impl/plots";
import {
  rolesForTragedySet,
  tragedySetDefinition,
} from "../src/tragedy-sets";
import { startLocationOf, type GameState, type Scenario } from "../src/types";
import { setBoardLocation } from "./helpers";

function primeState(
  mainPlot: string,
  subPlots: string[],
  cast: Scenario["cast"],
): GameState {
  const scenario: Scenario = {
    tragedySet: "primeEvil",
    mainPlot,
    subPlots,
    cast,
    incidents: [],
    loops: 3,
    daysPerLoop: 4,
  };
  return {
    scenario,
    gamePhase: "ROUND",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
  };
}

describe("Prime Evil tragedy set and rules", () => {
  it("matches the fixed upstream rule, role, and incident lists", () => {
    expect(tragedySetDefinition("primeEvil")).toEqual({
      id: "primeEvil",
      name: "Prime Evil",
      numberOfMainPlots: 1,
      numberOfSubPlots: 2,
      mainPlots: [
        "nobleBloodline",
        "moonlightBeast",
        "nightMistNightmare",
        "OnesFromGrave",
        "cursedLand",
      ],
      subPlots: [
        "thoseHabits",
        "loveAffair",
        "witchsCurse",
        "keyGirl",
        "monsterIntrigue",
        "panicObsession",
        "peopleDontListen",
      ],
      additionalRoles: ["zombie"],
      incidents: [
        "sacrilegiousMurder",
        "increasingUnease",
        "missingPerson",
        "evilContamination",
        "executioner",
        "darkRumor",
        "barricade",
        "nightMadness",
        "awakenedCurse",
        "fountainFilth",
        "evangeliumDead",
      ],
      hasFinalGuess: true,
    });
    expect(rolesForTragedySet("primeEvil")).toEqual(expect.arrayContaining([
      "vampire",
      "werewolf",
      "nightmare",
      "ghost",
      "showOff",
      "coward",
      "zombie",
    ]));
  });

  it("enforces Noble Bloodline opposite sex and Key Girl's girl tag", () => {
    const noble = {
      tragedySet: "primeEvil",
      mainPlot: "nobleBloodline",
      subPlots: ["thoseHabits", "loveAffair"],
      cast: { boyStudent: "keyPerson", officeWorker: "vampire" },
      incidents: [],
      loops: 3,
      daysPerLoop: 4,
    };
    expect(validateScenario(noble).diagnostics.some(
      ({ code }) => code === "NOBLE_BLOODLINE_SAME_SEX",
    )).toBe(true);
    expect(validateScenario({
      ...noble,
      cast: { girlStudent: "keyPerson", officeWorker: "vampire" },
    }).diagnostics.some(
      ({ code }) => code === "NOBLE_BLOODLINE_SAME_SEX",
    )).toBe(false);

    expect(validateScenario({
      ...noble,
      mainPlot: "moonlightBeast",
      subPlots: ["keyGirl", "loveAffair"],
      cast: { officeWorker: "keyPerson", patient: "werewolf" },
    }).diagnostics.some(
      ({ code }) => code === "KEY_GIRL_KEY_PERSON_NOT_GIRL",
    )).toBe(true);
  });

  it("places selected loop-start Curses at the role holder's starting location and records public inference evidence", () => {
    const game = primeState(
      "cursedLand",
      ["panicObsession", "keyGirl"],
      { richStudent: "ghost", boyStudent: "showOff", girlStudent: "keyPerson" },
    );
    game.gamePhase = "LOOP_TIME_GAP";

    expect(activeLoopStartCursePlots(game)).toEqual(["cursedLand"]);
    setLoopStartCursePlacement(game, "cursedLand", true);
    continueFromTimeGap(game);

    expect(game.loop.extraCards).toContainEqual(expect.objectContaining({
      cardId: "curse",
      source: { kind: "rule", id: "cursedLand" },
      target: {
        kind: "location",
        at: startLocationOf("richStudent", game.scenario),
      },
    }));
    const observations = collectProtagonistObservations(game);
    expect(observations).toContainEqual(expect.objectContaining({
      kind: "mastermindAbilityResult",
      timing: "LOOP_START",
      changes: [expect.objectContaining({
        kind: "extraCard",
        action: "placed",
      })],
    }));
    const hypotheses = evaluateStateRoleTableHypotheses(game);
    expect(hypotheses.remaining.length).toBeGreaterThan(0);
    expect(hypotheses.remaining.every(({ mainPlot, subPlots }) =>
      mainPlot === "cursedLand" || subPlots.includes("witchsCurse")
    )).toBe(true);
  });

  it("uses Monster Intrigue only at refusal-role locations, once per day and twice per loop", () => {
    const game = primeState(
      "moonlightBeast",
      ["monsterIntrigue", "witchsCurse"],
      { boyStudent: "witch", girlStudent: "person", patient: "curmudgeon" },
    );
    setBoardLocation(game.loop, "boyStudent", "City");
    setBoardLocation(game.loop, "girlStudent", "School");
    setBoardLocation(game.loop, "patient", "Hospital");
    game.loop.phase = "P5_MASTERMIND_ABILITY";
    const hook = PLOT_IMPL.monsterIntrigue.hooks[0];

    expect(hook.selectableTargets?.(game, "")).toEqual(expect.arrayContaining([
      { kind: "location", at: "City" },
      { kind: "location", at: "Hospital" },
    ]));
    applyHookEffect(game, "P5_MASTERMIND_ABILITY", hook, "", {
      kind: "location",
      at: "City",
    });
    expect(game.loop.locIntrigue.City).toBe(1);
    expect(hook.when(game, "")).toBe(false);

    game.loop.day = 2;
    expect(hook.when(game, "")).toBe(true);
    applyHookEffect(game, "P5_MASTERMIND_ABILITY", hook, "", {
      kind: "location",
      at: "Hospital",
    });
    game.loop.day = 3;
    expect(hook.when(game, "")).toBe(false);
  });

  it("offers Cursed Land immediately after an unattachable location Curse, before ordinary P9 hooks", () => {
    const game = primeState(
      "cursedLand",
      ["panicObsession", "keyGirl"],
      { richStudent: "ghost", boyStudent: "showOff", girlStudent: "keyPerson" },
    );
    game.loop.phase = "P9_ROUND_END";
    for (const character of Object.keys(game.loop.board)) {
      setBoardLocation(game.loop, character, "School");
    }
    game.loop.extraCards.push({
      instanceId: "stranded",
      cardId: "curse",
      controller: "mastermind",
      source: { kind: "rule", id: "witchsCurse" },
      target: { kind: "location", at: "Hospital" },
      expiresAt: "loopEnd",
    });

    advance(game);
    expect(game.loop.roundEndCurseLossAwaitingAt).toEqual({ loop: 1, day: 1 });
    expect(game.loop.roundEndMandatoryResolved).toBeUndefined();
    expect(evaluateLoss(game)).toContainEqual(expect.objectContaining({
      id: "cursedLand",
      activation: "optional",
      met: true,
    }));

    advance(game);
    expect(game.loop.day).toBe(2);

    const attachable = primeState(
      "cursedLand",
      ["panicObsession", "keyGirl"],
      { richStudent: "ghost", boyStudent: "showOff", girlStudent: "keyPerson" },
    );
    attachable.loop.phase = "P9_ROUND_END";
    setBoardLocation(attachable.loop, "richStudent", startLocationOf("richStudent"));
    setBoardLocation(attachable.loop, "boyStudent", "City");
    setBoardLocation(attachable.loop, "girlStudent", "Hospital");
    attachable.loop.extraCards.push({
      instanceId: "attachable",
      cardId: "curse",
      controller: "mastermind",
      source: { kind: "rule", id: "witchsCurse" },
      target: { kind: "location", at: startLocationOf("richStudent") },
      expiresAt: "loopEnd",
    });
    advance(attachable);
    expect(attachable.loop.roundEndCurseLossAwaitingAt).toBeUndefined();
    expect(evaluateLoss(attachable).some(({ id }) => id === "cursedLand"))
      .toBe(false);
  });

  it("keeps empty-rule plots free of invented runtime hooks", () => {
    for (const plot of [
      "moonlightBeast",
      "nightMistNightmare",
      "thoseHabits",
      "panicObsession",
      "peopleDontListen",
    ]) {
      expect(PLOT_IMPL[plot].hooks).toEqual([]);
    }
    const game = primeState(
      "moonlightBeast",
      ["thoseHabits", "peopleDontListen"],
      { boyStudent: "werewolf", girlStudent: "ghost" },
    );
    expect(collectHooks(game, "LOOP_START")).toEqual([]);
  });
});
