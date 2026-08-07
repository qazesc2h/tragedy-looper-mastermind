import manualExamples from "./fixtures/manual-examples.json";
import {
  characterLocation,
  isCharacterAlive,
  withCharacterLife,
  withCharacterLocation,
  type CharacterId,
  type Location,
  type LoopState,
} from "../src/types";

export function boardLocation(
  loop: LoopState,
  character: CharacterId,
): Location {
  return characterLocation(loop.board[character], character);
}

export function boardIsAlive(
  loop: LoopState,
  character: CharacterId,
): boolean {
  return isCharacterAlive(loop.board[character]);
}

export function setBoardLocation(
  loop: LoopState,
  character: CharacterId,
  location: Location,
): void {
  loop.board[character] = withCharacterLocation(
    loop.board[character],
    location,
    character,
  );
}

export function setBoardLife(
  loop: LoopState,
  character: CharacterId,
  alive: boolean,
): void {
  loop.board[character] = withCharacterLife(
    loop.board[character],
    alive,
    character,
  );
}

export function loadManualExamples() {
  return manualExamples;
}

export type ManualExamples = ReturnType<typeof loadManualExamples>;
export type ManualExampleCase = ManualExamples["cases"][number];
