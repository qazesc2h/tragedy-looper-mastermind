import { describe, expect, it } from "vitest";

import { withDeathBatch, killCharacter } from "../src/engine/death";
import {
  advanceGame,
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
  setLoopStartExtraCardChoice,
  setLoopStartTraitLocationChoice,
} from "../src/engine/game";
import {
  incidentFailureReasons,
  resolveIncident,
  resolveIncidentEffect,
} from "../src/engine/incident";
import { validatePlacement } from "../src/engine/legal";
import { evaluateIncidentHypotheses } from "../src/engine/incident-hypothesis";
import {
  evaluateRuleHypotheses,
  type ProtagonistObservation,
  type RuleCombination,
} from "../src/engine/hypothesis";
import { distanceToLoss, evaluateLoss } from "../src/engine/loss";
import { mastermindGuidance } from "../src/engine/mastermind-guidance";
import { mastermindCautions } from "../src/engine/mastermind-cautions";
import { mastermindDecoyGuidance } from "../src/engine/mastermind-decoys";
import { mastermindCoverGuidance } from "../src/engine/mastermind-cover";
import { mastermindOpeningGuidance } from "../src/engine/mastermind-opening";
import { applyHookEffect, collectHooks } from "../src/engine/phases";
import { resolveActions } from "../src/engine/resolve";
import { resolveRoleReveal } from "../src/engine/role-reveal";
import { initLoop } from "../src/engine/setup";
import { PLOT_IMPL } from "../src/impl/plots";
import { ROLE_IMPL } from "../src/impl/roles";
import {
  assertOfficialScenariosValid,
  loadScenarioCatalog,
} from "../src/scenario-catalog";
import {
  effectiveRole,
  type GameState,
  type PlacedCard,
  type Scenario,
} from "../src/types";
import { setBoardLife, setBoardLocation } from "./helpers";

function scenario(
  mainPlot = "secretRecord",
  subPlots: string[] = ["unsafeTrigger", "loveHateSpiral"],
  cast: Scenario["cast"] = {
    boyStudent: "person",
    girlStudent: "person",
    officeWorker: "ninja",
  },
  incidents: Scenario["incidents"] = [],
): Scenario {
  return {
    tragedySet: "midnightZone",
    mainPlot,
    subPlots,
    cast,
    incidents,
    loops: 3,
    daysPerLoop: 4,
  };
}

function stateFor(value: Scenario): GameState {
  return {
    scenario: value,
    gamePhase: "ROUND",
    loop: initLoop(value),
    history: [],
    loopOutcomes: [],
  };
}

describe("Midnight Zone official scripts", () => {
  it("preserves all four scripts but rejects the conflicting Romance Antithesis schedule", () => {
    const entries = loadScenarioCatalog().filter(({ id }) =>
      id.startsWith("midnightZone:")
    );
    expect(entries).toHaveLength(4);
    expect(entries.flatMap(({ difficulties }) => difficulties)).toHaveLength(8);
    const romance = entries.find(({ id }) => id === "midnightZone:4");
    if (romance === undefined) throw new Error("missing Romance Antithesis");
    expect(romance.difficulties.every(({ validation }) =>
      validation.diagnostics.some(({ code }) =>
        code === "INCIDENT_DAY_DUPLICATED"
      )
    )).toBe(true);

    const unambiguousEntries = entries.filter(({ id }) =>
      id !== "midnightZone:4"
    );
    expect(() => assertOfficialScenariosValid(unambiguousEntries)).not.toThrow();
    for (const entry of unambiguousEntries) {
      for (const difficulty of entry.difficulties) {
        const game = createGameState(difficulty.scenario);
        chooseInitialLeader(game, 0);
        if ("henchman" in game.scenario.cast) {
          setLoopStartTraitLocationChoice(game, "henchman", "School");
        }
        expect(() => continueFromTimeGap(game)).not.toThrow();
        expect(game.gamePhase).toBe("ROUND");
      }
    }
  });

  it("does not guess which conflicting day-4 Romance Antithesis row is wrong", () => {
    const entry = loadScenarioCatalog().find(({ id }) =>
      id === "midnightZone:4"
    );
    if (entry === undefined) throw new Error("missing Romance Antithesis");
    expect(entry.scenario.incidents.filter(({ day }) => day === 4))
      .toMatchObject([
        {
          incident: "confession",
          culprit: { kind: "character", id: "officeWorker" },
        },
        {
          incident: "increasingUnease",
          culprit: { kind: "character", id: "girlStudent" },
        },
      ]);
  });

  it("generates guidance A through E for every MZ difficulty", () => {
    const difficulties = loadScenarioCatalog()
      .filter(({ id }) =>
        id.startsWith("midnightZone:") && id !== "midnightZone:4"
      )
      .flatMap(({ difficulties }) => difficulties);
    for (const { scenario: officialScenario } of difficulties) {
      const game = createGameState(officialScenario);
      const guidance = mastermindGuidance(game);
      expect(() => mastermindCautions(game)).not.toThrow();
      expect(() => mastermindDecoyGuidance(game)).not.toThrow();
      expect(() => mastermindCoverGuidance(game, guidance)).not.toThrow();
      expect(() => mastermindOpeningGuidance(game)).not.toThrow();
    }
  });
});

