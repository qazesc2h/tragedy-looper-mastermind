import { describe, expect, it } from "vitest";

import { createGameState } from "../src/engine/game";
import { validatePlacement } from "../src/engine/legal";
import {
  mastermindOpeningGuidance,
  type MastermindOpeningGuidance,
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

interface CatalogRow {
  key: string;
  group: string;
  state: GameState;
}

const catalogRows: CatalogRow[] = loadScenarioCatalog().flatMap((entry) =>
  entry.difficulties.map((difficulty) => ({
    key: `${entry.id}#${difficulty.index}`,
    group: `${difficulty.scenario.tragedySet}/${entry.source}`,
    state: createCatalogState(difficulty.scenario),
  }))
);

const catalogGroups = [...catalogRows.reduce((groups, row) => {
  const rows = groups.get(row.group) ?? [];
  rows.push(row);
  groups.set(row.group, rows);
  return groups;
}, new Map<string, CatalogRow[]>())];

// 같은 카탈로그 입력을 아래의 독립 검증 세 가지가 공유한다. 계산 결과는
// 결정적이므로 한 번만 만들고, 느린 CI의 5초 제한은 그룹별 테스트로 격리한다.
const openingGuidanceByKey = new Map<string, MastermindOpeningGuidance>();

function openingGuidanceFor(row: CatalogRow): MastermindOpeningGuidance {
  const cached = openingGuidanceByKey.get(row.key);
  if (cached !== undefined) return cached;
  const guidance = mastermindOpeningGuidance(row.state);
  openingGuidanceByKey.set(row.key, guidance);
  return guidance;
}

describe("mastermind opening guidance E", () => {
  it("covers all 73 bundled difficulties", () => {
    expect(catalogRows).toHaveLength(73);
  });

  for (const [group, rows] of catalogGroups) {
    it(`exhaustively evaluates legal three-card recommendations for ${group} (${rows.length})`, () => {
      for (const row of rows) {
        const { key, state } = row;
        const guidance = openingGuidanceFor(row);
        expect(guidance.contributingPlacementCount, key).toBeLessThan(63_360);
        expect(guidance.recommendations.length, key).toBeLessThanOrEqual(3);
        expect(guidance.recommendations.length === 0, key).toBe(
          guidance.candidateProfileCount === 0,
        );
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
  }

  for (const [group, rows] of catalogGroups) {
    it(`makes every ${group} recommendation change its axis on the real resolver`, () => {
      for (const row of rows) {
        const { key, state } = row;
        const recommendations = openingGuidanceFor(row).recommendations;
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
    });
  }

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

  for (const [group, rows] of catalogGroups) {
    it(`matches ${group} worst-response guarantees to the real resolver`, () => {
      for (const row of rows) {
        const { key, state } = row;
        const profile = openingGuidanceFor(row).recommendations[0];
        if (profile === undefined) continue;
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
        expect(actual, key).toEqual(profile.guaranteed);
      }
    });
  }
});
