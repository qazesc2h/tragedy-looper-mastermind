import { characterDataOf } from "../data";
import {
  characterEntryTiming,
  scenarioTurfLocation,
  startLocationOf,
  type CharacterId,
  type Counters,
  type LoopState,
  type Scenario,
} from "../types";

export function initLoop(scenario: Scenario, loopNumber = 1): LoopState {
  const board: LoopState["board"] = {};
  const charCounters: Record<
    CharacterId,
    Counters & { protection: number }
  > = {};
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
    charCounters[character] = {
      goodwill: 0,
      paranoia: 0,
      intrigue: 0,
      protection: 0,
    };
  }

  const bossTurf = scenarioTurfLocation(scenario, "boss");
  if (bossTurf !== undefined) turfLocations.boss = bossTurf;

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
    placed: [],
    actionResolutionComplete: false,
    phaseLog: [],
  };
}