describe("MZ plots", () => {
  it("uses the claimed role for Secret Record, including a Ninja lie", () => {
    const value = scenario("secretRecord", ["unsafeTrigger", "loveHateSpiral"], {
      officeWorker: "ninja",
      boyStudent: "factor",
      girlStudent: "keyPerson",
      policeOfficer: "brain",
      journalist: "conspiracyTheorist",
      boss: "friend",
      richStudent: "obstinate",
    });
    value.scriptSpecified = { "Turf:boss": "School" };
    const game = stateFor(value);
    resolveRoleReveal(game, "officeWorker", "factor", "P6_GOODWILL");
    game.loop.phase = "P9_ROUND_END";
    game.loop.day = game.scenario.daysPerLoop;

    expect(evaluateLoss(game)).toContainEqual(
      expect.objectContaining({ plot: "secretRecord", met: true }),
    );
  });

  it("does not carry a Secret Record reveal into the next loop", () => {
    const value = scenario();
    const game = stateFor(value);
    const previous = structuredClone(game.loop);
    previous.publicInformationThisLoop = [{
      kind: "roleClaim",
      character: "boyStudent",
      claimedRole: "factor",
      loop: 1,
      day: 2,
    }];
    game.history = [previous];
    game.loop = initLoop(value, 2, previous);
    game.loop.phase = "P9_ROUND_END";
    game.loop.day = value.daysPerLoop;

    expect(distanceToLoss(game).find(({ plot }) => plot === "secretRecord"))
      .toMatchObject({ met: false });
  });

  it("applies and clears the Fated Connections Extra Card through loop setup", () => {
    const value = scenario("fatedConnections", ["unansweredHeart", "showtimeDeath"], {
      boyStudent: "magician",
      girlStudent: "friend",
      officeWorker: "serialKiller",
      journalist: "conspiracyTheorist",
      patient: "immortalRole",
    });
    const game = stateFor(value);
    const previous = structuredClone(game.loop);
    setBoardLife(previous, "boyStudent", false);
    game.history = [previous];
    game.loop = initLoop(value, 2, previous);
    game.gamePhase = "LOOP_TIME_GAP";
    setLoopStartExtraCardChoice(game, "fatedConnections", "boyStudent");

    continueFromTimeGap(game);

    expect(game.loop.extraCards).toHaveLength(1);
    expect(effectiveRole(game, "boyStudent")).toBe("keyPerson");

    const completedSecond = structuredClone(game.loop);
    setBoardLife(completedSecond, "boyStudent", true);
    game.history.push(completedSecond);
    game.loop = initLoop(value, 3, completedSecond);
    game.gamePhase = "LOOP_TIME_GAP";
    continueFromTimeGap(game);

    expect(game.loop.extraCards).toEqual([]);
    expect(effectiveRole(game, "boyStudent")).toBe("magician");
  });

  it("does not place a Dice of the Gods card without a prior-loop death", () => {
    const value = scenario("secretRecord", ["diceOfGods", "unsafeTrigger"]);
    const game = stateFor(value);
    game.gamePhase = "LOOP_TIME_GAP";

    continueFromTimeGap(game);

    expect(game.loop.extraCards).toEqual([]);
  });

  it("places a Dice of the Gods card after a prior-loop death", () => {
    const value = scenario("secretRecord", ["diceOfGods", "unsafeTrigger"]);
    const game = stateFor(value);
    const previous = structuredClone(game.loop);
    setBoardLife(previous, "boyStudent", false);
    game.history = [previous];
    game.loop = initLoop(value, 2, previous);
    game.gamePhase = "LOOP_TIME_GAP";
    setLoopStartExtraCardChoice(game, "diceOfGods", "boyStudent");

    continueFromTimeGap(game);

    expect(game.loop.extraCards).toContainEqual(expect.objectContaining({
      cardId: "diceOfGods",
      target: { kind: "character", id: "boyStudent" },
    }));
  });

  it("uses Unsafe Trigger only once and only while a Factor is alive", () => {
    const value = scenario("secretRecord", ["unsafeTrigger", "loveHateSpiral"], {
      boyStudent: "factor",
      girlStudent: "person",
    });
    const game = stateFor(value);
    setBoardLocation(game.loop, "boyStudent", "School");
    const hook = PLOT_IMPL.unsafeTrigger.hooks[0];

    expect(hook.when(game, "boyStudent")).toBe(true);
    hook.effect(game, "boyStudent");
    expect(game.loop.locIntrigue.School).toBe(1);
    expect(hook.when(game, "boyStudent")).toBe(false);

    const deadFactor = stateFor(value);
    setBoardLife(deadFactor.loop, "boyStudent", false);
    expect(hook.when(deadFactor, "boyStudent")).toBe(false);
  });

  it("checks the Male Confrontation and Showtime of Death boundaries", () => {
    const male = stateFor(scenario(
      "maleConfrontation",
      ["unsafeTrigger", "loveHateSpiral"],
      { officeWorker: "ninja", boyStudent: "factor" },
    ));
    male.loop.phase = "P9_ROUND_END";
    male.loop.day = male.scenario.daysPerLoop;
    male.loop.charCounters.officeWorker.intrigue = 1;
    expect(distanceToLoss(male).find(({ plot }) =>
      plot === "maleConfrontation"
    )?.met).toBe(false);
    male.loop.charCounters.officeWorker.intrigue = 2;
    setBoardLife(male.loop, "officeWorker", false);
    expect(evaluateLoss(male)).toContainEqual(expect.objectContaining({
      plot: "maleConfrontation",
      met: true,
    }));

    const showtime = stateFor(scenario(
      "fatedConnections",
      ["showtimeDeath", "unansweredHeart"],
      {
        boyStudent: "magician",
        girlStudent: "friend",
        officeWorker: "serialKiller",
        journalist: "conspiracyTheorist",
        patient: "immortalRole",
        doctor: "person",
        policeOfficer: "person",
      },
    ));
    showtime.loop.phase = "P9_ROUND_END";
    showtime.loop.day = showtime.scenario.daysPerLoop;
    expect(distanceToLoss(showtime).find(({ plot }) =>
      plot === "showtimeDeath"
    )?.met).toBe(false);
    setBoardLife(showtime.loop, "doctor", false);
    expect(distanceToLoss(showtime).find(({ plot }) =>
      plot === "showtimeDeath"
    )?.met).toBe(true);
  });

  it("makes Forbid Goodwill also forbid movement only with Unanswered Heart", () => {
    const value = scenario("fatedConnections", ["unansweredHeart", "showtimeDeath"]);
    const blocked = stateFor(value);
    setBoardLocation(blocked.loop, "boyStudent", "School");
    blocked.loop.placed = [
      { owner: "mastermind", card: "moveHorizontal", target: { kind: "character", id: "boyStudent" } },
      { owner: 0, card: "forbidGoodwill", target: { kind: "character", id: "boyStudent" } },
    ];
    resolveActions(blocked);
    expect(blocked.loop.board.boyStudent).toMatchObject({ at: "School" });

    const ordinary = stateFor({ ...value, subPlots: ["showtimeDeath"] });
    setBoardLocation(ordinary.loop, "boyStudent", "School");
    ordinary.loop.placed = structuredClone(blocked.loop.placed.length === 0
      ? [
        { owner: "mastermind", card: "moveHorizontal", target: { kind: "character", id: "boyStudent" } },
        { owner: 0, card: "forbidGoodwill", target: { kind: "character", id: "boyStudent" } },
      ] as PlacedCard[]
      : []);
    resolveActions(ordinary);
    expect(ordinary.loop.board.boyStudent).not.toMatchObject({ at: "School" });
  });
});

