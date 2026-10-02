import {
  effectiveRole,
  type CharacterId,
  type GameState,
  type HookPoint,
  type RoleId,
} from "../types";
import { recordPublicInformation, nextPublicObservationAt } from "./public-information";
import { publicObservationContext } from "./public-observation";

export interface RoleClaimOption {
  claimedRole: RoleId;
  result: "truthful" | "ninjaLie";
}

/**
 * 공개 시점 실제 역할과 각본의 기본 배정 역할만으로 선언 후보를 만든다.
 * Q10 확정 전에는 동적으로 얻은 역할을 거짓 선언 후보에 넣지 않는다.
 */
export function roleClaimOptions(
  state: GameState,
  character: CharacterId,
): RoleClaimOption[] {
  const actualRoleAtReveal = effectiveRole(state, character);
  const truthful: RoleClaimOption = {
    claimedRole: actualRoleAtReveal,
    result: "truthful",
  };
  if (actualRoleAtReveal !== "ninja") return [truthful];

  const lieRoles = [...new Set(Object.values(state.scenario.cast))].filter(
    (role) => role !== "person" && role !== "ninja",
  );
  return [
    truthful,
    ...lieRoles.map((claimedRole) => ({
      claimedRole,
      result: "ninjaLie" as const,
    })),
  ];
}

/**
 * 역할 공개의 공개 주장과 실제 해결을 같은 관측 시점으로 기록한다.
 * 닌자의 거짓 선언을 포함한 모든 공개는 이 진입점에서 합법성을 판정한다.
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
  const option = roleClaimOptions(state, character).find(
    (candidate) => candidate.claimedRole === claimedRole,
  );
  if (option === undefined) {
    throw new Error(
      `role claim "${claimedRole}" is not allowed for ${actualRoleAtReveal}`,
    );
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
    result: option.result,
    observedAt,
  });
  return true;
}

/** 비밀 기록처럼 주인공에게 공개된 선언 역할을 읽는 효과용 조회다. */
export function claimedRoleWasRevealed(
  state: GameState,
  role: RoleId,
): boolean {
  return [...state.history, state.loop].some((loop) =>
    (loop.publicInformationThisLoop ?? []).some((information) =>
      information.kind === "roleClaim" && information.claimedRole === role
    )
  );
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
