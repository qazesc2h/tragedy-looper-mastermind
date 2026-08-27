import { characterDataOf } from "../data";
import {
  LOCATIONS,
  type CharacterId,
  type GameState,
  type Location,
} from "../types";

export interface CharacterLocationInformation {
  startLocations: readonly Location[];
  startLocationIsMastermindChoice: boolean;
  selectedStartLocation?: Location;
  forbiddenLocations: readonly Location[];
  restrictionsRemoved: boolean;
}

function selectedStartLocation(
  state: GameState,
  character: CharacterId,
): Location | undefined {
  if (character === "henchman") {
    return state.loop.loopStartTraitLocationChoices?.henchman;
  }
  const selected = state.scenario.scriptSpecified?.[
    `startLocation:${character}`
  ];
  return typeof selected === "string" &&
      LOCATIONS.includes(selected as Location)
    ? selected as Location
    : undefined;
}

export function characterLocationInformation(
  state: GameState,
  character: CharacterId,
): CharacterLocationInformation {
  const data = characterDataOf(character);
  const startLocationIsMastermindChoice = character === "henchman";

  return {
    startLocations: data.startLocation,
    startLocationIsMastermindChoice,
    selectedStartLocation: data.startLocation.length > 1
      ? selectedStartLocation(state, character)
      : data.startLocation[0],
    forbiddenLocations: data.forbiddenLocation,
    restrictionsRemoved:
      state.loop.locationRestrictionsRemoved?.includes(character) ?? false,
  };
}