describe("MZ roles", () => {
  it("moves with the Magician once per loop and removes corpse paranoia", () => {
    const value = scenario("fatedConnections", ["unansweredHeart", "showtimeDeath"], {
      boyStudent: "magician",
      girlStudent: "person",
      patient: "immortalRole",
    });
    const game = stateFor(value);
    setBoardLocation(game.loop, "boyStudent", "School");
    setBoardLocation(game.loop, "girlStudent", "School");
    game.loop.charCounters.girlStudent.paranoia = 1;
    const magician = ROLE_IMPL.magician.hooks[0];

    magician.effect(
      game,
      "boyStudent",
      { kind: "character", id: "girlStudent" },
      "City",
    );
    expect(game.loop.board.girlStudent).toMatchObject({ at: "City" });
    expect(magician.when(game, "boyStudent")).toBe(false);

    game.loop.charCounters.boyStudent.paranoia = 2;
    withDeathBatch(game, () => killCharacter(game, "boyStudent"));
    expect(game.loop.charCounters.boyStudent.paranoia).toBe(0);
  });

  it("keeps the Immortal alive", () => {
    const value = scenario("fatedConnections", ["unansweredHeart", "showtimeDeath"], {
      patient: "immortalRole",
    });
    const game = stateFor(value);

    expect(withDeathBatch(game, () => killCharacter(game, "patient"))).toBe(false);
    expect(game.loop.board.patient.status).toBe("alive");
  });

  it("blocks mastermind cards on a Prophet but not protagonist cards", () => {
    const value = scenario("fatedConnections", ["unansweredHeart", "showtimeDeath"], {
      mysteryBoy: "prophet",
      boyStudent: "person",
    });
    const game = stateFor(value);
    const placement = (owner: PlacedCard["owner"]): PlacedCard => ({
      owner,
      card: "paranoiaPlus1",
      target: { kind: "character", id: "mysteryBoy" },
    });

    expect(validatePlacement(game, placement("mastermind"))).toEqual({
      ok: false,
      reason: "예언자 능력",
    });
    expect(validatePlacement(game, placement(0)).ok).toBe(true);
  });

  it("suppresses a triggering incident only when the living Prophet is elsewhere", () => {
    const value = scenario("fatedConnections", ["unansweredHeart", "showtimeDeath"], {
      mysteryBoy: "prophet",
      boyStudent: "person",
    }, [{ day: 1, incident: "suicide", culprit: "boyStudent" }]);
    const game = stateFor(value);
    game.loop.charCounters.boyStudent.paranoia = 2;
    setBoardLocation(game.loop, "boyStudent", "School");
    setBoardLocation(game.loop, "mysteryBoy", "City");
    expect(incidentFailureReasons(game, "boyStudent", "suicide"))
      .toContain("culpritSuppressed");

    setBoardLocation(game.loop, "mysteryBoy", "School");
    expect(incidentFailureReasons(game, "boyStudent", "suicide")).toEqual([]);
  });

  it("lets a living Obstinate trigger below its paranoia limit", () => {
    const value = scenario("maleConfrontation", ["unsafeTrigger", "loveHateSpiral"], {
      girlStudent: "obstinate",
      officeWorker: "ninja",
      boyStudent: "factor",
      richStudent: "friend",
    }, [{ day: 1, incident: "confession", culprit: "girlStudent" }]);
    const game = stateFor(value);
    game.loop.charCounters.girlStudent.paranoia = 0;

    expect(incidentFailureReasons(game, "girlStudent", "confession"))
      .toEqual([]);
    setBoardLife(game.loop, "girlStudent", false);
    expect(incidentFailureReasons(game, "girlStudent", "confession"))
      .toContain("culpritDead");
  });
});

