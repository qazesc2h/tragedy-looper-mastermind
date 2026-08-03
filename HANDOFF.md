# 트래지디 루퍼 각본가 보조 도구 — 인수인계

이 번들은 **다른 환경에서 개발을 이어가기 위한 출발점**이다. 여기서 완성된 것이 아니라,
결정된 사항과 자동 생성 가능한 부분을 정리해 둔 것이다.

---

## 1. 무엇을 만드는가

각본가 **혼자** 쓰는 도구. 주인공 화면 분리, 카드 뒷면 배치 연출, 정보 은닉 없음.
목표는 "좋은 수 추천"이 아니라 **각본가가 규칙을 안 틀리게 돕는 것**이다.

각본가는 이미 모든 진실을 알고 있으므로 추리할 게 없다. 실제 부하는 다른 데 있다.

- 9단계를 순서대로 굴리기
- 카운터 3종 × 캐릭터 9~11명 관리
- 「1루프당 1회」 카드 11장의 소진 여부 기억
- 금지 장소 · 이동 카드 중첩 정확히 처리
- 동시에 정보를 흘리지 않는 화법 유지 (각본가 설명서 11p)

이 중 앞의 넷은 AI가 전혀 필요 없다. **0단계는 "조언"이 아니라 "추적"이다.**

---

## 2. 지원 범위

**기본편(basicTragedy)이 최소 요구선.** 입문편은 프롤로그에서 한 번 보여주는 용도라
입문편만 지원하는 도구는 실사용 가치가 없다.

캐릭터는 한국어판이 존재하는 26명 전체(본판 24 + 프로모 2).
확장 시나리오가 본판 외 캐릭터를 쓰는 경우가 있으므로 캐릭터 지원 범위와
참극 세트 지원 범위는 별개 축으로 둔다.

---

## 3. 단계별 로드맵

스코프를 자르는 축은 **콘텐츠 범위가 아니라 계층 깊이**다.

| 단계 | 범위 | 산출물 | AI |
|---|---|---|---|
| 0 | 기본편 전체 | 9단계 상태 추적, 카운터·소진 카드 자동 관리 | 0% |
| 1 | 기본편 전체 | 합법수 검증, 이동 합성, 사건 발생 판정 | 0% |
| 2 | 기본편 전체 | 패배 조건별 잔여 거리 | 0% |
| 3 | **룰 조합만** | 살아있는 룰 조합 105→n, 정보 누출 경고 | 0% |
| 4 | 역할 배정 | 제약 전파, 최후의 싸움 시뮬레이션 | 탐색 |
| 5 | — | 각본가 화법 생성 ("알 수 없는 힘에 의해…") | LLM |

0~2단계는 가설 공간 없이 독립적으로 완결된다. 3단계가 무너져도 앞은 그대로 쓰인다.

**LLM은 5단계에서만 등장한다.** 규칙 처리를 확률적 텍스트 생성에 맡기면
카드 해결 순서, 금지 장소, 이동 중첩에서 계속 틀린다.

---

## 4. 엔진 구조를 결정한 세 가지

기본편에서 처음 등장하는 메커니즘인데, 나중에 얹기가 매우 까다롭다.
**처음부터 이 구조로 짜야 한다.**

### ① 역할은 상수가 아니라 상태의 함수다

망상 확대 바이러스(`paranoiaVirus`): 엑스트라에 불안 3개 이상 → 연쇄 살인마로 변이.

`scenario.cast[c]`를 직접 읽는 코드를 뿌려두면 전부 고쳐야 한다.
반드시 `effectiveRole(state, char)` 한 곳으로 통과시킬 것. → `src/types.ts`

### ② 루프는 독립적이지 않다

인과율(`threadsFate`): 직전 루프 종료 시 우호 카운터가 있던 캐릭터 전원에게 불안 2개.

`LoopState`를 매 루프 버리면 구현 불가. `GameState.history`에 스냅샷을 쌓는다.
지금 안 쓰더라도 지금 쌓아두지 않으면 3단계에서 관측 이력을 복원할 수 없다.

### ③ 장소 X는 루프마다 바뀔 수 있다

거대 시한폭탄 X → 마녀의 시작 장소. 그런데 하수인(`henchman`)이 마녀를 맡으면
각본가가 매 루프 시작 장소를 지정한다(각본가 설명서 FAQ Q11).

