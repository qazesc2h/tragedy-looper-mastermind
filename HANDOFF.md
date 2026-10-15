# 트래지디 루퍼 각본가 보조 도구 — 인수인계

기준일: 2026-10-15

## 작업 경로와 브랜치

- Git의 주 checkout은 `/Users/vetching_dev2/Downloads/tragedy-looper-mastermind`이며
  `master`를 checkout한다. 배포와 최종 병합은 이 경로를 기준으로 한다.
- Codex 앱의 primary checkout은
  `/Users/vetching_dev2/.codex/worktrees/9b02/tragedy-looper-mastermind`인 연결 worktree다.
  앱이 사용 중인 primary checkout이라 제거·보관할 수 없고, 현재는 `master`와 같은 커밋을
  가리키는 clean detached HEAD다.
- Git은 같은 브랜치를 두 worktree에서 동시에 checkout하지 못한다. 앱 worktree를
  `master`로 바꾸려면 Downloads 주 checkout을 detached로 만들어야 해서 혼란만 옮기므로
  현재 구조를 유지한다.
- 다음 작업은 앱 worktree에서 최신 `master`를 기준으로 작업 브랜치 하나를 만들고, 완료 후
  Downloads의 `master`에 fast-forward 병합한다. detached HEAD에 커밋을 쌓아 두지 않는다.

## 현재 지원 범위

한국어판 정식 참극 세트 범위는 완료했다.

| 범위 | 상태 | 비고 |
|---|---|---|
| 입문편 / 기본편 | 완료 | 공식·커뮤니티 각본과 기존 정오표 포함 |
| 미드나이트 존 | 완료 | MZ 룰·역할·사건·공식 각본 |
| 미스터리 서클 | 완료 | MC 룰·역할·사건·공식 각본 |
| Prime Evil | 완료 | 구판 Haunted Stage의 신판. HS는 별도 지원 대상이 아니다. |
| Cosmic Mythology | 완료 | CM 룰·역할·사건·공식 각본 |
| 시나리오 모음집 1·2 | 미착수 | 실물 각본 원문과 수록작 식별이 선행 조건 |

`Haunted Stage`는 `Prime Evil`의 구판이므로 별도 세트로 중복 집계하지 않는다. 한국어판은
신판 Prime Evil 기준이고, 구판 번역이 없는 것은 지원 장애가 아니다. 과거의 “가장 비싼
단일 세트: Haunted Stage” 평가는 중복 집계 가능성 때문에 폐기했다.

## 구현에서 유지할 핵심 계약

- 규칙 근거는 `src/impl/*.ts`의 `source`다. `data/ko-rules-text.json`은 구현 근거가 아니다.
- 역할 조회는 `scenario.cast` 직접 참조 대신 `effectiveRole()` 또는
  `effectiveAbilityRoles()`를 사용한다.
- 루프 종료 상태는 `GameState.history`에 보존한다. 게임 단위 게이지와 직전 루프 조건이
  이 스냅샷을 사용한다.
- 장소 X는 `resolvePlaceX()`로 계산한다.
- 사건은 하루에 하나다. 엽기 살인의 복합 효과와 교주의 이중 해결은 복수 사건이 아니다.
- 공개 추론은 관측 시점의 보드 문맥을 사용한다. 선언·주장과 숨은 진실을 섞지 않는다.
- 강제 훅은 판정을 모두 끝낸 뒤 효과를 일괄 적용한다. 선택 훅은 각본가가 순서를 고른다.
- 완전 opening book과 전체 상태 공간 사전 열거는 불가 판정이다. 현재 전략 지침은
  `distanceToLoss`, 합법수, 공개 가설 변화의 계산 결과만 사용한다.

## 확장 기반 요약

### Midnight Zone

역할 변이, 역할 공개, 닌자의 거짓 선언, 위장 사건을 공개 주장과 실제 사실로 분리했다.
닌자의 선언 후보는 사용자가 확정한 대로 비공개 정보표의 기본 배정 역할만 사용한다.

