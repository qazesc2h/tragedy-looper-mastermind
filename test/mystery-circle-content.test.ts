import { describe, expect, it } from "vitest";

import {
  advanceGame,
  chooseInitialLeader,
  continueAfterLoopJudgment,
  continueFromTimeGap,
  createGameState,
  setLoopStartTraitCounterChoice,
  setLoopStartTraitLocationChoice,
  submitFinalGuess,
} from "../src/engine/game";
import {
  buildRolePossibilityTable,
  enumerateRuleCombinations,
} from "../src/engine/hypothesis";
import { evaluateStateIncidentHypotheses } from "../src/engine/incident-hypothesis";
import { mastermindCautions } from "../src/engine/mastermind-cautions";
import { mastermindCoverGuidance } from "../src/engine/mastermind-cover";
import { mastermindDecoyGuidance } from "../src/engine/mastermind-decoys";
import { mastermindGuidance } from "../src/engine/mastermind-guidance";
import { mastermindOpeningGuidance } from "../src/engine/mastermind-opening";
import { collectHooks, hookResolutionKey } from "../src/engine/phases";
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
import { gameText, translatedText } from "../src/ui/terms";
import {
  effectiveRole,
  type CharacterId,
  type GameState,
} from "../src/types";

const catalog = loadScenarioCatalog();
const official = catalog.filter(({ id }) => id.startsWith("mysteryCircle:"));

function prepareLoop(state: GameState): void {
  if ("scientist" in state.scenario.cast) {
    setLoopStartTraitCounterChoice(state, "scientist", "goodwill");
  }
  if ("henchman" in state.scenario.cast) {
    setLoopStartTraitLocationChoice(state, "henchman", "School");
  }
  continueFromTimeGap(state);
}

function forceCurrentLoopLoss(state: GameState): void {
  switch (state.scenario.mainPlot) {
    case "blackSchool":
      state.loop.locIntrigue.School = state.loop.loop;
      break;
    case "quiltIncidents":
      if (state.loop.specialGauge === undefined) throw new Error("missing gauge");
      state.loop.specialGauge.value = 3;
      break;
    case "dropStrychnine":
      if (state.loop.specialGauge === undefined) throw new Error("missing gauge");
      state.loop.specialGauge.value = 4;
      break;
    case "tightropePlan":
      if (state.loop.specialGauge === undefined) throw new Error("missing gauge");
      state.loop.specialGauge.value = 0;
      break;
    default:
      throw new Error(`unsupported MC plot ${state.scenario.mainPlot}`);
  }
  state.loop.day = state.scenario.daysPerLoop;
  state.loop.phase = "P9_ROUND_END";
  const mandatoryHookTargets = Object.fromEntries(
    collectHooks(state, "P9_ROUND_END").flatMap(({ self, hook }, index) => {
      const target = hook.selectableTargets?.(state, self)[0];
      return target === undefined
        ? []
        : [[hookResolutionKey("P9_ROUND_END", self, index), target]];
    }),
  );
  advanceGame(state, undefined, { mandatoryHookTargets });
  expect(state.gamePhase).toBe("LOOP_JUDGMENT");
}