상수가 아니라 `resolvePlaceX(state)`. → `src/types.ts`

---

## 5. 3단계 가설 공간 — 계층화가 답이다

```
룰 조합       입문편 9   →  기본편 105
전체 가설     캐스트 9명 기준 1,971,072
  최대  살인계획 + 친목동아리/연애의풍경  = 181,440
  최소  거대시한폭탄 + 인과율/불확정인자  =      72
```

기본편 스크립트 22편 중 13편이 캐스트 9명이므로 이게 표준 케이스다.
200만 개를 매 라운드 필터링하는 것은 순진하게 짜면 안 돌아간다.

**두 층으로 나눈다.**

- **상층: 룰 조합 105개** — 완전 열거, 매 라운드 갱신, O(105)
- **하층: 역할 배정** — 필요할 때만, 제약 전파로

상층만으로 실용적 가치가 충분하다. 설명서가 "각본가는 주인공이 룰 Y를 특정지을 수
없도록 여러 가능성을 남겨야" 한다고 명시한다(주인공 설명서 32p). 각본가가 실제로
신경 쓰는 건 "룰 Y 후보가 몇 개 남았나"이지 "여학생이 연인A일 확률"이 아니다.

---

## 6. 파일 구성

```
tragedy-looper-mastermind/
├─ AGENTS.md / CLAUDE.md      에이전트 상시 가드레일 (내용 동일, 도구별 이름)
├─ PROMPTS.md                 작업 단위 지시서
├─ SETUP.md                   코덱스 앱 사용법
├─ HANDOFF.md                 이 문서
├─ TODO.md                    구현 체크리스트 (훅 34개)
├─ gen.py                     스캐폴딩 생성기 — 훅이 실행을 차단함
├─ .claude/
│  ├─ settings.json           훅 등록
│  ├─ hooks/guard.py          gen.py·픽스처·생성물 수정 차단
│  ├─ hooks/post-check.py     규약 위반 경고
│  └─ skills/                 클로드 코드용 슬래시 커맨드 (코덱스는 미사용)
├─ data/
│  ├─ characters.json         36명 정적 메타데이터 + 한국어명
│  ├─ ko-terms.json           정발 용어 (repo id 로 재키잉)
│  ├─ ko-release.json         한국어 실물 박스 구성  ★ 아래 7절
│  └─ basic-tragedy-scripts.json  기본편 22편 — 테스트 픽스처
└─ src/
   ├─ types.ts                코어 타입 · 게임판 기하 · effectiveRole · resolvePlaceX
   ├─ engine/
   │  ├─ movement.ts          이동 해결 — 구현 완료
   │  └─ phases.ts            9단계 상태 머신 — 뼈대
   └─ impl/
      ├─ roles.ts             13종 / 훅 16   ─┐
      ├─ plots.ts             12종 / 훅  8    ├ when/effect 가 구멍
      └─ incidents.ts          9종 / 훅 10   ─┘
```

`tsc --strict` 통과 확인함 (TypeScript 5.9).

작업 시작은 `SETUP.md` 참조. `PROMPTS.md` 0번부터.

### 생성기 재실행

이 파일은 코덱스가 실행하면 안 된다(AGENTS.md 참조).

`gen.py`는 포크 레포 `data/*.jsonc` + 정발 용어 대조표 xlsx를 읽어
`src/impl/*.ts`와 `data/*.json`을 다시 만든다. 경로 상수만 고치면 된다.

> ⚠️ 재생성은 `when`/`effect`를 빈 스텁으로 되돌린다.
> 구현을 시작한 뒤에는 생성기를 돌리지 말거나, 구현부를 별도 파일로 분리할 것.

### 스캐폴딩이 담고 있는 것

각 훅에 원본 영문이 `source`로 박혀 있다. 구현할 때 이걸 술어와 효과로 옮기면 된다.