### Mystery Circle

특수 게이지는 루프마다 초기화한다. 사건 발생과 역할 효과의 게이지 변화를 공개 변화로
기록하되, 이미 존재하는 사건 관측의 중복 추론 근거로 세지 않는다.

### Prime Evil

- 장소 음모 하나는 익명 시체 한 구다. `corpseCountAt()`이 실제 사망 캐릭터와 합산하며
  이 환산은 Prime Evil에서만 적용한다.
- 익명 시체는 개별 ID가 없다. 부활하면 해당 장소의 음모 하나를 제거하고, 좀비 이동은
  출발 장소 음모 -1 / 인접 도착 장소 음모 +1이다.
- 저주는 장소/캐릭터 두 상태만 가진다. P9 진입 스냅샷을 기준으로 일반 P9 훅보다 먼저
  한 번 전환한다. 새 빙의 대상은 생존 캐릭터뿐이다.
- 장소 범인 사건은 `IncidentCulprit`의 character/location union을 사용한다.

### Cosmic Mythology

- 특수 게이지는 게임 전체에서 유지한다. 다음 루프와 저장·복원에서 값을 보존하고
  `increasedThisLoop`만 루프 시작에 초기화한다.
- 거부 가능한 우호 능력을 실제로 거부했을 때만 게이지가 오른다. 거부 불가 능력은
  오르지 않는다. 학자의 감소 뒤에도 “이번 루프 증가” 이력은 유지한다.
- 주문은 새 라운드 단계가 아니라 현재 게이지 1~4에 따라 기존 시점에서 누적 해금되는
  효과다.
- 황색의 왕은 현재 게이지 값이 아니라 `increasedThisLoop`를 본다. 지침 A/B는
  “이번 루프에 우호 거부·심해인 사망·목격자 사망·발견으로 게이지를 올리지 않으면
  패배를 막는다”를 명시한다.
- `Twisted Truth`의 `Extra Plot`은 업스트림 `addRolesForPlot: true`를 보존한다. 역할 최대
  정원에는 Extra Plot을 포함한다. 공식 `Bella Stellarum`은 동반 룰 X의 역할을 전부
  배정하지 않고 Extra Plot 역할을 사용하므로, 편집기에서는 원 룰 Y와 Twisted Truth
  역할만 필수로 하고 동반 룰 X·Extra Plot 역할은 허용 정원으로 계산한다.

## CM-4 완료 결과

### 공식 각본

공식 Cosmic Mythology 각본 5편, 난이도 변형 7개를 `scenario-source.json`에 official로
분류했다.

| ID | 제목 | 변형 |
|---|---|---:|
| `cosmicMythology:6` | Banquet School Life | 2 |
| `cosmicMythology:7` | Eyes Without Vision | 1 |
| `cosmicMythology:8` | Bella Stellarum | 2 |
| `cosmicMythology:9` | An Ordinary Day In Misuka City | 1 |
| `cosmicMythology:10` | Cosmic Insignificance | 1 |

다섯 편 모두 upstream cast·사건·난이도·`Extra Plot` 메타데이터를 보존한다. 7개 변형은
`validateScenario()`를 통과하고, 실제 게임 흐름에서 모든 루프를 종료한 뒤 최후의 싸움과
정답 제출까지 진행된다.

전체 세트 회귀에서는 First Steps·기본편·MZ·MC·PE·CM의 카탈로그 생성과 시작 상태를
전수 확인하고, 기존 세트별 종단 회귀와 CM 7변형 종단 회귀를 함께 실행한다. 단,
`midnightZone:4` Romance Antithesis의 두 난이도는 upstream에서 4일 사건이 두 개로
충돌해 현재 `INCIDENT_DAY_DUPLICATED`로 거부된다. 이후 공식 Mastermind Handbook 6쪽의
각본가 힌트에서 회사원의 `Confession`은 3일, `Increasing Unease`는 4일임을 확인했다.
원문 판정은 해결됐지만 이번 조사에서는 데이터를 고치지 않았으므로, 다음 구현에서 정오표
오버레이를 추가하고 두 변형의 종단 회귀를 복구해야 한다.

