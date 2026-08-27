import { describe, expect, it } from "vitest";
import { resolveGoodwillAbility } from "../src/engine/goodwill";
import {
  advanceGame,
  chooseInitialLeader,
  continueFromTimeGap,
  createGameState,
} from "../src/engine/game";
import { validatePlacement } from "../src/engine/legal";
import { initLoop } from "../src/engine/setup";
import {
  aiIncidentChoiceFields,
  decodeIncidentSelection,
  encodeIncidentSelection,
  goodwillAbilityViews,
  goodwillRefusalHistory,
  subplotRevealOptions,
} from "../src/ui/goodwill-abilities";
import type {
  ActionCard,
  CharacterId,
  GameState,
  PlacedCard,
  Scenario,
} from "../src/types";
import { setBoardLife, setBoardLocation } from "./helpers";

function createState(characters: readonly CharacterId[]): GameState {
  const scenario: Scenario = {
    tragedySet: "basicTragedy",
    mainPlot: "murderPlan",
    subPlots: [],
    cast: Object.fromEntries(characters.map((character) => [character, "person"])),
    incidents: [],
    loops: 3,
    daysPerLoop: 4,
    scriptSpecified: {
      ...(characters.includes("godlyBeing")
        ? { "enters on loop:godlyBeing": 1 }
        : {}),
      ...(characters.includes("boss") ? { "Turf:boss": "School" } : {}),
    },
  };
  const state: GameState = characters.includes("godlyBeing")
    ? createGameState(scenario)
    : {
      scenario,
      gamePhase: "ROUND",
      loop: initLoop(scenario),
      history: [],
      loopOutcomes: [],
    };
  if (characters.includes("godlyBeing")) {
    chooseInitialLeader(state, 0);
    continueFromTimeGap(state);
  }
  state.loop.phase = "P6_GOODWILL";
  return state;
}

function unlock(state: GameState, character: CharacterId, goodwill: number): void {
  state.loop.charCounters[character].goodwill = goodwill;
}

describe("AI incident choice fields", () => {
  it.each([
    ["murder", ["target"]],
    ["missingPerson", ["location"]],
    ["butterflyEffect", ["counter", "target"]],
    ["farawayMurder", ["target"]],
    ["spreading", ["target", "otherTarget"]],
    ["increasingUnease", ["target", "otherTarget"]],
    ["suicide", []],
    ["hospitalIncident", []],
    ["foulEvil", []],
  ] as const)("maps %s to only its required selections", (incident, fields) => {
    expect(aiIncidentChoiceFields(incident)).toEqual(fields);
  });
});

describe("goodwill ability owner life state", () => {
  it("omits dead and absent ability users", () => {
    const dead = createState(["alien"]);
    unlock(dead, "alien", 5);
    setBoardLife(dead.loop, "alien", false);
    expect(goodwillAbilityViews(dead)).toEqual([]);

    const absent = createState(["alien"]);
    unlock(absent, "alien", 5);
    absent.loop.board.alien = { status: "absent" };
    expect(goodwillAbilityViews(absent)).toEqual([]);
  });

  it.each([
    ["alien", "boyStudent"],
    ["forensicSpecialist", "boyStudent"],
  ] as const)(
    "keeps %s's corpse-target ability available",
    (user, corpse) => {
      const state = createState([user, corpse]);
      unlock(state, user, 5);
      setBoardLocation(state.loop, user, "City");
      setBoardLocation(state.loop, corpse, "City");
      setBoardLife(state.loop, corpse, false);

      const view = goodwillAbilityViews(state).find(
        ({ character, schema }) =>
          character === user && schema.rank === 5,
      );
      expect(view).toMatchObject({
        disabledReason: undefined,
        targets: [{ kind: "character", id: corpse }],
      });
    },
  );
});

function resolveLeaderCardThroughP4(
  state: GameState,
  card: ActionCard,
): void {
  const leader = state.loop.leader;
  const placements: PlacedCard[] = [
    {
      owner: "mastermind",
      card: "paranoiaPlus1",
      target: { kind: "character", id: "classRep" },
    },
    {
      owner: "mastermind",
      card: "paranoiaMinus1",
      target: { kind: "character", id: "boyStudent" },
    },
    {
      owner: "mastermind",
      card: "intriguePlus1",
      target: { kind: "location", at: "Shrine" },
    },
    {
      owner: leader,
      card,
      target: { kind: "character", id: "classRep" },
    },
    {
      owner: ((leader + 1) % 3) as 0 | 1 | 2,
      card: "goodwillPlus1",
      target: { kind: "character", id: "boyStudent" },
    },
    {
      owner: ((leader + 2) % 3) as 0 | 1 | 2,
      card: "paranoiaPlus1",
      target: { kind: "character", id: "girlStudent" },
    },
  ];
  state.loop.placed = [];
  for (const placement of placements) {
    expect(validatePlacement(state, placement)).toEqual({ ok: true });
    state.loop.placed.push(placement);
  }
  state.loop.phase = "P4_RESOLVE";
  advanceGame(state);
  expect(state.loop.phase).toBe("P4_RESOLVE");
  expect(state.loop.actionResolutionComplete).toBe(true);
  advanceGame(state);
  expect(state.loop.phase).toBe("P6_GOODWILL");
}

