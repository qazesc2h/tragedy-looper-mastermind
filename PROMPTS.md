# 코덱스 작업 지시서

`AGENTS.md`가 상시 가드레일이고, 이 파일은 **작업 단위 프롬프트**다.
코덱스 앱에서 **작업 하나에 스레드 하나**를 쓴다. 아래 블록을 하나씩 복사해서 먹인다.

설정 절차는 `SETUP.md` 참조.

에이전트에게 큰 덩어리를 주면 규칙을 지어내기 시작한다. 작업이 좁고 검증 가능할수록
결과가 좋아진다. 각 작업은 통과 기준이 명시되어 있다.

---

## 0. 첫 세션 — 환경 구축

```
이 저장소는 보드게임 트래지디 루퍼의 각본가 보조 도구다.
먼저 AGENTS.md 와 HANDOFF.md 를 읽어라. 특히 AGENTS.md 의 "절대 규칙"을 지켜라.

이번 작업은 환경 구축만 한다. 게임 로직은 건드리지 마라.

1. package.json, tsconfig.json 생성
   - TypeScript strict, target es2022, module esnext, moduleResolution bundler
   - 테스트 러너는 vitest
   - 런타임 의존성 없음. devDependencies 만.
2. `npx tsc --noEmit` 이 통과하는지 확인
3. test/fixtures/manual-examples.json 을 읽어 구조를 파악하고,
   이 픽스처를 로드하는 헬퍼 test/helpers.ts 를 작성
4. 아직 통과하지 않아도 좋으니, 픽스처의 cases 배열을 순회하며
   describe/it 껍데기만 만든 test/resolve.test.ts 를 작성 (전부 it.todo)

통과 기준: `npx tsc --noEmit` 무오류, `npx vitest run` 이 todo 목록을 출력.
```

---

## 1. 상태 초기화

```
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
```

---

## 2. 행동 해결 — 가장 중요한 작업

```
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
```

---

## 3. 합법수 검증

```
src/engine/legal.ts 를 작성하라. 카드 배치가 규칙상 가능한지 검사한다.

- 각본가는 동일한 캐릭터/장소에 2장 이상 놓을 수 없다
- 주인공끼리도 동일 대상 중복 불가. 단 각본가가 놓은 대상 위에는 겹쳐 놓을 수 있다
- 시체에는 카드를 놓을 수 없다
- 장소에 놓아서 효과가 있는 카드는 주인공「음모 금지」, 각본가「음모+1」「음모+2」뿐이다.
  다른 카드도 장소에 놓을 수는 있다(각본가의 블러핑). 놓는 것 자체를 막지 마라.
- 이미 소진된 "1루프당 1회" 카드는 낼 수 없다

반환은 boolean 이 아니라 { ok: boolean; reason?: string } 형태로.
reason 은 UI에 띄울 한국어 문자열.

통과 기준: 각 규칙마다 위반/비위반 케이스 테스트 2개씩.
```

---

## 4. 역할 훅 — 16개

```
src/impl/roles.ts 의 when/effect 를 채워라. TODO.md 의 "역할" 절이 목록이다.

한 번에 3~4개씩만 하고 멈춰라. 전부 한꺼번에 하지 마라.

각 훅마다:
1. source.prerequisite 를 when 으로 옮긴다. 문장에 없는 조건을 추가하지 마라.
2. source.description 을 effect 로 옮긴다.
3. 단위 테스트를 쓴다 — 조건 만족 케이스 1개, 불만족 케이스 1개.

주의:
- 역할 조회는 반드시 effectiveRole(state, char). scenario.cast 직접 참조 금지.
- keyPerson 같은 다른 역할을 찾을 때도 effectiveRole 로 순회해라.
- "이 캐릭터가 있는 장소" 는 state.loop.board[self].at
- 사망 판정은 alive 플래그. 시체 위 카운터는 제거하지 않는다 (FAQ Q1).

source 가 모호해서 두 가지로 읽히면 구현하지 말고 QUESTIONS.md 에 적어라.
추측해서 진행하지 마라.

이번에 할 것: keyPerson, killer, brain, cultist
```