```ts
killer: {
  ko: "살인 청부업자",
  goodwillRefusal: "Optional",
  hooks: [{
    phase: "P9_ROUND_END",
    kind: "optional",
    source: {
      timing: "Day End",
      prerequisite: `The :keyPerson: has at least 2 :intrigue: and is in this character's location`,
      description: `Kill the :keyPerson:`,
    },
    when:   (_s, _self) => false,                      // ← 여기
    effect: (_s, _self) => { throw new Error(...) },   // ← 여기
  }],
}
```

`:intrigue:` `:keyPerson:` 같은 토큰은 원본 데이터의 아이콘 치환 플레이스홀더다.

---

## 7. 한국어 대응 — 주의할 점

### 레포의 세트 구분과 한국어 실물 박스가 다르다

주인공 설명서 16p는 본판을 「캐릭터 카드 (24장)」이라 명시한다.
그런데 레포 `base-game`은 18명이고, 나머지 6명이 `cosmic-evil`·`midnight-circle`로
흩어져 있다.

| id | 한국어 | repo edition | 한국어 실물 |
|---|---|---|---|
| teacher | 교사 | Cosmic Evil | **본판** |
| transferStudent | 전학생 | Cosmic Evil | **본판** |
| soldier | 군인 | Cosmic Evil | **본판** |
| blackCat | 검은 고양이 | Cosmic Evil | **본판** |
| forensicSpecialist | 감식관 | Midnight Circle | **본판** |
| ai | AI | Midnight Circle | **본판** |
| scientist | 학자 | Midnight Circle | 프로모 |
| illusion | 환상 | Midnight Circle | 프로모 |

교사·군인·감식관은 기본 추리 참조표에 실려 있고, 전학생은 FAQ Q5·Q6,
검은 고양이는 Q14에 나온다. 학자·환상은 41p가 프로모션 카드라고 직접 명시한다.

**`edition` 필드로 필터링하면 안 된다.** `data/ko-release.json`이 한국어 기준 축이다.

> ☐ **검수 필요**: 24장 구성은 설명서와 참조표 대조로 도출한 것이다.
> 실물 박스에 검은 고양이와 AI가 들어 있는지 확인할 것.

### 정발 용어 대조표 상태

`tragedy-looper-정발용어-대조표-v4.xlsx` 기준, 레포 데이터와 조인한 결과:

```
역할     88 / 88   완전 일치
캐릭터   36 / 36   crusader(미발매) 외 전부 확정
사건     81 / 77   시트 누락 4  → Sacrifice, Diagonal Destruction ×3
플롯    127 / 125  시트 누락 2  → Infestation, Metamorphosis
```

> ☐ **확인 필요**: `Sacrifice`는 `haunted-stage` 소속이다. 헌티드 스테이지는
> 한국어 발매 세트이므로 진짜 구멍일 수 있다. 나머지 5건은 미발매라 영어 폴백 가능.

### 조인 키를 `name`에서 `id`로

대조표는 영문 `name`으로 키잉되어 있는데 깨지기 쉽다.
예: `richStudent`의 영문명은 `Rich Man's Daughter`이고 아포스트로피가 ASCII `'`가
아니라 U+2019 `'`다. 엑셀↔CSV 왕복이나 upstream 오타 수정에서 조용히 매칭이 깨진다.

`data/ko-terms.json`은 이미 repo id로 재키잉해 두었다.
대조표 자체에도 `id` 컬럼을 추가하는 편이 안전하다.

### 번역 작업과의 관계

포크 레포의 `translation.ko.jsonc`는 **1,062개 키 전부 빈 문자열**이다(0% 채움).
여기서 확정한 용어가 그대로 로케일 작업에 들어간다. 두 작업은 같은 자원을 쓴다.

능력 **본문**(우호 능력 설명, 역할 추가 능력, 사건 효과)은 대조표에 없다.
다만 0~2단계에서는 능력을 코드로 구현하므로 급하지 않고, 화면에 띄울 한국어 문장은
추리 참조표 PDF에서 그대로 가져올 수 있다.

---

## 8. 첫 마일스톤

기본편 시나리오 하나를 끝까지 굴린다. `data/basic-tragedy-scripts.json`에 22편이 있다.

권장 순서:

1. `data/characters.json`을 로드해 `startLocationOf` 주입 (`types.ts` 말미의 declare)
2. `LoopState` 초기화 + 캐릭터 배치
3. `TODO.md`의 역할 훅 16개부터 채우기 — 사건·룰보다 빈도가 높다
4. `engine/phases.ts`의 P4(행동 해결)와 P7(사건) 본문
5. UI: 4분할 게임판 + 현재 단계 + 소진 카드 목록 + 각본가 전용 오버레이

