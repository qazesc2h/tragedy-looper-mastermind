import { describe, expect, it } from "vitest";

import { createGameState } from "../src/engine/game";
import { mastermindGuidance } from "../src/engine/mastermind-guidance";
import { loadScenarioCatalog } from "../src/scenario-catalog";
import type { Scenario } from "../src/types";

function createCatalogState(scenario: Scenario) {
  return createGameState(scenario);
}

function stateFor(id: string, difficultyIndex = 0) {
  const entry = loadScenarioCatalog().find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`missing scenario ${id}`);
  const difficulty = entry.difficulties.find(
    ({ index }) => index === difficultyIndex,
  );
  if (difficulty === undefined) {
    throw new Error(`missing scenario difficulty ${id}#${difficultyIndex}`);
  }
  return createCatalogState(difficulty.scenario);
}

describe("mastermind pre-game guidance", () => {
  it("generates static guidance for all 48 bundled difficulties", () => {
    const results = loadScenarioCatalog().flatMap((entry) =>
      entry.difficulties.map((difficulty) => ({
        key: `${entry.id}#${difficulty.index}`,
        guidance: mastermindGuidance(createCatalogState(difficulty.scenario)),
      }))
    );

    expect(results).toHaveLength(48);
    for (const { key, guidance } of results) {
      expect(guidance.routes.length, key).toBeGreaterThan(0);
      expect(guidance.primary, key).toBeDefined();
      expect(guidance.rankedRoutes[0], key).toEqual(guidance.primary);
      expect(guidance.alternatives, key).toEqual(
        guidance.rankedRoutes.slice(1, 3),
      );
      expect(new Set(guidance.routes.map(({ conditionKey, key: routeKey }) =>
        `${conditionKey}|${routeKey}`
      )).size,
        key).toBe(guidance.routes.length);
    }
  });

  it("uses the control label without repeating the generic automatic warning", () => {
    const guidance = mastermindGuidance(stateFor("basicTragedy:8"));

    expect(guidance.automaticRisks.length).toBeGreaterThan(0);
    expect(guidance.automaticRisks.every(({ warning }) =>
      warning === undefined || warning.includes("방치하면")
    )).toBe(true);
  });

  it("includes the First Script protagonist-death and key-person routes", () => {
    const guidance = mastermindGuidance(stateFor("firstSteps:1"));
    const keys = guidance.routes.map(({ key }) => key);

    expect(keys).toEqual(expect.arrayContaining([
      "role:killer:officeWorker:direct",
      "death:killer:officeWorker:girlStudent",
      "death:serialKiller:shrineMaiden:girlStudent",
      "death:incident:murder:2:officeWorker:girlStudent",
      "death:incident:suicide:3:girlStudent",
    ]));
    expect(guidance.routes.find(
      ({ key }) => key === "death:incident:suicide:3:girlStudent",
    )?.timing).toBe("3일 사건 단계");
  });

  it("marks time-traveler neglect as a zero-action last-day win", () => {
    const state = stateFor("basicTragedy:10");
    const guidance = mastermindGuidance(state);
    const route = guidance.routes.find(({ conditionKey }) =>
      conditionKey.startsWith("role:timeTraveler:")
    );

    expect(route).toMatchObject({
      control: "mastermind",
      actions: { cards: 0, abilities: 0 },
      minimumDay: state.scenario.daysPerLoop,
    });
    expect(route?.warning).toContain("방치하면");
    expect(route?.interference).toContain("우호 금지는 무시");
  });

  it("separates protagonist-choice routes from targets", () => {
    const guidance = mastermindGuidance(stateFor("basicTragedy:9"));

    expect(guidance.protagonistChoices.every(
      ({ control }) => control === "protagonist",
    )).toBe(true);
    expect(guidance.primary?.control).not.toBe("protagonist");
    expect(guidance.alternatives.every(
      ({ control }) => control !== "protagonist",
    )).toBe(true);
  });

  it("includes the factor's conditional key-person death routes", () => {
    const guidance = mastermindGuidance(stateFor("basicTragedy:8"));

    expect(guidance.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        conditionKey: "role:keyPerson:journalist",
        key: "death:incident:suicide:7:journalist",
      }),
    ]));
  });

  it("prefers a resource-disjoint fallback when one exists", () => {
    const guidance = mastermindGuidance(stateFor("basicTragedy:14"));
    const primaryResources = new Set(guidance.primary?.resources ?? []);
    const overlaps = guidance.alternatives.map((route) =>
      route.resources.filter((resource) => primaryResources.has(resource)).length
    );

    if (overlaps.includes(0)) expect(overlaps[0]).toBe(0);
  });

  it("does not emit permanently ineffective black-cat incident deaths", () => {
    for (const entry of loadScenarioCatalog()) {
      for (const difficulty of entry.difficulties) {
        const guidance = mastermindGuidance(createCatalogState(difficulty.scenario));
        const blackCatDays = new Set(difficulty.scenario.incidents
          .filter(({ culprit }) => culprit === "blackCat")
          .map(({ day, incident }) => `${incident}:${day}`));
        expect(guidance.routes.some(({ key }) =>
          [...blackCatDays].some((incident) => key.includes(`:${incident}:`))
        ), `${entry.id}#${difficulty.index}`).toBe(false);
      }
    }
  });
});
