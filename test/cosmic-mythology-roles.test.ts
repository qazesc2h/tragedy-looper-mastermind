import { describe, expect, it } from "vitest";

import { killCharacter } from "../src/engine/death";
import { resolveGoodwillAbility } from "../src/engine/goodwill";
import { incidentParanoia } from "../src/engine/incident";
import { distanceToLoss, setOptionalLossActivation } from "../src/engine/loss";
import { applyHookEffect, collectHooks, resolveHooks } from "../src/engine/phases";
import { roleIsImmortal } from "../src/engine/role-properties";
import { initLoop } from "../src/engine/setup";
import { validateScenario } from "../src/engine/validate";
import {
  effectiveAbilityRoles,
  effectiveGoodwillRefusal,
  ROLE_IMPL,
} from "../src/impl/roles";
import type { GameState, RoleId, Scenario } from "../src/types";
import { boardIsAlive, setBoardLocation } from "./helpers";

function cosmicState(
  cast: Record<string, RoleId>,
  subPlots = ["resistance", "peopleWhoSaw"],
): GameState {
  const scenario: Scenario = {
    tragedySet: "cosmicMythology",
    mainPlot: "kingYellow",
    subPlots,
    cast,
    incidents: [],
    loops: 3,
    daysPerLoop: 4,
  };
  const loop = initLoop(scenario);
  for (const character of Object.keys(cast)) {
    setBoardLocation(loop, character, "City");
  }
  return { scenario, gamePhase: "ROUND", loop, history: [], loopOutcomes: [] };
}

describe("Cosmic Mythology role metadata", () => {
  it("registers the five new implementations and preserves the two reused roles", () => {
    expect(Object.fromEntries([
      "sacrifice",
      "deepOne",
      "wizard",
      "witness",
      "faceless",
      "paranoiac",
      "immortalRole",
    ].map((role) => [role, ROLE_IMPL[role].hooks.length]))).toEqual({
      sacrifice: 3,
      deepOne: 2,
      wizard: 2,
      witness: 1,
      faceless: 2,
      paranoiac: 1,
      immortalRole: 0,
    });
    expect(ROLE_IMPL.deepOne.max).toBe(1);
    expect(ROLE_IMPL.wizard.max).toBe(1);
    expect(roleIsImmortal("sacrifice")).toBe(true);
    expect(roleIsImmortal("faceless")).toBe(true);
    expect(ROLE_IMPL.deepOne.hooks[1].source.description).toBe(
      "When this charcter dies, reveal the role and increast the Extra Gauge 1 step.",
    );
    expect(ROLE_IMPL.wizard.hooks[1].source.description).toBe(
      "When this character’s :goodwill: ability is used, reveal this role after resolution. Then, the leader may increase the Extra Gauge one step.",
    );
  });
});

