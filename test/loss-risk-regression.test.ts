import { describe, expect, it } from "vitest";

import { characterDataOf } from "../src/data";
import { killCharacter } from "../src/engine/death";
import { createGameState } from "../src/engine/game";
import {
  distanceToLoss,
  evaluateLoss,
  type LossRoute,
} from "../src/engine/loss";
import type {
  CharacterId,
  GameState,
  IncidentId,
  RoleId,
  Scenario,
} from "../src/types";
import { setBoardLife, setBoardLocation } from "./helpers";

interface StateOptions {
  mainPlot?: Scenario["mainPlot"];
  subPlots?: Scenario["subPlots"];
  cast?: Scenario["cast"];
  incidents?: Scenario["incidents"];
}

function createState(options: StateOptions = {}): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: options.mainPlot ?? "",
    subPlots: options.subPlots ?? [],
    cast: options.cast ?? { boyStudent: "person" },
    incidents: options.incidents ?? [],
    loops: 2,
    daysPerLoop: 3,
    scriptSpecified: "boss" in (options.cast ?? {})
      ? { "Turf:boss": "School" }
      : {},
  };
  const state = createGameState(scenario);
  state.gamePhase = "ROUND";
  return state;
}

function routeByKey(state: GameState, routeKey: string): LossRoute {
  const candidate = distanceToLoss(state).flatMap(({ routes }) => routes)
    .find(({ key }) => key === routeKey);
  if (candidate === undefined) throw new Error(`missing route ${routeKey}`);
  return candidate;
}

function roleCondition(state: GameState, role: RoleId) {
  const condition = distanceToLoss(state).find((candidate) =>
    candidate.role === role
  );
  if (condition === undefined) throw new Error(`missing role ${role}`);
  return condition;
}

function incidentRoute(
  state: GameState,
  incident: IncidentId,
  target: CharacterId,
): LossRoute {
  const candidate = distanceToLoss(state).flatMap(({ routes }) => routes)
    .find(({ key }) =>
      key.startsWith(`death:incident:${incident}:`) && key.endsWith(`:${target}`)
    );
  if (candidate === undefined) {
    throw new Error(`missing ${incident} route for ${target}`);
  }
  return candidate;
}

function remaining(route: LossRoute): number {
  return route.requirements.reduce((sum, item) => sum + item.remaining, 0);
}

