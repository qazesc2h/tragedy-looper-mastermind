import type {
  AttachmentTarget,
  ExtraCardInstance,
  LoopState,
  PublicExtraCard,
} from "../types";

export function sameAttachmentTarget(
  left: AttachmentTarget,
  right: AttachmentTarget,
): boolean {
  const key = (target: AttachmentTarget): string => JSON.stringify(
    Object.fromEntries(Object.entries(target).sort(([leftKey], [rightKey]) =>
      leftKey.localeCompare(rightKey)
    )),
  );
  return key(left) === key(right);
}

/** 비공개 효과 출처를 제외한 공개 부착 카드 복사본을 만든다. */
export function publicExtraCard(card: ExtraCardInstance): PublicExtraCard {
  return {
    instanceId: card.instanceId,
    cardId: card.cardId,
    controller: card.controller,
    target: structuredClone(card.target),
    expiresAt: card.expiresAt,
  };
}

/** 같은 instanceId는 보드에 하나만 존재한다. */
export function placeExtraCard(
  loop: LoopState,
  card: ExtraCardInstance,
): void {
  if (loop.extraCards.some(({ instanceId }) => instanceId === card.instanceId)) {
    throw new Error(`extra card instance "${card.instanceId}" already exists`);
  }
  loop.extraCards.push(structuredClone(card));
}

export function moveExtraCard(
  loop: LoopState,
  instanceId: string,
  target: AttachmentTarget,
): void {
  const card = loop.extraCards.find(
    (candidate) => candidate.instanceId === instanceId,
  );
  if (card === undefined) {
    throw new Error(`extra card instance "${instanceId}" does not exist`);
  }
  card.target = structuredClone(target);
}

export function removeExtraCard(
  loop: LoopState,
  instanceId: string,
): ExtraCardInstance {
  const index = loop.extraCards.findIndex(
    (candidate) => candidate.instanceId === instanceId,
  );
  if (index < 0) {
    throw new Error(`extra card instance "${instanceId}" does not exist`);
  }
  const [removed] = loop.extraCards.splice(index, 1);
  if (removed === undefined) {
    throw new Error(`extra card instance "${instanceId}" could not be removed`);
  }
  return removed;
}

/** 같은 대상에는 여러 장이 붙을 수 있으므로 항상 배열을 반환한다. */
export function extraCardsAt(
  loop: LoopState,
  target: AttachmentTarget,
): ExtraCardInstance[] {
  return structuredClone(loop.extraCards.filter((card) =>
    sameAttachmentTarget(card.target, target)
  ));
}

/** 지정한 수명의 카드를 한꺼번에 제거하고 제거된 인스턴스를 반환한다. */
export function expireExtraCards(
  loop: LoopState,
  timing: "loopStart" | "loopEnd",
): ExtraCardInstance[] {
  const expired = loop.extraCards.filter(({ expiresAt }) =>
    expiresAt === timing
  );
  if (expired.length === 0) return [];
  const expiredIds = new Set(expired.map(({ instanceId }) => instanceId));
  loop.extraCards = loop.extraCards.filter(({ instanceId }) =>
    !expiredIds.has(instanceId)
  );
  return expired;
}

/** 자동 만료 시점 사이의 준비 상태에는 현재 부착 카드를 그대로 인계한다. */
export function carryExtraCards(previous?: LoopState): ExtraCardInstance[] {
  return structuredClone(previous?.extraCards ?? []);
}
