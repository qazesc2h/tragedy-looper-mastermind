import { describe, expect, it } from "vitest";
import { initLoop } from "../src/engine/setup";
import {
  decodeIncidentSelection,
  encodeIncidentSelection,
  goodwillAbilityViews,
} from "../src/ui/goodwill-abilities";
import type { CharacterId, GameState, Scenario } from "../src/types";

function createState(characters: readonly CharacterId[]): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "murderPlan",
    subPlots: [],
    cast: Object.fromEntries(characters.map((character) => [character, "person"])),
    incidents: [],
    loops: 3,
    daysPerLoop: 4,
  };
  const state = { scenario, loop: initLoop(scenario), history: [] };
  state.loop.phase = "P6_GOODWILL";
  return state;
}

function unlock(state: GameState, character: CharacterId, goodwill: number): void {
  state.loop.charCounters[character].goodwill = goodwill;
}

describe("structured goodwill ability UI", () => {
  it("offers boyStudent and girlStudent only another living student in the same location", () => {
    const state = createState(["boyStudent", "girlStudent"]);
    unlock(state, "boyStudent", 2);
    unlock(state, "girlStudent", 2);

    const available = goodwillAbilityViews(state);
    const boy = available.find(({ character }) => character === "boyStudent");
    const girl = available.find(({ character }) => character === "girlStudent");
    expect(boy).toMatchObject({
      disabledReason: undefined,
      choice: { kind: "none" },
      schema: { effect: { counter: "paranoia", delta: -1 } },
      targets: [{ kind: "character", id: "girlStudent" }],
    });
    expect(girl?.targets).toEqual([
      { kind: "character", id: "boyStudent" },
    ]);

    state.loop.board.girlStudent.at = "City";
    expect(
      goodwillAbilityViews(state).find(
        ({ character }) => character === "boyStudent",
      )?.disabledReason,
    ).toBe("noTarget");
  });

  it("offers doctor rank 2 only other living characters nearby and the +1/-1 choice", () => {
    const state = createState(["doctor", "patient", "nurse"]);
    unlock(state, "doctor", 2);

    const doctor = goodwillAbilityViews(state).find(
      ({ character, schema }) => character === "doctor" && schema.rank === 2,
    );
    expect(doctor).toMatchObject({
      disabledReason: undefined,
      choice: { kind: "paranoiaDelta", options: [1, -1] },
    });
    expect(doctor?.targets).toEqual([
      { kind: "character", id: "patient" },
      { kind: "character", id: "nurse" },
    ]);
    expect(doctor?.targets).not.toContainEqual({
      kind: "character",
      id: "doctor",
    });

    state.loop.board.patient.alive = false;
    expect(
      goodwillAbilityViews(state).find(
        ({ character, schema }) => character === "doctor" && schema.rank === 2,
      )?.targets,
    ).toEqual([{ kind: "character", id: "nurse" }]);
  });

  it("enforces richStudent's School/City restriction", () => {
    const state = createState(["richStudent", "boyStudent"]);
    unlock(state, "richStudent", 3);

    expect(goodwillAbilityViews(state)[0].disabledReason).toBeUndefined();

    state.loop.board.richStudent.at = "Shrine";
    state.loop.board.boyStudent.at = "Shrine";
    expect(goodwillAbilityViews(state)[0].disabledReason).toBe(
      "restrictedLocation",
    );
  });

  it("enforces shrineMaiden rank 3's Shrine restriction", () => {
    const state = createState(["shrineMaiden"]);
    unlock(state, "shrineMaiden", 3);

    expect(goodwillAbilityViews(state)[0]).toMatchObject({
      disabledReason: undefined,
      choice: { kind: "none" },
      schema: { rank: 3 },
    });

    state.loop.board.shrineMaiden.at = "City";
    expect(goodwillAbilityViews(state)[0].disabledReason).toBe(
      "restrictedLocation",
    );
  });

  it("shows once-per-loop abilities as spent and requires a recoverable card", () => {
    const state = createState(["classRep"]);
    unlock(state, "classRep", 2);

    expect(goodwillAbilityViews(state)[0].disabledReason).toBe("noSpentCard");

    state.loop.spentOncePerLoop.protagonists[0].push("moveVertical");
    expect(goodwillAbilityViews(state)[0]).toMatchObject({
      disabledReason: undefined,
      choice: { kind: "spentCard", options: ["moveVertical"] },
    });

    state.loop.abilitiesUsedThisLoop.push("classRep:goodwill:0");
    expect(goodwillAbilityViews(state)[0].disabledReason).toBe("spent");
  });

  it("keeps both journalist rank-2 abilities as separate rows", () => {
    const state = createState(["journalist"]);
    unlock(state, "journalist", 2);

    expect(
      goodwillAbilityViews(state).map(({ abilityIndex, schema }) => ({
        abilityIndex,
        rank: schema.rank,
      })),
    ).toEqual([
      { abilityIndex: 0, rank: 2 },
      { abilityIndex: 1, rank: 2 },
    ]);
  });

  it("lists exact scenario occurrences for godlyBeing and AI", () => {
    const state = createState([
      "godlyBeing",
      "ai",
      "officeWorker",
      "alien",
    ]);
    state.scenario.incidents = [
      { day: 4, incident: "missingPerson", culprit: "officeWorker" },
      { day: 5, incident: "missingPerson", culprit: "alien" },
    ];
    unlock(state, "godlyBeing", 3);
    unlock(state, "ai", 3);

    const views = goodwillAbilityViews(state);
    expect(views.find(({ character }) => character === "godlyBeing")?.choice)
      .toEqual({
        kind: "incident",
        options: [
          { day: 4, incident: "missingPerson" },
          { day: 5, incident: "missingPerson" },
        ],
      });
    expect(views.find(({ character }) => character === "ai")?.choice)
      .toEqual({
        kind: "incident",
        options: [
          { day: 4, incident: "missingPerson" },
          { day: 5, incident: "missingPerson" },
        ],
      });
  });

  it("offers policeOfficer only exact occurrences that fired this loop", () => {
    const state = createState([
      "policeOfficer",
      "boyStudent",
      "girlStudent",
    ]);
    state.scenario.incidents = [
      { day: 1, incident: "suicide", culprit: "boyStudent" },
      { day: 2, incident: "foulEvil", culprit: "girlStudent" },
    ];
    unlock(state, "policeOfficer", 4);

    expect(goodwillAbilityViews(state)[0]).toMatchObject({
      disabledReason: "noChoice",
      choice: { kind: "pastIncident", options: [] },
    });

    state.loop.incidentOccurrencesFiredThisLoop = [{
      day: 1,
      incident: "suicide",
      culprit: "boyStudent",
    }];
    expect(goodwillAbilityViews(state)[0]).toMatchObject({
      disabledReason: undefined,
      choice: {
        kind: "pastIncident",
        options: [{ day: 1, incident: "suicide" }],
      },
    });
  });

  it("offers every basic Rule X declaration and only active reveal choices", () => {
    const state = createState(["informer"]);
    state.scenario.subPlots = ["circleFriends", "threadsFate"];
    unlock(state, "informer", 5);

    const choice = goodwillAbilityViews(state)[0].choice;
    expect(choice).toMatchObject({
      kind: "subplot",
      revealOptions: ["circleFriends", "threadsFate"],
    });
    if (choice.kind !== "subplot") {
      throw new Error("expected subplot choice");
    }
    expect(choice.options).toContain("hiddenFreak");
  });

  it("round-trips the incident value rendered in data-goodwill-choice", () => {
    const selection = { day: 5, incident: "missingPerson" };

    expect(decodeIncidentSelection(encodeIncidentSelection(selection)))
      .toEqual(selection);
    expect(decodeIncidentSelection("not-an-occurrence")).toBeUndefined();
  });
});
