import { describe, expect, it } from "vitest";

import { previewP5Disclosure } from "../src/engine/disclosure-preview";
import { createGameState } from "../src/engine/game";
import { evaluateStateRoleTableHypotheses } from "../src/engine/hypothesis";
import { applyHookEffect, collectHooks } from "../src/engine/phases";
import { loadFirstStepsScenarioCatalog } from "../src/scenario-catalog";
import type { CharacterId, GameState, Hook, Target } from "../src/types";
import { setBoardLocation } from "./helpers";

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
