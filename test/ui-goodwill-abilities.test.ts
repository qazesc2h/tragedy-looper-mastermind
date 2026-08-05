import { describe, expect, it } from "vitest";
import { resolveGoodwillAbility } from "../src/engine/goodwill";
import { advanceGame } from "../src/engine/game";
import { validatePlacement } from "../src/engine/legal";
import { initLoop } from "../src/engine/setup";
import {
  decodeIncidentSelection,
  encodeIncidentSelection,
  goodwillAbilityViews,
} from "../src/ui/goodwill-abilities";
import type {
  ActionCard,
  CharacterId,
  GameState,
  PlacedCard,
  Scenario,
} from "../src/types";

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
  const state: GameState = {
    scenario,
    gamePhase: "ROUND",
    loop: initLoop(scenario),
    history: [],
    loopOutcomes: [],
  };
  state.loop.phase = "P6_GOODWILL";
  return state;
}

function unlock(state: GameState, character: CharacterId, goodwill: number): void {
  state.loop.charCounters[character].goodwill = goodwill;
}

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
  expect(state.loop.phase).toBe("P6_GOODWILL");
}

describe("structured goodwill ability UI", () => {
  it("disables dead officeWorker and boyStudent abilities as dead", () => {
    const state = createState([
      "officeWorker",
      "boyStudent",
      "girlStudent",
    ]);
    unlock(state, "officeWorker", 3);
    unlock(state, "boyStudent", 2);
    state.loop.board.officeWorker.alive = false;
    state.loop.board.boyStudent.alive = false;

    const views = goodwillAbilityViews(state);

    expect(views.find(({ character }) => character === "officeWorker"))
      .toMatchObject({
        disabledReason: "dead",
        disabledDiagnostic: "alive=false",
        targetRequired: false,
      });
    expect(views.find(({ character }) => character === "boyStudent"))
      .toMatchObject({
        disabledReason: "dead",
        disabledDiagnostic: "alive=false",
        targetRequired: true,
      });
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

    state.loop.board.girlStudent.at = "City";
    const unavailableBoy = goodwillAbilityViews(state).find(
      ({ character }) => character === "boyStudent",
    );
    expect(unavailableBoy?.disabledReason).toBe("noTarget");
    expect(unavailableBoy?.disabledDiagnostic).toBe(
      'scope=sameLocation, excludeSelf=true, tags=["student"], ' +
      'predicates=["alive"], candidates=[]',
    );
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

  it("lets richStudent target self but excludes popIdol from her own rank-4 targets", () => {
    const state = createState(["richStudent", "popIdol"]);
    state.loop.board.popIdol.at = "School";
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

    state.loop.board.richStudent.at = "Shrine";
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
      disabledDiagnostic: "loop=1, minLoop=2",
      schema: { minLoop: 2 },
    });

    state.loop.loop = 2;
    expect(goodwillAbilityViews(state)[0].disabledReason).toBeUndefined();
  });

  it("shows promotion abilities as present but not yet implemented", () => {
    const state = createState(["scientist", "illusion"]);
    unlock(state, "scientist", 3);
    unlock(state, "illusion", 4);

    expect(goodwillAbilityViews(state).map(({
      character,
      schema,
      disabledReason,
      disabledDiagnostic,
    }) => ({
      character,
      rank: schema.rank,
      disabledReason,
      disabledDiagnostic,
    }))).toEqual([
      {
        character: "scientist",
        rank: 3,
        disabledReason: "notImplemented",
        disabledDiagnostic: "implemented=false",
      },
      {
        character: "illusion",
        rank: 3,
        disabledReason: "notImplemented",
        disabledDiagnostic: "implemented=false",
      },
      {
        character: "illusion",
        rank: 4,
        disabledReason: "notImplemented",
        disabledDiagnostic: "implemented=false",
      },
    ]);
  });

  it("shows evidence for unsupported turf and multiple-target abilities", () => {
    const state = createState([
      "boss",
      "forensicSpecialist",
      "boyStudent",
      "girlStudent",
    ]);
    for (const character of Object.keys(state.loop.board)) {
      state.loop.board[character].at = "City";
    }
    unlock(state, "boss", 5);
    unlock(state, "forensicSpecialist", 2);

    const views = goodwillAbilityViews(state);
    expect(views.find(
      ({ character, schema }) => character === "boss" && schema.rank === 5,
    )).toMatchObject({
      disabledReason: "unsupportedTurf",
      disabledDiagnostic: "predicate=inUserTurf, candidates=unsupported",
    });
    expect(views.find(
      ({ character, schema }) =>
        character === "forensicSpecialist" && schema.rank === 2,
    )).toMatchObject({
      disabledReason: "multipleTargets",
      disabledDiagnostic:
        'required=2, candidates=[{"kind":"character","id":"boss"},' +
        '{"kind":"character","id":"boyStudent"},' +
        '{"kind":"character","id":"girlStudent"}]',
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

    state.loop.board.shrineMaiden.at = "City";
    expect(goodwillAbilityViews(state)[0]).toMatchObject({
      disabledReason: "restrictedLocation",
      disabledDiagnostic: 'at=City, allowed=["Shrine"]',
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
      disabledDiagnostic: "leader=0, spent=[[],[],[]]",
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
    expect(state.loop.phase).toBe("P9_ROUND_END");
    expect(state.loop.leader).toBe(1);
    advanceGame(state);
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
      disabledDiagnostic: "choice=pastIncident, candidates=[]",
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
