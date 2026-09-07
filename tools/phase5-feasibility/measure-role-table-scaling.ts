import { writeFileSync } from "node:fs";

import { loadScenarioCatalog } from "../../src/scenario-catalog";
import {
  evaluateRoleTableHypotheses,
  evaluateRoleTableHypothesesReference,
  profileRoleTableHypotheses,
  type ProtagonistObservation,
  type RoleTableHypothesisEvaluation,
  type RoleTablePerformanceProfile,
} from "../../src/engine/hypothesis";
import { evaluateIncidentHypotheses } from "../../src/engine/incident-hypothesis";
import { createGameState } from "../../src/engine/game";
import {
  effectiveRole,
  type CharacterId,
  type Location,
  type PublicObservationAt,
  type PublicObservationContext,
  type Scenario,
} from "../../src/types";

const LOCATIONS: readonly Location[] = [
  "Hospital",
  "Shrine",
  "City",
  "School",
];

function naughtyCatScenario(): Scenario {
  const entry = loadScenarioCatalog().find(({ id }) =>
    id === "community:naughty-cat"
  );
  if (entry === undefined) throw new Error("missing community:naughty-cat");
  return structuredClone(entry.scenario);
}

function observationContext(
  cast: readonly CharacterId[],
  loop: number,
  day: number,
): PublicObservationContext {
  const characters: NonNullable<PublicObservationContext["characters"]> = {};
  for (let index = 0; index < cast.length; index += 1) {
    const character = cast[index];
    if (character === undefined) continue;
    const location = character === "popIdol" || character === "patient"
      ? "Hospital"
      : LOCATIONS[(index + loop + day) % LOCATIONS.length] ?? "School";
    characters[character] = {
      status: "alive",
      location,
      abilityLocations: [location],
      goodwill: 0,
      paranoia: 0,
      intrigue: 0,
    };
  }
  return {
    locationIntrigue: {
      Hospital: 0,
      Shrine: 0,
      City: 0,
      School: 0,
    },
    characters,
  };
}

function observedAt(
  loop: number,
  day: number,
  phase: PublicObservationAt["phase"],
  sequence: number,
  variant: number,
): PublicObservationAt {
  return { loop, day, phase, sequence: variant * 1_000 + sequence };
}