describe("Mystery Circle official scripts", () => {
  it("classifies five official scripts and seven variants, with Bag of Risks separate", () => {
    expect(official.map(({ id }) => id)).toEqual([
      "mysteryCircle:8",
      "mysteryCircle:9",
      "mysteryCircle:10",
      "mysteryCircle:11",
      "mysteryCircle:12",
    ]);
    expect(official.flatMap(({ difficulties }) => difficulties)).toHaveLength(7);
    expect(official.every(({ source }) => source === "official")).toBe(true);
    expect(() => assertOfficialScenariosValid(official)).not.toThrow();

    const bag = catalog.find(({ id }) => id === "community:bag-of-risks");
    expect(bag).toMatchObject({ source: "community", rawTitle: "Bag of Risks" });
    expect(bag?.difficulties).toHaveLength(2);
    expect(bag?.difficulties.every(({ validation }) => validation.ok)).toBe(true);
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
        expect(state.gamePhase, `${entry.id}#${difficulty.index}`).toBe("FINAL_GUESS");
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

  it("generates guidance A through E without exceptions for every MC variant", () => {
    for (const entry of official) {
      for (const difficulty of entry.difficulties) {
        const state = createGameState(difficulty.scenario);
        const guidance = mastermindGuidance(state);
        expect(guidance.routes.length, entry.id).toBeGreaterThan(0);
        expect(mastermindCautions(state).total, entry.id).toBeGreaterThan(0);
        expect(mastermindDecoyGuidance(state).total, entry.id).toBeGreaterThan(0);
        expect(mastermindCoverGuidance(state, guidance).candidates.length, entry.id)
          .toBeGreaterThan(0);
        expect(() => mastermindOpeningGuidance(state), entry.id).not.toThrow();
      }
    }
    const noDirectDayOneProgress = createGameState(official.find(({ id }) =>
      id === "mysteryCircle:9"
    )!.scenario);
    expect(mastermindOpeningGuidance(noDirectDayOneProgress).recommendations)
      .toEqual([]);
  });

  it("uses MC rule, role, and incident candidate spaces", () => {
    const combinations = enumerateRuleCombinations("mysteryCircle");
    expect(combinations).toHaveLength(105);
    const milestone = official.find(({ id }) => id === "mysteryCircle:12")!;
    const state = createGameState(milestone.scenario);
    expect(combinations).toContainEqual({
      id: "tightropePlan+anAbsoluteWill+masterDetective",
      mainPlot: "tightropePlan",
      subPlots: ["anAbsoluteWill", "masterDetective"],
    });
    const characters = Object.keys(state.scenario.cast) as CharacterId[];
    const roles = buildRolePossibilityTable(
      "mysteryCircle",
      characters,
      combinations,
      [],
    );
    for (const role of [
      "poisoner", "fool", "privateInvestigator", "therapist", "paranoiac",
      "twin", "obstinate",
    ] as const) expect(roles.roles).toContain(role);
    expect(roles.cells.policeOfficer.privateInvestigator.status).not.toBe("impossible");

    const incidents = evaluateStateIncidentHypotheses(state);
    expect(incidents.columns.map(({ incident }) => incident)).toEqual(
      state.scenario.incidents.map(({ incident }) => incident),
    );
  });

  it("round-trips official MC and MZ scripts through the editor", () => {
    for (const id of ["mysteryCircle:12", "midnightZone:7"]) {
      const entry = catalog.find((candidate) => candidate.id === id)!;
      const draft = scenarioToDraft(entry.scenario);
      expect(validateScenarioDraft(draft, "finalize").ok, id).toBe(true);
      expect(finalizeScenarioDraft(draft).ok, id).toBe(true);
      const html = renderScenarioEditor({ draft, step: 0 }, "");
      expect(html).toContain('value="midnightZone"');
      expect(html).toContain('value="mysteryCircle"');
      if (id.startsWith("mysteryCircle:")) {
        expect(html).toContain('data-editor-special-gauge');
        expect(html).toContain("공개 특수 게이지");
      }
    }
  });

  it("keeps the documented MC translation gaps on their English source", () => {
    for (const entry of official) {
      expect(gameText(entry.rawTitle)).toBe(entry.rawTitle);
      expect(entry.victoryConditions).toBe(
        "See Tragedy Looper: Midnight Circle Mastermind Handbook",
      );
      expect(entry.mastermindHints).toBe(
        "See Tragedy Looper: Midnight Circle Mastermind Handbook",
      );
    }
    for (const source of [
      "The Extra Gauge is 1 or above",
      "This role has been revealed",
      "Incident trigger",
    ]) expect(translatedText(source)).toBe(source);
  });
});
