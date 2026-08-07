import { describe, expect, it } from "vitest";

import { resolveIncident } from "../src/engine/incident";
import { resolveGoodwillAbility } from "../src/engine/goodwill";
import { advanceGame } from "../src/engine/game";
import {
  distanceToLoss,
  evaluateLoss,
  setOptionalLossActivation,
} from "../src/engine/loss";
import { initLoop } from "../src/engine/setup";
import type { GameState, Scenario } from "../src/types";
import { setBoardLife, setBoardLocation } from "./helpers";

interface StateOptions {
  mainPlot?: string;
  subPlots?: string[];
  cast?: Scenario["cast"];
  incidents?: Scenario["incidents"];
  scriptSpecified?: Record<string, unknown>;
}

function createState(options: StateOptions = {}): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: options.mainPlot ?? "",
    subPlots: options.subPlots ?? [],
    cast: options.cast ?? { boyStudent: "person" },
    incidents: options.incidents ?? [],
    loops: 1,
    daysPerLoop: 3,
    scriptSpecified: options.scriptSpecified,
  };
  return {
    scenario,
    gamePhase: "ROUND",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
  };
}

function activateSoldierProtection(state: GameState): void {
  state.loop.phase = "P6_GOODWILL";
  state.loop.charCounters.soldier.goodwill = 5;
  resolveGoodwillAbility(state, {
    user: "soldier",
    rank: 5,
    abilityIndex: 1,
  }, "resolve");
}

describe("plot loss distance", () => {
  it("does not count an absent protected character as dead", () => {
    const state = createState({
      cast: { transferStudent: "keyPerson" },
      scriptSpecified: { "enters on day:transferStudent": 2 },
    });

    expect(distanceToLoss(state).some(
      ({ source, character }) =>
        source === "role" && character === "transferStudent",
    )).toBe(false);
    expect(evaluateLoss(state)).toEqual([]);
  });

  it("reports the sealedItem distance in a human-readable form", () => {
    const state = createState({ mainPlot: "sealedItem" });
    state.loop.locIntrigue.Shrine = 1;

    expect(distanceToLoss(state)).toContainEqual(expect.objectContaining({
      id: "sealedItem",
      source: "plot",
      plot: "sealedItem",
      ko: "봉인된 것",
      timing: "loopEnd",
      activation: "mandatory",
      when: "루프 종료",
      current: 1,
      needed: 2,
      remaining: 1,
      met: false,
      label: "신사 음모 1/2",
    }));
  });

  it("only returns a met plot condition at loop end", () => {
    const state = createState({ mainPlot: "sealedItem" });
    state.loop.locIntrigue.Shrine = 2;

    expect(evaluateLoss(state)).toEqual([]);

    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";
    expect(evaluateLoss(state)).toContainEqual(expect.objectContaining({
      category: "plot",
      plot: "sealedItem",
      met: true,
    }));
  });

  it("uses resolvePlaceX for giantTimeBomb", () => {
    const state = createState({
      mainPlot: "giantTimeBomb",
      cast: { henchman: "witch" },
      scriptSpecified: { "startLocation:henchman": "Hospital" },
    });
    setBoardLocation(state.loop, "henchman", "School");
    state.loop.locIntrigue.Hospital = 1;

    expect(distanceToLoss(state)).toContainEqual(expect.objectContaining({
      plot: "giantTimeBomb",
      current: 1,
      needed: 2,
      label: "장소 X(병원) 음모 1/2",
    }));
  });

  it("returns giantTimeBomb when Place X reaches 2 intrigue", () => {
    const state = createState({
      mainPlot: "giantTimeBomb",
      cast: { henchman: "witch" },
      scriptSpecified: { "startLocation:henchman": "Hospital" },
    });
    state.loop.locIntrigue.Hospital = 2;
    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";

    expect(evaluateLoss(state)).toContainEqual(expect.objectContaining({
      id: "giantTimeBomb",
      met: true,
      activated: true,
      label: "장소 X(병원) 음모 2/2",
    }));
  });

  it("returns signWithMe for an actual keyPerson at 2 intrigue", () => {
    const state = createState({
      mainPlot: "signWithMe",
      cast: { girlStudent: "keyPerson" },
    });
    state.loop.charCounters.girlStudent.intrigue = 2;
    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";

    expect(evaluateLoss(state)).toContainEqual(expect.objectContaining({
      id: "signWithMe",
      character: "girlStudent",
      met: true,
      activated: true,
    }));
  });

  it("does not treat factor's gained keyPerson ability as that plot role", () => {
    const state = createState({
      mainPlot: "signWithMe",
      cast: { boyStudent: "factor" },
    });
    state.loop.locIntrigue.City = 2;
    state.loop.charCounters.boyStudent.intrigue = 2;

    const distances = distanceToLoss(state);
    expect(distances).toContainEqual(expect.objectContaining({
      plot: "signWithMe",
      character: undefined,
      current: 0,
      label: "핵심 인물 없음 · 음모 0/2",
    }));
    expect(distances).toContainEqual(expect.objectContaining({
      role: "keyPerson",
      character: "boyStudent",
      category: "protectedCharacter",
    }));
  });

  it("tracks a fired butterflyEffect for changeOfFuture", () => {
    const state = createState({
      mainPlot: "changeOfFuture",
      incidents: [{
        day: 1,
        incident: "butterflyEffect",
        culprit: "boyStudent",
      }],
    });
    state.loop.phase = "P7_INCIDENT";
    state.loop.charCounters.boyStudent.paranoia = 2;

    expect(resolveIncident(state, {
      target: "boyStudent",
      counter: "intrigue",
    }).fired).toBe(true);
    expect(state.loop.incidentsFiredThisLoop).toEqual(["butterflyEffect"]);
    expect(distanceToLoss(state)).toContainEqual(expect.objectContaining({
      plot: "changeOfFuture",
      current: 1,
      needed: 1,
      met: true,
      label: "나비의 날갯짓 발생 1/1",
    }));
  });

  it("does not meet changeOfFuture before butterflyEffect fires", () => {
    const state = createState({ mainPlot: "changeOfFuture" });
    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";

    expect(distanceToLoss(state)).toContainEqual(expect.objectContaining({
      id: "changeOfFuture",
      current: 0,
      needed: 1,
      met: false,
    }));
    expect(evaluateLoss(state)).toEqual([]);
  });
});

