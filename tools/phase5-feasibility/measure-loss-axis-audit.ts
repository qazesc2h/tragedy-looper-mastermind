import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { characterDataOf } from "../../src/data";
import {
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
} from "../../src/engine/game";
import { distanceToLoss } from "../../src/engine/loss";
import { loadScenarioCatalog } from "../../src/scenario-catalog";
import {
  effectiveRole,
  isCharacterDead,
  type GameState,
  type PlacedCard,
  type RoleId,
} from "../../src/types";
import { canonicalStringify, engineStateKey } from "./canonical-state";
import {
  applyJointAction,
  closedCharacterProjections,
  decisionContext,
  mastermindActions,
  protagonistResponses,
  sha256,
  type ClosedCharacterProjection,
  type DecisionContext,
} from "./measure-action-equivalence";
import {
  representativeStateForDay,
  stratifiedCandidates,
} from "./evaluation-variance-shared";

const RELEVANT_PROTAGONIST_CARDS = new Set([
  "moveVertical",
  "moveHorizontal",
  "forbidMove",
  "forbidIntrigue",
  "paranoiaPlus1",
  "paranoiaMinus1",
]);

interface ScenarioActors {
  keyPerson: string;
  killer: string;
  serialKiller: string;
  suicideCulprit: string;
  suicideDay: number;
}

interface LossRouteVector {
  keyPersonDead: boolean;
  killerKillsKeyPerson: {
    keyPersonIntrigueRemaining: number;
    sameLocation: boolean;
  };
  serialKillerKillsKeyPerson: {
    keyPersonSameLocation: boolean;
    otherLivingAtSerialKillerLocation: number;
    conditionMet: boolean;
  };
  suicideKillsKeyPerson: {
    paranoiaRemaining: number;
    incidentDay: number;
    firesOnCurrentDay: boolean;
  };
  killerKillsProtagonists: {
    killerIntrigueRemaining: number;
  };
}

function elapsedMilliseconds(started: bigint): number {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function characterWithRole(state: GameState, role: RoleId): string {
  const character = Object.keys(state.loop.board).find(
    (candidate) => effectiveRole(state, candidate) === role,
  );
  if (character === undefined) throw new Error(`missing role ${role}`);
  return character;
}

function scenarioActors(state: GameState): ScenarioActors {
  const suicide = state.scenario.incidents.find(
    ({ incident }) => incident === "suicide",
  );
  if (suicide === undefined) throw new Error("missing suicide incident");
  return {
    keyPerson: characterWithRole(state, "keyPerson"),
    killer: characterWithRole(state, "killer"),
    serialKiller: characterWithRole(state, "serialKiller"),
    suicideCulprit: suicide.culprit,
    suicideDay: suicide.day,
  };
}

function projectionMap(
  projections: readonly ClosedCharacterProjection[],
): Map<string, ClosedCharacterProjection> {
  return new Map(projections.map((projection) => [
    projection.character,
    projection,
  ]));
}

function requiredProjection(
  projections: ReadonlyMap<string, ClosedCharacterProjection>,
  character: string,
): ClosedCharacterProjection {
  const projection = projections.get(character);
  if (projection === undefined) throw new Error(`missing ${character} projection`);
  return projection;
}

/**
 * firstSteps:2 원문의 네 가지 승리 경로를 합산하지 않고 필드별로 보존한다.
 * `role:keyPerson:*`의 0/1은 현재 사망 여부일 뿐이므로 별도 endpoint로 둔다.
 */
function lossRouteVector(
  state: GameState,
  projections: readonly ClosedCharacterProjection[],
  actors: ScenarioActors,
): LossRouteVector {
  const byCharacter = projectionMap(projections);
  const keyPerson = requiredProjection(byCharacter, actors.keyPerson);
  const killer = requiredProjection(byCharacter, actors.killer);
  const serialKiller = requiredProjection(byCharacter, actors.serialKiller);
  const suicideCulprit = requiredProjection(byCharacter, actors.suicideCulprit);
  const otherLivingAtSerialKillerLocation = projections.filter(
    ({ character, location }) =>
      character !== actors.serialKiller && location === serialKiller.location,
  ).length;
  const keyPersonSameLocation = keyPerson.location === serialKiller.location;
  const paranoiaNeeded = characterDataOf(actors.suicideCulprit).paranoiaLimit;
  const paranoiaRemaining = Math.max(0, paranoiaNeeded - suicideCulprit.paranoia);

  return {
    keyPersonDead: isCharacterDead(state.loop.board[actors.keyPerson]),
    killerKillsKeyPerson: {
      keyPersonIntrigueRemaining: Math.max(0, 2 - keyPerson.intrigue),
      sameLocation: keyPerson.location === killer.location,
    },
    serialKillerKillsKeyPerson: {
      keyPersonSameLocation,
      otherLivingAtSerialKillerLocation,
      conditionMet: keyPersonSameLocation &&
        otherLivingAtSerialKillerLocation === 1,
    },
    suicideKillsKeyPerson: {
      paranoiaRemaining,
      incidentDay: actors.suicideDay,
      firesOnCurrentDay:
        state.loop.day === actors.suicideDay && paranoiaRemaining === 0,
    },
    killerKillsProtagonists: {
      killerIntrigueRemaining: Math.max(0, 4 - killer.intrigue),
    },
  };
}

function literalDistanceProjection(
  state: GameState,
  projections: readonly ClosedCharacterProjection[],
  actors: ScenarioActors,
): string {
  const byCharacter = projectionMap(projections);
  const killer = requiredProjection(byCharacter, actors.killer);
  return canonicalStringify([
    {
      key: `role:keyPerson:${actors.keyPerson}`,
      requirements: [{
        key: "dead",
        current: Number(isCharacterDead(state.loop.board[actors.keyPerson])),
        needed: 1,
      }],
    },
    {
      key: `role:killer:${actors.killer}`,
      requirements: [{
        key: "intrigue",
        current: killer.intrigue,
        needed: 4,
      }],
    },
  ].sort((left, right) => left.key.localeCompare(right.key)));
}

function responseEffectSignature(response: readonly PlacedCard[]): string {
  return canonicalStringify({
    intrigueForbidActive:
      response.filter(({ card }) => card === "forbidIntrigue").length === 1,
    characterEffects: response.flatMap((placement) =>
      placement.target.kind === "character" &&
          RELEVANT_PROTAGONIST_CARDS.has(placement.card)
        ? [{ target: placement.target.id, card: placement.card }]
        : []
    ).sort((left, right) =>
      left.target.localeCompare(right.target) || left.card.localeCompare(right.card)
    ),
  });
}

function projectionFromState(
  state: GameState,
  characters: readonly string[],
): ClosedCharacterProjection[] {
  return characters.map((character) => {
    const position = state.loop.board[character];
    const counters = state.loop.charCounters[character];
    if (position?.status !== "alive" || counters === undefined) {
      throw new Error(`expected living ${character}`);
    }
    return {
      character,
      location: position.at,
      paranoia: counters.paranoia,
      intrigue: counters.intrigue,
    };
  });
}

function compactResponses(context: DecisionContext) {
  const representatives = new Map<string, PlacedCard[]>();
  let rawResponses = 0;
  for (const response of protagonistResponses(context)) {
    const signature = responseEffectSignature(response);
    if (!representatives.has(signature)) {
      representatives.set(signature, structuredClone(response));
    }
    rawResponses += 1;
  }
  return { rawResponses, representatives };
}

function axisPaths(value: unknown, prefix = ""): Array<[string, string]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [[prefix, canonicalStringify(value)]];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    axisPaths(child, prefix === "" ? key : `${prefix}.${key}`)
  );
}

