import { describe, expect, it } from "vitest";

import {
  advanceGame,
  chooseInitialLeader,
  continueAfterLoopJudgment,
  continueFromTimeGap,
  createGameState,
  setLoopStartTraitLocationChoice,
  submitFinalGuess,
} from "../src/engine/game";
import { resolveGoodwillAbility } from "../src/engine/goodwill";
import {
  collectProtagonistObservations,
  enumerateRuleCombinations,
  evaluateStateRoleTableHypotheses,
  evaluateStateRuleHypotheses,
} from "../src/engine/hypothesis";
import { distanceToLoss } from "../src/engine/loss";
import { mastermindCautions } from "../src/engine/mastermind-cautions";
import { mastermindCoverGuidance } from "../src/engine/mastermind-cover";
import { mastermindDecoyGuidance } from "../src/engine/mastermind-decoys";
import { mastermindGuidance } from "../src/engine/mastermind-guidance";
import { mastermindOpeningGuidance } from "../src/engine/mastermind-opening";
import {
  assertOfficialScenariosValid,
  loadScenarioCatalog,
} from "../src/scenario-catalog";
import {
  finalizeScenarioDraft,
  scenarioToDraft,
  validateScenarioDraft,
} from "../src/scenario-draft";
import { renderScenarioEditor } from "../src/ui/scenario-editor";
import { gameText } from "../src/ui/terms";
import {
  effectiveRole,
  startLocationOf,
  type CharacterId,
  type GameState,
} from "../src/types";

const catalog = loadScenarioCatalog();
const official = catalog.filter(({ id }) => id.startsWith("cosmicMythology:"));

function prepareLoop(state: GameState): void {
  if ("henchman" in state.scenario.cast) {
    setLoopStartTraitLocationChoice(state, "henchman", "School");
  }
  continueFromTimeGap(state);
}

function forceCurrentLoopLoss(state: GameState): void {
  state.loop.day = state.scenario.daysPerLoop;
  state.loop.phase = "P9_ROUND_END";
  switch (state.scenario.mainPlot) {
    case "kingYellow":
      if (state.loop.specialGauge === undefined) throw new Error("missing gauge");
      state.loop.specialGauge.increasedThisLoop = true;
      break;
    case "giantTimeBombAgain": {
      const witch = Object.keys(state.scenario.cast).find((character) =>
        effectiveRole(state, character) === "witch"
      );
      if (witch === undefined) throw new Error("missing witch");
      state.loop.locIntrigue[startLocationOf(witch, state.scenario)] = 2;
      break;
    }
    case "sacredWordsDagon":
    case "bloodyRites":
      // 게이지 0이면 원문에 따라 조건이 자동 성립한다.
      break;
    default:
      throw new Error(`unsupported CM plot ${state.scenario.mainPlot}`);
  }
  advanceGame(state);
  if (state.gamePhase === "ROUND" && state.loop.phase === "P9_ROUND_END") {
    advanceGame(state);
  }
  expect(state.gamePhase, `${state.scenario.mainPlot} loop ${state.loop.loop} ${state.loop.phase}`)
    .toBe("LOOP_JUDGMENT");
}