describe("Cosmic Mythology role effects", () => {
  it("lets Sacrifice count intrigue as paranoia and kill all characters on activation", () => {
    const state = cosmicState({
      boyStudent: "sacrifice",
      girlStudent: "person",
      officeWorker: "person",
    });
    state.loop.charCounters.boyStudent.paranoia = 1;
    state.loop.charCounters.boyStudent.intrigue = 2;
    expect(incidentParanoia(state, "boyStudent", "missingPerson")).toBe(3);
    state.loop.phase = "P9_ROUND_END";
    expect(distanceToLoss(state).find(({ role }) => role === "sacrifice")?.met)
      .toBe(false);

    state.loop.charCounters.boyStudent.paranoia = 2;
    const condition = distanceToLoss(state).find(
      ({ role }) => role === "sacrifice",
    );
    expect(condition?.met).toBe(true);
    setOptionalLossActivation(state, condition!.key, true);
    expect(boardIsAlive(state.loop, "boyStudent")).toBe(true);
    expect(boardIsAlive(state.loop, "girlStudent")).toBe(false);
    expect(boardIsAlive(state.loop, "officeWorker")).toBe(false);
    expect(state.pendingLoopEnd?.reason).toBe("protagonistDeath");
  });

  it("applies Deep One intrigue and reveals/increases the gauge when it dies", () => {
    const state = cosmicState({ boyStudent: "deepOne", girlStudent: "person" });
    const entry = collectHooks(state, "P5_MASTERMIND_ABILITY").find(
      ({ self, hook }) => self === "boyStudent" && hook.kind === "optional",
    )!;
    applyHookEffect(
      state,
      "P5_MASTERMIND_ABILITY",
      entry.hook,
      entry.self,
      { kind: "character", id: "girlStudent" },
    );
    expect(state.loop.charCounters.girlStudent.intrigue).toBe(1);
    expect(() => applyHookEffect(
      state,
      "P5_MASTERMIND_ABILITY",
      entry.hook,
      entry.self,
      { kind: "location", at: "Hospital" },
    )).toThrow("deepOne requires");

    killCharacter(state, "boyStudent");
    expect(state.loop.specialGauge?.value).toBe(1);
    expect(state.loop.publicInformationThisLoop).toContainEqual(
      expect.objectContaining({
        kind: "roleClaim",
        character: "boyStudent",
        claimedRole: "deepOne",
      }),
    );
  });

  it("reveals Wizard after its goodwill ability and lets the leader increase the gauge", () => {
    const state = cosmicState({ boyStudent: "wizard", girlStudent: "person" });
    state.loop.phase = "P6_GOODWILL";
    state.loop.charCounters.boyStudent.goodwill = 2;
    state.loop.charCounters.girlStudent.paranoia = 1;
    resolveGoodwillAbility(state, {
      user: "boyStudent",
      rank: 2,
      target: "girlStudent",
      wizardGaugeIncrease: true,
    }, "resolve");
    expect(state.loop.charCounters.girlStudent.paranoia).toBe(0);
    expect(state.loop.specialGauge?.value).toBe(1);
    expect(state.loop.publicInformationThisLoop).toContainEqual(
      expect.objectContaining({
        kind: "roleClaim",
        character: "boyStudent",
        claimedRole: "wizard",
      }),
    );

    expect(distanceToLoss(state).find(({ role }) => role === "wizard")?.met)
      .toBe(false);
    state.loop.board.boyStudent = { status: "dead", at: "City" };
    state.gamePhase = "LOOP_JUDGMENT";
    expect(distanceToLoss(state).find(({ role }) => role === "wizard")?.met)
      .toBe(true);
  });

  it("resolves Witness death and gauge increase as one mandatory P9 effect", () => {
    const state = cosmicState({ boyStudent: "witness" });
    state.loop.phase = "P9_ROUND_END";
    state.loop.charCounters.boyStudent.paranoia = 3;
    resolveHooks(state, "P9_ROUND_END");
    expect(boardIsAlive(state.loop, "boyStudent")).toBe(true);
    expect(state.loop.specialGauge?.value).toBe(0);
    state.loop.charCounters.boyStudent.paranoia = 4;
    resolveHooks(state, "P9_ROUND_END");
    expect(boardIsAlive(state.loop, "boyStudent")).toBe(false);
    expect(state.loop.specialGauge?.value).toBe(1);
  });

  it("switches Faceless abilities at current gauge two and grants Key Person to Paranoiac", () => {
    const faceless = cosmicState({ boyStudent: "faceless" });
    faceless.loop.specialGauge!.value = 1;
    expect(effectiveAbilityRoles(faceless, "boyStudent")).toEqual([
      "faceless",
      "conspiracyTheorist",
    ]);
    faceless.loop.specialGauge!.value = 2;
    expect(effectiveAbilityRoles(faceless, "boyStudent")).toEqual([
      "faceless",
      "deepOne",
    ]);
    expect(effectiveGoodwillRefusal(faceless, "boyStudent")).toBe("Optional");

    const ordinaryParanoiac = cosmicState(
      { girlStudent: "paranoiac" },
      ["peopleWhoSaw", "greatRace"],
    );
    expect(effectiveAbilityRoles(ordinaryParanoiac, "girlStudent"))
      .toEqual(["paranoiac"]);

    const whisper = cosmicState(
      { girlStudent: "paranoiac" },
      ["whispersFromDeep", "greatRace"],
    );
    expect(effectiveAbilityRoles(whisper, "girlStudent")).toEqual([
      "paranoiac",
      "keyPerson",
    ]);
    killCharacter(whisper, "girlStudent");
    expect(whisper.loop.pendingImmediateLossKeys).toContain(
      "role:keyPerson:girlStudent",
    );
  });

  it("enforces Sacrifice culprit assignment and the one-copy maxima", () => {
    const invalid: Scenario = {
      tragedySet: "cosmicMythology",
      mainPlot: "choirOuterGod",
      subPlots: ["resistance", "facelessGod"],
      cast: {
        boyStudent: "sacrifice",
        girlStudent: "wizard",
        officeWorker: "wizard",
        informer: "conspiracyTheorist",
      },
      incidents: [],
      loops: 3,
      daysPerLoop: 4,
    };
    const codes = validateScenario(invalid).diagnostics.map(({ code }) => code);
    expect(codes).toContain("SACRIFICE_NOT_INCIDENT_CULPRIT");
    expect(codes).toContain("ROLE_COUNT_EXCEEDED");
  });
});