describe("role loss conditions", () => {
  it("returns keyPerson death immediately", () => {
    const state = createState({ cast: { boyStudent: "keyPerson" } });
    setBoardLife(state.loop, "boyStudent", false);

    expect(evaluateLoss(state)).toContainEqual(expect.objectContaining({
      category: "protectedCharacter",
      timing: "immediate",
      role: "keyPerson",
      character: "boyStudent",
      current: 1,
      needed: 1,
      met: true,
      activated: true,
    }));
  });

  it("does not return a living keyPerson", () => {
    const state = createState({ cast: { boyStudent: "keyPerson" } });

    expect(distanceToLoss(state)).toContainEqual(expect.objectContaining({
      id: "keyPerson",
      current: 0,
      needed: 1,
      met: false,
    }));
    expect(evaluateLoss(state)).toEqual([]);
  });

  it("waits until loop end to return a dead friend", () => {
    const state = createState({ cast: { boss: "friend" } });
    setBoardLife(state.loop, "boss", false);

    expect(evaluateLoss(state)).toEqual([]);

    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";
    expect(evaluateLoss(state)).toContainEqual(expect.objectContaining({
      timing: "loopEnd",
      role: "friend",
      character: "boss",
      met: true,
      activated: true,
    }));
  });

  it("does not return a living friend at loop end", () => {
    const state = createState({ cast: { boss: "friend" } });
    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";

    expect(distanceToLoss(state)).toContainEqual(expect.objectContaining({
      id: "friend",
      current: 0,
      met: false,
    }));
    expect(evaluateLoss(state)).toEqual([]);
  });

  it("gives two friends distinct keys", () => {
    const state = createState({
      cast: { boss: "friend", girlStudent: "friend" },
    });
    setBoardLife(state.loop, "boss", false);
    setBoardLife(state.loop, "girlStudent", false);
    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";

    const friends = evaluateLoss(state).filter(
      (condition) => condition.id === "friend",
    );
    expect(friends).toHaveLength(2);
    expect(new Set(friends.map((condition) => condition.key)).size).toBe(2);
  });

  it("shows the inverse timeTraveler distance with days remaining", () => {
    const state = createState({ cast: { informer: "timeTraveler" } });
    state.loop.charCounters.informer.goodwill = 1;

    expect(distanceToLoss(state)).toContainEqual(expect.objectContaining({
      id: "timeTraveler",
      source: "role",
      activation: "optional",
      activated: false,
      current: 1,
      needed: 3,
      remaining: 2,
      label: "우호 1/3 확보 필요",
      when: "마지막 날",
      daysLeft: 2,
      met: false,
    }));
  });

  it("returns an optional timeTraveler loss on the last day at 2 goodwill", () => {
    const state = createState({ cast: { informer: "timeTraveler" } });
    state.loop.charCounters.informer.goodwill = 2;
    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";

    const beforeActivation = evaluateLoss(state).find(
      (condition) => condition.id === "timeTraveler",
    );
    expect(beforeActivation).toEqual(expect.objectContaining({
      met: true,
      activated: false,
      when: "마지막 날",
      daysLeft: 0,
    }));

    setOptionalLossActivation(state, beforeActivation!.key, true);
    expect(evaluateLoss(state)).toContainEqual(expect.objectContaining({
      id: "timeTraveler",
      activated: true,
    }));

    advanceGame(state);
    expect(state.loop.optionalLossActivations).toBeUndefined();
    expect(state.history[0].optionalLossActivations).toBeUndefined();
  });

  it("does not return timeTraveler with 3 goodwill on the last day", () => {
    const state = createState({ cast: { informer: "timeTraveler" } });
    state.loop.charCounters.informer.goodwill = 3;
    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";

    expect(distanceToLoss(state)).toContainEqual(expect.objectContaining({
      id: "timeTraveler",
      current: 3,
      needed: 3,
      remaining: 0,
      met: false,
    }));
    expect(evaluateLoss(state)).toEqual([]);
  });

  it("reports killer and lovedOne protagonist-death distances", () => {
    const state = createState({
      cast: {
        girlStudent: "killer",
        boyStudent: "lovedOne",
      },
    });
    state.loop.charCounters.girlStudent.intrigue = 4;
    state.loop.charCounters.boyStudent.paranoia = 2;
    state.loop.charCounters.boyStudent.intrigue = 1;

    const distances = distanceToLoss(state);
    expect(distances).toContainEqual(expect.objectContaining({
      role: "killer",
      current: 4,
      needed: 4,
      remaining: 0,
      met: true,
      label: "여학생(살인 청부업자) 음모 4/4",
    }));
    expect(distances).toContainEqual(expect.objectContaining({
      role: "lovedOne",
      current: 3,
      needed: 4,
      remaining: 1,
      met: false,
      label: "남학생(연인A) 불안 2/3 · 음모 1/1",
    }));
    expect(evaluateLoss(state)).toEqual([]);

    state.loop.phase = "P9_ROUND_END";
    const killer = evaluateLoss(state).find(
      (condition) => condition.id === "killer",
    );
    expect(killer).toEqual(expect.objectContaining({
      role: "killer",
      category: "protagonistDeath",
      activation: "optional",
      activated: false,
    }));

    setOptionalLossActivation(state, killer!.key, true);
    expect(evaluateLoss(state)).toContainEqual(expect.objectContaining({
      id: "killer",
      activated: true,
    }));

    advanceGame(state);
    expect(state.loop.optionalLossActivations).toBeUndefined();
  });

  it("does not return killer below 4 intrigue at day end", () => {
    const state = createState({ cast: { girlStudent: "killer" } });
    state.loop.charCounters.girlStudent.intrigue = 3;
    state.loop.phase = "P9_ROUND_END";

    expect(distanceToLoss(state)).toContainEqual(expect.objectContaining({
      id: "killer",
      current: 3,
      needed: 4,
      met: false,
    }));
    expect(evaluateLoss(state)).toEqual([]);
  });

  it("returns lovedOne at 3 paranoia and 1 intrigue", () => {
    const state = createState({ cast: { boyStudent: "lovedOne" } });
    state.loop.charCounters.boyStudent.paranoia = 3;
    state.loop.charCounters.boyStudent.intrigue = 1;
    state.loop.phase = "P9_ROUND_END";

    expect(evaluateLoss(state)).toContainEqual(expect.objectContaining({
      id: "lovedOne",
      activation: "optional",
      activated: false,
      met: true,
      when: "라운드 종료",
    }));
  });
});

