// 9단계 라운드 상태 머신 — 뼈대만. 각 단계 본문은 TODO.
// 근거: 주인공 설명서 21p(4-1~4-9), 45p(라운드 진행 요약).

import {
  isCharacterAlive,
  isCharacterDead,
  isCharacterPresent,
  type GameState, type Hook, type HookPoint, type IncidentChoice,
  type HookContext, type IncidentResult, type Phase,
  type PublicAbilityTrigger, type Target, PHASE_ORDER,
} from "../types";
import { effectiveAbilityRoles, ROLE_IMPL } from "../impl/roles";
import { PLOT_IMPL } from "../impl/plots";
import { TRAIT_IMPL } from "../impl/traits";
import { resolveActions } from "./resolve";
import { resolveIncident } from "./incident";
import { requestLoopEnd } from "./flow";
import { evaluateLoss } from "./loss";
import { withDeathBatch } from "./death";
import { recordPhaseLog } from "./phase-log";
import {
  publicBoardChanges,
  publicObservationContext,
} from "./public-observation";
import { recordRoundEndPairs } from "./round-evidence";
import {
  finalizeSacredTreeMastermindStep,
  sacredTreeLeaderChoiceRequired,
} from "./sacred-tree";

function requestEndForActivatedLosses(s: GameState): void {
  // LOOP_END 조건은 라운드 종료 훅과 LAST_DAY 처리를 마친 뒤 finishLoop()에서
  // 판정한다. P9 진입 시점에 먼저 잡으면 P9 훅을 건너뛰게 된다.
  const activated = evaluateLoss(s).filter(
    (condition) => condition.activated && condition.timing !== "loopEnd",
  );
  if (activated.length === 0) return;
  requestLoopEnd(
    s,
    activated.some(({ category }) => category === "protagonistDeath")
      ? "protagonistDeath"
      : "effect",
    activated.map(({ key }) => key),
  );
}

/** 현재 상태에서 실제로 성립한 즉시 종료 조건의 키를 반환한다. */
export function activatedImmediateLossKeys(s: GameState): string[] {
  return evaluateLoss(s)
    .filter((condition) =>
      condition.timing === "immediate" && condition.activated
    )
    .map(({ key }) => key);
}

/**
 * 정규 효과 묶음 전후를 비교해 이번 묶음에서 새로 성립한 즉시 조건만 남긴다.
 * 묶음 시작 전부터 성립한 수동 교정 상태는 즉시 종료 기록에 추가하지 않는다.
 */
export function reconcilePendingImmediateLosses(
  s: GameState,
  beforeKeys: readonly string[],
): void {
  const before = new Set(beforeKeys);
  const after = new Set(activatedImmediateLossKeys(s));
  const pending = new Set(
    (s.loop.pendingImmediateLossKeys ?? []).filter((key) => after.has(key)),
  );
  for (const key of after) {
    if (!before.has(key)) pending.add(key);
  }
  if (pending.size === 0) {
    delete s.loop.pendingImmediateLossKeys;
    return;
  }
  s.loop.pendingImmediateLossKeys = [...pending];
}

/** 지금 이 시점에 걸리는 모든 훅을 모은다. */
export function collectHooks(s: GameState, at: HookPoint): {
  self: string; hook: Hook;
}[] {
  const out: { self: string; hook: Hook }[] = [];

  for (const c of Object.keys(s.scenario.cast)) {
    const position = s.loop.board[c];
    if (position !== undefined) {
      for (const abilityRole of effectiveAbilityRoles(s, c)) {
        const impl = ROLE_IMPL[abilityRole];
        for (const h of impl?.hooks ?? []) {
          if (
            h.phase === at &&
            (
              isCharacterAlive(position) ||
              // 핵심 인물의 즉시 종료와 친구의 루프 종료 공개는 시체가 능력을
              // "사용"하는 예외가 아니라 사망 상태 자체의 패배·공개 처리다.
              ((at === "ALWAYS" || at === "LOOP_END") &&
                h.kind === "lossTragedy" &&
                isCharacterDead(position))
            )
          ) out.push({ self: c, hook: h });
        }
      }
    }
    // 등장 특성은 absent 상태에서도 자신을 배치할 수 있어야 한다. 그 밖의
    // 캐릭터 특성은 살아 있는 캐릭터만 공급한다.
    for (const h of TRAIT_IMPL[c]?.hooks ?? []) {
      const entryTrait = h.phase === "LOOP_CHARACTER_PLACEMENT" ||
        h.phase === "P1_CHARACTER_ENTRY";
      if (
        h.phase === at &&
        position !== undefined &&
        (isCharacterAlive(position) ||
          (entryTrait && !isCharacterPresent(position)))
      ) out.push({ self: c, hook: h });
    }
  }
  for (const p of [s.scenario.mainPlot, ...s.scenario.subPlots]) {
    for (const h of PLOT_IMPL[p]?.hooks ?? []) {
      if (h.phase === at) out.push({ self: "", hook: h });
    }
  }
  return out;
}

function publicTrigger(
  context: HookContext | undefined,
): PublicAbilityTrigger | undefined {
  if (context?.kind !== "death") return undefined;
  return {
    kind: "death",
    deadCharacters: [...context.deadCharacters],
  };
}

/**
 * 훅 하나의 공개 게임판 변화를 기록한다. 사망 배치 안에서 호출해야 하므로
 * 최초 사망과 그 뒤 ON_DEATH 반응이 서로 다른 관측으로 남는다.
 */
