import { describe, expect, it } from "vitest";

import {
  previewCurrentLossDisclosure,
  previewP5Disclosure,
  previewP6GoodwillRefusal,
  previewP9HookDisclosure,
  previewP9OptionalLossDisclosure,
} from "../src/engine/disclosure-preview";
import { finishLoop, createGameState } from "../src/engine/game";
import { resolveGoodwillAbility } from "../src/engine/goodwill";
import { evaluateStateRoleTableHypotheses } from "../src/engine/hypothesis";
import { requestLoopEnd } from "../src/engine/flow";
import { applyHookEffect, collectHooks } from "../src/engine/phases";
import {
  loadBasicTragedyScenarioCatalog,
  loadFirstStepsScenarioCatalog,
} from "../src/scenario-catalog";
import type {
  CharacterId,
  GameState,
  Hook,
  Scenario,
  Target,
} from "../src/types";
import { setBoardLife, setBoardLocation } from "./helpers";

function prevailingSecrecyState(sharedShrine = false): GameState {
  const entry = loadFirstStepsScenarioCatalog().find(
    ({ rawTitle }) => rawTitle === "Prevailing Secrecy",
  );
  if (entry === undefined) throw new Error("missing Prevailing Secrecy");
  const state = createGameState(structuredClone(entry.scenario));
  state.gamePhase = "ROUND";
  state.loop.phase = "P5_MASTERMIND_ABILITY";
  for (const character of Object.keys(state.scenario.cast)) {
    setBoardLocation(state.loop, character, "School");
  }
  setBoardLocation(state.loop, "shrineMaiden", "Shrine");
  if (sharedShrine) setBoardLocation(state.loop, "officeWorker", "Shrine");
  return state;
}

function shrineMaidenAbility(
  state: GameState,
): { hook: Hook; self: CharacterId } {
  const entry = collectHooks(state, "P5_MASTERMIND_ABILITY").find(
    ({ self }) => self === "shrineMaiden",
  );
  if (entry === undefined) throw new Error("missing shrine maiden P5 hook");
  return entry;
}

const SHRINE_MAIDEN_TARGET: Target = {
  kind: "character",
  id: "shrineMaiden",
};

describe("P5 disclosure preview", () => {
  it("warns that a lone shrine maiden will be confirmed as conspiracy theorist", () => {
    const state = prevailingSecrecyState();
    const { hook, self } = shrineMaidenAbility(state);

    const preview = previewP5Disclosure(
      state,
      hook,
      self,
      SHRINE_MAIDEN_TARGET,
    );

    expect(preview.risk).toBe("critical");
    expect(preview.newlyConfirmedRoles).toContainEqual({
      character: "shrineMaiden",
      role: "conspiracyTheorist",
    });
  });

  it("does not claim a role confirmation when two characters share the location", () => {
    const state = prevailingSecrecyState(true);
    const { hook, self } = shrineMaidenAbility(state);

    const preview = previewP5Disclosure(
      state,
      hook,
      self,
      SHRINE_MAIDEN_TARGET,
    );

    expect(preview.newlyConfirmedRoles).not.toContainEqual({
      character: "shrineMaiden",
      role: "conspiracyTheorist",
    });
    expect(preview.risk).not.toBe("critical");
  });

  it("matches the inference produced after the ability is actually activated", () => {
    const state = prevailingSecrecyState();
    const { hook, self } = shrineMaidenAbility(state);
    const preview = previewP5Disclosure(
      state,
      hook,
      self,
      SHRINE_MAIDEN_TARGET,
    );

    applyHookEffect(
      state,
      "P5_MASTERMIND_ABILITY",
      hook,
      self,
      SHRINE_MAIDEN_TARGET,
      undefined,
      true,
    );
    const actual = evaluateStateRoleTableHypotheses(state);

    expect(actual.remaining).toHaveLength(preview.after.ruleCombinations);
    expect(new Set(actual.remaining.map(({ mainPlot }) => mainPlot)).size)
      .toBe(preview.after.mainPlots);
    for (const { character, role } of preview.newlyConfirmedRoles) {
      expect(actual.table.cells[character]?.[role]?.status).toBe("confirmed");
    }
  });

  it("does not mutate any part of the actual game state", () => {
    const state = prevailingSecrecyState();
    const before = structuredClone(state);
    const { hook, self } = shrineMaidenAbility(state);

    previewP5Disclosure(state, hook, self, SHRINE_MAIDEN_TARGET);

    expect(state).toEqual(before);
  });
});

