import { createGameState } from "../../src/engine/game";
import { distanceToLoss, type LossRoute } from "../../src/engine/loss";
import { mastermindOpeningGuidance } from "../../src/engine/mastermind-opening";
import { mastermindGuidance } from "../../src/engine/mastermind-guidance";
import { loadScenarioCatalog } from "../../src/scenario-catalog";

const startedAt = performance.now();
const axisCounts = {
  locationIntrigue: 0,
  characterIntrigue: 0,
  paranoia: 0,
  locationRelation: 0,
  other: 0,
};

function routeAxes(route: LossRoute): Set<keyof typeof axisCounts> {
  const axes = new Set<keyof typeof axisCounts>();
  for (const { key } of route.requirements) {
    if ([
      "placeXIntrigue", "schoolIntrigue", "shrineIntrigue",
      "hospitalIntrigue", "hospitalIntrigueForDeath",
    ].includes(key)) axes.add("locationIntrigue");
    else if (["keyPersonIntrigue", "intrigue", "targetIntrigue"].includes(key)) {
      axes.add("characterIntrigue");
    } else if (["paranoia", "culpritParanoia"].includes(key)) {
      axes.add("paranoia");
    } else if ([
      "sameAbilityLocation", "sameLocationAsCulprit", "targetAtHospital",
      "sameLocationAsAlien", "targetSameLocation", "exactlyOneOtherLiving",
    ].includes(key)) axes.add("locationRelation");
  }
  if (axes.size === 0) axes.add("other");
  return axes;
}

const rows = loadScenarioCatalog().flatMap((entry) =>
  entry.difficulties.map((difficulty) => {
    const baseRoutes = distanceToLoss(createGameState(difficulty.scenario))
      .flatMap(({ routes }) => routes);
    for (const route of baseRoutes) {
      for (const axis of routeAxes(route)) axisCounts[axis] += 1;
    }
    const guidance = mastermindOpeningGuidance(
      createGameState(difficulty.scenario),
    );
    const routeGuidance = mastermindGuidance(createGameState(difficulty.scenario));
    if (guidance.recommendations.length === 0) {
      throw new Error(`${entry.id}#${difficulty.index}: no opening recommendation`);
    }
    return {
      key: `${entry.id}#${difficulty.index}`,
      placements: guidance.contributingPlacementCount,
      profiles: guidance.candidateProfileCount,
      decoys: guidance.eligibleDecoyCount,
      excludedDecoys: guidance.excludedDecoys.length,
      recommendation: guidance.recommendations[0]?.placements.map(
        ({ cardLabel, targetLabel, targetKind }) =>
          `${cardLabel}@${targetLabel}(${targetKind})`,
      ),
      primary: routeGuidance.primary?.title,
      baseRoutes: baseRoutes.length,
    };
  })
);

const officialIds = new Set([
  "basicTragedy:1",
  "basicTragedy:8",
  "basicTragedy:9",
  "basicTragedy:10",
  "basicTragedy:11",
  "basicTragedy:12",
  "basicTragedy:13",
  "basicTragedy:14",
]);

console.log(JSON.stringify({
  difficulties: rows.length,
  baseRiskRoutes: rows.reduce((sum, { baseRoutes }) => sum + baseRoutes, 0),
  axisRouteCounts: axisCounts,
  eligibleDecoys: rows.reduce((sum, { decoys }) => sum + decoys, 0),
  excludedDecoys: rows.reduce(
    (sum, { excludedDecoys }) => sum + excludedDecoys,
    0,
  ),
  elapsedMs: Math.round(performance.now() - startedAt),
  placementRange: [
    Math.min(...rows.map(({ placements }) => placements)),
    Math.max(...rows.map(({ placements }) => placements)),
  ],
  profileRange: [
    Math.min(...rows.map(({ profiles }) => profiles)),
    Math.max(...rows.map(({ profiles }) => profiles)),
  ],
  official: rows.filter(({ key }) => officialIds.has(key.split("#")[0] ?? "")),
}, null, 2));