export function applyHookEffect(
  s: GameState,
  at: HookPoint,
  hook: Hook,
  self: string,
  target?: Target,
  context?: HookContext,
  recordWhenUnchanged = false,
): void {
  const before = structuredClone(s.loop);
  hook.effect(s, self, target);
  const publicChanges = publicBoardChanges(before, s.loop);
  if (publicChanges.length === 0 && !recordWhenUnchanged) return;
  const trigger = publicTrigger(context);

  recordPhaseLog(s, {
    loop: s.loop.loop,
    day: s.loop.day,
    phase: s.loop.phase,
    kind: "abilityActivated",
    timing: at,
    ...(self ? { character: self } : {}),
    description:
      hook.source.description ?? hook.source.prerequisite ?? hook.source.timing,
    publicChanges,
    publicContext: publicObservationContext(before),
    ...(trigger === undefined ? {} : { publicTrigger: trigger }),
  });
}

/**
 * [강제] 를 전부 동시에 해결한 뒤 [선택] 을 각본가가 원하는 순서로.
 * (주인공 설명서 28p 「추리 참조표 및 카드 용어 설명」)
 *
 * "동시"란 조건 판정을 모두 먼저 하고 나서 효과를 적용한다는 뜻이다.
 * FAQ Q21: 연쇄 살인마 둘이 단 둘이 있으면 서로 죽인다 — 순차 처리하면
 * 한쪽만 죽는다. 반드시 판정/적용을 분리할 것.
 * 이 강제 훅 묶음 전체가 하나의 사망 배치이며 단계 밖으로 이어지지 않는다.
 */
export function resolveHooks(
  s: GameState,
  at: HookPoint,
  context?: HookContext,
): void {
  const all = collectHooks(s, at);

  const mandatory = all.filter((x) => x.hook.kind !== "optional");
  const fired = mandatory
    .filter((x) => x.hook.when(s, x.self, context))
    .map((x) => ({
      ...x,
      target: x.hook.effectTarget?.(s, x.self),
    }));                                                        // ① 전원 판정
  withDeathBatch(s, () => {
    for (const x of fired) {
      applyHookEffect(s, at, x.hook, x.self, x.target, context);
    }                                                           // ② 일괄 적용
  });

  // TODO: [선택] 훅은 각본가에게 목록을 제시하고 순서/발동 여부를 받아야 한다.
  //       자동 진행이 아니라 UI 상호작용 지점.
}

export function advance(
  s: GameState,
  incidentChoice?: IncidentChoice,
): IncidentResult | undefined {
  if (s.gamePhase !== "ROUND") {
    throw new Error(`round phase cannot advance during ${s.gamePhase}`);
  }
  if (s.pendingLoopEnd || (s.loop.pendingImmediateLossKeys?.length ?? 0) > 0) {
    return undefined;
  }

  let incidentResult: IncidentResult | undefined;
  switch (s.loop.phase) {
    case "P1_ROUND_START":
      resolveHooks(s, "P1_CHARACTER_ENTRY");
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
      if (s.loop.actionResolutionComplete) {
        if (sacredTreeLeaderChoiceRequired(s)) {
          throw new Error("sacred-tree Leader choice is required");
        }
        s.loop.actionResolutionComplete = false;
        break;
      }
      // 강제 훅과 이동→나머지 행동 해결은 서로 다른 사망 배치다.
      resolveHooks(s, "P4_RESOLVE");
      withDeathBatch(s, () => resolveActions(s));
      // 공개·효과 적용·결과 확인까지 P4다. 다음 입력에서 P5로 넘어간다.
      s.loop.actionResolutionComplete = true;
      return undefined;

    case "P5_MASTERMIND_ABILITY":
      finalizeSacredTreeMastermindStep(s);
      resolveHooks(s, "P5_MASTERMIND_ABILITY");
      break;

    case "P6_GOODWILL":
      // 상호작용 단계이므로 이 phase를 유지한 채 goodwill.ts로 선언을 하나씩
      // 해결한다. 여기까지 advance하면 더 선언하지 않고 P7로 넘어간다.
      break;

    case "P7_INCIDENT":
      incidentResult = resolveIncident(s, incidentChoice);
      break;

    case "P8_LEADER_PASS":
      s.loop.leader = ((s.loop.leader + 1) % 3) as 0 | 1 | 2;
      break;

    case "P9_ROUND_END":
      if (!s.loop.roundEndMandatoryResolved) {
        recordRoundEndPairs(s);
        resolveHooks(s, "P9_ROUND_END");
        requestEndForActivatedLosses(s);
        if (s.pendingLoopEnd) return undefined;

        const optionalHookAvailable = collectHooks(s, "P9_ROUND_END").some(
          ({ hook, self }) => hook.kind === "optional" && hook.when(s, self),
        );
        const optionalLossAvailable = evaluateLoss(s).some(
          (condition) =>
            condition.activation === "optional" &&
            condition.met &&
            condition.blockedBy === undefined,
        );
        if (optionalHookAvailable || optionalLossAvailable) {
          s.loop.roundEndMandatoryResolved = true;
          return undefined;
        }
      }
      delete s.loop.roundEndMandatoryResolved;
      if (s.loop.day === s.scenario.daysPerLoop) {
        resolveHooks(s, "LAST_DAY");
        requestEndForActivatedLosses(s);
        if (!s.pendingLoopEnd) {
          requestLoopEnd(s, "lastDay");
        }
        return undefined;
      }
      delete s.loop.optionalLossActivations;
      s.loop.abilitiesUsedThisRound = [];
      s.loop.day += 1;
      s.loop.phase = "P1_ROUND_START";
      return undefined;
  }

  if (s.pendingLoopEnd || (s.loop.pendingImmediateLossKeys?.length ?? 0) > 0) {
    return incidentResult;
  }

  const i = PHASE_ORDER.indexOf(s.loop.phase as Phase);
  s.loop.phase = PHASE_ORDER[i + 1];
  return incidentResult;
}
