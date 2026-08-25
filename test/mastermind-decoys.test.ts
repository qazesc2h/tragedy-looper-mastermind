import { describe, expect, it } from "vitest";

import { createGameState } from "../src/engine/game";
import {
  ATTRIBUTE_REQUIREMENT_AUDIT,
  INTRIGUE_REQUIREMENT_AUDIT,
  mastermindDecoyGuidance,
  PLOT_OBSERVATION_PROFILES,
} from "../src/engine/mastermind-decoys";
import { PLOT_IMPL } from "../src/impl/plots";
import { loadScenarioCatalog } from "../src/scenario-catalog";

function stateFor(id: string, difficultyIndex = 0) {
  const entry = loadScenarioCatalog().find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`missing scenario ${id}`);
  const difficulty = entry.difficulties.find(
    ({ index }) => index === difficultyIndex,
  );
  if (difficulty === undefined) {
    throw new Error(`missing scenario difficulty ${id}#${difficultyIndex}`);
  }
  return createGameState(difficulty.scenario);
}

describe("mastermind decoy guidance", () => {
  it("generates C for all 47 bundled difficulties", () => {
    const results = loadScenarioCatalog().flatMap((entry) =>
      entry.difficulties.map((difficulty) => ({
        key: `${entry.id}#${difficulty.index}`,
        guidance: mastermindDecoyGuidance(
          createGameState(difficulty.scenario),
        ),
      }))
    );

    expect(results).toHaveLength(47);
    for (const { key, guidance } of results) {
      expect(guidance.confusableRules.length, key).toBeGreaterThan(0);
      expect(guidance.fakeLossConditions.length, key).toBeGreaterThan(0);
      expect(guidance.locationIntrigueSources.length, key).toBeGreaterThanOrEqual(2);
      expect(new Set(guidance.fakeLossConditions.map(({ key: planKey }) =>
        planKey
      )).size, key).toBe(guidance.fakeLossConditions.length);
    }
  });

  it("lists every girl in the scenario and marks only the real key person", () => {
    const guidance = mastermindDecoyGuidance(stateFor("basicTragedy:1"));
    const group = guidance.attributeCandidates.find(({ key }) =>
      key === "plot:signWithMe:girl"
    );

    expect(group).toBeDefined();
    expect(group?.candidates).toEqual(expect.arrayContaining([
      "girlStudent",
      "shrineMaiden",
      "classRep",
    ]));
    expect(group?.actualHolders).toHaveLength(1);
    expect(group?.candidates).toContain(group?.actualHolders[0]);
  });

  it("pairs rules by observation type only within the current tragedy set", () => {
    const sealed = mastermindDecoyGuidance(stateFor("basicTragedy:8"))
      .confusableRules.find(({ key }) =>
        key === "sealedItem:locationIntrigueLoss"
      );
    const murder = mastermindDecoyGuidance(stateFor("basicTragedy:13"))
      .confusableRules.find(({ key }) => key === "murderPlan:keyPersonDeath");

    expect(sealed?.alternatives.map(({ plot }) => plot)).toContain(
      "giantTimeBomb",
    );
    expect(sealed?.alternatives.map(({ plot }) => plot)).not.toContain(
      "placeProtect",
    );
    expect(murder?.alternatives.map(({ plot }) => plot)).toContain("signWithMe");
    expect(Object.keys(PLOT_OBSERVATION_PROFILES).sort()).toEqual(
      Object.keys(PLOT_IMPL).sort(),
    );
    expect(Object.values(PLOT_OBSERVATION_PROFILES).every(
      (profiles) => profiles.length > 0,
    )).toBe(true);
  });

  it("omits visible key-person deaths and undeliverable protagonist-death decoys", () => {
    const guidance = mastermindDecoyGuidance(stateFor("basicTragedy:8"));
    const keys = guidance.fakeLossConditions.map(({ explanationKey }) =>
      explanationKey
    );

    expect(keys).not.toContain("role:keyPerson");
    expect(keys).not.toContain("role:factor");
    expect(keys).not.toContain("role:killer");
    expect(keys).not.toContain("role:lovedOne");
  });

  it("keeps location and character intrigue loss decoys distinct", () => {
    const firstSteps = mastermindDecoyGuidance(stateFor("firstSteps:1"));
    const basic = mastermindDecoyGuidance(stateFor("basicTragedy:8"));
    const byKey = new Map([
      ...firstSteps.fakeLossConditions,
      ...basic.fakeLossConditions,
    ].map((condition) => [
      condition.explanationKey,
      condition,
    ]));

    expect(byKey.get("plot:placeProtect")).toMatchObject({
      targetKind: "location",
      requirement: "학교(장소)에 음모 2개",
    });
    expect(byKey.get("plot:signWithMe")).toMatchObject({
      targetKind: "character",
      requirement: "소녀인 핵심 인물 후보(캐릭터)에 음모 2개",
    });
    expect(byKey.get("plot:signWithMe")?.targets.length).toBeGreaterThan(0);
    expect(INTRIGUE_REQUIREMENT_AUDIT).toEqual([
      expect.objectContaining({ key: "plot:sealedItem", targetKind: "location", target: "신사", amount: 2 }),
      expect.objectContaining({ key: "plot:giantTimeBomb", targetKind: "location", target: "장소 X", amount: 2 }),
      expect.objectContaining({ key: "plot:lightAvenger", targetKind: "location", target: "장소 X", amount: 2 }),
      expect.objectContaining({ key: "plot:placeProtect", targetKind: "location", target: "학교", amount: 2 }),
      expect.objectContaining({ key: "plot:signWithMe", targetKind: "character", target: "핵심 인물", amount: 2 }),
      expect.objectContaining({ key: "role:killer:keyPerson", targetKind: "character", target: "핵심 인물", amount: 2 }),
      expect.objectContaining({ key: "role:killer:self", targetKind: "character", target: "본인", amount: 4 }),
    ]);
  });

  it("shows only location-intrigue methods available to the scenario", () => {
    const catalog = loadScenarioCatalog();
    const sourceKeys = new Set(catalog.flatMap((entry) =>
      entry.difficulties.flatMap((difficulty) =>
        mastermindDecoyGuidance(createGameState(difficulty.scenario))
          .locationIntrigueSources.map(({ key }) => key)
      )
    ));

    expect([...sourceKeys]).toEqual(expect.arrayContaining([
      "card:intriguePlus1",
      "card:intriguePlus2",
      "role:brain",
      "goodwill:journalist:2",
      "plot:unsettlingRumor",
      "trait:blackCat",
    ]));
  });

  it("records every static and dynamic attribute requirement found in expansions", () => {
    expect(ATTRIBUTE_REQUIREMENT_AUDIT).toHaveLength(14);
    expect(ATTRIBUTE_REQUIREMENT_AUDIT.filter(({ kind }) =>
      kind === "scriptBuild"
    )).toHaveLength(7);
    expect(new Set(ATTRIBUTE_REQUIREMENT_AUDIT.map(({ sourcePath }) =>
      sourcePath
    ))).toEqual(new Set([
      "data/base-game/plots.jsonc",
      "data/cosmic-evil/plots.jsonc",
      "data/haunted-stage/plots.jsonc",
      "data/midnight-circle/plots.jsonc",
      "data/last-liar/plots.jsonc",
      "data/rei/plots.jsonc",
      "data/another-horizon/plots.jsonc",
      "data/supernatural/plots.jsonc",
      "data/haunted-stage/roles.jsonc",
      "data/supernatural/roles.jsonc",
      "data/visual-novel/roles.jsonc",
      "data/another-horizon/roles.jsonc",
    ]));
  });
});