### 지침 A~E와 편집기

- A: CM 룰·역할·사건 패배 경로와 게이지 조건을 `distanceToLoss()`에서 읽는다. 황색의
  왕은 증가 회피 경고가 별도로 표시된다.
- B: 인간 제물·심해인·마법사·목격자·얼굴 없는 자의 강제/선택 노출과 CM 사건 효과를
  예고한다.
- C: CM 룰의 공개 관측 프로필을 사용한다.
- D: CM 신규 역할의 불사, 사망 공개, 게이지 변화, 획득 능력을 은폐 난이도에 반영한다.
- E: 7개 공식 변형 모두 초반 배치 추천 계산이 예외 없이 끝난다. 기여 배치가 부족하면
  빈 추천을 정상 결과로 유지한다.
- 편집기는 Cosmic Mythology 선택, CM 룰 Y/X·역할·사건 후보, `초기값 0 · 루프 간 유지`,
  Twisted Truth/Extra Plot 역할 정원을 표시하고 검증한다.

### 가설 공간

CM의 룰 조합은 105개다. 공식 각본으로 역할표와 사건 범인표가 계산되고 신규 역할 7종이
후보 공간에 들어간다. 심해인·마법사·목격자·얼굴 없는 자의 강제 효과가 관측되지 않으면
`mandatoryEffectMissing`으로 배제한다. 우호 거부로 생긴 게이지 증가는 기존
`goodwillRefused` 한 건만 사용하며 별도 게이지 증거를 중복 생성하지 않는다.

### 실제 브라우저 성능

가장 큰 공식 CM 각본 `cosmicMythology:10`을 390×844 실제 Chrome 하네스에서 각 3회
측정한 중앙값이다.

| 합성 진행 | 공개 관측 | 역할표 렌더 | 관측당 | DOM |
|---|---:|---:|---:|---:|
| 3루프 | 58 | 44.3ms | 0.76ms | 396 |
| 4루프 | 78 | 57.9ms | 0.74ms | 400 |
| 5루프 | 98 | 72.5ms | 0.74ms | 404 |

5루프 진행 기록 필터는 90건·1.2ms다. PE 기준 98관측 68.5ms·관측당 0.70ms와 같은
선형 범위이며, CM 게이지 변화 때문에 구조적 증가가 생기지 않았다.

### 번역

CM 공식 5편의 제목·story·힌트·승리 조건은 upstream 한국어 번역에서 비어 있다.
제목은 영문 폴백을 사용하고, 본문 세 필드는
`See Tragedy Looper: Cosmic Evil Mastermind Handbook`를 보존한다. 임의 번역하지 않는다.

## 다음 작업: 시나리오 모음집 1·2

모음집 1은 공모작 30편과 학자·환상, 모음집 2는 52편과 캐릭터 6장을 담지만 upstream의
전용 각본 데이터는 없다. 모음집 2에서 식별 가능한 샘플은 기본편 태그가 붙은
`A Little Friend`, `Fall-Sakura Gathering` 두 편뿐이다. 나머지를 제목으로 추정하지
않는다.

진행 순서:

1. 실물 목차와 공개·비공개 정보표로 모음집 1·2 수록작을 확정한다.
2. Haunted Stage로 작성된 구판 각본 한 편을 식별한다.
3. 그 각본의 룰 Y/X·역할·사건을 Prime Evil 신판과 대조해 각본 단위로 변환한다.
4. 수록작 출처, 정오표, 한국어 제목·story·힌트·승리 조건을 기록한다.
5. 각 변형의 검증·게임 진행·가설 공간·편집기 회귀를 추가한다.

## 사용자 실물 확인 목록