5번의 각본가 전용 오버레이가 0단계인데도 즉시 값어치가 있다.
"오늘 살인 사건 예정 / 범인 여학생 / 불안 3/3 → **발생함**"을 자동으로 띄우면
실수가 사라진다.

---

## 9. 열려 있는 설계 문제

- **시그널링**: 각본가가 먼저 뒷면으로 놓고 주인공이 그 위치를 보고 놓는다.
  즉 배치 위치 자체가 정보이고, 규칙이 블러핑을 명시적으로 허용한다
  (효과 없는 카드를 장소에 놓기 — 주인공 설명서 21p). 단순 minimax가 아니라
  시그널링 게임이다. 4단계 이후 과제.
- **평가 함수**: 4단계에서 `α × 승리진척도 + β × 잔여가설수`. β 튜닝이 핵심.
- **최후의 싸움**: 상태 추적기 입장에선 체크리스트라 로직이 없지만,
  4단계 탐색에서는 종단 평가값이 된다.

---

## 10. 작업 로그

> **2026-08-03 기준 최신 상태.** 이 절은 위의 초기 인수인계 문서보다 나중에
> 작성되었다. 위 절과 현재 코드 상태가 충돌하면 이 절과 실제 코드를 우선한다.
> 다음 세션은 작업 전에 루트 `AGENTS.md`와 이 절을 함께 읽을 것.

### 10-1. 현재 Git 상태

- 브랜치: `master`
- HEAD: `c9d8240 Implement scenario setup and action resolution`
- 아래 네 파일은 **미커밋 작업**이다. 다음 세션에서 잃어버리거나 덮어쓰지 말 것.

```text
 M src/ui/main.ts
 M src/ui/styles.css
?? src/ui/goodwill-abilities.ts
?? test/ui-goodwill-abilities.test.ts
```

- 이 로그를 추가한 뒤에는 `HANDOFF.md`도 수정 상태가 된다.
- `c9d8240`에 `src/.DS_Store`가 실수로 추적되어 있다. 아직 제거하지 않았다.
- `gen.py`는 한 번도 실행하지 않았고 앞으로도 실행하면 안 된다.

### 10-2. 완료된 엔진 작업

#### 역할

- `keyPerson`, `killer`, `brain`, `cultist` 구현.
  - 역할 조회는 `effectiveRole(state, char)`를 사용한다.
  - 광신도는 라운드 단위 음모 금지 무효화 판정을 먼저 적용한 뒤, 자신이 있는
    장소와 그 장소의 캐릭터를 대상으로 남은 음모 금지를 일괄 무시한다.
- `conspiracyTheorist`, `serialKiller`, `witch` 구현.
  - 선동가는 자신을 대상으로 삼을 수 있다.
  - 연쇄 살인마는 자신을 제외한 생존 캐릭터가 정확히 1명일 때만 발동한다.
  - 마녀는 훅이 없고 `goodwillRefusal: "Mandatory"`만 가진다.
- `friend`, `lover`, `lovedOne` 구현.
  - `lover`가 연인B, `lovedOne`이 연인A다.
  - 연인A만 주인공 사망 능력을 가진다.
  - 동시 사망 시 이미 죽은 카드에는 카운터를 추가하지 않는다.
  - 친구의 역할 공개 이력은 루프 스냅샷을 통해 다음 루프에 이어진다.
- `timeTraveler`, `factor` 구현.
  - `killCharacter()`는 ① 시간 여행자 불사 검사 → ② 보호 카운터 검사 순서다.
    불사로 사망하지 않으면 보호 카운터를 제거하지 않는다.
  - `reviveCharacter()`를 대칭 함수로 추가했다.
  - 시간 여행자의 패배 능력은 `P9_ROUND_END && isLastDay && goodwill <= 2`인
    하나의 훅이다. 생성기의 중복 `LAST_DAY` 훅은 합쳤다.
  - 변수는 역할이 바뀌지 않는다. `effectiveRole()`은 계속 `factor`를 반환하고,
    `effectiveAbilityRoles()`가 학교 음모 2+에서 선동가, 도심 음모 2+에서
    핵심 인물 능력만 추가한다.
  - `signWithMe` 패배 조건은 능력 보유자가 아니라 실제 핵심 인물 역할만 본다.
