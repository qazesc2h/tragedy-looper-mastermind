---
name: tl-resolve
description: 라운드 4단계(행동 해결) 구현. 이동 합성, 금지 카드, 카드 회수. 픽스처 7개를 통과시킨다.
---

src/engine/resolve.ts 를 작성하라. 라운드 4단계(행동 해결)의 본문이다.

입력: GameState + LoopState.placed (카드 6장)
출력: 카운터/위치가 갱신된 상태

순서를 반드시 지켜라:
1. 이동에 관한 효과를 전부 먼저 처리
   - 대상별로 이동 카드를 모아 src/engine/movement.ts 의 resolveMove() 호출
   - movement.ts 는 이미 구현되어 있다. 재구현하지 마라.
2. 나머지 카드 처리
   - 불안+1 은 불안-1 보다 먼저
   - 금지 카드(우호 금지/불안 금지)는 대응 카드의 효과를 무시시킴
   - 음모 금지는 intrigueForbidActive() 로 라운드 단위 판정
3. 카드 회수. "1루프당 1회" 카드는 손에 돌리지 말고 spentOncePerLoop 에 기록

1루프당 1회 카드:
  주인공 - 우호+2, 불안-1, 이동 금지
  각본가 - 대각 이동, 음모+2

test/fixtures/manual-examples.json 의 cases 를 전부 통과시켜라.
이 픽스처는 한국어판 공식 설명서의 진행 예시다. 테스트가 실패하면
테스트가 아니라 구현을 고쳐라.

통과 기준: resolve-basic, move-compose-forbidden-location, move-forbid-card,
move-same-card-twice, intrigue-forbid-single, intrigue-forbid-doubled-cancels,
paranoia-plus-minus-order 7개 케이스 전부 green.