function goodwillState(role: Scenario["cast"][string]): GameState {
  const entry = loadBasicTragedyScenarioCatalog().find(
    ({ id }) => id === "basicTragedy:1",
  );
  if (entry === undefined) throw new Error("missing basicTragedy:1");
  const state = createGameState(structuredClone(entry.scenario));
  state.gamePhase = "ROUND";
  state.loop.phase = "P6_GOODWILL";
  state.loop.loop = 2;
  state.scenario.cast.officeWorker = role;
  state.loop.charCounters.officeWorker.goodwill = 3;
  return state;
}

describe("P6 disclosure preview", () => {
  const declaration = {
    user: "officeWorker",
    rank: 3,
    abilityIndex: 0,
  } as const;

  it("shows that an optional refusal fixes the goodwill-ignore family", () => {
    const state = goodwillState("killer");
    const preview = previewP6GoodwillRefusal(state, declaration);

    expect(preview.risk).toBe("danger");
    expect(preview.goodwillIgnoreFamilyConfirmed).toBe(true);
    expect(preview.roleCandidatesBefore).toHaveLength(12);
    expect(preview.roleCandidatesAfter).toHaveLength(5);
    expect(preview.roleCandidatesAfter).toEqual(expect.arrayContaining([
      "killer",
      "brain",
      "factor",
      "cultist",
      "witch",
    ]));
  });

  it("previews the same disclosure for a mandatory refusal", () => {
    const state = goodwillState("cultist");
    const preview = previewP6GoodwillRefusal(state, declaration);

    expect(preview.goodwillIgnoreFamilyConfirmed).toBe(true);
    expect(preview.roleCandidatesAfter).toHaveLength(5);
  });

  it("matches the inference after the refusal is actually resolved", () => {
    const state = goodwillState("killer");
    const preview = previewP6GoodwillRefusal(state, declaration);

    resolveGoodwillAbility(state, declaration, "refuse");
    const actual = evaluateStateRoleTableHypotheses(state);

    expect(actual.remaining).toHaveLength(preview.after.ruleCombinations);
    expect(actual.table.roles.filter((role) =>
      role !== "person" &&
      actual.table.cells.officeWorker[role]?.status !== "impossible"
    )).toEqual(preview.roleCandidatesAfter);
  });

  it("does not mutate the actual game state", () => {
    const state = goodwillState("killer");
    const before = structuredClone(state);

    previewP6GoodwillRefusal(state, declaration);

    expect(state).toEqual(before);
  });
});

const LOSS_CAST = [
  "boyStudent",
  "girlStudent",
  "classRep",
  "doctor",
  "patient",
  "officeWorker",
  "informer",
  "richStudent",
  "teacher",
] as const;

function p9State(
  cast: Scenario["cast"] = {},
): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "sealedItem",
    subPlots: ["unsettlingRumor", "threadsFate"],
    cast: Object.fromEntries(LOSS_CAST.map((character) =>
      [character, cast[character] ?? "person"]
    )),
    incidents: [],
    loops: 2,
    daysPerLoop: 5,
  };
  const state = createGameState(scenario);
  state.gamePhase = "ROUND";
  state.loop.phase = "P9_ROUND_END";
  state.loop.day = 4;
  state.loop.roundEndMandatoryResolved = true;
  for (const character of LOSS_CAST) {
    state.loop.charCounters[character].goodwill = 3;
  }
  return state;
}

