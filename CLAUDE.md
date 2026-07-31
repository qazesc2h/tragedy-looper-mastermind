# CLAUDE.md

트래지디 루퍼(Tragedy Looper) **각본가 보조 도구**. 보드게임 규칙 엔진 + 상태 추적기.

작업 전 `HANDOFF.md`를 읽을 것. 설계 결정의 근거가 거기 있다.

## 이 저장소의 하네스

- **슬래시 커맨드**: `/tl-setup` 부터 순서대로. `/help` 로 목록 확인.
- **검증 스킬**: `/verify-hook` — 훅 구현이 원문과 일치하는지 대조한다.
- **가드 훅**: `gen.py` 실행과 `test/fixtures/` 수정은 자동 차단된다.
  차단되면 우회하지 말고 사용자에게 알려라.

---

## 절대 규칙

### 1. 게임 규칙을 지어내지 마라

이 게임은 학습 데이터가 얇다. **네가 "알고 있다"고 느끼는 규칙은 대부분 틀렸다.**

유일한 근거는 `src/impl/*.ts`의 각 훅에 박혀 있는 `source` 필드다.

```ts
source: {
  timing: "Day End",
  prerequisite: `The :keyPerson: has at least 2 :intrigue: and is in this character's location`,
  description: `Kill the :keyPerson:`,
}
```

이 문장을 `when`과 `effect`로 옮기는 것이 작업의 전부다. **문장에 없는 조건을 추가하지 마라.**

- `source`가 모호하면 → 구현하지 말고 `// AMBIGUOUS:` 주석과 함께 질문 목록에 올려라
- 다른 보드게임의 유사 메커니즘을 유추하지 마라
- "밸런스상 이게 맞을 것 같다"는 판단을 하지 마라

`:intrigue:` `:goodwill:` `:paranoia:` `:keyPerson:` 은 아이콘 치환 토큰이다.
각각 음모 카운터 / 우호 카운터 / 불안 카운터 / 핵심 인물 역할을 가리킨다.

### 2. `gen.py`를 실행하지 마라 (훅이 차단한다)

`src/impl/*.ts`는 자동 생성물이지만 **이미 사람이 구현을 채우기 시작한 파일**이다.
재생성하면 `when`/`effect`가 빈 스텁으로 돌아간다. 어떤 이유로도 돌리지 마라.

`data/*.json`도 생성물이다. 수정하지 마라.

### 3. 구조를 리팩터링하지 마라

`src/impl/*.ts`의 `Record<string, {...}>` 형태와 `source` 필드는 의도된 것이다.
더 우아한 형태가 보여도 그대로 둬라. 생성기와 형태를 맞춰야 한다.

`source` 필드는 런타임에 안 쓰이지만 **삭제하지 마라.** 구현 검증의 근거다.

---

## 이 세 가지는 반드시 지켜라

기본편에서 처음 등장하는 메커니즘이다. 어긴 코드는 나중에 전부 고쳐야 한다.

### ① 역할은 상수가 아니다

`scenario.cast[char]`를 **직접 읽지 마라.** 항상 `effectiveRole(state, char)`를 써라.

망상 확대 바이러스(`paranoiaVirus`)가 선택되면 엑스트라가 불안 3개 이상일 때
연쇄 살인마로 변이한다. 직접 참조하면 이 변이를 놓친다.

### ② 루프 상태를 버리지 마라

루프 종료 시 `GameState.history`에 `LoopState` 스냅샷을 push해야 한다.

인과율(`threadsFate`)은 "직전 루프 종료 시 우호 카운터가 있던 캐릭터"를 참조한다.
스냅샷 없이는 구현 불가다.

### ③ 장소 X는 고정이 아니다

`resolvePlaceX(state)`를 써라. 하수인(`henchman`)이 마녀를 맡으면 각본가가
매 루프 시작 장소를 지정하므로 루프마다 바뀐다.

---

## 처리 순서 — 틀리기 쉬운 곳

### 이동 해결

`src/engine/movement.ts`에 **이미 구현되어 있다.** 재구현하지 말고 호출해라.

순서: ① 겹침 합성 → ② 이동 금지 검사 → ③ 금지 장소 검사