function measureDay(initial: GameState, day: number) {
  const representative = representativeStateForDay(initial, day);
  const state = representative.state;
  const context = decisionContext(state);
  const actors = scenarioActors(state);
  const population = mastermindActions(context);
  const candidates = stratifiedCandidates(population);
  const compact = compactResponses(context);
  const axisVaryingCounts = new Map<string, number>();
  let literalInvariant = 0;
  let correctedInvariant = 0;
  let closedProjectionMismatches = 0;
  let signatureMismatches = 0;
  const candidateRows = [];

  for (const [sampleIndex, candidate] of candidates.entries()) {
    const literalVectors = new Set<string>();
    const correctedVectors = new Set<string>();
    const axisValues = new Map<string, Set<string>>();
    const vectorByResponseSignature = new Map<string, string>();

    for (const [signature, response] of compact.representatives) {
      const projections = closedCharacterProjections(
        context,
        candidate.placements,
        response,
      );
      const corrected = lossRouteVector(state, projections, actors);
      const correctedKey = canonicalStringify(corrected);
      correctedVectors.add(correctedKey);
      vectorByResponseSignature.set(signature, correctedKey);
      for (const [axis, value] of axisPaths(corrected)) {
        const values = axisValues.get(axis);
        if (values === undefined) axisValues.set(axis, new Set([value]));
        else values.add(value);
      }

      // firstSteps:2의 실제 distanceToLoss 두 반환 조건을 요구사항 단위로 재현한다.
      literalVectors.add(literalDistanceProjection(state, projections, actors));
    }

    if (literalVectors.size === 1) literalInvariant += 1;
    if (correctedVectors.size === 1) correctedInvariant += 1;
    const varyingAxes = [...axisValues].flatMap(([axis, values]) =>
      values.size > 1 ? [axis] : []
    );
    for (const axis of varyingAxes) {
      axisVaryingCounts.set(axis, (axisVaryingCounts.get(axis) ?? 0) + 1);
    }

    // 응답 효과 축약이 원시 응답을 빠뜨리지 않는지 표본 P2 한 개에서 전수 대조한다.
    if (sampleIndex === 0) {
      for (const response of protagonistResponses(context)) {
        const signature = responseEffectSignature(response);
        const expected = vectorByResponseSignature.get(signature);
        const actual = canonicalStringify(lossRouteVector(
          state,
          closedCharacterProjections(context, candidate.placements, response),
          actors,
        ));
        if (expected !== actual) signatureMismatches += 1;
      }
    }

    // 상징 P4 투영과 실제 엔진 경로를 후보별 첫 응답에서 대조한다.
    const firstResponse = compact.representatives.values().next().value as
      | PlacedCard[]
      | undefined;
    if (firstResponse === undefined) throw new Error("no protagonist responses");
    const predicted = closedCharacterProjections(
      context,
      candidate.placements,
      firstResponse,
    );
    const actualState = applyJointAction(
      state,
      candidate.placements,
      firstResponse,
      true,
    );
    const actual = projectionFromState(actualState, context.characters);
    if (canonicalStringify(predicted) !== canonicalStringify(actual)) {
      closedProjectionMismatches += 1;
    }
    if (
      literalDistanceProjection(actualState, actual, actors) !==
        literalDistanceVectorFromEngine(actualState)
    ) closedProjectionMismatches += 1;

    candidateRows.push({
      sampleIndex,
      candidateHash: candidate.hash,
      literalDistanceVectors: literalVectors.size,
      correctedLossRouteVectors: correctedVectors.size,
      varyingAxes,
    });
  }

  return {
    day,
    stateHash: sha256(engineStateKey(state)),
    representativePath: representative.path,
    p2Population: population.length,
    p2Sample: candidates.length,
    rawProtagonistResponses: compact.rawResponses,
    exactResponseEffectClasses: compact.representatives.size,
    literalDistanceToLoss: {
      invariantCandidates: literalInvariant,
      invariantPercent: literalInvariant / candidates.length,
    },
    correctedCompleteLossRoutes: {
      invariantCandidates: correctedInvariant,
      invariantPercent: correctedInvariant / candidates.length,
      varyingCandidates: candidates.length - correctedInvariant,
      axisVaryingCounts: Object.fromEntries(
        [...axisVaryingCounts].sort(([left], [right]) => left.localeCompare(right)),
      ),
    },
    verification: {
      signatureExhaustiveRawResponsesChecked: compact.rawResponses,
      signatureMismatches,
      closedProjectionEngineChecks: candidates.length,
      closedProjectionMismatches,
    },
    candidates: candidateRows,
  };
}