describe("incident loss conditions", () => {
  it("includes the common trigger conditions for hospitalIncident", () => {
    const state = createState({
      incidents: [{
        day: 1,
        incident: "hospitalIncident",
        culprit: "boyStudent",
      }],
    });
    state.loop.phase = "P7_INCIDENT";
    state.loop.charCounters.boyStudent.paranoia = 2;
    state.loop.locIntrigue.Hospital = 2;

    expect(distanceToLoss(state)).toContainEqual(expect.objectContaining({
      incident: "hospitalIncident",
      current: 5,
      needed: 5,
      remaining: 0,
      met: true,
      label: "1일 병원 사건: 범인 생존 1/1 · 범인 불안 2/2 · 병원 음모 2/2",
    }));
    expect(evaluateLoss(state)).toContainEqual(expect.objectContaining({
      incident: "hospitalIncident",
      category: "protagonistDeath",
      timing: "incident",
      source: "incident",
      when: "사건 단계",
      activation: "mandatory",
      activated: true,
    }));
  });

  it("does not return hospitalIncident at 1 Hospital intrigue", () => {
    const state = createState({
      incidents: [{
        day: 1,
        incident: "hospitalIncident",
        culprit: "boyStudent",
      }],
    });
    state.loop.phase = "P7_INCIDENT";
    state.loop.charCounters.boyStudent.paranoia = 2;
    state.loop.locIntrigue.Hospital = 1;

    expect(distanceToLoss(state)).toContainEqual(expect.objectContaining({
      id: "hospitalIncident",
      met: false,
      remaining: 1,
    }));
    expect(evaluateLoss(state)).toEqual([]);
  });

  it("does not return it when the culprit is dead", () => {
    const state = createState({
      incidents: [{
        day: 1,
        incident: "hospitalIncident",
        culprit: "boyStudent",
      }],
    });
    state.loop.phase = "P7_INCIDENT";
    setBoardLife(state.loop, "boyStudent", false);
    state.loop.charCounters.boyStudent.paranoia = 2;
    state.loop.locIntrigue.Hospital = 2;

    const hospital = distanceToLoss(state).find(
      (condition) => condition.incident === "hospitalIncident",
    );
    expect(hospital?.met).toBe(false);
    expect(hospital?.remaining).toBe(1);
    expect(evaluateLoss(state)).toEqual([]);
  });
});

