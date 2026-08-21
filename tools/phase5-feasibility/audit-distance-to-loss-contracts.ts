import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createGameState } from "../../src/engine/game";
import { distanceToLoss, type LossDistance } from "../../src/engine/loss";
import { loadScenarioCatalog } from "../../src/scenario-catalog";
import { canonicalStringify } from "./canonical-state";
import { sha256 } from "./measure-action-equivalence";

interface ExpectedContract {
  source: LossDistance["source"];
  category: LossDistance["category"];
  timing: LossDistance["timing"];
  activation: LossDistance["activation"];
  requirements: string[];
  semantic: string;
}

const PLOT_CONTRACTS: Readonly<Record<string, ExpectedContract>> = {
  lightAvenger: {
    source: "plot",
    category: "plot",
    timing: "loopEnd",
    activation: "mandatory",
    requirements: ["placeXIntrigue"],
    semantic: "resolved place X intrigue reaches 2",
  },
  placeProtect: {
    source: "plot",
    category: "plot",
    timing: "loopEnd",
    activation: "mandatory",
    requirements: ["schoolIntrigue"],
    semantic: "School intrigue reaches 2",
  },
  sealedItem: {
    source: "plot",
    category: "plot",
    timing: "loopEnd",
    activation: "mandatory",
    requirements: ["shrineIntrigue"],
    semantic: "Shrine intrigue reaches 2",
  },
  signWithMe: {
    source: "plot",
    category: "plot",
    timing: "loopEnd",
    activation: "mandatory",
    requirements: ["keyPersonIntrigue"],
    semantic: "actual key-person intrigue reaches 2",
  },
  changeOfFuture: {
    source: "plot",
    category: "plot",
    timing: "loopEnd",
    activation: "mandatory",
    requirements: ["butterflyEffectFired"],
    semantic: "butterflyEffect incident has fired in this loop",
  },
  giantTimeBomb: {
    source: "plot",
    category: "plot",
    timing: "loopEnd",
    activation: "mandatory",
    requirements: ["placeXIntrigue"],
    semantic: "resolved place X intrigue reaches 2",
  },
};

const ROLE_CONTRACTS: Readonly<Record<string, ExpectedContract>> = {
  keyPerson: {
    source: "role",
    category: "protectedCharacter",
    timing: "immediate",
    activation: "mandatory",
    requirements: ["dead"],
    semantic: "current key-person death endpoint, not intrigue progress",
  },
  timeTraveler: {
    source: "role",
    category: "protectedCharacter",
    timing: "lastDay",
    activation: "optional",
    requirements: ["goodwill"],
    semantic: "time-traveler goodwill reaches 3 on the last day",
  },
  friend: {
    source: "role",
    category: "protectedCharacter",
    timing: "loopEnd",
    activation: "mandatory",
    requirements: ["dead"],
    semantic: "current friend death endpoint, not a death-route distance",
  },
  killer: {
    source: "role",
    category: "protagonistDeath",
    timing: "dayEnd",
    activation: "optional",
    requirements: ["intrigue"],
    semantic: "killer's own intrigue reaches 4",
  },
  lovedOne: {
    source: "role",
    category: "protagonistDeath",
    timing: "dayEnd",
    activation: "optional",
    requirements: ["paranoia", "intrigue"],
    semantic:
      "loved-one paranoia reaches 3 and intrigue reaches 1; top-level remaining sums unlike axes",
  },
};

const INCIDENT_CONTRACTS: Readonly<Record<string, ExpectedContract>> = {
  hospitalIncident: {
    source: "incident",
    category: "protagonistDeath",
    timing: "incident",
    activation: "mandatory",
    requirements: ["culpritAlive", "culpritParanoia", "hospitalIntrigue"],
    semantic:
      "culprit alive, culprit paranoia limit, and Hospital intrigue 2; top-level remaining sums unlike axes",
  },
};

function expectedContract(condition: LossDistance): ExpectedContract | undefined {
  if (condition.plot !== undefined) return PLOT_CONTRACTS[condition.plot];
  if (condition.role !== undefined) return ROLE_CONTRACTS[condition.role];
  if (condition.incident !== undefined) {
    return INCIDENT_CONTRACTS[condition.incident];
  }
  return undefined;
}

