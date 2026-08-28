import { describe, expect, it } from "vitest";

import koRelease from "../data/ko-release.json";
import communityScripts from "../scenarios/community-scripts.json";
import { characterDataOf } from "../src/data";
import { killCharacter } from "../src/engine/death";
import {
  advanceGame,
  chooseInitialLeader,
  continueAfterLoopJudgment,
  continueFromTimeGap,
  createGameState,
  settleGameFlow,
} from "../src/engine/game";
import { requestLoopEnd } from "../src/engine/flow";
import { resolveGoodwillAbility } from "../src/engine/goodwill";
import { actionCardRestriction, validatePlacement } from "../src/engine/legal";
import { mastermindCautions } from "../src/engine/mastermind-cautions";
import { mastermindCoverGuidance } from "../src/engine/mastermind-cover";
import { mastermindDecoyGuidance } from "../src/engine/mastermind-decoys";
import { mastermindGuidance } from "../src/engine/mastermind-guidance";
import { mastermindOpeningGuidance } from "../src/engine/mastermind-opening";
import { resolveHooks } from "../src/engine/phases";
import {
  resolveSacredTreeMastermindTransfer,
  sacredTreeMastermindChoiceRequired,
} from "../src/engine/sacred-tree";
import {
  currentServantFollowOptions,
  resolveActions,
} from "../src/engine/resolve";
import { loadScenarioCatalog } from "../src/scenario-catalog";
import { effectiveRole, type GameState, type PlacedCard } from "../src/types";
import {
  boardIsAlive,
  boardLocation,
  setBoardLocation,
} from "./helpers";

function catalogEntry() {
  const entry = loadScenarioCatalog().find(({ id }) =>
    id === "community:naughty-cat"
  );
  if (entry === undefined) throw new Error("missing community:naughty-cat");
  return entry;
}

function stateAt(): GameState {
  return createGameState(catalogEntry().scenario);
}