function observationsAt(
  scenario: Scenario,
  loopCount: number,
  variant: number,
): ProtagonistObservation[] {
  const cast = Object.keys(scenario.cast);
  const observations: ProtagonistObservation[] = [];
  let sequence = 0;
  for (let loop = 1; loop <= loopCount; loop += 1) {
    for (let day = 1; day <= scenario.daysPerLoop; day += 1) {
      const context = observationContext(cast, loop, day);
      observations.push({
        kind: "roundEvidence",
        loop,
        record: {
          day,
          observedAt: observedAt(
            loop,
            day,
            "P9_ROUND_END",
            sequence,
            variant,
          ),
          roundEndPairs: [{
            location: "Hospital",
            characters: ["popIdol", "patient"],
            paranoia: [0, 0],
            intrigue: [0, 0],
          }],
        },
        context,
        lastDay: day === scenario.daysPerLoop,
        protectedAtRoundEnd: [],
        deathReactions: [],
        observedAt: observedAt(
          loop,
          day,
          "P9_ROUND_END",
          sequence++,
          variant,
        ),
      });
      observations.push({
        kind: "mastermindAbilityResult",
        loop,
        day,
        timing: "P5_MASTERMIND_ABILITY",
        changes: [{
          kind: "counter",
          target: { kind: "character", id: "patient" },
          counter: "paranoia",
          delta: 1,
        }],
        context,
        observedAt: observedAt(
          loop,
          day,
          "P5_MASTERMIND_ABILITY",
          sequence++,
          variant,
        ),
      });
    }

    for (const scheduled of scenario.incidents) {
      const context = observationContext(cast, loop, scheduled.day);
      observations.push({
        kind: "incidentOccurred",
        loop,
        day: scheduled.day,
        incident: scheduled.incident,
        occurred: false,
        context,
        changes: [],
        deaths: [],
        observedAt: observedAt(
          loop,
          scheduled.day,
          "P7_INCIDENT",
          sequence++,
          variant,
        ),
      });
    }

    if (loop > 1) {
      for (const character of ["patient", "nurse"] as const) {
        observations.push({
          kind: "goodwillAccepted",
          loop,
          day: character === "patient" ? 2 : 4,
          character,
          rank: 1,
          abilityIndex: 0,
          observedAt: observedAt(
            loop,
            character === "patient" ? 2 : 4,
            "P6_GOODWILL",
            sequence++,
            variant,
          ),
        });
      }
    }
  }
  return observations;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function medianProfile(
  profiles: readonly RoleTablePerformanceProfile[],
): RoleTablePerformanceProfile {
  const keys = Object.keys(profiles[0] ?? {}) as Array<
    keyof RoleTablePerformanceProfile
  >;
  return Object.fromEntries(keys.map((key) => [
    key,
    median(profiles.map((profile) => profile[key])),
  ])) as unknown as RoleTablePerformanceProfile;
}

function roleSignature(evaluation: RoleTableHypothesisEvaluation): object {
  return {
    remaining: evaluation.remaining.map(({ id }) => id).sort(),
    propagationPasses: evaluation.propagationPasses,
    cells: Object.fromEntries(evaluation.table.characters.map((character) => [
      character,
      Object.fromEntries(evaluation.table.roles.map((role) => [
        role,
        evaluation.table.cells[character]?.[role]?.status,
      ])),
    ])),
  };
}

const scenario = naughtyCatScenario();
const cast = Object.keys(scenario.cast);
const actualState = createGameState(scenario);
const rows = [3, 4, 5].map((loopCount) => {
  const profiles: RoleTablePerformanceProfile[] = [];
  for (let sample = 0; sample < 3; sample += 1) {
    const observations = observationsAt(scenario, loopCount, sample + 1);
    const { profile } = profileRoleTableHypotheses(
      scenario.tragedySet,
      cast,
      observations,
    );
    profiles.push(profile);
  }
  const observations = observationsAt(scenario, loopCount, 99);
  const optimized = evaluateRoleTableHypotheses(
    scenario.tragedySet,
    cast,
    observations,
  );
  const reference = evaluateRoleTableHypothesesReference(
    scenario.tragedySet,
    cast,
    observations,
  );
  const optimizedIncident = evaluateIncidentHypotheses(
    cast,
    scenario.incidents,
    observations,
  );
  const referenceIncident = evaluateIncidentHypotheses(
    cast,
    scenario.incidents,
    observations,
  );
  const roleAndRulesEqual = JSON.stringify(optimized) ===
    JSON.stringify(reference);
  const incidentsEqual = JSON.stringify(optimizedIncident) ===
    JSON.stringify(referenceIncident);
  if (!roleAndRulesEqual || !incidentsEqual) {
    throw new Error(`optimized result mismatch at loop ${loopCount}`);
  }
  const actualRoleImpossible = cast.flatMap((character) => {
    const role = effectiveRole(actualState, character);
    return optimized.table.cells[character]?.[role]?.status ===
        "impossible"
      ? [`${character}:${role}`]
      : [];
  });
  const actualCombinationRemains = optimized.remaining.some(
    ({ mainPlot, subPlots }) =>
      mainPlot === scenario.mainPlot &&
      subPlots.length === scenario.subPlots.length &&
      subPlots.every((plot) => scenario.subPlots.includes(plot)),
  );
  return {
    loopCount,
    observationCount: observations.length,
    crossObservationCount: observations.filter(({ kind }) =>
      kind !== "incidentOccurred"
    ).length,
    profile: medianProfile(profiles),
    actualRoleImpossible,
    actualCombinationRemains,
    referenceMatches: {
      roleTableAndRules: roleAndRulesEqual,
      incidents: incidentsEqual,
    },
    signatures: {
      roleAndRules: roleSignature(optimized),
      incidents: {
        propagationPasses: optimizedIncident.propagationPasses,
        cells: Object.fromEntries(optimizedIncident.characters.map((character) => [
          character,
          Object.fromEntries(optimizedIncident.columns.map(({ id }) => [
            id,
            optimizedIncident.cells[character]?.[id]?.status,
          ])),
        ])),
      },
    },
  };
});

const report = {
  schema: "naughty-cat-role-table-scaling-v1",
  generatedAt: new Date().toISOString(),
  scenario: "community:naughty-cat",
  samplesPerLoop: 3,
  rows,
};
const output = process.argv[2];
if (output !== undefined) {
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