function contractMismatch(condition: LossDistance): string[] {
  const expected = expectedContract(condition);
  if (expected === undefined) return ["missing expected contract"];
  const actualRequirements = condition.requirements.map(({ key }) => key);
  return [
    condition.source === expected.source ? undefined :
      `source ${condition.source} != ${expected.source}`,
    condition.category === expected.category ? undefined :
      `category ${condition.category} != ${expected.category}`,
    condition.timing === expected.timing ? undefined :
      `timing ${condition.timing} != ${expected.timing}`,
    condition.activation === expected.activation ? undefined :
      `activation ${condition.activation} != ${expected.activation}`,
    canonicalStringify(actualRequirements) ===
        canonicalStringify(expected.requirements)
      ? undefined
      : `requirements ${actualRequirements.join(",")} != ${
        expected.requirements.join(",")
      }`,
  ].flatMap((value) => value === undefined ? [] : [value]);
}

function main(): void {
  const outputDirectory = process.argv[2];
  if (outputDirectory === undefined) {
    throw new Error(
      "usage: vite-node audit-distance-to-loss-contracts.ts OUTPUT_DIR",
    );
  }
  mkdirSync(outputDirectory, { recursive: true });
  const scenarios = [];
  const returnedContracts = new Map<string, {
    contract: ExpectedContract;
    examples: string[];
  }>();
  const mismatches = [];
  const errors = [];

  for (const entry of loadScenarioCatalog()) {
    for (const difficulty of entry.difficulties) {
      const scenarioKey = `${entry.id}#difficulty-${difficulty.index + 1}`;
      const state = createGameState(structuredClone(difficulty.scenario));
      try {
        const conditions = distanceToLoss(state);
        scenarios.push({
          scenario: scenarioKey,
          conditions: conditions.map(({ key }) => key),
        });
        for (const condition of conditions) {
          const expected = expectedContract(condition);
          const conditionMismatches = contractMismatch(condition);
          if (conditionMismatches.length > 0) {
            mismatches.push({
              scenario: scenarioKey,
              key: condition.key,
              mismatches: conditionMismatches,
            });
          }
          if (expected === undefined) continue;
          const signature = canonicalStringify({
            discriminator: condition.plot ?? condition.role ?? condition.incident,
            ...expected,
          });
          const row = returnedContracts.get(signature);
          if (row === undefined) {
            returnedContracts.set(signature, {
              contract: expected,
              examples: [`${scenarioKey}:${condition.key}`],
            });
          } else if (row.examples.length < 3) {
            row.examples.push(`${scenarioKey}:${condition.key}`);
          }
        }
      } catch (error) {
        errors.push({
          scenario: scenarioKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const deterministic = {
    schema: "phase5-distance-to-loss-contract-audit-v1",
    coverage:
      "every bundled scenario difficulty at createGameState initial loop state",
    scenariosAttempted: scenarios.length + errors.length,
    scenariosReturned: scenarios.length,
    scenariosErrored: errors.length,
    returnedContracts: [...returnedContracts.values()],
    contractMismatches: mismatches,
    unsupportedScenarioErrors: errors,
    semanticWarnings: [
      "role:keyPerson and role:friend measure only current death endpoints; they omit every causal death route",
      "multi-requirement top-level remaining is an arithmetic sum; consumers needing separate axes must read requirements",
      "incident loss distance implements only hospitalIncident; other lossDeath incidents make distanceToLoss throw",
    ],
  };
  const result = {
    deterministic,
    deterministicHash: sha256(canonicalStringify(deterministic)),
  };
  writeFileSync(
    join(outputDirectory, "distance-to-loss-contract-audit.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify({
    deterministicHash: result.deterministicHash,
    scenariosAttempted: deterministic.scenariosAttempted,
    scenariosReturned: deterministic.scenariosReturned,
    scenariosErrored: deterministic.scenariosErrored,
    returnedContracts: deterministic.returnedContracts.length,
    contractMismatches: deterministic.contractMismatches.length,
    unsupportedScenarioErrors: deterministic.unsupportedScenarioErrors,
  }, null, 2)}\n`);
}

main();
