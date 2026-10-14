import type { RoleId } from "../types";

/** 원문 역할 데이터에서 immortal 태그를 가진 역할들. */
export const IMMORTAL_ROLE_IDS = [
  "timeTraveler",
  "immortalRole",
  "privateInvestigator",
  "vampire",
  "nightmare",
  "showOff",
  "sacrifice",
  "faceless",
] as const satisfies readonly RoleId[];

/** 현재 공개 불안까지 반영한 불사 여부. 허당은 불안 3개 이상이면 불사를 잃는다. */
export function roleIsImmortal(role: RoleId, paranoia = 0): boolean {
  if (role === "showOff" && paranoia > 2) return false;
  return IMMORTAL_ROLE_IDS.some((candidate) => candidate === role);
}
