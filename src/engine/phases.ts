// 9단계 라운드 상태 머신 — 뼈대만. 각 단계 본문은 TODO.
// 근거: 주인공 설명서 21p(4-1~4-9), 45p(라운드 진행 요약).

import {
  type GameState, type Hook, type HookPoint, type IncidentChoice,
  type IncidentResult, type Phase,
  PHASE_ORDER,
} from "../types";
import { effectiveAbilityRoles, ROLE_IMPL } from "../impl/roles";
import { PLOT_IMPL } from "../impl/plots";
import { resolveActions } from "./resolve";
import { resolveIncident } from "./incident";

/** 지금 이 시점에 걸리는 모든 훅을 모은다. */
export function collectHooks(s: GameState, at: HookPoint): {
  self: string; hook: Hook;
}[] {
  const out: { self: string; hook: Hook }[] = [];

  for (const c of Object.keys(s.scenario.cast)) {
    for (const abilityRole of effectiveAbilityRoles(s, c)) {
      const impl = ROLE_IMPL[abilityRole];
      for (const h of impl?.hooks ?? []) {
        if (h.phase === at) out.push({ self: c, hook: h });
      }
    }
  }
  for (const p of [s.scenario.mainPlot, ...s.scenario.subPlots]) {
    for (const h of PLOT_IMPL[p]?.hooks ?? []) {
      if (h.phase === at) out.push({ self: "", hook: h });
    }
  }
  return out;
}

/**
 * [강제] 를 전부 동시에 해결한 뒤 [선택] 을 각본가가 원하는 순서로.
 * (주인공 설명서 28p 「추리 참조표 및 카드 용어 설명」)
 *
 * "동시"란 조건 판정을 모두 먼저 하고 나서 효과를 적용한다는 뜻이다.
 * FAQ Q21: 연쇄 살인마 둘이 단 둘이 있으면 서로 죽인다 — 순차 처리하면
 * 한쪽만 죽는다. 반드시 판정/적용을 분리할 것.
 */
export function resolveHooks(s: GameState, at: HookPoint): void {
  const all = collectHooks(s, at);

  const mandatory = all.filter((x) => x.hook.kind !== "optional");
  const fired = mandatory
    .filter((x) => x.hook.when(s, x.self))
    .map((x) => ({
      ...x,
      target: x.hook.effectTarget?.(s, x.self),
    }));                                                        // ① 전원 판정
  for (const x of fired) x.hook.effect(s, x.self, x.target);     // ② 일괄 적용

  // TODO: [선택] 훅은 각본가에게 목록을 제시하고 순서/발동 여부를 받아야 한다.
  //       자동 진행이 아니라 UI 상호작용 지점.
}

export function advance(
  s: GameState,
  incidentChoice?: IncidentChoice,
): IncidentResult | undefined {
  let incidentResult: IncidentResult | undefined;
  switch (s.loop.phase) {
    case "P1_ROUND_START":
      resolveHooks(s, "P1_ROUND_START");
      break;

    case "P2_MASTERMIND_ACTION":
      // TODO: 각본가 카드 3장 배치. 동일 대상 중복 불가 검증.
      break;

    case "P3_PROTAGONIST_ACTION":
      // TODO: 리더부터 시계방향 1장씩. 주인공끼리만 중복 불가,
      //       각본가가 놓은 대상 위에는 겹쳐 놓을 수 있음.
      break;

    case "P4_RESOLVE":
      resolveHooks(s, "P4_RESOLVE");
      resolveActions(s);
      break;

    case "P5_MASTERMIND_ABILITY":
      resolveHooks(s, "P5_MASTERMIND_ABILITY");
      break;

    case "P6_GOODWILL":
      // TODO: 리더가 사용 선언 → 각본가가 해결/거부.
      //       우호 무시 역할만 거부 가능. 절대 우호 무시는 반드시 거부.
      //       거부당해도 "1루프당 1회"는 소진된 것으로 간주.
      break;

    case "P7_INCIDENT":
      incidentResult = resolveIncident(s, incidentChoice);
      break;

    case "P8_LEADER_PASS":
      s.loop.leader = ((s.loop.leader + 1) % 3) as 0 | 1 | 2;
      break;

    case "P9_ROUND_END":
      resolveHooks(s, "P9_ROUND_END");
      if (s.loop.day === s.scenario.daysPerLoop) {
        resolveHooks(s, "LAST_DAY");
        endLoop(s);
        return undefined;
      }
      s.loop.day += 1;
      s.loop.phase = "P1_ROUND_START";
      return undefined;
  }

  const i = PHASE_ORDER.indexOf(s.loop.phase as Phase);
  s.loop.phase = PHASE_ORDER[i + 1];
  return incidentResult;
}

export function endLoop(s: GameState): void {
  resolveHooks(s, "LOOP_END");
  // 인과율(threadsFate) 등 루프 간 참조를 위해 반드시 스냅샷을 남긴다.
  s.history.push(structuredClone(s.loop));
  // TODO: 승패 판정 → 다음 루프 준비 또는 최후의 싸움
}
