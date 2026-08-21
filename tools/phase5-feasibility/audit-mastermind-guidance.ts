import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import basicScriptsJson from "../../data/basic-tragedy-scripts.json";
import { createGameState } from "../../src/engine/game";
import { distanceToLoss } from "../../src/engine/loss";
import {
  mastermindGuidance,
  type MastermindGuidanceRoute,
} from "../../src/engine/mastermind-guidance";
import { loadScenarioCatalog } from "../../src/scenario-catalog";
import { canonicalStringify } from "./canonical-state";
import { sha256 } from "./measure-action-equivalence";

interface OfficialExpectation {
  label: string;
  matches: (
    route: MastermindGuidanceRoute,
    cast: Readonly<Record<string, string>>,
  ) => boolean;
}

const plot = (id: string): OfficialExpectation => ({
  label: `룰:${id}`,
  matches: (route) => route.conditionKey === `plot:${id}`,
});

const role = (id: string): OfficialExpectation => ({
  label: `역할:${id}`,
  matches: (route) => route.conditionKey.startsWith(`role:${id}:`),
});

const protectedRoute = (
  protectedRole: "keyPerson" | "friend",
  mechanism: string,
): OfficialExpectation => ({
  label: `${protectedRole}:${mechanism}`,
  matches: (route) =>
    route.conditionKey.startsWith(`role:${protectedRole}:`) &&
    route.key.includes(mechanism),
});

const factorRoute = (mechanism: string): OfficialExpectation => ({
  label: `factor-keyPerson:${mechanism}`,
  matches: (route, cast) => {
    const character = route.conditionKey.split(":").at(-1);
    return route.conditionKey.startsWith("role:keyPerson:") &&
      character !== undefined && cast[character] === "factor" &&
      route.key.includes(mechanism);
  },
});

const OFFICIAL_EXPECTATIONS: Readonly<Record<string, OfficialExpectation[]>> = {
  "basicTragedy:1": [
    plot("signWithMe"),
    protectedRoute("keyPerson", "death:serialKiller:"),
    protectedRoute("friend", "death:serialKiller:"),
    protectedRoute("friend", ":suicide:"),
    role("lovedOne"),
  ],
  "basicTragedy:8": [
    plot("sealedItem"),
    protectedRoute("friend", "death:serialKiller:"),
    factorRoute("death:serialKiller:"),
    factorRoute(":suicide:"),
  ],
  "basicTragedy:9": [
    plot("giantTimeBomb"),
    protectedRoute("friend", ":hospitalIncident:"),
    { label: "주인공:병원 사건", matches: (route) =>
      route.conditionKey.startsWith("incident:hospitalIncident:") },
  ],
  "basicTragedy:10": [
    plot("changeOfFuture"),
    role("timeTraveler"),
    protectedRoute("friend", "death:serialKiller:"),
    role("lovedOne"),
  ],
  "basicTragedy:11": [
    plot("signWithMe"),
    protectedRoute("keyPerson", "death:serialKiller:"),
    protectedRoute("keyPerson", ":hospitalIncident:"),
    protectedRoute("keyPerson", ":murder:"),
    factorRoute("death:serialKiller:"),
    factorRoute(":hospitalIncident:"),
    factorRoute(":murder:"),
    { label: "주인공:병원 사건", matches: (route) =>
      route.conditionKey.startsWith("incident:hospitalIncident:") },
  ],
  "basicTragedy:12": [
    plot("changeOfFuture"),
    role("timeTraveler"),
  ],
  "basicTragedy:13": [
    protectedRoute("keyPerson", "death:killer:"),
    protectedRoute("keyPerson", ":hospitalIncident:"),
    protectedRoute("keyPerson", ":murder:"),
    protectedRoute("friend", ":hospitalIncident:"),
    protectedRoute("friend", ":murder:"),
    role("lovedOne"),
    role("killer"),
    { label: "주인공:병원 사건", matches: (route) =>
      route.conditionKey.startsWith("incident:hospitalIncident:") },
  ],
  "basicTragedy:14": [
    plot("giantTimeBomb"),
    role("lovedOne"),
  ],
};