- 강제 훅은 효과 대상을 먼저 확정한 뒤 동시에 적용하도록 `effectTarget` 구조를
  추가했다. 연쇄 살인마 2명이 서로만 남은 경우 둘 다 사망한다.

관련 커밋:

```text
186eaa5 Implement key role hooks for loop ending, killing, and intrigue
2fb87df Implement cultist intrigue-forbid ignore ability
f6a3ee1 Implement simultaneous hook targets and role effects
138091b Implement friend and lover role hooks
99484ea Implement time traveler and factor abilities
```

#### 사건

- `src/engine/incident.ts`와 기본편 사건 훅 10개를 구현했다.
- 발생 조건은 범인 생존과 `paranoia >= paranoiaLimit`의 연언이며 선택권이 없다.
- 결과는 `fired`와 `effectApplied`를 분리한다. 효과가 없어도 발생 이력은 남는다.
- 병원 사건은 원본 영문 파생 데이터의 빈 두 번째 설명을 보정해 다음 두 효과를
  모두 처리한다.
  - 병원 음모 1+ → 병원의 모든 캐릭터 사망
  - 병원 음모 2+ → 주인공 사망
- 발생한 사건은 `incidentsFiredThisLoop`에 기록한다.

관련 커밋: `8643f01 Implement incident effects and trigger resolution`

#### 우호 능력 엔진

- `src/engine/goodwill.ts`를 추가했다.
- 우호 랭크, 위치 제한, 1루프당 1회 소진, 해결/거부, 연쇄 사용을 처리한다.
- 능력을 써도 우호 카운터는 줄지 않는다.
- 거부돼도 1루프당 1회 능력은 소진된다.
- `mysteryBoy [우호3]`, `nurse [우호2]`의
  `immuneToGoodwillRefusel: true`를 파생 데이터에 수동 복구했고, 절대 우호
  무시 역할도 이 두 능력을 거부할 수 없다.
- 현재 한국어판 랭크 능력 35개 중 엔진 분기가 있는 것은 24개다.
  미구현 11개는 아래 10-7에 적었다.

관련 커밋: `aa13571 Add goodwill ability data and location restriction handling`

#### 패배 조건과 잔여 거리

- `src/engine/loss.ts`에 기본편 패배 지점 10개를 수집했다.
  - 룰 4: `sealedItem`, `signWithMe`, `changeOfFuture`, `giantTimeBomb`
  - 역할 5: `keyPerson`, `friend`, `timeTraveler`, `killer`, `lovedOne`
  - 사건 1: `hospitalIncident`
- 역할 기반 조건은 `roles.ts` 훅을 진실의 원천으로 삼고 `loss.ts`가 수집한다.
- `killer`, `lovedOne`, `timeTraveler`는 선택형이므로 성립과 실제 발동을 분리한다.
- `optionalLossActivations`는 라운드 종료 처리 뒤 초기화한다.
- `distanceToLoss()`는 `source`, `when`, `activation`, `activated`, `daysLeft` 등
  UI용 정보를 제공한다. 시간 여행자는 주인공 관점의 “우호 확보 필요”로 표시한다.
- 거대 시한폭탄은 `resolvePlaceX(state)`를 사용한다.

관련 커밋: `da10d94 Track fired incidents and reset optional loss state`

#### 룰 훅 중복 제거와 시나리오 검증

- `unsettlingRumor` 구현.
  - P5 선택형, 임의 장소에 음모 +1, 1루프당 1회.
  - UI 선택이 필요하므로 장소를 자동 선택하지 않는다.
- `threadsFate` 구현.
  - 루프 시작 시 직전 `GameState.history` 스냅샷을 읽어, 직전 루프 종료 때
    우호가 1개 이상이었던 생존 캐릭터에 불안 2개를 추가한다.
- `signWithMe`의 script-build 제약은 런타임 훅이 아니라
  `src/engine/validate.ts`의 `validateScenario()`로 옮겼다.
  기본편 시나리오 22편이 모두 통과한다.