describe("community scenario: 못된 고양이", () => {
  it("preserves its author metadata, source text, and validation result", () => {
    const entry = catalogEntry();
    const source = communityScripts[0];

    expect(entry).toMatchObject({
      id: "community:naughty-cat",
      rawTitle: "못된 고양이",
      creator: "갱하",
      source: "community",
      validation: { ok: true, errors: [] },
    });
    expect(entry.mastermindHints).toBe(source.mastermindHints);
    expect(entry.victoryConditions).toBe(source["victory-conditions"]);
    expect(source.cast.servant).toEqual([
      "person",
      { startLocation: "School" },
    ]);
    expect(entry.scenario).toMatchObject({
      tragedySet: "basicTragedy",
      mainPlot: "changeOfFuture",
      subPlots: ["paranoiaVirus", "threadsFate"],
      loops: 5,
      daysPerLoop: 5,
      difficulty: 5,
      specialRules: ["각본가는 '우호 금지' 카드를 사용할 수 없다."],
      specialRuleIds: ["mastermindCannotUseForbidGoodwill"],
      scriptSpecified: { "startLocation:servant": "School" },
    });
  });

  it("fixes the Servant at School as scenario data", () => {
    const scenario = catalogEntry().scenario;
    expect(scenario.scriptSpecified?.["startLocation:servant"]).toBe("School");
    expect(boardLocation(stateAt().loop, "servant")).toBe("School");
  });

  it("classifies every supported character start-location contract", () => {
    const supported = [
      ...koRelease.characters["본판"],
      ...koRelease.characters["프로모"],
      "servant",
      "sacredTree",
    ];
    const multiple = supported.filter((character) =>
      characterDataOf(character).startLocation.length > 1
    );
    const fixed = supported.filter((character) =>
      characterDataOf(character).startLocation.length === 1
    );

    expect(supported).toHaveLength(28);
    expect(multiple).toEqual(["henchman", "servant"]);
    expect(fixed).toHaveLength(26);
    expect(characterDataOf("henchman").startLocation).toEqual([
      "City",
      "School",
      "Shrine",
      "Hospital",
    ]);
    expect(characterDataOf("servant").startLocation).toEqual([
      "City",
      "School",
    ]);
  });

  it("keeps Forbid Goodwill in hand semantics but blocks only the Mastermind", () => {
    const state = stateAt();
    const target = { kind: "character", id: "informer" } as const;
    const mastermind: PlacedCard = {
      owner: "mastermind",
      card: "forbidGoodwill",
      target,
    };
    const protagonist: PlacedCard = {
      owner: 0,
      card: "forbidGoodwill",
      target,
    };

    expect(actionCardRestriction(state, "mastermind", "forbidGoodwill"))
      .toEqual({
        ok: false,
        reason: "특수 규칙",
      });
    expect(validatePlacement(state, mastermind)).toEqual(
      actionCardRestriction(state, "mastermind", "forbidGoodwill"),
    );
    expect(actionCardRestriction(state, 0, "forbidGoodwill")).toBeUndefined();
    expect(validatePlacement(state, protagonist)).toEqual({ ok: true });
    expect(state.loop.spentOncePerLoop.mastermind).not.toContain(
      "forbidGoodwill",
    );
  });

  it("runs Servant, Sacred Tree, Black Cat, and Mystery Boy through this cast", () => {
    const servant = stateAt();
    chooseInitialLeader(servant, 0);
    continueFromTimeGap(servant);
    expect(servant.loop.locIntrigue.Shrine).toBe(1);

    servant.loop.phase = "P4_RESOLVE";
    servant.loop.placed = [{
      owner: "mastermind",
      card: "moveHorizontal",
      target: { kind: "character", id: "richStudent" },
    }];
    expect(currentServantFollowOptions(servant)).toEqual([{
      character: "richStudent",
      to: "City",
    }]);
    resolveActions(servant);
    expect(boardLocation(servant.loop, "servant")).toBe("City");

    const tree = stateAt();
    chooseInitialLeader(tree, 0);
    continueFromTimeGap(tree);
    tree.loop.phase = "P5_MASTERMIND_ABILITY";
    tree.loop.charCounters.sacredTree.intrigue = 1;
    expect(sacredTreeMastermindChoiceRequired(tree)).toBe(true);
    resolveSacredTreeMastermindTransfer(tree, {
      counter: "intrigue",
      target: "blackCat",
    });
    expect(tree.loop.charCounters.blackCat.intrigue).toBe(1);

    const outsider = stateAt();
    killCharacter(outsider, "mysteryBoy");
    expect(boardIsAlive(outsider.loop, "mysteryBoy")).toBe(false);
    resolveHooks(outsider, "LOOP_END");
    expect(outsider.loop.revealedRoleCharacters).toContain("mysteryBoy");
  });

  it("applies Friend and Threads of Fate after the revealed Mystery Boy dies", () => {
    const state = stateAt();
    state.gamePhase = "ROUND";
    state.loop.loop = 2;
    state.loop.day = 2;
    state.loop.phase = "P6_GOODWILL";
    state.loop.charCounters.mysteryBoy.goodwill = 3;

    resolveGoodwillAbility(state, {
      user: "mysteryBoy",
      rank: 3,
      abilityIndex: 1,
    }, "resolve");
    expect(state.loop.revealedRoleCharacters).toContain("mysteryBoy");

    for (const character of [
      "sacredTree",
      "informer",
      "popIdol",
      "patient",
      "nurse",
      "richStudent",
      "servant",
      "blackCat",
      "mysteryBoy",
    ] as const) {
      setBoardLocation(state.loop, character, "School");
    }
    setBoardLocation(state.loop, "nurse", "Hospital");
    setBoardLocation(state.loop, "mysteryBoy", "Hospital");
    state.loop.charCounters.nurse.paranoia = 3;
    state.loop.phase = "P9_ROUND_END";

    expect(effectiveRole(state, "nurse")).toBe("serialKiller");
    resolveHooks(state, "P9_ROUND_END");
    expect(boardIsAlive(state.loop, "mysteryBoy")).toBe(false);
    expect(state.loop.charCounters.mysteryBoy.goodwill).toBe(3);

    requestLoopEnd(state, "lastDay");
    expect(settleGameFlow(state)).toMatchObject({
      loop: 2,
      result: "protagonistsLost",
    });
    expect(state.history.at(-1)?.board.mysteryBoy.status).toBe("dead");
    expect(state.history.at(-1)?.charCounters.mysteryBoy.goodwill).toBe(3);

    continueAfterLoopJudgment(state);
    continueFromTimeGap(state);

    expect(state.loop.loop).toBe(3);
    expect(state.loop.day).toBe(1);
    expect(state.loop.phase).toBe("P2_MASTERMIND_ACTION");
    expect(state.loop.charCounters.mysteryBoy).toMatchObject({
      goodwill: 1,
      paranoia: 2,
    });
    const loopStartChanges = (state.loop.phaseLog ?? [])
      .flatMap((entry) =>
        entry.kind === "abilityActivated" && entry.timing === "LOOP_START"
          ? entry.publicChanges ?? []
          : []
      );
    expect(loopStartChanges).toEqual(expect.arrayContaining([
      {
        kind: "counter",
        target: { kind: "character", id: "mysteryBoy" },
        counter: "goodwill",
        delta: 1,
      },
      {
        kind: "counter",
        target: { kind: "character", id: "mysteryBoy" },
        counter: "paranoia",
        delta: 2,
      },
    ]));
  });

  it("plays all five days of all five loops and reaches the final guess", () => {
    const state = stateAt();
    chooseInitialLeader(state, 0);
    const visited = new Map<number, Set<number>>();

    for (let loop = 1; loop <= 5; loop += 1) {
      expect(boardLocation(state.loop, "servant")).toBe("School");
      continueFromTimeGap(state);
      expect(boardLocation(state.loop, "servant")).toBe("School");
      expect(state.loop.locIntrigue.Shrine).toBe(1);
      const days = visited.get(loop) ?? new Set<number>();
      visited.set(loop, days);

      for (let guard = 0; guard < 80 && state.gamePhase === "ROUND"; guard += 1) {
        days.add(state.loop.day);
        if (state.loop.phase === "P2_MASTERMIND_ACTION") {
          state.loop.placed.push(
            {
              owner: "mastermind",
              card: "moveVertical",
              target: { kind: "location", at: "Hospital" },
            },
            {
              owner: "mastermind",
              card: "moveHorizontal",
              target: { kind: "location", at: "Shrine" },
            },
            {
              owner: "mastermind",
              card: "paranoiaPlus1",
              target: { kind: "location", at: "City" },
            },
          );
        } else if (state.loop.phase === "P3_PROTAGONIST_ACTION") {
          state.loop.placed.push(
            {
              owner: 0,
              card: "moveVertical",
              target: { kind: "location", at: "Hospital" },
            },
            {
              owner: 1,
              card: "moveHorizontal",
              target: { kind: "location", at: "Shrine" },
            },
            {
              owner: 2,
              card: "paranoiaPlus1",
              target: { kind: "location", at: "City" },
            },
          );
        }
        advanceGame(state);
      }

      expect(state.gamePhase).toBe("LOOP_JUDGMENT");
      expect(days).toEqual(new Set([1, 2, 3, 4, 5]));
      expect(state.loop.incidentOccurrencesFiredThisLoop).toContainEqual({
        day: 5,
        incident: "butterflyEffect",
        culprit: "blackCat",
      });
      expect(state.loopOutcomes.at(-1)).toMatchObject({
        loop,
        day: 5,
        result: "protagonistsLost",
      });
      continueAfterLoopJudgment(state);
    }

    expect(state.history).toHaveLength(5);
    expect(state.loopOutcomes).toHaveLength(5);
    expect(state.gamePhase).toBe("FINAL_GUESS");
  });

  it("recovers the scenario author's seven key guidance intentions in A-E", () => {
    const state = stateAt();
    const guidance = mastermindGuidance(state);
    const cautions = mastermindCautions(state);
    const decoys = mastermindDecoyGuidance(state);
    const cover = mastermindCoverGuidance(state);
    const opening = mastermindOpeningGuidance(state);
    const future = guidance.routes.find(({ conditionKey }) =>
      conditionKey === "plot:changeOfFuture"
    );
    const cautionRows = [
      ...cautions.identityExposure,
      ...cautions.uncontrolledRisks,
      ...cautions.operationalNotes,
      ...cautions.protagonistTools,
    ];

    expect(future).toMatchObject({ minimumDay: 5 });
    expect(future?.warning).toContain(
      "5일 나비의 날갯짓 범인은 검은 고양이",
    );
    expect(future?.warning).toContain("사건 단계까지 범인을 생존");
    expect(cautionRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "risk:trait:black-cat-loop-start",
        description: expect.stringContaining("매 루프 시작 시 신사에 음모 1개"),
      }),
      expect.objectContaining({
        key: "risk:incident:5:butterflyEffect:blackCat",
        title: expect.stringContaining("범인 검은 고양이"),
      }),
      expect.objectContaining({
        key: "tool:goodwill:informer:0",
        description: expect.stringContaining("룰 X"),
      }),
      expect.objectContaining({
        key: "risk:trait:sacred-tree-refusal-range",
        description: expect.stringMatching(/후보는 5개.*광신도는 그중 하나/),
      }),
    ]));
    expect(cautionRows.some(({ key }) =>
      key === "identity:time-traveler:informer"
    )).toBe(false);

    const girlDecoy = decoys.fakeLossConditions.find(({ key }) =>
      key === "fake:plot:signWithMe"
    );
    expect(girlDecoy).toMatchObject({
      requirement: "소녀인 핵심 인물 후보(캐릭터)에 음모 2개",
      candidateCharacters: ["popIdol", "richStudent"],
    });
    expect(decoys.locationIntrigueSources).toContainEqual(
      expect.objectContaining({
        key: "trait:blackCat",
        targetScope: "신사",
        condition: "신사(장소)에 음모 1개",
      }),
    );
    expect(cover.rolePoolPressure).toContain("역할은 3종");
    expect(cover.rolePoolPressure).toContain("최후의 싸움에서 역전하기 쉬우므로");
    expect(cover.candidates.find(({ character }) =>
      character === "informer"
    )?.exposurePaths.some(({ key }) =>
      key === "role:timeTraveler:forbid-goodwill"
    )).toBe(false);
    expect(opening.recommendations.flatMap(({ placements }) => placements)
      .some(({ card }) => card === "forbidGoodwill")).toBe(false);
    expect(opening.recommendations.flatMap(({ placements }) => placements)
      .some(({ contributions }) => contributions.some(({ source, key }) =>
        source === "C" && key === "C:fake:plot:signWithMe"
      ))).toBe(true);
  });
});
