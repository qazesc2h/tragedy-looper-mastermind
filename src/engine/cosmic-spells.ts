import {
  isCharacterAlive,
  type CharacterId,
  type GameState,
} from "../types";
import { recordPublicInformation } from "./public-information";

export function cosmicSpellLevel(state: GameState): number {
  if (state.scenario.tragedySet !== "cosmicMythology") return 0;
  return state.loop.specialGauge?.value ?? 0;
}

// SOURCE: "At the start of the first day, the Leader may place 2 :goodwill:
// on any one character of his choice."

export function sympathySpellDecisionRequired(state: GameState): boolean {
  return state.gamePhase === "ROUND" &&
    state.loop.phase === "P1_ROUND_START" &&
    state.loop.day === 1 &&
    cosmicSpellLevel(state) >= 1 &&
    state.loop.sympathySpellResolved !== true;
}

/** 주인공 리더의 선택. null은 이번 루프에 사용하지 않음을 뜻한다. */
export function resolveSympathySpell(
  state: GameState,
  target: CharacterId | null,
): void {
  if (!sympathySpellDecisionRequired(state)) {
    throw new Error("Spell of Sympathy choice is not currently available");
  }
  if (target !== null) {
    const position = state.loop.board[target];
    if (position === undefined || !isCharacterAlive(position)) {
      throw new Error("Spell of Sympathy requires a living character");
    }
    state.loop.charCounters[target].goodwill += 2;
  }
  state.loop.sympathySpellResolved = true;
}

export function revealFirstSubplotBySpell(state: GameState): void {
  // SOURCE: "At the end of the loop, the Protagonists get to know the first subplot."
  if (cosmicSpellLevel(state) < 2) return;
  const revealedSubplot = state.scenario.subPlots[0];
  if (revealedSubplot === undefined) return;
  const alreadyRevealed = (state.loop.publicInformationThisLoop ?? []).some(
    (information) => information.kind === "subplot" &&
      information.source === "reminiscenceForefathers",
  );
  if (alreadyRevealed) return;
  recordPublicInformation(state, {
    kind: "subplot",
    source: "reminiscenceForefathers",
    declaredSubplot: revealedSubplot,
    revealedSubplot,
  }, "LOOP_END");
}

export function ancientSealActive(state: GameState): boolean {
  // SOURCE: "The Protagonist’s \"Forbid :intrigue:\" cards are no longer
  // nullified if more then one of them are played in the same day."
  return cosmicSpellLevel(state) >= 3;
}

export function madnessSpellActive(state: GameState): boolean {
  // SOURCE: "At the end of the Day the Protagonists die. This happens after
  // everything else. No more loops can be played. Go to Final Guess."
  return cosmicSpellLevel(state) >= 4;
}
