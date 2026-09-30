import { characterDataOf } from "../data";
import { emptyCharacterCounters } from "../counters";
import {
  characterEntryTiming,
  scenarioTurfLocation,
  startLocationOf,
  type CharacterId,
  type LoopState,
  type Scenario,
} from "../types";
import { initialSpecialGauge } from "./special-gauge";

export function initLoop(
  scenario: Scenario,
  loopNumber = 1,
  previousLoop?: LoopState,
): LoopState {
  const board: LoopState["board"] = {};
  const charCounters: LoopState["charCounters"] = {};
  const turfLocations: LoopState["turfLocations"] = {};

  for (const character of Object.keys(scenario.cast)) {
    const entry = characterEntryTiming(scenario, character);
    const waitsForEntry = character === "henchman" || (
      characterDataOf(character).comesInLater && !(
        entry?.kind === "loop" && loopNumber > entry.value
      )
    );
    board[character] = waitsForEntry
      ? { status: "absent" }
      : {
        status: "alive",
        at: startLocationOf(character, scenario),
      };
    charCounters[character] = emptyCharacterCounters();
  }

  const bossTurf = scenarioTurfLocation(scenario, "boss");
  if (bossTurf !== undefined) turfLocations.boss = bossTurf;

  const specialGauge = initialSpecialGauge(
    scenario.tragedySet,
    previousLoop?.specialGauge,
  );

  return {
    loop: loopNumber,
    day: 1,
    phase: "P1_ROUND_START",
    leader: 0,
    board,
    turfLocations,
    charCounters,
    locIntrigue: {
      Hospital: 0,
      Shrine: 0,
      City: 0,
      School: 0,
    },
    spentOncePerLoop: {
      mastermind: [],
      protagonists: [[], [], []],
    },
    abilitiesUsedThisLoop: [],
    abilitiesUsedThisRound: [],
    servantAdditionalServedCharacters: [],
    placed: [],
    actionResolutionComplete: false,
    phaseLog: [],
    ...(specialGauge === undefined ? {} : { specialGauge }),
  };
}