describe("soldier rank 5 / protagonist death prevention", () => {
  it("blocks killer protagonist death and returns soldier as blockedBy", () => {
    const state = createState({
      cast: { soldier: "person", girlStudent: "killer" },
    });
    activateSoldierProtection(state);
    state.loop.charCounters.girlStudent.intrigue = 4;
    state.loop.phase = "P9_ROUND_END";
    const condition = distanceToLoss(state).find(
      ({ id }) => id === "killer",
    );

    expect(condition).toMatchObject({
      met: true,
      activated: false,
      blockedBy: "soldier",
    });
    expect(setOptionalLossActivation(state, condition!.key, true)).toEqual({
      died: false,
      blockedBy: "soldier",
    });
    expect(state.loop.optionalLossActivations).toBeUndefined();
    expect(evaluateLoss(state).some(({ id }) => id === "killer")).toBe(false);
    expect(state.loop.publicInformationThisLoop).toBeUndefined();
  });

  it("blocks lovedOne protagonist death through the same entry point", () => {
    const state = createState({
      cast: { soldier: "person", boyStudent: "lovedOne" },
    });
    activateSoldierProtection(state);
    state.loop.charCounters.boyStudent.paranoia = 3;
    state.loop.charCounters.boyStudent.intrigue = 1;
    state.loop.phase = "P9_ROUND_END";
    const condition = distanceToLoss(state).find(
      ({ id }) => id === "lovedOne",
    );

    expect(setOptionalLossActivation(state, condition!.key, true)).toEqual({
      died: false,
      blockedBy: "soldier",
    });
    expect(condition?.blockedBy).toBe("soldier");
    expect(evaluateLoss(state).some(({ id }) => id === "lovedOne")).toBe(false);
  });

  it("blocks hospitalIncident protagonist death without stopping the incident", () => {
    const state = createState({
      cast: { soldier: "person", boyStudent: "person" },
      incidents: [{
        day: 1,
        incident: "hospitalIncident",
        culprit: "boyStudent",
      }],
    });
    activateSoldierProtection(state);
    state.loop.phase = "P7_INCIDENT";
    state.loop.charCounters.boyStudent.paranoia = 2;
    state.loop.locIntrigue.Hospital = 2;
    for (const character of Object.keys(state.loop.board)) {
      setBoardLocation(state.loop, character, "City");
    }

    expect(resolveIncident(state)).toEqual({
      incident: "hospitalIncident",
      culprit: "boyStudent",
      fired: true,
      effectApplied: false,
    });
    expect(distanceToLoss(state)).toContainEqual(expect.objectContaining({
      incident: "hospitalIncident",
      blockedBy: "soldier",
      activated: false,
    }));
    expect(
      evaluateLoss(state).some(
        ({ incident }) => incident === "hospitalIncident",
      ),
    ).toBe(false);
  });

  it("does not block timeTraveler protagonist defeat", () => {
    const state = createState({
      cast: { soldier: "person", informer: "timeTraveler" },
    });
    activateSoldierProtection(state);
    state.loop.charCounters.informer.goodwill = 2;
    state.loop.day = state.scenario.daysPerLoop;
    state.loop.phase = "P9_ROUND_END";
    const condition = evaluateLoss(state).find(
      ({ id }) => id === "timeTraveler",
    );

    expect(condition).toMatchObject({
      category: "protectedCharacter",
      blockedBy: undefined,
    });
    expect(setOptionalLossActivation(state, condition!.key, true)).toBeUndefined();
    expect(evaluateLoss(state)).toContainEqual(expect.objectContaining({
      id: "timeTraveler",
      activated: true,
      blockedBy: undefined,
    }));
  });

  it("does not block keyPerson or friend defeat conditions", () => {
    const keyPersonState = createState({
      cast: { soldier: "person", boyStudent: "keyPerson" },
    });
    activateSoldierProtection(keyPersonState);
    setBoardLife(keyPersonState.loop, "boyStudent", false);

    expect(evaluateLoss(keyPersonState)).toContainEqual(
      expect.objectContaining({
        id: "keyPerson",
        category: "protectedCharacter",
        blockedBy: undefined,
      }),
    );

    const friendState = createState({
      cast: { soldier: "person", boss: "friend" },
    });
    activateSoldierProtection(friendState);
    setBoardLife(friendState.loop, "boss", false);
    friendState.loop.day = friendState.scenario.daysPerLoop;
    friendState.loop.phase = "P9_ROUND_END";

    expect(evaluateLoss(friendState)).toContainEqual(
      expect.objectContaining({
        id: "friend",
        category: "protectedCharacter",
        blockedBy: undefined,
      }),
    );
  });
});