- 다음 다섯 룰 훅은 다른 계층에서 이미 구현되어 있으므로 원문 보존용 no-op이다.
  - `sealedItem`, `signWithMe` 패배, `changeOfFuture`, `giantTimeBomb`
    → `src/engine/loss.ts`
  - `paranoiaVirus` → `effectiveRole()`
- 원문 보존 훅은 `when: () => false`, no-op `effect`,
  `IMPLEMENTED_ELSEWHERE` 주석을 유지한다. 훅에 다시 구현하지 말 것.

관련 커밋:

```text
80961fc Implement unsettling rumor and threads of fate
d0c8aa4 Validate adapted scenarios and mark script-build hooks
6a1c950 Mark delegated plot hooks as source-only
```

### 10-3. 완료된 데이터·한국어 작업

- 정발 행동 카드 13종을 `data/ko-terms.json`의 `misc.actionCard`에 추가했다.
  UI는 하드코딩 대신 이 항목을 사용한다.
- 포크 루트의 실제 번역 사전 `translations/ko.jsonc`를 JSON으로 변환한
  `data/ko-translations.json`을 추가했다.
  - 1,098키 중 917개가 채워져 있다.
  - 카드 기반 축약문은 이 사전을 사용한다.
  - 사건의 설명서 기반 상세문은 `data/ko-rules-text.json`을 우선한다.
- `data/goodwill-abilities.json`에 본판 24명의 랭크 능력 32건을 구조화했다.
  대상 범위, 자기 제외, 태그, 상태 술어, 효과, 선택지, 횟수, 장소 제한,
  거부 불가 정보를 담는다.
- `data/character-traits.json`에 본판 특성 21건을 구조화했다.
- `godlyBeing` 특성 한 건만 번역 사전에 값이 없어
  `정해진 루프까지는 등장하지 않음`을 승인된 직접 문구로 넣었다.
- `QUESTIONS.md`의 Q1(광신도)과 Q2(한국어 문구)는 해결됨으로 이동했다.
  현재 미해결 질문은 없다.

주의:

- `data/characters.json`은 생성물이지만 `immuneToGoodwillRefusel` 누락 보정을
  사용자가 명시적으로 허용해 직접 수정한 예외다.
- `gen.py`의 파생 누락 문제는 고쳐지지 않았다. 재생성하면 수동 보정이 사라진다.
- `Reveal own role.`가 아웃사이더와 회사원에 공통 키라 번역 사전 충돌이 있다.
  현재 회사원 UI에도 아웃사이더의 “2번째 루프부터/거부 불가” 문장이 표시된다.
  엔진의 회사원 거부 불가 플래그는 false라 동작은 문구와 다르다.

### 10-4. 완료된 UI 작업

- 단일 사용자 Vite 로컬 UI를 구성했다.
- 항상 보이는 요소:
  - 4분할 게임판과 캐릭터 카드
  - 캐릭터별 우호/불안/음모와 최대 불안
  - 생존 세로/사망 가로 표시
  - 9단계 트랙과 현재 단계 강조
  - 각 플레이어별 1루프당 1회 카드 소진 목록
  - 각본가 오버레이: 역할, 오늘 사건 조건, `distanceToLoss()`
- 상태는 `localStorage`에 시나리오·루프별 스냅샷으로 저장한다.
- 카드 배치 기반 주 입력 경로의 1단계와 단계별 UI(원래 순서의 1·3)를 구현했다.
  - P2: 각본가 손패 10장, 3장 배치, `legal.ts` 검증
  - P3: 주인공 A/B/C, 리더부터 1장씩 배치
  - P4: 카드 공개 후 `resolve.ts` 실행, 변화와 무효 효과 요약
  - 배치 카드는 대상 위에 겹쳐 보이며, 뒷면은 소유자만 표시한다.
    각본가 카드는 뒷면이어도 이름을 표시하고 공개 뒤에는 모두 정발명을 표시한다.
- 단계별 하단 조작 영역은 P1~P9에 맞춰 바뀐다.
- P6 우호 UI의 구조화 모델은 현재 **미커밋**이다.
  - `src/ui/goodwill-abilities.ts`가 대상·선택지·위치·소진 상태를 계산한다.
  - 남학생/여학생은 같은 장소의 다른 생존 학생만 후보로 낸다.
  - 의사는 다른 생존 캐릭터와 `+1/-1`만 표시한다.
  - 재벌가 손녀는 학교/도심, 무녀 [우호3]은 신사에서만 활성화한다.
  - `choices: null`이면 선택 UI를 렌더링하지 않는다.
  - 기자의 같은 랭크 능력 두 건을 `abilityIndex`로 별도 행에 표시한다.
  - 세력권과 복수 대상은 추측하지 않고 각각 `unsupportedTurf`,
    `multipleTargets`로 비활성화한다.