describe("Cosmic Mythology official scripts", () => {
  it("classifies five official scripts and seven difficulty variants", () => {
    expect(official.map(({ id }) => id)).toEqual([
      "cosmicMythology:6",
      "cosmicMythology:7",
      "cosmicMythology:8",
      "cosmicMythology:9",
      "cosmicMythology:10",
    ]);
    expect(official.flatMap(({ difficulties }) => difficulties)).toHaveLength(7);
    expect(official.every(({ source }) => source === "official")).toBe(true);
    expect(() => assertOfficialScenariosValid(official)).not.toThrow();
  });

  it("can progress every official variant through all loops and the final guess", () => {
    for (const entry of official) {
      for (const difficulty of entry.difficulties) {
        const state = createGameState(difficulty.scenario);
        chooseInitialLeader(state, 0);
        prepareLoop(state);
        while (state.loop.loop <= state.scenario.loops) {
          forceCurrentLoopLoss(state);
          continueAfterLoopJudgment(state);
          if (state.gamePhase === "FINAL_GUESS") break;
          prepareLoop(state);
        }
        expect(state.gamePhase, `${entry.id}#${difficulty.index}`)
          .toBe("FINAL_GUESS");
        for (const character of Object.keys(state.scenario.cast) as CharacterId[]) {
          submitFinalGuess(state, character, effectiveRole(state, character));
        }
        expect(state.result, `${entry.id}#${difficulty.index}`).toEqual({
          winner: "protagonists",
          reason: "finalGuessSuccess",
        });
      }
    }
  });

  it("runs guidance A through E and covers every CM role in B and D", () => {
    const coveredRoles = new Set<string>();
    const cautionKeys = new Set<string>();
    for (const entry of official) {
      for (const difficulty of entry.difficulties) {
        const state = createGameState(difficulty.scenario);
        const guidance = mastermindGuidance(state);
        expect(guidance.routes.length, entry.id).toBeGreaterThan(0);
        const cautions = mastermindCautions(state);
        expect(cautions.total, entry.id).toBeGreaterThan(0);
        for (const caution of [
          ...cautions.identityExposure,
          ...cautions.uncontrolledRisks,
          ...cautions.operationalNotes,
        ]) cautionKeys.add(caution.key.split(":")[1] ?? caution.key);
        expect(mastermindDecoyGuidance(state).total, entry.id).toBeGreaterThan(0);
        const cover = mastermindCoverGuidance(state, guidance);
        expect(cover.candidates.length, entry.id).toBeGreaterThan(0);
        for (const candidate of cover.candidates) coveredRoles.add(candidate.role);
        expect(() => mastermindOpeningGuidance(state), entry.id).not.toThrow();
      }
    }
    expect([...coveredRoles]).toEqual(expect.arrayContaining([
      "sacrifice", "deepOne", "wizard", "witness", "faceless",
      "paranoiac", "immortalRole",
    ]));
    expect([...cautionKeys]).toEqual(expect.arrayContaining([
      "sacrifice", "deep-one", "wizard", "witness", "faceless",
    ]));
  });

  it("keeps gauge-based plots and the King in Yellow avoidance in loss guidance", () => {
    for (const entry of official) {
      const state = createGameState(entry.scenario);
      const plot = distanceToLoss(state).find(({ id }) =>
        id === entry.scenario.mainPlot
      );
      expect(plot, entry.id).toBeDefined();
      if (entry.scenario.mainPlot === "kingYellow") {
        const route = mastermindGuidance(state).routes.find(({ conditionKey }) =>
          conditionKey === "plot:kingYellow"
        );
        expect(route?.warning).toContain("이번 루프에 게이지를 올리지 않으면");
        expect(route?.interference).toContain("우호 능력 거부");
      }
    }
  });

  it("uses CM rule and role spaces without duplicating refusal evidence", () => {
    expect(enumerateRuleCombinations("cosmicMythology")).toHaveLength(105);
    const roleNames = new Set<string>();
    for (const entry of official) {
      const state = createGameState(entry.scenario);
      const rules = evaluateStateRuleHypotheses(state);
      expect(rules.remaining.length, entry.id).toBeGreaterThan(0);
      const roles = evaluateStateRoleTableHypotheses(state);
      for (const role of roles.table.roles) roleNames.add(role);
    }
    expect([...roleNames]).toEqual(expect.arrayContaining([
      "sacrifice", "deepOne", "wizard", "witness", "faceless",
      "paranoiac", "immortalRole",
    ]));

    const state = createGameState(official.find(({ id }) =>
      id === "cosmicMythology:8"
    )!.scenario);
    state.gamePhase = "ROUND";
    state.loop.phase = "P6_GOODWILL";
    state.loop.charCounters.officeWorker.goodwill = 3;
    expect(resolveGoodwillAbility(
      state,
      { user: "officeWorker", rank: 3 },
      "resolve",
    )).toMatchObject({ refused: true });
    const observations = collectProtagonistObservations(state);
    expect(observations.filter(({ kind }) => kind === "goodwillRefused"))
      .toHaveLength(1);
    expect(observations.some(({ kind }) =>
      kind === "mastermindAbilityResult"
    )).toBe(false);
  });

  it("round-trips CM scripts and exposes CM-only editor choices and gauge lifetime", () => {
    for (const entry of official) {
      const draft = scenarioToDraft(entry.scenario);
      expect(validateScenarioDraft(draft, "finalize").ok, entry.id).toBe(true);
      expect(finalizeScenarioDraft(draft).ok, entry.id).toBe(true);
      expect(renderScenarioEditor({ draft, step: 0 }, ""))
        .toContain('value="cosmicMythology"');
      expect(renderScenarioEditor({ draft, step: 2 }, ""))
        .toContain(`value="${entry.scenario.mainPlot}"`);
      const roleHtml = renderScenarioEditor({ draft, step: 5 }, "");
      expect(roleHtml).toContain('value="deepOne"');
      expect(roleHtml).not.toContain('value="zombie"');
    }
    const draft = scenarioToDraft(official[0]!.scenario);
    expect(renderScenarioEditor({ draft, step: 0 }, ""))
      .toContain("초기값 0 · 루프 간 유지");
  });

  it("keeps the documented CM translation gaps on their English source", () => {
    for (const entry of official) {
      expect(gameText(entry.rawTitle)).toBe(entry.rawTitle);
      expect(entry.story).toBe(
        "See Tragedy Looper: Cosmic Evil Mastermind Handbook",
      );
      expect(entry.victoryConditions).toBe(
        "See Tragedy Looper: Cosmic Evil Mastermind Handbook",
      );
      expect(entry.mastermindHints).toBe(
        "See Tragedy Looper: Cosmic Evil Mastermind Handbook",
      );
    }
  });
});