describe("structured goodwill ability UI", () => {
  it("collects public refusal dates by character across loop snapshots", () => {
    const state = createState(["officeWorker"]);
    state.scenario.cast.officeWorker = "killer";
    unlock(state, "officeWorker", 3);
    state.loop.day = 2;
    resolveGoodwillAbility(state, {
      user: "officeWorker",
      rank: 3,
      abilityIndex: 0,
    }, "refuse");
    state.history.push(structuredClone(state.loop));

    state.loop = initLoop(state.scenario, 2);
    state.loop.phase = "P6_GOODWILL";
    state.loop.day = 3;
    unlock(state, "officeWorker", 3);
    resolveGoodwillAbility(state, {
      user: "officeWorker",
      rank: 3,
      abilityIndex: 0,
    }, "refuse");

    expect(goodwillRefusalHistory(state)).toEqual([{
      character: "officeWorker",
      occurrences: [
        { loop: 1, day: 2 },
        { loop: 2, day: 3 },
      ],
    }]);
  });

  it("hides an absent user's abilities and excludes it from targets", () => {
    const state = createState(["transferStudent", "nurse"]);
    unlock(state, "transferStudent", 2);
    unlock(state, "nurse", 2);

    const views = goodwillAbilityViews(state);
    expect(views.some(({ character }) => character === "transferStudent"))
      .toBe(false);
    expect(views.find(({ character }) => character === "nurse")?.targets)
      .not.toContainEqual({ kind: "character", id: "transferStudent" });
  });

  it("does not display dead officeWorker and boyStudent abilities", () => {
    const state = createState([
      "officeWorker",
      "boyStudent",
      "girlStudent",
    ]);
    unlock(state, "officeWorker", 3);
    unlock(state, "boyStudent", 2);
    setBoardLife(state.loop, "officeWorker", false);
    setBoardLife(state.loop, "boyStudent", false);

    const views = goodwillAbilityViews(state);

    expect(views.some(({ character }) => character === "officeWorker"))
      .toBe(false);
    expect(views.some(({ character }) => character === "boyStudent"))
      .toBe(false);
  });

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

    setBoardLocation(state.loop, "girlStudent", "City");
    const unavailableBoy = goodwillAbilityViews(state).find(
      ({ character }) => character === "boyStudent",
    );
    expect(unavailableBoy?.disabledReason).toBe("noTarget");
    expect(unavailableBoy).not.toHaveProperty("disabledDiagnostic");
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

    setBoardLife(state.loop, "patient", false);
    expect(
      goodwillAbilityViews(state).find(
        ({ character, schema }) => character === "doctor" && schema.rank === 2,
      )?.targets,
    ).toEqual([{ kind: "character", id: "nurse" }]);
  });

  it("lets richStudent target self but excludes popIdol from her own rank-4 targets", () => {
    const state = createState(["richStudent", "popIdol"]);
    setBoardLocation(state.loop, "popIdol", "School");
    unlock(state, "richStudent", 3);
    unlock(state, "popIdol", 4);

    const views = goodwillAbilityViews(state);
    const richStudent = views.find(
      ({ character }) => character === "richStudent",
    );
    const popIdol = views.find(
      ({ character, schema }) => character === "popIdol" && schema.rank === 4,
    );
    expect(richStudent).toMatchObject({
      disabledReason: undefined,
      targets: [
        { kind: "character", id: "richStudent" },
        { kind: "character", id: "popIdol" },
      ],
    });
    expect(popIdol?.targets).toEqual([
      { kind: "character", id: "richStudent" },
    ]);

    setBoardLocation(state.loop, "richStudent", "Shrine");
    expect(
      goodwillAbilityViews(state).find(
        ({ character }) => character === "richStudent",
      )?.disabledReason,
    ).toBe("restrictedLocation");
  });

  it("disables mysteryBoy's rank-3 ability until loop 2", () => {
    const state = createState(["mysteryBoy"]);
    unlock(state, "mysteryBoy", 3);

    expect(goodwillAbilityViews(state)[0]).toMatchObject({
      disabledReason: "minLoop",
      schema: { minLoop: 2 },
    });

    state.loop.loop = 2;
    expect(goodwillAbilityViews(state)[0].disabledReason).toBeUndefined();
  });

  it("enables implemented illusion rank 4 while disabling unsupported abilities", () => {
    const state = createState(["scientist", "illusion"]);
    unlock(state, "scientist", 3);
    unlock(state, "illusion", 4);

    expect(goodwillAbilityViews(state).map(({
      character,
      schema,
      disabledReason,
    }) => ({
      character,
      rank: schema.rank,
      disabledReason,
    }))).toEqual([
      {
        character: "scientist",
        rank: 3,
        disabledReason: "notImplemented",
      },
      {
        character: "illusion",
        rank: 3,
        disabledReason: "notImplemented",
      },
      {
        character: "illusion",
        rank: 4,
        disabledReason: undefined,
      },
    ]);
  });

  it("offers boss rank 5 targets in turf and disables unsupported forensic rank 2", () => {
    const state = createState([
      "boss",
      "forensicSpecialist",
      "boyStudent",
      "girlStudent",
    ]);
    setBoardLocation(state.loop, "boss", "City");
    setBoardLocation(state.loop, "forensicSpecialist", "City");
    setBoardLocation(state.loop, "boyStudent", "School");
    setBoardLocation(state.loop, "girlStudent", "Shrine");
    unlock(state, "boss", 5);
    unlock(state, "forensicSpecialist", 2);

    const views = goodwillAbilityViews(state);
    expect(views.find(
      ({ character, schema }) => character === "boss" && schema.rank === 5,
    )).toMatchObject({
      disabledReason: undefined,
      targets: [{ kind: "character", id: "boyStudent" }],
    });
    expect(views.find(
      ({ character, schema }) =>
        character === "forensicSpecialist" && schema.rank === 2,
    )).toMatchObject({
      disabledReason: "notImplemented",
    });
  });

  it("enforces shrineMaiden rank 3's Shrine restriction", () => {
    const state = createState(["shrineMaiden"]);
    unlock(state, "shrineMaiden", 3);

    expect(goodwillAbilityViews(state)[0]).toMatchObject({
      disabledReason: undefined,
      choice: { kind: "none" },
      schema: { rank: 3 },
    });

    setBoardLocation(state.loop, "shrineMaiden", "City");
    expect(goodwillAbilityViews(state)[0]).toMatchObject({
      disabledReason: "restrictedLocation",
    });
  });

  it.each<ActionCard>([
    "goodwillPlus2",
    "paranoiaMinus1",
    "forbidMove",
  ])("recovers the leader's %s card after the actual P4 path", (card) => {
    const state = createState(["classRep", "boyStudent", "girlStudent"]);
    unlock(state, "classRep", 2);

    expect(goodwillAbilityViews(state)[0]).toMatchObject({
      disabledReason: "noSpentCard",
    });

    resolveLeaderCardThroughP4(state, card);
    const view = goodwillAbilityViews(state).find(
      ({ character, schema }) => character === "classRep" && schema.rank === 2,
    );
    expect(view).toMatchObject({
      disabledReason: undefined,
      choice: { kind: "spentCard", options: [card] },
    });
    expect(state.loop.spentOncePerLoop.protagonists[0]).toEqual([card]);

    resolveGoodwillAbility(state, {
      user: "classRep",
      rank: 2,
      abilityIndex: 0,
      card,
    }, "resolve");

    expect(state.loop.spentOncePerLoop.protagonists[0]).toEqual([]);
  });

  it("uses the new leader's spent cards after P8 passes leadership", () => {
    const state = createState(["classRep", "boyStudent", "girlStudent"]);
    unlock(state, "classRep", 2);
    state.loop.phase = "P7_INCIDENT";

    advanceGame(state);
    expect(state.loop.leader).toBe(1);
    expect(state.loop).toMatchObject({
      day: 2,
      phase: "P2_MASTERMIND_ACTION",
      leader: 1,
    });

    resolveLeaderCardThroughP4(state, "goodwillPlus2");
    expect(state.loop.spentOncePerLoop.protagonists).toEqual([
      [],
      ["goodwillPlus2"],
      [],
    ]);
    expect(goodwillAbilityViews(state).find(
      ({ character, schema }) => character === "classRep" && schema.rank === 2,
    )).toMatchObject({
      disabledReason: undefined,
      choice: { kind: "spentCard", options: ["goodwillPlus2"] },
    });

    resolveGoodwillAbility(state, {
      user: "classRep",
      rank: 2,
      abilityIndex: 0,
      card: "goodwillPlus2",
    }, "resolve");
    expect(state.loop.spentOncePerLoop.protagonists).toEqual([[], [], []]);
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

  it("disables only the goodwill ability already used this round", () => {
    const state = createState(["journalist", "boyStudent"]);
    unlock(state, "journalist", 2);
    setBoardLocation(state.loop, "journalist", "City");
    setBoardLocation(state.loop, "boyStudent", "City");

    resolveGoodwillAbility(state, {
      user: "journalist",
      rank: 2,
      abilityIndex: 0,
      target: "boyStudent",
    }, "resolve");

    expect(goodwillAbilityViews(state).map((view) => ({
      abilityIndex: view.abilityIndex,
      disabledReason: view.disabledReason,
    }))).toEqual([
      { abilityIndex: 0, disabledReason: "usedThisRound" },
      { abilityIndex: 1, disabledReason: undefined },
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
    expect(subplotRevealOptions(choice, "circleFriends")).toEqual([
      "threadsFate",
    ]);
    expect(subplotRevealOptions(choice, "hiddenFreak")).toEqual([
      "circleFriends",
      "threadsFate",
    ]);
  });

  it("round-trips the incident value rendered in data-goodwill-choice", () => {
    const selection = { day: 5, incident: "missingPerson" };

    expect(decodeIncidentSelection(encodeIncidentSelection(selection)))
      .toEqual(selection);
    expect(decodeIncidentSelection("not-an-occurrence")).toBeUndefined();
  });
});