function literalDistanceVectorFromEngine(state: GameState): string {
  return canonicalStringify(distanceToLoss(state).map((condition) => ({
    key: condition.key,
    requirements: condition.requirements.map(({ key, current, needed }) => ({
      key,
      current,
      needed,
    })),
  })).sort((left, right) => left.key.localeCompare(right.key)));
}

function main(): void {
  const outputDirectory = process.argv[2];
  if (outputDirectory === undefined) {
    throw new Error("usage: vite-node measure-loss-axis-audit.ts OUTPUT_DIR");
  }
  mkdirSync(outputDirectory, { recursive: true });
  const entry = loadScenarioCatalog().find(({ id }) => id === "firstSteps:2");
  if (entry === undefined) throw new Error("missing firstSteps:2");
  const initial = createGameState(structuredClone(entry.scenario));
  chooseInitialLeader(initial, 0);
  continueFromTimeGap(initial);
  const started = process.hrtime.bigint();
  const days = [1, 2, 3].map((day) => measureDay(initial, day));
  const deterministic = {
    schema: "phase5-loss-axis-audit-v1",
    scenario: "firstSteps:2",
    comparison:
      "literal distanceToLoss requirements versus source-complete First Steps 2 loss routes",
    stateSelection:
      "reuse the exact previously reported day-1/2/3 state hashes to isolate the axis-definition change; day 2/3 were selected by the now-invalid literal distanceToLoss ordering and are not claimed to be corrected stress representatives",
    correctedAxes: {
      endpoint: "key-person current death status",
      killerKillsKeyPerson:
        "key-person intrigue>=2 and key-person/killer co-location",
      serialKillerKillsKeyPerson:
        "key-person co-location and exactly one other living character with serial killer",
      suicideKillsKeyPerson:
        "scheduled day-3 culprit paranoia reaches printed limit",
      killerKillsProtagonists: "killer intrigue>=4",
    },
    responseCompactionProof:
      "P4 route fields read only character movement, forbid-move, intrigue-forbid, paranoia +/- and the round-wide exactly-one intrigue-forbid flag; owner/resource identity and other cards cannot change these fields",
    days,
  };
  const result = {
    deterministic,
    deterministicHash: sha256(canonicalStringify(deterministic)),
    performance: {
      milliseconds: elapsedMilliseconds(started),
      rssBytes: process.memoryUsage().rss,
    },
  };
  writeFileSync(
    join(outputDirectory, "firstSteps-2-loss-axis-audit.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify({
    deterministicHash: result.deterministicHash,
    performance: result.performance,
    days: days.map((day) => ({
      day: day.day,
      literal: day.literalDistanceToLoss,
      corrected: day.correctedCompleteLossRoutes,
      verification: day.verification,
    })),
  }, null, 2)}\n`);
}

main();
