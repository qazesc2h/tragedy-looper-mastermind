import {
  effectiveRole,
  type CharacterId,
  type GameState,
  type HookPoint,
  type RoleId,
} from "../types";
import { recordPublicInformation, nextPublicObservationAt } from "./public-information";
import { publicObservationContext } from "./public-observation";

/**
 * 역할 공개의 공개 주장과 실제 해결을 같은 관측 시점으로 기록한다.
 * 닌자의 거짓 선언 합법성은 MZ-3에서 이 진입점에 연결한다.
 */
export function resolveRoleReveal(
  state: GameState,
  character: CharacterId,
  claimedRole: RoleId = effectiveRole(state, character),
  phase: HookPoint = state.loop.phase,
): boolean {
  const alreadyClaimed = (state.loop.publicInformationThisLoop ?? []).some(
    (information) =>
      information.kind === "roleClaim" &&
      information.character === character,
  );
  if (alreadyClaimed) return false;

  const actualRoleAtReveal = effectiveRole(state, character);
  if (claimedRole !== actualRoleAtReveal) {
    throw new Error("false role claims are not supported before MZ-3");
  }

  const observedAt = nextPublicObservationAt(state, phase);
  recordPublicInformation(state, {
    kind: "roleClaim",
    character,
    claimedRole,
    loop: state.loop.loop,
    day: state.loop.day,
    context: publicObservationContext(state.loop),
    observedAt,
  }, phase);
  const resolutions = state.loop.roleRevealResolutionsThisLoop ??= [];
  resolutions.push({
    character,
    actualRoleAtReveal,
    claimedRole,
    result: "truthful",
    observedAt,
  });
  return true;
}

/** 그 시점의 실제 역할 기준으로 공개된 적이 있는지 판정한다. */
export function actualRoleWasRevealed(
  state: GameState,
  character: CharacterId,
  role: RoleId,
): boolean {
  return [...state.history, state.loop].some((loop) =>
    (loop.roleRevealResolutionsThisLoop ?? []).some((resolution) =>
      resolution.character === character &&
      resolution.actualRoleAtReveal === role
    )
  );
}