| 자료와 부분 | 확인할 것 | 필요한 이유 |
|---|---|---|
| 한국어 시나리오 모음집 1·2의 목차와 각본 공개·비공개 정보표 | Haunted Stage로 작성된 각본의 정확한 제목, 참극 세트 표기, 룰 Y/X, 역할표, 사건표. 해당 각본이 구판 `Sacrifice` 사건을 쓰면 정식 한국어 사건명도 함께 확인 | upstream의 구판 HS 8편에는 모음집 태그가 없어 어느 각본을 PE로 다시 써야 하는지 식별할 수 없다. `Sacrifice` 명칭은 실제 수록 각본에서 필요할 때만 확인하면 된다. |
| 한국어 본판 구성물 목록과 캐릭터 카드 24장 | 검은 고양이와 AI가 24장에 포함되는지 | 한국어 본판 캐릭터 범위를 확정한다. |

`crusader`는 한국 미발매 `Supernatural` 범위라 현재 정식 한국어판 지원과 모음집 구현에
필요하지 않다. 사용자 실물 확인 목록에서 제외하고, 해당 세트를 별도로 지원할 때만 다시
확인한다.

## QUESTIONS.md

현재 미해결 규칙 질문은 없다. Q10과 Q13~Q15를 포함한 확정 사항은
`QUESTIONS.md`의 해결됨 절에 보존한다. 모음집 구판 각본 식별은 규칙 해석 질문이 아니라
위 실물 확인 목록에서 관리한다.

## 기록만 하고 미착수인 항목

| 우선순위 | 항목 | 착수 조건 |
|---|---|---|
| P1 | 연쇄 살인마 관련성 축소 | 후보 축소가 결과를 누락하지 않는다는 전수 대조 하네스가 먼저 필요하다. |
| P2 | 전 날짜 완전 전략 탐색 | 완전 opening book은 불가 판정이다. 상징적 전이 또는 새 성능 게이트 없이는 재개하지 않는다. |
| P2 | 광신도 확장 범위 | 새 참극 세트를 실제 지원할 때 원문과 등장 각본을 다시 감사한다. |
| P2 | 미사용 역할·룰 조회 | 편집기의 레드 헤링 조회 범위와 진실 정보 분리 계약을 먼저 정한다. |
| P2 | 역할 배정 CSP 일반화 | 새 교차 캐릭터 제약이 실제로 필요할 때 확장한다. |
| P2 | 시나리오 제목 정발 대조 | 실물 한국어 각본과 대조하기 전에는 번역하지 않는다. |
| P2 | 입문편 7편 출처 확정 | 설명서 수록 2편 외 5편의 직접 출처가 필요하다. |
| P3 | Another Horizon R 괴뢰 우호 능력 | 해당 확장 지원 시 선택·대상·즉시 종료를 함께 명세한다. |

Phase 5 feasibility 계측 코드는 `tools/phase5-feasibility/`에 남아 있고 평상시 Vitest에서
분리되어 있다. 재현이 필요할 때만 `npm run test:phase5-feasibility`를 실행한다.

## 최신 검증

- Vitest 72파일: **1140개 통과, 1개 todo**
- 실제 Chrome: 수동 생사 교정, 캐릭터 특성, 390×844 게임 화면, 390×844 편집기 통과
- `npx tsc --noEmit --strict` 통과
- `npm run build` 통과. 기존 500kB 청크 경고만 남는다.
- `git diff --check` 통과

## 검증 기준

- 저장소 지침에 따라 타입 검사는 `npx tsc --noEmit --strict`를 직접 실행한다.
- 전체 단위 회귀, 수동 생사 교정, 특성 흐름, 390×844 게임 화면, 390×844 편집기를
  `npm test`로 확인한다.
- 런타임/UI 변경은 `npm run build`, 모든 변경은 `git diff --check`를 통과시킨다.
- `gen.py`는 실행하지 않는다. `data/*.json` 생성물은 직접 수정하지 않는다.
