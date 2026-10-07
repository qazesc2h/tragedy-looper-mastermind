import type { RoleId } from "../types";

/** 원문 역할 데이터에서 immortal 태그를 가진 역할들. */
export const IMMORTAL_ROLE_IDS = [
  "timeTraveler",
  "immortalRole",
  "privateInvestigator",
] as const satisfies readonly RoleId[];

export function roleIsImmortal(role: RoleId): boolean {
  return IMMORTAL_ROLE_IDS.some((candidate) => candidate === role);
}
