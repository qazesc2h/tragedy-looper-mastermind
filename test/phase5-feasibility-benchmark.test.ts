import { describe, expect, it } from "vitest";

import {
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
} from "../src/engine/game";
import { validatePlacement } from "../src/engine/legal";
import { loadScenarioCatalog } from "../src/scenario-catalog";
import {
  enumerateP3Transitions,
  headlessNode,
} from "../tools/phase5-feasibility/headless-transitions";

describe("Phase 5 completed feasibility benchmark", () => {
  it("counts every firstSteps:2 P3 constraint without submission-order duplicates", () => {
    const entry = loadScenarioCatalog().find(({ id }) => id === "firstSteps:2");
    if (entry === undefined) throw new Error("missing firstSteps:2");
    const state = createGameState(structuredClone(entry.scenario));
    chooseInitialLeader(state, 0);
    continueFromTimeGap(state);
    state.loop.placed = [
      {
        owner: "mastermind",
        card: "paranoiaPlus1",
        target: { kind: "location", at: "Hospital" },
      },
      {
        owner: "mastermind",
        card: "intriguePlus1",
        target: { kind: "location", at: "Shrine" },
      },
      {
        owner: "mastermind",
        card: "moveVertical",
        target: { kind: "location", at: "City" },
      },
    ];
    state.loop.phase = "P3_PROTAGONIST_ACTION";

    let count = 0;
    for (const _transition of enumerateP3Transitions(headlessNode(state))) {
      count += 1;
    }
    // 카드 8^3 × 세 소유자의 서로 다른 대상 P(10, 3).
    expect(count).toBe(8 ** 3 * 10 * 9 * 8);

    const constrained = structuredClone(state);
    const firstCharacter = Object.keys(constrained.loop.board)[0];
    if (firstCharacter === undefined) throw new Error("missing cast");
    const firstPosition = constrained.loop.board[firstCharacter];
    if (firstPosition === undefined || firstPosition.status === "absent") {
      throw new Error("missing initial character position");
    }
    constrained.loop.board[firstCharacter] = {
      status: "dead",
      at: firstPosition.at,
    };
    expect(validatePlacement(constrained, {
      owner: 0,
      card: "goodwillPlus1",
      target: { kind: "character", id: firstCharacter },
    }).ok).toBe(false);

    constrained.loop.spentOncePerLoop.protagonists[0].push("goodwillPlus2");
    expect(validatePlacement(constrained, {
      owner: 0,
      card: "goodwillPlus2",
      target: { kind: "location", at: "School" },
    }).ok).toBe(false);

    constrained.loop.placed.push({
      owner: 1,
      card: "goodwillPlus1",
      target: { kind: "location", at: "School" },
    });
    expect(validatePlacement(constrained, {
      owner: 2,
      card: "goodwillPlus1",
      target: { kind: "location", at: "School" },
    }).ok).toBe(false);

    expect(validatePlacement(state, {
      owner: 0,
      card: "goodwillPlus1",
      target: { kind: "location", at: "Hospital" },
    })).toEqual({ ok: true });
  // 368,640개 실제 전이를 검사한다. timeout은 성능 판정값이 아니라 실행 여유다.
  }, 120_000);
});
