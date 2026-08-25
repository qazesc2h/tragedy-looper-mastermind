import { describe, expect, it } from "vitest";

import { characterDataOf } from "../src/data";
import { mastermindCautions } from "../src/engine/mastermind-cautions";
import { createGameState } from "../src/engine/game";
import { loadScenarioCatalog } from "../src/scenario-catalog";

function stateFor(id: string, difficultyIndex = 0) {
  const entry = loadScenarioCatalog().find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`missing scenario ${id}`);
  const difficulty = entry.difficulties.find(
    ({ index }) => index === difficultyIndex,
  );
  if (difficulty === undefined) {
    throw new Error(`missing scenario difficulty ${id}#${difficultyIndex}`);
  }
  return createGameState(difficulty.scenario);
}

describe("mastermind scenario cautions", () => {
  it("generates filtered cautions and every cast goodwill ability for all 47 difficulties", () => {
    const results = loadScenarioCatalog().flatMap((entry) =>
      entry.difficulties.map((difficulty) => {
        const state = createGameState(difficulty.scenario);
        return {
          key: `${entry.id}#${difficulty.index}`,
          state,
          cautions: mastermindCautions(state),
        };
      })
    );

    expect(results).toHaveLength(47);
    for (const { key, state, cautions } of results) {
      const expectedGoodwillAbilities = Object.keys(state.scenario.cast)
        .reduce((sum, character) => sum + characterDataOf(character)
          .goodwillAbilities.filter(({ rank }) => rank !== null).length, 0);
      const actualGoodwillAbilities = cautions.protagonistTools.filter(
        ({ key: cautionKey }) => cautionKey.startsWith("tool:goodwill:"),
      ).length;
      const all = [
        ...cautions.identityExposure,
        ...cautions.uncontrolledRisks,
        ...cautions.operationalNotes,
        ...cautions.protagonistTools,
      ];

      expect(cautions.total, key).toBe(all.length);
      expect(new Set(all.map(({ key: cautionKey }) => cautionKey)).size, key)
        .toBe(all.length);
      expect(actualGoodwillAbilities, key).toBe(expectedGoodwillAbilities);
      expect(cautions.operationalNotes.filter(
        ({ key: cautionKey }) => cautionKey.startsWith("risk:incident:"),
      ), key).toHaveLength(state.scenario.incidents.length);
    }
  });

  it("names actual roles directly and does not treat non-refusable abilities as identity exposure", () => {
    const cautions = mastermindCautions(stateFor("basicTragedy:10"));

    expect(cautions.identityExposure).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "identity:mandatory-refusal:shrineMaiden",
        condition: "무녀 · 광신도",
      }),
      expect.objectContaining({
        key: "identity:time-traveler:boyStudent",
        condition: "남학생 · 시간 여행자",
      }),
    ]));
    expect(cautions.identityExposure.some(({ key }) =>
      key.startsWith("identity:cannot-refuse:")
    )).toBe(false);
  });

  it("keeps black-cat occurrence, AI counter, and early incident tools distinct", () => {
    const cautions = mastermindCautions(stateFor("basicTragedy:7"));
    const blackCatIncident = cautions.operationalNotes.find(
      ({ key }) => key === "risk:incident:1:suicide:blackCat",
    );
    const aiTool = cautions.protagonistTools.find(
      ({ key }) => key === "tool:goodwill:ai:2",
    );

    expect(blackCatIncident?.description).toContain("발생 이력은 남");
    expect(cautions.operationalNotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "risk:trait:ai-incident-counters" }),
    ]));
    expect(aiTool?.description).toContain("오늘 이후의 사건도 미리");
    expect(aiTool?.description).toContain("발생 이력에는 남지");
  });

  it("warns about henchman suppression, factor abilities, virus mutation, and delayed entry", () => {
    const cautions = mastermindCautions(stateFor("basicTragedy:4"));
    const keys = [
      ...cautions.uncontrolledRisks,
      ...cautions.operationalNotes,
      ...cautions.protagonistTools,
    ].map(({ key }) => key);

    expect(keys).toEqual(expect.arrayContaining([
      "risk:factor:boyStudent",
      "risk:plot:paranoia-virus",
      "risk:trait:henchman-placement",
      "risk:trait:entry:transferStudent",
      "tool:goodwill:henchman:1",
    ]));
    expect(cautions.protagonistTools.find(
      ({ key }) => key === "tool:goodwill:henchman:1",
    )?.description).toContain("예정 사건은 발생하지 않");
  });

  it("emphasizes plans that forced deaths can cancel", () => {
    const prologue = mastermindCautions(stateFor("basicTragedy:13"));
    const battlefield = mastermindCautions(stateFor("basicTragedy:1"));

    expect(prologue.operationalNotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "risk:self-sabotage:killer-route" }),
    ]));
    expect(battlefield.uncontrolledRisks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "risk:self-sabotage:serial-key-person",
        severity: "critical",
      }),
    ]));
  });

  it("includes additional selected-trait hazards without leaking absent casts", () => {
    const cautions = mastermindCautions(stateFor("basicTragedy:17"));
    const text = JSON.stringify(cautions);

    expect(cautions.uncontrolledRisks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "risk:trait:sect-founder" }),
      expect.objectContaining({ key: "risk:trait:sacred-tree" }),
    ]));
    expect(cautions.protagonistTools).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "tool:trait:sacred-tree" }),
    ]));
    expect(cautions.identityExposure.some(({ key }) =>
      key.startsWith("identity:cannot-refuse:")
    )).toBe(false);
    expect(text).not.toContain("black-cat");
    expect(text).not.toContain("ai-incident");
  });

  it("keeps Lesser of Two Evils incidents and the factor out of uncontrollable risks", () => {
    const cautions = mastermindCautions(stateFor("basicTragedy:8"));
    const uncontrolledKeys = cautions.uncontrolledRisks.map(({ key }) => key);
    const operationalKeys = cautions.operationalNotes.map(({ key }) => key);

    expect(uncontrolledKeys.some((key) => key.startsWith("risk:incident:")))
      .toBe(false);
    expect(uncontrolledKeys).not.toContain("risk:factor:journalist");
    expect(operationalKeys).toContain("risk:factor:journalist");
    expect(operationalKeys.filter((key) => key.startsWith("risk:incident:")))
      .toHaveLength(4);
  });
});