function main(): void {
  const outputDirectory = process.argv[2];
  if (outputDirectory === undefined) {
    throw new Error("usage: vite-node audit-mastermind-guidance.ts OUTPUT_DIR");
  }
  mkdirSync(outputDirectory, { recursive: true });
  const catalog = loadScenarioCatalog();
  const scenarios = catalog.flatMap((entry) => entry.difficulties.map(
    (difficulty) => {
      const guidance = mastermindGuidance(createGameState(difficulty.scenario));
      const baseRoutes = distanceToLoss(createGameState(difficulty.scenario))
        .reduce((sum, condition) => sum + condition.routes.length, 0);
      return {
        key: `${entry.id}#difficulty-${difficulty.index + 1}`,
        baseRouteCount: baseRoutes,
        routeCount: guidance.routes.length,
        primary: guidance.primary?.key,
        alternatives: guidance.alternatives.map(({ key }) => key),
        automaticRiskCount: guidance.automaticRisks.length,
        protagonistChoiceCount: guidance.protagonistChoices.length,
      };
    }
  ));

  const officialComparison = Object.entries(OFFICIAL_EXPECTATIONS).map(
    ([id, expectations]) => {
      const entry = catalog.find((candidate) => candidate.id === id);
      if (entry === undefined) throw new Error(`missing official scenario ${id}`);
      const scenario = entry.difficulties[0].scenario;
      const guidance = mastermindGuidance(createGameState(scenario));
      const checks = expectations.map(({ label, matches }) => ({
        label,
        matched: guidance.routes.some((route) => matches(route, scenario.cast)),
      }));
      const rawIndex = Number(id.split(":")[1]) - 1;
      const raw = basicScriptsJson[rawIndex] as { mastermindHints?: unknown };
      const hint = raw.mastermindHints;
      return {
        id,
        title: entry.rawTitle,
        expectedMechanisms: checks.length,
        matchedMechanisms: checks.filter(({ matched }) => matched).length,
        missing: checks.filter(({ matched }) => !matched).map(({ label }) => label),
        mastermindHintsField: typeof hint === "string" ? hint : "<missing>",
        mastermindHintsHasContent: typeof hint === "string" &&
          hint.trim() !== "" && !hint.startsWith("See Tragedy Looper"),
      };
    },
  );

  const deterministic = {
    schema: "mastermind-pre-game-guidance-audit-v1",
    scenariosAttempted: scenarios.length,
    scenariosReturned: scenarios.filter(({ routeCount }) => routeCount > 0).length,
    scenariosWithNoRoute: scenarios.filter(({ routeCount }) => routeCount === 0)
      .map(({ key }) => key),
    totalGeneratedRoutes: scenarios.reduce(
      (sum, { routeCount }) => sum + routeCount,
      0,
    ),
    totalBaseRiskRoutes: scenarios.reduce(
      (sum, { baseRouteCount }) => sum + baseRouteCount,
      0,
    ),
    scenarios,
    officialComparison,
    officialMechanismsExpected: officialComparison.reduce(
      (sum, row) => sum + row.expectedMechanisms,
      0,
    ),
    officialMechanismsMatched: officialComparison.reduce(
      (sum, row) => sum + row.matchedMechanisms,
      0,
    ),
    officialHintsWithEmbeddedContent: officialComparison.filter(
      ({ mastermindHintsHasContent }) => mastermindHintsHasContent,
    ).length,
  };
  const result = {
    deterministic,
    deterministicHash: sha256(canonicalStringify(deterministic)),
  };
  writeFileSync(
    join(outputDirectory, "mastermind-guidance-audit.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify({
    deterministicHash: result.deterministicHash,
    scenariosAttempted: deterministic.scenariosAttempted,
    scenariosReturned: deterministic.scenariosReturned,
    scenariosWithNoRoute: deterministic.scenariosWithNoRoute,
    totalGeneratedRoutes: deterministic.totalGeneratedRoutes,
    totalBaseRiskRoutes: deterministic.totalBaseRiskRoutes,
    officialMechanismsExpected: deterministic.officialMechanismsExpected,
    officialMechanismsMatched: deterministic.officialMechanismsMatched,
    officialHintsWithEmbeddedContent: deterministic.officialHintsWithEmbeddedContent,
    officialMissing: officialComparison.flatMap(({ id, missing }) =>
      missing.map((label) => `${id}:${label}`)
    ),
  }, null, 2)}\n`);
}

main();