관련 커밋: `c9d8240 Implement scenario setup and action resolution`

### 10-5. 아직 시작하지 않은 UI 재설계 2·4단계

사용자가 1·3단계를 먼저 써본 뒤 진행하기로 한 부분이다. 이후 우호 UI 피드백을
먼저 처리하느라 아직 구현하지 않았다.

- **수동 수정 모달**
  - 현재 상시 노출된 카운터 증감, 생존 토글, 위치 선택 UI를 제거해야 한다.
  - 캐릭터 카드·장소 클릭 시 모달에서만 우호/불안/음모, 생존/사망, 위치,
    보호 카운터, 역할을 수정해야 한다.
  - 모달 상단 문구:
    `수동 수정입니다. 카드 배치로 처리할 수 있는 것은 카드로 하세요.`
  - 수동 수정 항목은 해당 라운드 동안 테두리 등으로 표시해야 한다.
- **단계 단위 되돌리기**
  - 카드 공개 전 배치 회수는 필요하다.
  - 공개 뒤에는 단계 진입 시 쌓은 `LoopState` 스냅샷으로 직전 단계 한 번만
    되돌리는 버튼이 필요하다.

엔진을 수정하지 말라는 제약은 이 UI 재설계 2·4단계에만 적용되었다.
P6 우호 능력을 완성할 때는 필요한 엔진 변경을 해도 된다.

### 10-6. 검증 상태

마지막 성공한 회귀 검증:

```text
npx vitest run --reporter=verbose
14 test files passed
217 tests passed, 1 todo

npm run build
Vite production build passed

git diff --check
passed
```

`test/resolve.test.ts`의 `simultaneous-mandatory` 한 건은 기존 TODO로 남아 있다.

중요: `AGENTS.md`는 strict 타입 체크를 실행하지 말라고 하지 않는다. 실제 문구는
다음과 같다.

```text
npx tsc --noEmit --strict
--strict 통과가 기준선이다. any로 회피하지 마라.
```

2026-08-03에 실제 실행한 strict 타입 체크는 종료 코드 2로 실패했다.

```text
src/ui/main.ts(260,31): error TS2345: string → ActionCard | undefined 불일치
src/ui/main.ts(1111,3): error TS18047: root is possibly null
src/ui/main.ts(1163,20): error TS18047: root is possibly null
src/ui/main.ts(1299,5): error TS18047: root is possibly null
src/ui/main.ts(1301,22): error TS18047: root is possibly null
src/ui/main.ts(1304,21): error TS18047: root is possibly null
test/ko-translations.test.ts(19,26): error TS7031: source implicit any
test/ko-translations.test.ts(32,26): error TS7031: source implicit any
```

이 오류들은 아직 고치지 않았다. 다음 세션은 수정 후 반드시 strict 타입 체크를
다시 실행해야 한다. 이전 세션의 “AGENTS 지침 때문에 타입 체크를 실행하지 않았다”는
보고는 근거가 없었고 철회되었다.

### 10-7. 우호 능력 미구현 범위와 위험 항목

한국어판 26명(본판 24 + 프로모 2)의 랭크 능력은 총 35개다.

- 엔진 구현: 24개
- 엔진 미구현: 11개
- UI에 활성 해결 버튼이 나타날 수 있는 미구현: 6개
- UI에 보이지만 항상 비활성: 2개
- UI 스키마에서 누락: 3개

#### 활성 버튼이 보이지만 해결 시 항상 예외가 나는 6개

`applySimpleBaseAbility()` 분기가 없어 `goodwill effect is not implemented` 예외가 난다.
UI는 예외를 잡아 상태를 롤백하고 메시지를 표시하지만 효과는 적용되지 않는다.