describe("MZ incidents", () => {
  it("allows a repeated Serial Murder culprit and kills another character", () => {
    const value = scenario("secretRecord", ["diceOfGods", "unsafeTrigger"], {
      boyStudent: "obstinate",
      girlStudent: "person",
    }, [
      { day: 1, incident: "serialMurder", culprit: "boyStudent" },
      { day: 2, incident: "serialMurder", culprit: "boyStudent" },
    ]);
    const game = stateFor(value);
    setBoardLocation(game.loop, "boyStudent", "City");
    setBoardLocation(game.loop, "girlStudent", "City");

    expect(resolveIncidentEffect(game, "serialMurder", "boyStudent", {
      target: "girlStudent",
    })).toBe(true);
    expect(game.loop.board.girlStudent.status).toBe("dead");
  });

  it("keeps the same revealed culprit in multiple Serial Murder columns", () => {
    const scheduled = [
      { day: 1, incident: "serialMurder", culprit: "boyStudent" },
      { day: 2, incident: "serialMurder", culprit: "boyStudent" },
    ];
    const table = evaluateIncidentHypotheses(
      ["boyStudent", "girlStudent"],
      scheduled,
      scheduled.map((incident) => ({
        kind: "incidentCulpritRevealed" as const,
        loop: 1,
        day: incident.day,
        incident: incident.incident,
        culprit: { kind: "character" as const, id: "boyStudent" },
      })),
    );

    expect(table.columns.every(({ id }) =>
      table.cells.boyStudent[id].status === "confirmed"
    )).toBe(true);
  });

  it("uses intrigue to trigger Conspiracies and resolves the selected incident", () => {
    const value = scenario("secretRecord", ["diceOfGods", "unsafeTrigger"], {
      boyStudent: "person",
      girlStudent: "person",
    }, [{ day: 1, incident: "conspiracies", culprit: "boyStudent" }]);
    const game = stateFor(value);
    setBoardLocation(game.loop, "boyStudent", "City");
    setBoardLocation(game.loop, "girlStudent", "City");
    game.loop.charCounters.boyStudent.paranoia = 0;
    game.loop.charCounters.boyStudent.intrigue = 2;

    expect(incidentFailureReasons(game, "boyStudent", "conspiracies"))
      .toEqual([]);
    expect(resolveIncidentEffect(game, "conspiracies", "boyStudent", {
      incident: "serialMurder",
      target: "girlStudent",
    })).toBe(true);
    expect(game.loop.board.girlStudent.status).toBe("dead");
  });

  it("requires the printed paranoia limit in intrigue for Conspiracies", () => {
    const value = scenario("secretRecord", ["diceOfGods", "unsafeTrigger"], {
      boyStudent: "person",
    });
    const game = stateFor(value);
    game.loop.charCounters.boyStudent.paranoia = 10;
    game.loop.charCounters.boyStudent.intrigue = 1;

    expect(incidentFailureReasons(game, "boyStudent", "conspiracies"))
      .toContain("insufficientIntrigue");
  });

  it("kills everyone only in Uproar locations with intrigue", () => {
    const value = scenario();
    const game = stateFor(value);
    setBoardLocation(game.loop, "boyStudent", "School");
    setBoardLocation(game.loop, "girlStudent", "City");
    game.loop.locIntrigue.School = 1;

    expect(resolveIncidentEffect(game, "uproar", "officeWorker")).toBe(true);
    expect(game.loop.board.boyStudent.status).toBe("dead");
    expect(game.loop.board.girlStudent.status).toBe("alive");
  });

  it("uses the Fake Incident culprit's starting location", () => {
    const value = scenario();
    const game = stateFor(value);
    game.loop.locIntrigue.School = 2;

    expect(resolveIncidentEffect(game, "fakeIncident", "boyStudent")).toBe(true);
    expect(game.pendingLoopEnd?.reason).toBe("protagonistDeath");
  });

  it("lets Breakthrough remove intrigue from either target kind", () => {
    const game = stateFor(scenario());
    game.loop.charCounters.boyStudent.intrigue = 3;
    game.loop.locIntrigue.City = 2;

    expect(resolveIncidentEffect(game, "breakthrough", "officeWorker", {
      target: "boyStudent",
    })).toBe(true);
    expect(game.loop.charCounters.boyStudent.intrigue).toBe(1);
    expect(resolveIncidentEffect(game, "breakthrough", "officeWorker", {
      location: "City",
    })).toBe(true);
    expect(game.loop.locIntrigue.City).toBe(0);
  });

  it("activates Faked Suicide for all current and later Extra Card holders", () => {
    const game = stateFor(scenario());
    expect(resolveIncidentEffect(game, "fakedSuicide", "boyStudent")).toBe(true);
    game.loop.extraCards.push({
      instanceId: "later",
      cardId: "diceOfGods",
      controller: "mastermind",
      source: { kind: "rule", id: "diceOfGods" },
      target: { kind: "character", id: "girlStudent" },
      expiresAt: "loopStart",
    });

    for (const character of ["boyStudent", "girlStudent"]) {
      expect(validatePlacement(game, {
        owner: 0,
        card: "goodwillPlus1",
        target: { kind: "character", id: character },
      })).toEqual({ ok: false, reason: "위장 자살" });
    }
    expect(validatePlacement(game, {
      owner: "mastermind",
      card: "paranoiaPlus1",
      target: { kind: "character", id: "girlStudent" },
    }).ok).toBe(true);

    const nextLoop = initLoop(game.scenario, 2, structuredClone(game.loop));
    expect(nextLoop.fakedSuicideRestrictionActive).toBe(false);
  });

  it("reveals a Confession culprit and records the Ninja's chosen claim", () => {
    const game = stateFor(scenario("maleConfrontation", ["unsafeTrigger", "loveHateSpiral"], {
      officeWorker: "ninja",
      boyStudent: "factor",
      richStudent: "friend",
      girlStudent: "obstinate",
    }));

    expect(resolveIncidentEffect(game, "confession", "officeWorker", {
      roleClaim: "factor",
    })).toBe(true);
    expect(game.loop.publicInformationThisLoop).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "incidentCulprit",
        source: "confession",
        culprit: { kind: "character", id: "officeWorker" },
      }),
      expect.objectContaining({
        kind: "roleClaim",
        character: "officeWorker",
        claimedRole: "factor",
      }),
    ]));
    expect(game.loop.roleRevealResolutionsThisLoop).toContainEqual(
      expect.objectContaining({ result: "ninjaLie", actualRoleAtReveal: "ninja" }),
    );
  });
});