"일단 옮기고 되돌리기"로 짜면 틀린다. 합성 결과가 금지 장소를 향하면
**이동 전체가 무시**되지, 원래 카드 중 하나만 적용되는 게 아니다.

### 카드 해결

행동 해결 단계에서 **이동에 관한 효과를 먼저** 전부 처리한 뒤 나머지를 처리한다.

### [강제] 와 [선택]

`kind: "mandatory"` 를 전부 **동시에** 해결한 뒤 `kind: "optional"` 을 각본가가
원하는 순서로 해결한다.

"동시"는 **판정을 모두 끝낸 뒤 효과를 일괄 적용**한다는 뜻이다. 순차 처리하면
연쇄 살인마 둘이 단 둘이 있을 때 한쪽만 죽는다(정답: 양쪽 다 죽음).

`src/engine/phases.ts`의 `resolveHooks`가 이 패턴을 보여준다.

### 음모 금지

카드 단위가 아니라 **라운드 단위 집계**다. 주인공 2명 이상이 같은 라운드에 내면
전부 무효화된다. `intrigueForbidActive()` 참조.

---

## 범위

**지금 만드는 것: 상태 추적기.** 각본가가 규칙을 안 틀리게 돕는 도구다.

**만들지 않는 것:**

- 수 추천 / 최적 행동 탐색
- 승률 계산, 몬테카를로
- LLM 호출
- 주인공용 화면, 정보 은닉, 네트워크 대전

각본가는 이미 모든 진실을 알고 있다. 숨길 것이 없다. 단일 사용자 로컬 도구다.

요청받지 않은 기능을 추가하지 마라. 특히 "이 수가 좋습니다" 류의 조언 기능은
명시적으로 범위 밖이다.

---

## 검증

### 타입

```bash
npx tsc --noEmit --strict
```

`--strict` 통과가 기준선이다. `any`로 회피하지 마라.

### 테스트

`test/fixtures/` 의 벡터는 **한국어판 공식 설명서의 진행 예시를 그대로 옮긴 것**이다.
이게 정답이다. 테스트가 실패하면 테스트가 아니라 구현을 고쳐라.

훅을 하나 구현하면 그에 대응하는 단위 테스트를 하나 쓴다. `source`의
`prerequisite`를 만족하는 케이스와 만족하지 않는 케이스 최소 2개.

### 스스로 확인할 수 없는 것

규칙 해석이 갈리면 **추측해서 진행하지 말고 멈춰라.** `QUESTIONS.md`에 적어라.

```md
## Q1. 광신도의 음모 금지 무시 — 장소에 놓인 카드도 포함되는가?
- source: "You may ignore all Forbid :intrigue: effects on this location and on all characters in this location."
- 해석 A: 장소 + 그 장소의 캐릭터 모두
- 해석 B: 캐릭터만
- 현재 A로 구현했으나 확인 필요
```

---

## 코드 스타일

- TypeScript strict. 런타임 의존성 최소.
- 상태 변경은 `GameState`를 직접 mutate해도 좋다(단일 스레드, undo는 스냅샷으로).
- 주석은 한국어로 써도 된다. 기존 코드가 그렇다.
- 커밋은 작게. 훅 몇 개 단위로.

## 용어

코드와 주석에 한국어가 섞여 있다. 대응은 이렇다.

| 한국어 | English | 코드 |
|---|---|---|
| 각본가 | Mastermind | `mastermind` |
| 주인공 | Protagonist | `protagonist` |
| 시나리오 | Script | `Scenario` |
| 참극 세트 | Tragedy Set | `tragedySet` |
| 룰 Y / 룰 X | Main Plot / Subplot | `mainPlot` / `subPlots` |
| 역할 | Role | `RoleId` |
| 엑스트라 | Person | `person` |
| 우호 / 불안 / 음모 | Goodwill / Paranoia / Intrigue | `goodwill` / `paranoia` / `intrigue` |
| 라운드(날짜) | Day | `day` |
| 루프 | Loop | `loop` |
| 최후의 싸움 | Final Guess | — |

`data/ko-terms.json`에 전체 대조표가 있다. UI 문자열은 여기서 가져와라.
없으면 영어 폴백. **임의로 번역하지 마라** — 정발 용어가 따로 있다.
