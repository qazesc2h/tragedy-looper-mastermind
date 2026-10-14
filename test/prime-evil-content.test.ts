import { describe, expect, it } from "vitest";

import { killCharacter } from "../src/engine/death";
import {
  chooseInitialLeader,
  continueAfterLoopJudgment,
  continueFromTimeGap,
  createGameState,
  setLoopStartCursePlacement,
  setLoopStartTraitLocationChoice,
  settleGameFlow,
  submitFinalGuess,
} from "../src/engine/game";
import {
  collectProtagonistObservations,
  enumerateRuleCombinations,
  evaluateStateRoleTableHypotheses,
  evaluateStateRuleHypotheses,
} from "../src/engine/hypothesis";
import { evaluateStateIncidentHypothesisTables } from "../src/engine/incident-hypothesis";
import { distanceToLoss, setOptionalLossActivation } from "../src/engine/loss";
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
const official = catalog.filter(({ id }) => id.startsWith("primeEvil:"));

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
    case "cursedLand":
    case "nobleBloodline": {
      const keyPerson = Object.keys(state.scenario.cast).find((character) =>
        effectiveRole(state, character) === "keyPerson"
      );
      if (keyPerson === undefined) throw new Error("missing key person");
      killCharacter(state, keyPerson);
      settleGameFlow(state);
      break;
    }
    case "OnesFromGrave": {
      const lovedOne = Object.keys(state.scenario.cast).find((character) =>
        effectiveRole(state, character) === "lovedOne"
      );
      if (lovedOne === undefined) throw new Error("missing loved one");
      state.loop.charCounters[lovedOne].paranoia = 3;
      state.loop.charCounters[lovedOne].intrigue = 1;
      setOptionalLossActivation(state, `role:lovedOne:${lovedOne}`, true);
      settleGameFlow(state);
      break;
    }
    case "moonlightBeast": {
      const werewolf = Object.keys(state.scenario.cast).find((character) =>
        effectiveRole(state, character) === "werewolf"
      );
      if (werewolf === undefined) throw new Error("missing werewolf");
      state.loop.incidentOccurrencesFiredThisLoop = [{
        day: state.loop.day,
        incident: "nightMadness",
        culprit: { kind: "location", at: "Hospital" },
      }];
      setOptionalLossActivation(state, `role:werewolf:${werewolf}`, true);
      settleGameFlow(state);
      break;
    }
    default:
      throw new Error(`unsupported PE plot ${state.scenario.mainPlot}`);
  }
  expect(state.gamePhase).toBe("LOOP_JUDGMENT");
}

