---
name: tl-init
description: characters.json / scripts 로더와 GameState 초기화 구현. tl-setup 다음.
---

data/characters.json 과 data/basic-tragedy-scripts.json 을 로드해
GameState 를 초기화하는 코드를 작성하라.

- src/data.ts: characters.json 로더. src/types.ts 말미의 `declare function
  startLocationOf` 를 실제 구현으로 대체하라 (declare 제거).
- src/engine/setup.ts: Scenario 를 받아 LoopState 를 만드는 initLoop()
  - 캐릭터를 시작 장소에 생존 상태로 배치
  - 모든 카운터 0
  - day=1, phase=P1_ROUND_START, leader=0
  - spentOncePerLoop 빈 배열
- basic-tragedy-scripts.json 의 스크립트 JSON 형태를 Scenario 타입으로
  변환하는 어댑터도 작성 (cast 는 Record<CharacterId, RoleId>, subPlots 는 배열)

주의:
- 시작 장소가 배열인 캐릭터가 있다 (henchman 등 scriptSpecified).
  배열 길이가 1이면 그것을 쓰고, 2 이상이면 scenario.scriptSpecified 에서
  읽어야 한다. 값이 없으면 명확한 에러를 던져라. 임의로 고르지 마라.
- comesInLater 캐릭터(신, 전학생)는 지정된 루프 전까지 게임판에 없다.
  이번 작업에서는 일단 배치하되 TODO 주석을 남겨라.

통과 기준: basic-tragedy-scripts.json 의 22편 전부에 대해 initLoop 가
예외 없이 실행되는 테스트.