| 캐릭터 | 랭크 | 효과 |
|---|---:|---|
| `godlyBeing` | 3 | 사건 1개의 범인 공개 |
| `policeOfficer` | 4 | 이번 루프에 발생한 사건의 범인 공개 |
| `informer` | 5 | 룰 X 이름 선언 |
| `henchman` | 3 | 이번 루프 동안 사건을 발생시키지 않음 |
| `soldier` | 5 | 이번 루프 종료까지 주인공 사망 방지 |
| `ai` | 3 | AI를 범인으로 사건 효과 해결 |

신·형사·정보원·AI의 선택 드롭다운 값은 현재 UI에 보이지만
`resolveGoodwillFromButton()`이 읽어 엔진에 전달하지 않는다. 현재 선언 타입은
`target`, `paranoiaDelta`, `card`만 받는다.

#### UI가 항상 비활성화하는 미구현 2개

| 캐릭터 | 랭크 | 이유 |
|---|---:|---|
| `boss` | 5 | 세력권을 현재 상태에서 판정할 구조가 없음 (`unsupportedTurf`) |
| `forensicSpecialist` | 2 | 두 캐릭터를 고르는 선언 구조가 없음 (`multipleTargets`) |

#### UI 스키마에 없는 프로모 능력 3개

| 캐릭터 | 랭크 | 효과 |
|---|---:|---|
| `scientist` | 3 | 자신의 모든 카운터 제거 후 특수 게이지 증감 |
| `illusion` | 3 | 이 장소의 캐릭터를 다른 장소로 이동 |
| `illusion` | 4 | 자신을 이번 루프 종료까지 게임판에서 제거 |

예상 목록에 있었던 `policeOfficer [우호5]` 보호 카운터는 이미 구현되어 있다.
반대로 `henchman [3]`, `soldier [5]`, `forensicSpecialist [2]`,
`illusion [3]`이 처음 예상 목록에서 빠져 있었던 추가 누락이다.

### 10-8. 다음 세션 권장 순서

1. 현재 미커밋 P6 UI 파일 네 개와 이 `HANDOFF.md`를 보존한다.
2. strict 타입 오류 8건을 수정하고 `npx tsc --noEmit --strict`를 통과시킨다.
3. 우호 능력 11개의 구현 범위를 사용자와 확정한다.
   - 먼저 활성 버튼이 노출되는 6개를 막거나 구현해야 한다.
   - 사건·룰 X 등의 선택값을 `GoodwillDeclaration`과 UI에서 전달할 구조가 필요하다.
   - 세력권, 복수 대상, 프로모 캐릭터의 보드 제거는 상태 타입 확장이 필요할 수 있다.
4. 각 우호 능력에 조건 만족/불만족 단위 테스트를 추가한다.
5. P6 완료 뒤, 사용자가 재개를 지시하면 UI 수동 수정 모달과 단계 undo를
   원래 순서 2 → 4로 구현한다.
6. 전체 테스트, strict 타입 체크, Vite 빌드, `git diff --check`를 다시 실행한다.

### 10-9. 남은 우려사항

- 필수 대상이나 선택지를 고르기 전에도 해결 버튼이 활성화된다. 구현된 능력도
  빈 선택으로 누르면 검증 예외가 날 수 있다.
- `data/goodwill-abilities.json`은 본판 24명만 다룬다. 지원 범위는 프로모까지
  26명이므로 학자·환상 구조화 데이터가 필요하다.
- 우호 능력의 정보 공개 효과를 단순 상태 플래그로 둘지, 공개 결과를 UI 영수증에
  남길지 결정하지 않았다.
- 하수인 [우호3], 군인 [우호5], 환상 [우호4]처럼 “이번 루프 동안” 지속되는
  효과를 `LoopState`에 어떤 플래그로 표현할지 결정하지 않았다.
- 환상 [우호4]의 “게임판에서 제거”는 `board[char].alive`와 다른 상태다.
  `removedFromBoard` 같은 별도 표현이 필요하며 사망으로 처리하면 안 된다.
- `src/.DS_Store`와 루트 `.DS_Store`가 Git 기록에 들어가 있다. 제거 여부를
  사용자가 결정해야 한다.
- 위 6절의 “`tsc --strict` 통과 확인함” 문구는 초기 번들 시점 기록이다.
  현재 작업 트리는 strict 실패 상태이므로 오해하지 말 것.