---

## 5. 사건 판정

```
src/engine/incident.ts 를 작성하라. 라운드 7단계다.

발생 조건 2가지를 모두 만족하면 반드시 발생한다. 각본가에게 선택권이 없다.
  ① 범인 캐릭터가 생존 상태
  ② 범인에 최대 불안 수치 이상의 불안 카운터

효과가 아무것도 하지 않더라도 "발생했다"는 사실 자체는 결과에 포함시켜라.
(FAQ Q23 — 각본가는 "사건이 발생했지만 아무 일도 일어나지 않았습니다"라고 전달해야 한다)

반환 타입에 fired: boolean 과 effectApplied: boolean 을 분리해서 담아라.

src/impl/incidents.ts 의 훅 10개도 함께 채워라.

통과 기준: 픽스처의 incident-trigger-condition 3개 케이스.
```

---

## 5.5. 우호 능력 해결

```
src/engine/goodwill.ts 를 작성하라. 라운드 6단계다.

흐름:
1. 리더가 사용을 선언한다 — 어떤 캐릭터의 몇 랭크 능력을 누구에게 쓸지
2. 각본가가 해결 또는 거부를 선언한다
3. 해결이면 효과 적용, 거부면 아무 일도 없음

규칙:
- 사용 가능 조건은 "우호 카운터 >= 능력에 표시된 랭크"
- 능력을 사용해도 우호 카운터는 줄지 않는다
- 거부는 우호 무시 역할만 가능. 절대 우호 무시는 반드시 거부해야 한다
- 거부당해도 "1루프당 1회" 능력은 소진된 것으로 간주한다
- 한 라운드에 여러 능력을 연쇄 사용할 수 있다. 앞 능력의 결과로 조건이
  만족되면 곧바로 다음 능력을 쓸 수 있다
- 주인공은 카운터를 직접 배치하지 않는다. 선언만 하고 각본가가 해결한다

능력 데이터는 data/characters.json 의 goodwillAbilities 에 있다.
restrictedToLocation 이 있으면 해당 장소에서만 사용 가능하다.

통과 기준: goodwill-chain-and-refusal,
goodwill-comes-after-card-resolve 2개 케이스.
```

---

## 6. 패배 조건 평가

```
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
```

---

## 7. UI

```
상태 추적 화면을 만들어라. 단일 사용자 로컬 도구다. 프레임워크는 네가 골라라.

필수 요소:
- 4분할 게임판. 각 장소에 캐릭터 카드와 음모 카운터.
- 캐릭터마다 우호/불안/음모 카운터. 최대 불안 수치를 함께 표시 (예: 불안 2/3)
- 생존/사망은 카드 회전으로 (생존 세로, 사망 가로)
- 현재 단계 하이라이트 + "다음 단계" 버튼. 9단계 전부 보이게.
- 소진된 "1루프당 1회" 카드 목록 — 각본가/주인공A/B/C 구분
- 각본가 전용 오버레이:
  · 캐릭터마다 역할 표기
  · 오늘 예정 사건과 범인, 발생 조건 충족 여부를 ✓/✗ 로
  · distanceToLoss() 결과

문자열은 data/ko-terms.json 에서 가져와라. 없으면 영어 폴백.
임의로 번역하지 마라.

상태는 localStorage 에 루프별 스냅샷으로 저장하라.
나중에 관측 이력을 복원하는 데 쓴다.
```

---

## 진행이 막힐 때

에이전트가 규칙을 지어내기 시작하면 즉시 멈추고 이렇게 물어라.

```
방금 구현한 X의 근거가 되는 source 문자열을 그대로 인용해라.
source 에 없는 조건을 추가했다면 제거해라.
```

훅을 구현한 직후에는 검증을 시켜라.

```
.claude/skills/verify-hook/SKILL.md 의 절차대로 방금 구현한 훅을 검증해라.
특히 3번 역방향 검사를 빠뜨리지 마라.
```

`QUESTIONS.md`가 쌓이면 그게 실물 설명서를 다시 봐야 할 목록이다.