describe("P9 disclosure preview", () => {
  it("warns when the current loss state fixes sealedItem", () => {
    const state = p9State();
    state.loop.locIntrigue.Shrine = 2;

    const preview = previewCurrentLossDisclosure(state);

    expect(preview.risk).toBe("danger");
    expect(preview.newlyFixedPlots).toContain("sealedItem");
    expect(preview.explainableConditions).toEqual([{
      key: "plot:sealedItem",
      kind: "plot",
      plot: "sealedItem",
    }]);
  });

  it("keeps several explanations when a decoy condition is present", () => {
    const state = p9State();
    state.loop.locIntrigue.Shrine = 2;
    setBoardLife(state.loop, "girlStudent", false);

    const preview = previewCurrentLossDisclosure(state);

    expect(preview.explainableConditions.length).toBeGreaterThan(1);
    expect(preview.newlyFixedPlots).not.toContain("sealedItem");
  });

  it("matches the inference after a natural loop loss is recorded", () => {
    const state = p9State();
    state.loop.locIntrigue.Shrine = 2;
    const preview = previewCurrentLossDisclosure(state);

    requestLoopEnd(state, "lastDay");
    finishLoop(state);
    const actual = evaluateStateRoleTableHypotheses(state);

    expect(actual.remaining).toHaveLength(preview.after.ruleCombinations);
    expect(new Set(actual.remaining.map(({ mainPlot }) => mainPlot)).size)
      .toBe(preview.after.mainPlots);
  });

  it("previews the role exposure from killing the key person", () => {
    const state = p9State({
      boyStudent: "keyPerson",
      officeWorker: "killer",
    });
    state.loop.charCounters.boyStudent.intrigue = 2;
    setBoardLocation(state.loop, "boyStudent", "City");
    setBoardLocation(state.loop, "officeWorker", "City");
    const entry = collectHooks(state, "P9_ROUND_END").find(
      ({ self, hook }) => self === "officeWorker" && hook.kind === "optional",
    );
    if (entry === undefined) throw new Error("missing killer P9 hook");

    const preview = previewP9HookDisclosure(state, entry.hook, entry.self);

    expect(preview.risk).toBe("critical");
    expect(preview.newlyConfirmedRoles).toContainEqual({
      character: "boyStudent",
      role: "keyPerson",
    });
  });

  it("previews protagonist-death role exposure", () => {
    const state = p9State({ officeWorker: "killer" });
    state.loop.charCounters.officeWorker.intrigue = 4;

    const preview = previewP9OptionalLossDisclosure(
      state,
      "role:killer:officeWorker",
    );

    expect(preview.risk).toBe("critical");
    expect(preview.explainableConditions).toContainEqual({
      key: "role:killer",
      kind: "role",
      role: "killer",
    });
    expect(preview.newlyConfirmedRoles).toContainEqual({
      character: "officeWorker",
      role: "killer",
    });
  });

  it("does not mutate state for current, hook, or optional-loss previews", () => {
    const state = p9State({
      boyStudent: "keyPerson",
      officeWorker: "killer",
    });
    state.loop.charCounters.boyStudent.intrigue = 2;
    state.loop.charCounters.officeWorker.intrigue = 4;
    setBoardLocation(state.loop, "boyStudent", "City");
    setBoardLocation(state.loop, "officeWorker", "City");
    const entry = collectHooks(state, "P9_ROUND_END").find(
      ({ self, hook }) => self === "officeWorker" && hook.kind === "optional",
    );
    if (entry === undefined) throw new Error("missing killer P9 hook");
    const before = structuredClone(state);

    previewCurrentLossDisclosure(state);
    previewP9HookDisclosure(state, entry.hook, entry.self);
    previewP9OptionalLossDisclosure(state, "role:killer:officeWorker");

    expect(state).toEqual(before);
  });
});
