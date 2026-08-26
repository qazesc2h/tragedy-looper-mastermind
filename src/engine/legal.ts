import { isCharacterPresent } from "../types";
import type {
  ActionCard,
  GameState,
  PlacedCard,
  ScenarioSpecialRuleId,
  Target,
} from "../types";

export interface LegalResult {
  ok: boolean;
  reason?: string;
}

type CardOwner = PlacedCard["owner"];

interface ActionCardRestrictionDefinition {
  applies: (owner: CardOwner, card: ActionCard) => boolean;
  reason: string;
}

const ACTION_CARD_RESTRICTIONS: Readonly<
  Record<ScenarioSpecialRuleId, ActionCardRestrictionDefinition>
> = {
  mastermindCannotUseForbidGoodwill: {
    applies: (owner, card) =>
      owner === "mastermind" && card === "forbidGoodwill",
    reason: "특수 규칙: 각본가는 우호 금지 카드를 사용할 수 없습니다.",
  },
};

/** 시나리오 특수 규칙 때문에 손패의 카드 자체를 사용할 수 없는지 검사한다. */
export function actionCardRestriction(
  state: GameState,
  owner: CardOwner,
  card: ActionCard,
): LegalResult | undefined {
  for (const id of state.scenario.specialRuleIds ?? []) {
    const restriction = ACTION_CARD_RESTRICTIONS[id];
    if (restriction.applies(owner, card)) {
      return { ok: false, reason: restriction.reason };
    }
  }
  return undefined;
}

function sameTarget(left: Target, right: Target): boolean {
  if (left.kind === "character" && right.kind === "character") {
    return left.id === right.id;
  }
  if (left.kind === "location" && right.kind === "location") {
    return left.at === right.at;
  }
  return false;
}

function conflictsWithExisting(
  state: GameState,
  placement: PlacedCard,
): LegalResult | undefined {
  const cardsOnTarget = state.loop.placed.filter((placedCard) =>
    sameTarget(placedCard.target, placement.target)
  );

  if (
    placement.owner === "mastermind" &&
    cardsOnTarget.some((placedCard) => placedCard.owner === "mastermind")
  ) {
    return {
      ok: false,
      reason: "각본가는 같은 대상에 행동 카드를 2장 이상 놓을 수 없습니다.",
    };
  }

  if (
    placement.owner !== "mastermind" &&
    cardsOnTarget.some((placedCard) => placedCard.owner !== "mastermind")
  ) {
    return {
      ok: false,
      reason: "주인공끼리는 같은 대상에 행동 카드를 중복해서 놓을 수 없습니다.",
    };
  }

  return undefined;
}

function isSpent(state: GameState, placement: PlacedCard): boolean {
  if (placement.owner === "mastermind") {
    return state.loop.spentOncePerLoop.mastermind.includes(placement.card);
  }
  return state.loop.spentOncePerLoop.protagonists[placement.owner].includes(
    placement.card,
  );
}

/** 현재 라운드에 행동 카드 한 장을 더 놓을 수 있는지 검사한다. */
export function validatePlacement(
  state: GameState,
  placement: PlacedCard,
): LegalResult {
  const restriction = actionCardRestriction(
    state,
    placement.owner,
    placement.card,
  );
  if (restriction) return restriction;

  if (
    placement.target.kind === "character" &&
    placement.target.id === "illusion"
  ) {
    return {
      ok: false,
      reason: "환상에게는 행동 카드를 직접 놓을 수 없습니다.",
    };
  }

  const conflict = conflictsWithExisting(state, placement);
  if (conflict) return conflict;

  if (
    placement.target.kind === "character" &&
    state.loop.board[placement.target.id] !== undefined &&
    !isCharacterPresent(state.loop.board[placement.target.id])
  ) {
    return {
      ok: false,
      reason: "게임판에 없는 캐릭터에게는 행동 카드를 놓을 수 없습니다.",
    };
  }

  if (
    placement.target.kind === "character" &&
    state.loop.board[placement.target.id]?.status === "dead"
  ) {
    return {
      ok: false,
      reason: "사망한 캐릭터에게는 행동 카드를 놓을 수 없습니다.",
    };
  }

  if (isSpent(state, placement)) {
    return {
      ok: false,
      reason: "이미 사용한 1루프당 1회 카드는 다시 낼 수 없습니다.",
    };
  }

  // 장소에서 효과가 없는 카드도 각본가의 블러프로 놓을 수 있다.
  return { ok: true };
}