describe("MZ rule hypotheses", () => {
  const secretRecord: RuleCombination = {
    id: "secretRecord",
    mainPlot: "secretRecord",
    subPlots: ["unsafeTrigger", "loveHateSpiral"],
  };
  const fatedConnections: RuleCombination = {
    id: "fatedConnections",
    mainPlot: "fatedConnections",
    subPlots: ["unansweredHeart", "showtimeDeath"],
  };

  function naturalLoss(
    loop: number,
  ): Extract<ProtagonistObservation, { kind: "lossObserved" }> {
    return {
      kind: "lossObserved",
      loop,
      day: 4,
      timing: "lastDay",
      context: {
        phase: "P9_ROUND_END",
        lastDay: true,
        locationIntrigue: { Hospital: 0, Shrine: 0, City: 0, School: 0 },
        characters: {},
        extraCards: [],
        startingLocations: {},
        firedIncidents: [],
      },
    };
  }

  it("uses only a same-loop role claim to explain Secret Record", () => {
    const currentClaim: ProtagonistObservation = {
      kind: "roleRevealed",
      loop: 2,
      character: "officeWorker",
      role: "factor",
    };
    const candidates = [secretRecord, fatedConnections];

    expect(evaluateRuleHypotheses(
      "midnightZone",
      [currentClaim, naturalLoss(2)],
      { candidateCombinations: candidates },
    ).remaining).toEqual([secretRecord]);

    expect(evaluateRuleHypotheses(
      "midnightZone",
      [{ ...currentClaim, loop: 1 }, naturalLoss(2)],
      { candidateCombinations: candidates },
    ).remaining).toEqual([]);
  });

  it("does not infer Showtime of Death from a legacy loss without a board", () => {
    const loss = naturalLoss(1);
    if (loss.context === undefined) throw new Error("missing loss context");
    delete loss.context.characters;

    expect(evaluateRuleHypotheses(
      "midnightZone",
      [loss],
      { candidateCombinations: [fatedConnections] },
    ).remaining).toEqual([]);
  });
});