describe("Prime Evil official scripts", () => {
  it("classifies four official scripts and eight difficulty variants", () => {
    expect(official.map(({ id }) => id)).toEqual([
      "primeEvil:2",
      "primeEvil:3",
      "primeEvil:4",
      "primeEvil:5",
    ]);
    expect(official.flatMap(({ difficulties }) => difficulties)).toHaveLength(8);
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

  it("runs guidance A through E and covers every new role in B and D", () => {
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
        for (const candidate of cover.candidates) {
          coveredRoles.add(candidate.role);
          if (["vampire", "werewolf", "nightmare"].includes(candidate.role)) {
            expect(candidate.affectedVictoryRouteCount, candidate.role)
              .toBeGreaterThan(0);
          }
        }
        expect(() => mastermindOpeningGuidance(state), entry.id).not.toThrow();
      }
    }
    expect([...coveredRoles]).toEqual(expect.arrayContaining([
      "vampire", "werewolf", "nightmare", "ghost", "showOff", "coward", "zombie",
    ]));
    expect([...cautionKeys]).toEqual(expect.arrayContaining([
      "vampire", "werewolf", "nightmare", "ghost", "show-off", "coward", "zombie",
    ]));
  });

  it("includes PE loss distances for anonymous corpses and curses", () => {
    const vamp = createGameState(official.find(({ id }) => id === "primeEvil:3")!.scenario);
    const vampire = Object.keys(vamp.scenario.cast).find((character) =>
      effectiveRole(vamp, character) === "vampire"
    )!;
    const start = startLocationOf(vampire, vamp.scenario);
    vamp.loop.locIntrigue[start] = 2;
    expect(distanceToLoss(vamp).find(({ key }) =>
      key === `role:vampire:${vampire}`
    )).toMatchObject({
      met: true,
      requirements: [expect.objectContaining({
        key: "corpsesAtStart", current: 2, met: true,
      })],
    });

    const cursed = createGameState(official.find(({ id }) =>
      id === "primeEvil:2"
    )!.scenario);
    cursed.loop.phase = "P9_ROUND_END";
    cursed.loop.roundEndCurseResolvedAt = { loop: 1, day: 1 };
    cursed.loop.roundEndUnattachableCurseIds = ["stranded"];
    expect(distanceToLoss(cursed).find(({ id }) => id === "cursedLand"))
      .toMatchObject({ met: true });
  });

  it("uses PE rule, role, character-culprit, and location-culprit hypothesis spaces", () => {
    expect(enumerateRuleCombinations("primeEvil")).toHaveLength(105);
    const entry = official.find(({ id }) => id === "primeEvil:2")!;
    const state = createGameState(entry.scenario);
    const roleTable = evaluateStateRoleTableHypotheses(state);
    for (const role of [
      "vampire", "werewolf", "nightmare", "ghost", "showOff", "coward",
    ] as const) expect(roleTable.table.roles).toContain(role);
    const zombieTable = evaluateStateRoleTableHypotheses(createGameState(
      official.find(({ id }) => id === "primeEvil:4")!.scenario,
    ));
    expect(zombieTable.table.roles).toContain("zombie");

    const incidents = evaluateStateIncidentHypothesisTables(state);
    expect(incidents.character.columns.map(({ incident }) => incident)).toEqual([
      "missingPerson", "sacrilegiousMurder",
    ]);
    expect(incidents.location.columns.map(({ incident }) => incident)).toEqual([
      "evangeliumDead",
    ]);
  });

  it("uses public Curse placement to narrow PE rule and role hypotheses", () => {
    const state = createGameState(official.find(({ id }) =>
      id === "primeEvil:2"
    )!.scenario);
    chooseInitialLeader(state, 0);
    setLoopStartCursePlacement(state, "cursedLand", true);
    continueFromTimeGap(state);
    expect(collectProtagonistObservations(state)).toContainEqual(
      expect.objectContaining({
        kind: "mastermindAbilityResult",
        timing: "LOOP_START",
        changes: [expect.objectContaining({
          kind: "extraCard", action: "placed",
        })],
      }),
    );
    const rules = evaluateStateRuleHypotheses(state);
    expect(rules.remaining).toHaveLength(45);
    expect(rules.remaining.every(({ mainPlot, subPlots }) =>
      mainPlot === "cursedLand" || subPlots.includes("witchsCurse")
    )).toBe(true);
    const roles = evaluateStateRoleTableHypotheses(state);
    expect(roles.remaining.length).toBeGreaterThan(0);
    expect(roles.remaining.every(({ mainPlot, subPlots }) =>
      mainPlot === "cursedLand" || subPlots.includes("witchsCurse")
    )).toBe(true);
  });

  it("round-trips PE scripts and renders location culprits in the editor", () => {
    for (const entry of official) {
      const draft = scenarioToDraft(entry.scenario);
      expect(validateScenarioDraft(draft, "finalize").ok, entry.id).toBe(true);
      expect(finalizeScenarioDraft(draft).ok, entry.id).toBe(true);
      expect(renderScenarioEditor({ draft, step: 0 }, ""))
        .toContain('value="primeEvil"');
      expect(renderScenarioEditor({ draft, step: 2 }, ""))
        .toContain(`value="${entry.scenario.mainPlot}"`);
      expect(renderScenarioEditor({ draft, step: 5 }, ""))
        .toContain('value="ghost"');
    }
    const masterThief = scenarioToDraft(official[0]!.scenario);
    const html = renderScenarioEditor({ draft: masterThief, step: 6 }, "");
    expect(html).toContain('value="location:School"');
    const locationIncident = masterThief.incidents?.find(({ incident }) =>
      incident === "evangeliumDead"
    );
    if (locationIncident === undefined) throw new Error("missing location incident");
    locationIncident.culprit = { kind: "character", id: "richStudent" };
    expect(validateScenarioDraft(masterThief, "finalize").diagnostics)
      .toContainEqual(expect.objectContaining({
        code: "INCIDENT_CULPRIT_KIND_MISMATCH",
      }));
  });

  it("keeps the documented PE translation gaps on their English source", () => {
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