describe("loss risk route regression vectors", () => {
  it("fixes plot location, character, and history vectors", () => {
    const sealed = createState({ mainPlot: "sealedItem" });
    sealed.loop.locIntrigue.Shrine = 1;
    expect(distanceToLoss(sealed).find(({ plot }) => plot === "sealedItem"))
      .toMatchObject({ met: false, remaining: 1, label: "신사 음모 1/2" });
    sealed.loop.locIntrigue.Shrine = 2;
    expect(distanceToLoss(sealed).find(({ plot }) => plot === "sealedItem"))
      .toMatchObject({ met: true, remaining: 0, label: "신사 음모 2/2" });
    sealed.loop.locIntrigue.Shrine = 0;
    expect(distanceToLoss(sealed).find(({ plot }) => plot === "sealedItem"))
      .toMatchObject({ met: false, remaining: 2, label: "신사 음모 0/2" });

    const contract = createState({
      mainPlot: "signWithMe",
      cast: { girlStudent: "keyPerson" },
    });
    contract.loop.charCounters.girlStudent.intrigue = 1;
    expect(distanceToLoss(contract).find(({ plot }) => plot === "signWithMe"))
      .toMatchObject({ met: false, remaining: 1, label: "핵심 인물 음모 1/2" });
    contract.loop.charCounters.girlStudent.intrigue = 2;
    expect(distanceToLoss(contract).find(({ plot }) => plot === "signWithMe"))
      .toMatchObject({ met: true, remaining: 0, label: "핵심 인물 음모 2/2" });
    contract.loop.charCounters.girlStudent.intrigue = 0;
    expect(distanceToLoss(contract).find(({ plot }) => plot === "signWithMe"))
      .toMatchObject({ met: false, remaining: 2, label: "핵심 인물 음모 0/2" });

    const future = createState({
      mainPlot: "changeOfFuture",
      incidents: [{
        day: 1,
        incident: "butterflyEffect",
        culprit: "boyStudent",
      }],
    });
    expect(distanceToLoss(future).find(({ plot }) => plot === "changeOfFuture"))
      .toMatchObject({ met: false, remaining: 1 });
    future.loop.incidentsFiredThisLoop = ["butterflyEffect"];
    expect(distanceToLoss(future).find(({ plot }) => plot === "changeOfFuture"))
      .toMatchObject({ met: true, remaining: 0 });
    future.loop.incidentsFiredThisLoop = [];
    future.loop.day = 2;
    expect(distanceToLoss(future).find(({ plot }) => plot === "changeOfFuture"))
      .toMatchObject({ met: false, remaining: 1 });
  });

  it("fixes the key-person endpoint and both killer routes", () => {
    const state = createState({
      cast: {
        girlStudent: "keyPerson",
        officeWorker: "killer",
      },
    });
    setBoardLocation(state.loop, "girlStudent", "City");
    setBoardLocation(state.loop, "officeWorker", "City");

    expect(roleCondition(state, "keyPerson")).toMatchObject({
      met: false,
      current: 0,
      remaining: 1,
    });
    setBoardLife(state.loop, "girlStudent", false);
    expect(roleCondition(state, "keyPerson")).toMatchObject({
      met: true,
      current: 1,
      remaining: 0,
    });
    setBoardLife(state.loop, "girlStudent", true);
    expect(evaluateLoss(state)).toEqual([]);

    state.loop.charCounters.officeWorker.intrigue = 3;
    expect(roleCondition(state, "killer")).toMatchObject({
      met: false,
      remaining: 1,
    });
    state.loop.charCounters.officeWorker.intrigue = 4;
    expect(roleCondition(state, "killer")).toMatchObject({
      met: true,
      remaining: 0,
    });
    state.loop.charCounters.officeWorker.intrigue = 2;
    expect(roleCondition(state, "killer")).toMatchObject({
      met: false,
      remaining: 2,
    });

    state.loop.charCounters.girlStudent.intrigue = 1;
    const killerKey = "death:killer:officeWorker:girlStudent";
    expect(routeByKey(state, killerKey)).toMatchObject({ met: false });
    expect(remaining(routeByKey(state, killerKey))).toBe(1);
    state.loop.charCounters.girlStudent.intrigue = 2;
    expect(routeByKey(state, killerKey)).toMatchObject({
      met: true,
      when: "오늘 라운드 종료",
    });
    setBoardLocation(state.loop, "girlStudent", "School");
    expect(routeByKey(state, killerKey)).toMatchObject({ met: false });
    expect(routeByKey(state, killerKey).requirements).toContainEqual(
      expect.objectContaining({ key: "sameAbilityLocation", met: false }),
    );
  });

  it("fixes serial-killer and loved-one vectors", () => {
    const serial = createState({
      cast: {
        shrineMaiden: "serialKiller",
        girlStudent: "keyPerson",
        boyStudent: "person",
      },
    });
    for (const character of Object.keys(serial.loop.board)) {
      setBoardLocation(serial.loop, character, "City");
    }
    const serialKey = "death:serialKiller:shrineMaiden:girlStudent";
    expect(routeByKey(serial, serialKey)).toMatchObject({ met: false });
    expect(routeByKey(serial, serialKey).requirements).toContainEqual(
      expect.objectContaining({
        key: "exactlyOneOtherLiving",
        current: 2,
        remaining: 1,
        met: false,
      }),
    );
    setBoardLocation(serial.loop, "boyStudent", "School");
    expect(routeByKey(serial, serialKey)).toMatchObject({ met: true });
    setBoardLocation(serial.loop, "girlStudent", "School");
    expect(routeByKey(serial, serialKey)).toMatchObject({ met: false });
    expect(routeByKey(serial, serialKey).requirements).toContainEqual(
      expect.objectContaining({ key: "targetSameLocation", met: false }),
    );

    const lovedOne = createState({ cast: { boyStudent: "lovedOne" } });
    lovedOne.loop.charCounters.boyStudent.paranoia = 2;
    lovedOne.loop.charCounters.boyStudent.intrigue = 1;
    expect(roleCondition(lovedOne, "lovedOne")).toMatchObject({
      met: false,
      remaining: 1,
    });
    lovedOne.loop.charCounters.boyStudent.paranoia = 3;
    expect(roleCondition(lovedOne, "lovedOne")).toMatchObject({
      met: true,
      remaining: 0,
    });
    lovedOne.loop.charCounters.boyStudent.intrigue = 0;
    expect(roleCondition(lovedOne, "lovedOne")).toMatchObject({
      met: false,
      remaining: 1,
    });
  });

  it("fixes suicide, murder, faraway-murder, and hospital-death vectors", () => {
    const cases: ReadonlyArray<{
      incident: IncidentId;
      prepareNear: (state: GameState) => void;
      prepareMet: (state: GameState) => void;
      prepareUnmet: (state: GameState) => void;
    }> = [
      {
        incident: "suicide",
        prepareNear: (state) => {
          state.loop.charCounters.girlStudent.paranoia =
            characterDataOf("girlStudent").paranoiaLimit - 1;
        },
        prepareMet: (state) => {
          state.loop.charCounters.girlStudent.paranoia =
            characterDataOf("girlStudent").paranoiaLimit;
        },
        prepareUnmet: (state) => {
          state.loop.charCounters.girlStudent.paranoia =
            characterDataOf("girlStudent").paranoiaLimit;
          state.loop.charCounters.girlStudent.protection = 1;
        },
      },
      {
        incident: "murder",
        prepareNear: (state) => {
          state.loop.charCounters.boyStudent.paranoia =
            characterDataOf("boyStudent").paranoiaLimit - 1;
          setBoardLocation(state.loop, "boyStudent", "City");
          setBoardLocation(state.loop, "girlStudent", "City");
        },
        prepareMet: (state) => {
          state.loop.charCounters.boyStudent.paranoia =
            characterDataOf("boyStudent").paranoiaLimit;
          setBoardLocation(state.loop, "boyStudent", "City");
          setBoardLocation(state.loop, "girlStudent", "City");
        },
        prepareUnmet: (state) => {
          state.loop.charCounters.boyStudent.paranoia =
            characterDataOf("boyStudent").paranoiaLimit;
          setBoardLocation(state.loop, "boyStudent", "City");
          setBoardLocation(state.loop, "girlStudent", "School");
        },
      },
      {
        incident: "farawayMurder",
        prepareNear: (state) => {
          state.loop.charCounters.boyStudent.paranoia =
            characterDataOf("boyStudent").paranoiaLimit;
          state.loop.charCounters.girlStudent.intrigue = 1;
        },
        prepareMet: (state) => {
          state.loop.charCounters.boyStudent.paranoia =
            characterDataOf("boyStudent").paranoiaLimit;
          state.loop.charCounters.girlStudent.intrigue = 2;
        },
        prepareUnmet: (state) => {
          state.loop.charCounters.boyStudent.paranoia =
            characterDataOf("boyStudent").paranoiaLimit;
          state.loop.charCounters.girlStudent.intrigue = 2;
          state.loop.charCounters.girlStudent.protection = 1;
        },
      },
      {
        incident: "hospitalIncident",
        prepareNear: (state) => {
          state.loop.charCounters.boyStudent.paranoia =
            characterDataOf("boyStudent").paranoiaLimit - 1;
          state.loop.locIntrigue.Hospital = 1;
          setBoardLocation(state.loop, "girlStudent", "Hospital");
        },
        prepareMet: (state) => {
          state.loop.charCounters.boyStudent.paranoia =
            characterDataOf("boyStudent").paranoiaLimit;
          state.loop.locIntrigue.Hospital = 1;
          setBoardLocation(state.loop, "girlStudent", "Hospital");
        },
        prepareUnmet: (state) => {
          state.loop.charCounters.boyStudent.paranoia =
            characterDataOf("boyStudent").paranoiaLimit;
          state.loop.locIntrigue.Hospital = 1;
          setBoardLocation(state.loop, "girlStudent", "School");
        },
      },
    ];

    for (const vector of cases) {
      const make = (): GameState => createState({
        cast: {
          boyStudent: "person",
          girlStudent: "keyPerson",
        },
        incidents: [{
          day: 1,
          incident: vector.incident,
          culprit: vector.incident === "suicide"
            ? "girlStudent"
            : "boyStudent",
        }],
      });
      const near = make();
      vector.prepareNear(near);
      expect(incidentRoute(near, vector.incident, "girlStudent").met).toBe(false);

      const met = make();
      vector.prepareMet(met);
      expect(incidentRoute(met, vector.incident, "girlStudent").met).toBe(true);

      const unmet = make();
      vector.prepareUnmet(unmet);
      expect(incidentRoute(unmet, vector.incident, "girlStudent").met).toBe(false);
    }
  });

  it("fixes hospital protagonist death, friend loop-end, and time-traveler last-day vectors", () => {
    const hospital = createState({
      cast: { boyStudent: "person" },
      incidents: [{
        day: 1,
        incident: "hospitalIncident",
        culprit: "boyStudent",
      }],
    });
    hospital.loop.phase = "P7_INCIDENT";
    hospital.loop.charCounters.boyStudent.paranoia =
      characterDataOf("boyStudent").paranoiaLimit;
    hospital.loop.locIntrigue.Hospital = 1;
    expect(distanceToLoss(hospital).find(({ incident }) =>
      incident === "hospitalIncident"
    )).toMatchObject({ met: false, remaining: 1 });
    hospital.loop.locIntrigue.Hospital = 2;
    expect(distanceToLoss(hospital).find(({ incident }) =>
      incident === "hospitalIncident"
    )).toMatchObject({ met: true, remaining: 0 });
    hospital.loop.incidentCulpritSuppressedFor = ["boyStudent"];
    expect(distanceToLoss(hospital).find(({ incident }) =>
      incident === "hospitalIncident"
    )).toMatchObject({ met: false, remaining: 1 });

    const friend = createState({ cast: { boss: "friend" } });
    expect(roleCondition(friend, "friend")).toMatchObject({
      met: false,
      remaining: 1,
    });
    setBoardLife(friend.loop, "boss", false);
    expect(roleCondition(friend, "friend")).toMatchObject({
      met: true,
      remaining: 0,
    });
    expect(evaluateLoss(friend)).toEqual([]);
    friend.loop.day = 3;
    friend.loop.phase = "P9_ROUND_END";
    expect(evaluateLoss(friend)).toContainEqual(expect.objectContaining({
      role: "friend",
      activated: true,
    }));

    const traveler = createState({ cast: { informer: "timeTraveler" } });
    traveler.loop.day = 3;
    traveler.loop.phase = "P9_ROUND_END";
    traveler.loop.charCounters.informer.goodwill = 3;
    expect(roleCondition(traveler, "timeTraveler")).toMatchObject({
      met: false,
      remaining: 0,
    });
    traveler.loop.charCounters.informer.goodwill = 2;
    expect(roleCondition(traveler, "timeTraveler")).toMatchObject({
      met: true,
      remaining: 1,
    });
    traveler.loop.day = 2;
    expect(evaluateLoss(traveler)).toEqual([]);
  });

  it("fixes protection, immortality, black-cat, and henchman suppression blockers", () => {
    const protection = createState({
      cast: { boyStudent: "person", girlStudent: "keyPerson" },
      incidents: [{
        day: 1,
        incident: "farawayMurder",
        culprit: "boyStudent",
      }],
    });
    protection.loop.charCounters.boyStudent.paranoia =
      characterDataOf("boyStudent").paranoiaLimit;
    protection.loop.charCounters.girlStudent.intrigue = 2;
    protection.loop.charCounters.girlStudent.protection = 1;
    expect(incidentRoute(protection, "farawayMurder", "girlStudent")
      .requirements).toContainEqual(expect.objectContaining({
        key: "targetUnprotected",
        met: false,
        label: "보호 1개",
      }));

    const immortal = createState({
      cast: { boyStudent: "person", informer: "timeTraveler" },
      incidents: [{
        day: 1,
        incident: "farawayMurder",
        culprit: "boyStudent",
      }],
    });
    immortal.loop.charCounters.boyStudent.paranoia =
      characterDataOf("boyStudent").paranoiaLimit;
    immortal.loop.charCounters.informer.intrigue = 2;
    expect(killCharacter(immortal, "informer")).toBe(false);
    expect(immortal.loop.board.informer).toMatchObject({ status: "alive" });

    const blackCat = createState({
      cast: { blackCat: "person", girlStudent: "keyPerson" },
      incidents: [{
        day: 1,
        incident: "murder",
        culprit: "blackCat",
      }],
    });
    blackCat.loop.charCounters.blackCat.paranoia =
      characterDataOf("blackCat").paranoiaLimit;
    setBoardLocation(blackCat.loop, "blackCat", "City");
    setBoardLocation(blackCat.loop, "girlStudent", "City");
    expect(incidentRoute(blackCat, "murder", "girlStudent").requirements)
      .toContainEqual(expect.objectContaining({
        key: "effectNotSuppressed",
        met: false,
        label: "검은 고양이로 사건 효과 없음",
      }));

    const henchman = createState({
      cast: { henchman: "person", girlStudent: "keyPerson" },
      incidents: [{
        day: 1,
        incident: "murder",
        culprit: "henchman",
      }],
    });
    henchman.loop.board.henchman = { status: "alive", at: "City" };
    henchman.loop.charCounters.henchman.paranoia =
      characterDataOf("henchman").paranoiaLimit;
    setBoardLocation(henchman.loop, "henchman", "City");
    setBoardLocation(henchman.loop, "girlStudent", "City");
    henchman.loop.incidentCulpritSuppressedFor = ["henchman"];
    expect(incidentRoute(henchman, "murder", "girlStudent").requirements)
      .toContainEqual(expect.objectContaining({
        key: "culpritNotSuppressed",
        met: false,
        label: "범인의 사건 발생이 억제됨",
      }));
  });
});
