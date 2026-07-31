---
name: tl-loss
description: 패배 조건 판정과 distanceToLoss 구현. 도구의 실질적 가치.
---

src/engine/loss.ts 를 작성하라.

패배 조건은 세 종류다:
  ① 룰에 의한 패배 (루프 종료 시 판정) — src/impl/plots.ts 의 kind: "lossTragedy"
  ② 지켜야 할 인물의 사망 — 핵심 인물 등, kind: "lossTragedy" 중 즉시형
  ③ 주인공 사망 — kind: "lossDeath"

evaluateLoss(state) 는 현재 상태에서 성립한 패배 조건 목록을 반환한다.

추가로 distanceToLoss(state) 를 작성하라. 각 패배 조건까지 얼마나 남았는지
사람이 읽을 수 있는 형태로 반환한다. 예:
  { plot: "sealedItem", ko: "봉인된 것", current: 1, needed: 2, label: "신사 음모 1/2" }

이것이 도구의 실질적 가치다. 각본가가 "지금 얼마나 이기고 있나"를 한눈에 본다.

주의: 장소 X 를 참조하는 룰은 resolvePlaceX(state) 를 써라.
