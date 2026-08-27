import { describe, expect, it } from "vitest";

import { createGameState } from "../src/engine/game";
import { validatePlacement } from "../src/engine/legal";
import {
  mastermindOpeningGuidance,
  type OpeningPlacement,
  type OpeningProgress,
} from "../src/engine/mastermind-opening";
import { resolveActions } from "../src/engine/resolve";
import { loadScenarioCatalog } from "../src/scenario-catalog";
import {
  characterLocation,
  type GameState,
  type PlacedCard,
  type Scenario,
} from "../src/types";

function createCatalogState(scenario: Scenario) {
  return createGameState(scenario);
}

function stateFor(id: string, difficultyIndex = 0): GameState {
  const entry = loadScenarioCatalog().find((candidate) => candidate.id === id);
  const difficulty = entry?.difficulties.find(({ index }) =>
    index === difficultyIndex
  );
  if (difficulty === undefined) throw new Error(`missing ${id}#${difficultyIndex}`);
  return createCatalogState(difficulty.scenario);
}

describe("mastermind opening guidance E", () => {
  it("exhaustively generates a legal three-card recommendation for all 48 difficulties", () => {
    const rows = loadScenarioCatalog().flatMap((entry) =>
      entry.difficulties.map((difficulty) => ({
        key: `${entry.id}#${difficulty.index}`,
        state: createCatalogState(difficulty.scenario),
      }))
    );

    expect(rows).toHaveLength(48);
    for (const { key, state } of rows) {
      const guidance = mastermindOpeningGuidance(state);
      expect(guidance.contributingPlacementCount, key).toBeLessThan(63_360);
      expect(guidance.candidateProfileCount, key).toBeGreaterThan(0);
      expect(guidance.recommendations.length, key).toBeGreaterThan(0);
      for (const profile of guidance.recommendations) {
        expect(profile.placements, key).toHaveLength(3);
        expect(new Set(profile.placements.map(({ target }) =>
          target.kind === "character" ? `character:${target.id}` : `location:${target.at}`
        )).size, key).toBe(3);
        const projected = structuredClone(state);
        for (const placement of profile.placements) {
          const card: PlacedCard = {
            owner: "mastermind",
            card: placement.card,
            target: placement.target,
          };
          expect(validatePlacement(projected, card), `${key} ${placement.card}`).toEqual({ ok: true });
          projected.loop.placed.push(card);
          expect(placement.targetKind, key).toBe(placement.target.kind);
          expect(placement.contributions.every(({ targetKind }) =>
            targetKind === placement.target.kind
          ), key).toBe(true);
        }
      }
    }
  });

  it("makes every recommended placement change the stated axis on the real resolver", () => {
    for (const entry of loadScenarioCatalog()) {
      for (const difficulty of entry.difficulties) {
        const key = `${entry.id}#${difficulty.index}`;
        const state = createCatalogState(difficulty.scenario);
        const recommendations = mastermindOpeningGuidance(state).recommendations;
        for (const recommendation of recommendations) {
          for (const placement of recommendation.placements) {
        const projected = structuredClone(state);
        const before = placement.target.kind === "location"
          ? projected.loop.locIntrigue[placement.target.at]
          : placement.card === "paranoiaPlus1"
          ? projected.loop.charCounters[placement.target.id].paranoia
          : placement.card === "intriguePlus1" || placement.card === "intriguePlus2"
          ? projected.loop.charCounters[placement.target.id].intrigue
          : characterLocation(projected.loop.board[placement.target.id], placement.target.id);
        projected.loop.placed = [{
          owner: "mastermind",
          card: placement.card,
          target: placement.target,
        }];
        resolveActions(projected);
        const after = placement.target.kind === "location"
          ? projected.loop.locIntrigue[placement.target.at]
          : placement.card === "paranoiaPlus1"
          ? projected.loop.charCounters[placement.target.id].paranoia
          : placement.card === "intriguePlus1" || placement.card === "intriguePlus2"
          ? projected.loop.charCounters[placement.target.id].intrigue
          : characterLocation(projected.loop.board[placement.target.id], placement.target.id);
            expect(after, `${key} ${placement.card}@${placement.targetLabel}`).not.toBe(before);
          }
        }
      }
    }
  });

  it("admits only first-day-progress decoys and records excluded ones", () => {
    const guidance = mastermindOpeningGuidance(stateFor("basicTragedy:8"));
    const decoyContributions = guidance.recommendations.flatMap(({ placements }) =>
      placements.flatMap(({ contributions }) =>
        contributions.filter(({ source }) => source === "C")
      )
    );

    expect(guidance.eligibleDecoyCount).toBeGreaterThan(0);
    expect(guidance.excludedDecoys.every(({ reason }) =>
      reason.includes("1일차")
    )).toBe(true);
    expect(decoyContributions.every(({ amount }) => amount > 0)).toBe(true);
    expect(guidance.axisContract).toContain("실제 패배 조건");
    expect(guidance.axisContract).toContain("오해할 수 있는 공개 상태");
    expect(guidance.axisContract).not.toContain("224개");
    expect(guidance.horizonReason).toContain("2일차부터는 주인공이 낸 카드");
  });

  it("uses D only as a profile tie-break explanation", () => {
    const guidance = mastermindOpeningGuidance(stateFor("basicTragedy:13"));

    expect(guidance.recommendations.every(({ concealment, concealmentTieBreak }) =>
      concealment.includes("카드") && concealmentTieBreak >= 0
    )).toBe(true);
    expect(guidance.recommendations.every(({ guaranteed, unopposed }) =>
      guaranteed.primary <= unopposed.primary &&
      guaranteed.alternatives <= unopposed.alternatives &&
      guaranteed.decoys <= unopposed.decoys
    )).toBe(true);
  });

  it("matches its worst-response guarantee to the real resolver", () => {
    const add = (progress: OpeningProgress, placement: OpeningPlacement): void => {
      for (const contribution of placement.contributions) {
        if (contribution.source === "C") progress.decoys += contribution.amount;
        else if (contribution.priority === 0) progress.primary += contribution.amount;
        else progress.alternatives += contribution.amount;
        progress.total += contribution.amount;
      }
    };
    const compare = (left: OpeningProgress, right: OpeningProgress): number =>
      left.primary - right.primary || left.alternatives - right.alternatives ||
      left.decoys - right.decoys || left.total - right.total;

    for (const entry of loadScenarioCatalog()) {
      for (const difficulty of entry.difficulties) {
        const state = createCatalogState(difficulty.scenario);
        const profile = mastermindOpeningGuidance(state).recommendations[0];
        if (profile === undefined) throw new Error(`missing ${entry.id}`);
        const intrigueIndexes = profile.placements.flatMap(({ card }, index) =>
          card === "intriguePlus1" || card === "intriguePlus2" ? [index] : []
        );
        const blockChoices = intrigueIndexes.length === 0 ? [-1] : intrigueIndexes;
        const actual = blockChoices.map((intrigueBlock) => {
          const projected = structuredClone(state);
          projected.loop.placed = profile.placements.flatMap((placement, index) => {
            const mastermind: PlacedCard = {
              owner: "mastermind",
              card: placement.card,
              target: placement.target,
            };
            const response: PlacedCard = {
              owner: index as 0 | 1 | 2,
              card: index === intrigueBlock
                ? "forbidIntrigue"
                : placement.card === "paranoiaPlus1"
                ? "paranoiaMinus1"
                : placement.card.startsWith("move")
                ? "forbidMove"
                : "goodwillPlus1",
              target: placement.target,
            };
            return [mastermind, response];
          });
          resolveActions(projected);
          const progress: OpeningProgress = {
            primary: 0, alternatives: 0, decoys: 0, total: 0,
          };
          profile.placements.forEach((placement, index) => {
            const succeeded = placement.target.kind === "location"
              ? projected.loop.locIntrigue[placement.target.at] > 0
              : placement.card === "paranoiaPlus1"
              ? projected.loop.charCounters[placement.target.id].paranoia > 0
              : placement.card === "intriguePlus1" || placement.card === "intriguePlus2"
              ? projected.loop.charCounters[placement.target.id].intrigue > 0
              : characterLocation(
                projected.loop.board[placement.target.id],
                placement.target.id,
              ) !== characterLocation(
                state.loop.board[placement.target.id],
                placement.target.id,
              );
            if (succeeded) add(progress, profile.placements[index] as OpeningPlacement);
          });
          return progress;
        }).sort(compare)[0];
        expect(actual, `${entry.id}#${difficulty.index}`).toEqual(profile.guaranteed);
      }
    }
  });
});
