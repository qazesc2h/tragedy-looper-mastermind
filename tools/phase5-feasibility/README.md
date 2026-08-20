# Phase 5 2계층 검색 상태와 feasibility 계측

이 디렉터리는 프로덕션 번들에 연결하지 않는 feasibility 계측 전용 코드다. 이 문서는
`seed_73bb8e3ed023` v1.1.0의 feasibility 게이트를 다룬다.

## 명세 exit condition — `feasibility_gated`

```yaml
exit_conditions:
  feasibility_gated:
    status: satisfied
    benchmark: failed
    complete_opening_book: infeasible
    whole_state_space_precomputation: infeasible
    single_state_search: one_ply_desktop_background_only
    mobile_interactive: not_demonstrated
    heuristic_removal: forbidden_before_a_passing_benchmark
    research_hypothesis_retained: true
```

완전 opening book과 전체 상태 공간 사전 열거는 승인된 자원 프로필에서 불가로
확정한다. 연구 가설은 명세에 남기되, 벤치마크가 실패했으므로 현재 휴리스틱을 제거하지
않는다. 이후 feasibility 작업은 현재 한 상태에서 후보 몇 개를 비교하는 전경 탐색의
깊이·시간을 별도로 재는 범위다.

## 현재 결정: 전이와 정책 기억을 분리한다

검색 상태를 다음 두 키로 나눈다.

- `engineStateKey`: 합법 행동, 물리 효과, 자원, 지속 효과와 미래 엔진 전이에 필요한
  과거 요약. 공개 trace는 포함하지 않는다.
- `protagonistPolicyStateKey`: 주인공 정책이 공개 이력을 읽을 때만 붙이는 정보 문맥.
  `perfect-recall` 진단에서는 전체 canonical 공개 trace이며, 기본
  `worst-legal-response` 모델에서는 존재하지 않는다.

기본 검색 모델은 현재 상태에서 가능한 **모든 합법 주인공 대응 중 각본가에게 가장
불리한 결과**를 비교하는 `worst-legal-response`다. 이 모델의 합법 행동 집합과 실제
전이는 공개 이력에 의존하지 않으므로 `engineStateKey`만 검색 캐시에 사용한다. 확률,
승률, 몬테카를로, 대표 대응이나 숨은 가중치는 쓰지 않는다.

정보 누출과 시그널링은 검색 상태에 섞지 않는다. `src/engine/disclosure-preview.ts`의
공개 사실·가설 변화 계열을 별도 평가 축으로 유지한다. 따라서 물리 탐색의 앞섬과 정보
노출의 앞섬이 서로 다르면 둘을 각각 표시하며 하나의 숨은 점수로 합치지 않는다.

이 교환으로 물리 전이와 후속 상태를 병합할 수 있고, 모든 합법 대응에 대한 최악 기준
관계를 증명할 수 있다. 대신 실제 주인공이 어떤 대응을 고를지와 공개 행동의 시그널링
효과는 예측하지 않는다. 최악 대응 가정은 각본가에게 보수적이며 실제 대응이 그보다
약하면 결과는 같거나 유리할 수 있지만, 이를 승률이나 예상 행동으로 표현하지 않는다.

## 이전 Section 1 판정의 적용 범위

룰 조합 후보 집합, 역할 가능성 표, 사건 범인 가능성 표만으로 원시 공개 이력을
대체하는 안은 **반증되었다**. 세 표는 현재 숨은 정체의 후보 지지만 나타내며,
주인공이 본 공개 행동 신호와 후보를 아직 줄이지 못한 관측을 보존하지 않는다.
표의 `reason`에 원 관측 전체를 다시 넣으면 정보는 보존되지만, 그것은 후보 표로
대체한 것이 아니라 관측 이력을 다른 모양으로 중복 저장한 것이다.

`test/phase5-canonical-state.test.ts`의 반례는 현재 실제 코드 경로를 사용한다.

1. 두 완료 루프는 현재 보드에 아무 효과가 없는, 서로 다른 합법 P4 행동 프로필을
   공개한다.
2. 다음 루프의 보드·카운터·소진 카드와 세 가설 표는 완전히 같다.
3. `collectProtagonistObservations()`는 일반 P4 공개 프로필을 가설 관측으로 만들지
   않으므로 세 표의 canonical support도 같다.
4. 그러나 주인공은 서로 다른 각본가 카드·대상 신호를 보았다. 완전 기억 전략은
   그 신호에 따라 다음 대응을 달리할 수 있다.

따라서 **정책 모델을 정하지 않은 상태에서는** 두 상태의 이후 대응 정책이 같다는
보장이 없고, 모든 목적함수와
정책에서 각본가의 같은 선택이 나온다고 증명할 수 없다. 여기서 특정 행동이 실제로
최적이라고 주장하는 것이 아니라, **가설 표가 같다는 조건만으로 최적 행동의 동일성을
증명할 수 없음**을 보인 것이다. 이는 `HANDOFF.md`가 P2 배치 위치를 시그널링으로
규정한 것과도 일치한다.

`perfect-recall` 정책에서 관측 “순서”도 버릴 수 없다. 서로 다른 공개 행동·관측을 다른 순서로 겪고 우연히
같은 후보 표에 도달한 경우는 완전 기억 플레이어가 구별할 수 있다. 제거할 수 있는
것은 객체 프로퍼티 순서, 동일 사실의 중복 저장처럼 의미 이력 자체를 바꾸지 않는
표현 차이뿐이다.

## 두 충분성 기준

`engineStateKey`는 실제 미래 전이 동치를 보존한다.

두 결정 상태가 canonical 동치이려면 다음을 모두 만족해야 한다.

1. 같은 시나리오·엔진 근거 버전에서 같은 합법 행동 집합을 가진다.
2. 모든 합법 공동 행동과 후속 선택에 대해 공개 출력과 canonical 후속 상태가 같다.
3. 종결 여부와 종결 원인이 같다.
4. 공개 이력과 무관한 엔진 결과가 같다.

이 조건이면 물리 전이 그래프와 모든 합법 대응 집합이 같다. 기본 최악 대응 검색은 이
동치만 필요하다.

`protagonistPolicyStateKey`는 정책별 충분성이다. `perfect-recall`은 의미상 공개 trace가
같아야 하지만, `worst-legal-response`는 과거를 읽지 않으므로 두 번째 키가 없다. 미래에
유한 상태 주인공 모델을 승인하면 전체 trace 대신 그 모델의 내부 상태를 쓴다.

## 2계층 canonical 상태

`canonical-state.ts`의 `CANONICAL_DECISION_STATE_PARTITIONS`가 열거기가 따라야 할
필드 계약이다. 의미는 다음과 같다.

### 1. 불변 근거

- canonical 키 버전
- 시나리오 fingerprint: 참극 세트, 실제 룰·역할, 사건, 일수·루프 수, 각본 지정값
- 실제 전이 코드와 `src/impl/*.ts` source 근거의 버전

한 측정 프로필이 시나리오 하나로 고정되면 시나리오 fingerprint는 노드 키 밖의
파티션 키로 둘 수 있지만 서로 다른 시나리오의 캐시는 공유하지 않는다.

### 2. 현재 결정·물리 상태

- 게임 단계, 루프·날짜·9단계, 리더
- 캐릭터 위치·생사, 세력권, 캐릭터 카운터, 장소 음모, 특수 게이지
- 현재 배치 카드의 카드·대상·소유자와 P4 결과 확인 상태
- 종료 요청, 선택 패배 조건, P9 강제 해결 여부, 새 즉시 패배 키
- 최후의 싸움·게임 결과 상태

아직 해결되지 않은 현재 배치는 카드·대상·소유자 집합을 보존한다. 제출 순서는 규칙
효과에 영향을 주지 않으므로 버린다. 해결이 끝난 과거 P4 프로필은 엔진 키에서 빠지고,
필요할 때만 `perfect-recall` 정책 키의 공개 trace에 남는다.

### 3. 자원·지속 효과

- 양측의 1루프 1회 소진 카드
- 루프·라운드 능력 사용 키
- 장소 제한 해제, 음모·우호 금지 무시 대상
- 발생 사건과 발생 회차, 범인 억제, 주인공 사망 방지
- 루프 시작 특성 선택, 추가 루프 수

### 4. 과거에서 가져오는 전이 충분통계

전체 `history` 스냅샷 대신 실제 미래 전이가 읽는 값만 둔다.

- 직전 루프 종료 시 생존했고 우호가 1 이상인 캐릭터 집합:
  `threadsFate`의 `state.history.at(-1)` 참조
- 지금까지 역할이 공개된 캐릭터 집합: 친구의 재공개 방지
- 현재 루프에서 이미 기록된 `(loop, day, phase)` 집합: 자동 단계 중복 방지
- 현재 루프 판정 결과: `LOOP_JUDGMENT` 이후 전이용

새 규칙이 과거 필드를 읽으면 이 목록과 canonical 버전을 함께 갱신해야 한다.

### 5. 정책별 공개 이력

가설 표가 아니라 `(loop, day, phase, sequence, visibility, payload)`로 구조화한
완전한 공개 이벤트 trace는 authoritative 기록이지만 `engineStateKey`에는 넣지 않는다.
공개된 행동, 마스킹된 정보, 공개 결과와 당시 공개 보드를 포함하며
`perfect-recall` 정책 키와 정보 누출 평가에서만 읽는다.

`perfect-recall`에서 공개 이벤트의 시간·순서·가시성, `trigger`, 관측 직전 공개 보드는 삭제하지 않는다.
이 값들은 같은 결과라도 원인 가능성과 후속 결합 추론을 바꾼다. P4 프로필은 가설
수를 즉시 줄이지 않아도 시그널링 이력이므로 삭제하지 않는다.

`ProtagonistObservation`은 이 trace 전체가 아니라 가설 필터용 파생 투영이다.
새 기록은 `PublicInformation`과 공개 `PhaseLogEntry`가 공유하는
`(loop, day, phase, sequence)`를 보존하고 실제 시간순으로 투영한다. 역할 공개는
공개 순간 보드도 함께 보존한다. 다만 P2에서 주인공이 보는 각본가의 뒷면 카드
**대상**과 모든 시그널링 이력은 여전히 완전 trace에만 있다.

`projectCurrentKnowledgeProbe()`는 현재 보존되는 관측과 P4 공개 프로필만 뽑는
불완전 probe이며 `complete: false`를 반환한다. 완전 공개 이벤트 수집기가 모든 결정
노드와 공개 마스크를 포괄하기 전에는 Section 2의 canonical 열거를 시작하지 않는다.

기본 `worst-legal-response` 정책은 현재 모든 합법 대응을 빠짐없이 비교하므로 공개
trace를 읽지 않는다. 따라서 이 모델의 검색 캐시는 정책 키 없이 `engineStateKey`만
사용한다.

### 6. 파생값과 평가 키

- `ProtagonistObservation[]`, 룰 조합 후보, 역할표, 범인표는 위 공개 이벤트 trace에서
  다시 계산하는 호환·파생 캐시다.
- 목표 패배 조건, 탐색 지평, 승인 지표 방향·우선순위와 공식 버전, disclosure preview는 전이 키가 아니라
  평가 캐시 키다.
- 서로 다른 평가 키의 결과를 섞지 않는다.

## 제거할 수 있는 원시 정보

- `phaseLog`의 표시 문자열, `notApplicable`, 중복 P2/P3/P4 기록
- `publicInformationThisLoop`와 `history`에 중복 저장된 동일 사실
- 객체 프로퍼티 순서와 완전 중복 관측
- 런타임 오류 진단, 타이머의 절대 시각
- 이미 계산된 세 가설 표

`perfect-recall` 문맥에서는 서로 다른 공개 이벤트의 순서와 이벤트 내부 배열을 보존한다.
현재 관측 probe도 완전 중복만 첫 등장 위치에 하나 남긴다.
`canonicalizeProtagonistObservations()`는 이 보수적 probe 규칙을 구현한다.

## Section 1 종료 조건

- 가설 표 단독 키: 기각
- raw `GameState`/raw `phaseLog` 키: 기각
- 엔진 키: 현재 전이 상태 + 과거 전이 충분통계
- 정책 키: `worst-legal-response`에서는 없음, `perfect-recall`에서는 canonical 공개 trace
- Section 2 진입 전 구현 게이트: 아래 Section 2-A 공개 이벤트 수집기와
  Section 2-B headless 합법 전이 열거기

## Section 2-A — 공개 이벤트 수집기

`public-events.ts`의 `PublicEventCollector`가 새 headless 실행에서
`(loop, day, phase, sequence, visibility, payload)`를 authoritative trace로 쌓는다.
`sequence`는 trace 전체에서 단조 증가한다. 서로 다른 시점에 같은 변화가 반복되면
서로 다른 sequence이므로 둘 다 남는다. `canonicalizePublicEventTrace()`는 객체 키
순서를 무시한 **완전히 같은 이벤트**만 첫 등장 하나로 합치며 배열과 사건 순서는
정렬하지 않는다.

기존 저장 상태에서 이 trace를 역복원하지 않는다. 현재 `phaseLog`에는 P2/P3의 장별
배치 순서가 없고 여러 저장 원천 사이의 총순서도 없기 때문이다. Section 2 계측은 새
게임을 이 수집기와 함께 처음부터 실행해야 한다.

### 주인공 가시성 마스크

근거는 각본가 설명서 11p 「각본가의 효과 처리 전달 방법」의 게임판 변동만 전달한다는
원칙과, 7p의 효과 없는 장소 카드도 블러핑으로 놓을 수 있다는 설명이다. 전자는 결과와
숨은 원인을 분리하고, 후자는 뒷면 카드의 대상 자체가 공개 신호임을 확인한다.

| 공개 사건 | trace payload | visibility | 제외하는 비공개 값 |
|---|---|---|---|
| P2/P3 뒷면 배치 | 소유자, 대상, 배치 순서 | `public-card-identity-masked` | 카드 종류 |
| P4 공개 | 소유자, 대상, 카드 종류, 공개 순서 | `public` | 없음 |
| 카운터·이동·생사 | `PublicBoardChange[]` | 일반 효과는 `public`, 각본가 능력은 `public-cause-masked` | 역할명, 룰명, 훅 설명, 발동자 추정 |
| 사건 | 사건 종류와 발생 여부, 뒤따른 공개 보드 변화 | `public` | 범인, 미발생 원인, 하수인 억제 여부 |
| P6 선언·결과 | 주인공이 선언한 능력과 선택, 공개 변화·공개 정보 | `public` | 없음 |
| 역할 공개·우호 거부·정보 공개형 우호 결과 | 기존 `PublicInformation`의 공개 필드 | `public` | 시나리오의 다른 비공개 정보 |
| 패배 | 발생 사실과 `lastDay/effect/protagonistDeath` 시점 | `public-cause-masked` | 실제 `lossKeys`, 역할·룰 원인 |

각본가가 능력을 발동하지 않은 사실, 발동했지만 공개 변화가 전혀 없는 선택, 광신도나
하수인의 내부 선택은 이벤트를 만들지 않는다. P5/P9 효과는 `phaseLog`의 `character`,
`description`, 사건의 `culprit/failureReasons`를 trace 원천으로 쓰지 않는다. 카드가
공개된 뒤 변화가 없었다는 사실은 공개 카드와 전후 공개 보드로 표현되며 숨은 무효
원인을 별도 payload로 만들지 않는다.

프로덕션 UI의 `placedCardShowsName()`은 각본가 혼자 쓰는 화면에서 각본가 자신의 카드
이름을 보여주는 계약이다. 이것은 주인공 정보가 아니므로 canonical 공개 trace에서는
P4 전까지 각본가 카드 종류도 마스킹한다.

### 기존 ProtagonistObservation과 순서의 영향

순서 정보로 더 좁힐 수 있는 관측이 **있다**. 구체적인 반례는 망상 확대 바이러스다.
공개 불안이 3 이상이 된 뒤 어떤 캐릭터의 역할이 `person`으로 공개되면, 그 캐릭터를
엑스트라로 두는 `paranoiaVirus` 세계에서는 공개 순간 `serialKiller`여야 하므로
모순이다. 반대로 `person` 공개가 먼저이고 불안 증가가 나중이면 모순이 아니다.

`collectProtagonistObservations()`도 같은 공유 순번과 역할 공개 순간 보드를 보존한다.
따라서 불안 3 이상에서 일반 캐릭터의 `person`이 공개되면 `paranoiaVirus` 조합을
배제한다. 반대로 불안 3 이상에서 공개된 `serialKiller`는 기본 `person`의 변이일 수
있으므로 정적 배정 역할로 과잉 확정하지 않는다. 공개 순간 상태가 없는 구 저장은 새
배제에 쓰지 않는다. `incidentEffect`는 실제 해결일 `resolvedOnDay`를 우선한다.

전 관측 유형 감사와 회귀 범위는 `observation-order-audit.md`에 기록했다.

## Section 2-B — headless 합법 전이 열거기

`headless-transitions.ts`는 `HeadlessNode { state, publicTrace }`를 받아
`Generator<HeadlessTransition>`을 반환한다. 결과 배열을 만들지 않으므로 첫날의 거대한
공동 행동 프로필도 한 건씩 소비할 수 있다. 각 자식은 `structuredClone()`한 상태에서
실제 엔진을 실행하며 입력 상태를 변경하지 않는다.

### Section 2 계측 실행

승인된 자원·중단 프로필은 `measurement-profile-proposal.md`에 있다.
`measure-scenario.mjs`는 새 프로세스와 독립 출력 디렉터리 하나에서 계층별 물리
상태·전이·종결·병합률, 물리 상태당 정보 문맥 수, 처리량, RSS·디스크와 결정적
SHA-256을 기록한다. 승인된
`firstSteps:2`와 다음 세트 capped diagnostic인 `basicTragedy:3`만 허용한다.

```bash
npx vite-node tools/phase5-feasibility/measure-scenario.mjs \
  firstSteps:2 /tmp/phase5-firstSteps-2-run-a
```

전체 P2의 1일차 P4 목적지는 원시 P2×P3 간선을 만들지 않는 별도 CSP/DP 계측기로
정방향·역방향 두 번 실행한다.

```bash
npx vite-node tools/phase5-feasibility/measure-p4-destinations.ts \
  /tmp/phase5-p4-destinations-forward
npx vite-node tools/phase5-feasibility/measure-p4-destinations.ts \
  /tmp/phase5-p4-destinations-reverse --reverse
```

P4 목적지 투영을 보존하는 행동 동치류는 초기 상태 1개와 실제 엔진으로 만든 2일차
결정 상태 9개에서 잰다. 각본가 행동은 모든 합법 P3 대응에 대한 P4 후속 함수가 같을
때만 합치고, 주인공 대응은 고정 P2에서 P4 후속 투영이 같을 때 합친다.

```bash
npx vite-node tools/phase5-feasibility/measure-action-equivalence.ts \
  /tmp/phase5-action-equivalence-a
npx vite-node tools/phase5-feasibility/measure-action-equivalence.ts \
  /tmp/phase5-action-equivalence-b
```

고정 P2 하나의 P3 동치류 전개와 P4 최악 거리 평가는 다음처럼 잰다.

```bash
npx vite-node tools/phase5-feasibility/measure-one-ply-search.ts \
  /tmp/phase5-one-ply-a
npx vite-node tools/phase5-feasibility/measure-one-ply-search.ts \
  /tmp/phase5-one-ply-b
```

두 실행은 출력 디렉터리와 프로세스를 공유하지 않는다. `manifest.json`의
`deterministicHash`만 재현성 판정에 쓰고 시간·RSS 같은 성능값은 별도로 비교한다.

- P2: UI와 같은 `MASTERMIND_HAND`의 물리 카드 수량을 쓰고, 카드 한 장마다
  `validatePlacement()`를 호출한다. 의미가 같은 불안 +1 두 장의 물리 수량을
  보존하면서 완성 `(카드, 대상)` 집합을 한 번만 생성한다. 정확히 3장 뒤
  `advanceGame()`을 호출한다.
- P3: `PROTAGONIST_HAND`과 `nextProtagonist()`로 리더부터 1→2→3 순서를 강제하고,
  매 배치를 `validatePlacement()`로 검증한다. 세 명이 한 장씩 놓은 뒤 실제 P4로
  진행한다.
- P4 probe: 한 P2 부모의 모든 합법 P3 대응을 대표 축소 없이 실제 두 입력 P4 경로로
  해결한다. 해결 후 `engineStateKey` 병합률과 각 물리 상태에 붙는 perfect-recall 정보
  문맥 수를 센다. 다른 P2 부모로 외삽하지 않는다.
- P5: 현재 `collectHooks()`가 돌려주는 선택 훅을 매 발동 뒤 다시 수집한다.
  미발동, 모든 `selectableTargets`, 훅 발동 순열을 열거하고
  `withDeathBatch() + applyHookEffect() + advanceGame()`을 사용한다.
- P6: `goodwillAbilityViews()`의 현재 구조화 선택 필드로 후보를 만들고,
  `goodwillResponseAvailability()`가 허용한 해결/거부만 실제
  `resolveGoodwillAbility()`에 넣는다. 한 선언의 결과가 다음 선언 후보에 반영되며
  어느 시점에서든 더 선언하지 않는 분기를 낸다. AI 사건 선택은 사건 계약의 모든
  필드 조합을 실제 해결기로 검증한다.
- P7: 사건이 발생할 때 필요한 선택 필드를 스트리밍하고, 불완전·부적격 조합은 실제
  `advanceGame(state, choice)`가 거부한다. 사건이 발생하지 않으면 UI처럼 선택 없는
  한 분기만 낸다.
- P9: 먼저 실제 `advanceGame()`으로 동시 강제 훅을 해결한다. 그 뒤 미발동,
  선택 훅의 대상·순열과 `setOptionalLossActivation()`의 선택 패배 조건을 열거한다.
  시간 여행자의 동일한 “Loop ends” 입력은 UI와 같이 선택 패배 컨트롤 한 곳에서만
  센다.

P2/P3의 대상·카드 제약은 도구에 복제하지 않고 `legal.ts`를 합법성의 최종 판정으로
쓴다. P5~P9의 대상·효과·후속 종료도 `source`를 다시 해석하지 않고 기존 훅·우호·사건·
패배 엔진을 호출한다. UI에만 있던 손패 수량, 주인공 순서, 구조화 입력 스키마는 같은
export를 재사용한다.

테스트의 최소 보드에서는 P2가 `528 × C(4,3) = 2,112`, P3가
`8^3 × P(4,3) = 12,288`개의 owner-preserving 프로필을 정확히 스트리밍한다. 이 수는 게이트
완전성 검사용 작은 합성 상태의 결과일 뿐이며, 승인 전 실제 입문편/기본편 계측으로
사용하지 않는다.

## 게이트 종료 상태

- 2-A 공개 trace와 가시성 마스크: 구현
- 2-B P2/P3/P5/P6/P7/P9 스트리밍 실제 전이: 구현
- 기존 가설 필터의 시간 순서 활용: 구현·회귀 검증
- 2계층 캐시: `engineStateKey` + 정책별 선택 키 구현
- 기본 검색 정책: `worst-legal-response`, 정책 키 없음
- `firstSteps:2` P4 후 물리 병합 probe: 368,640 → 12,062, 96.728%
- 전체 P2×P3 원시 간선: 23,357,030,400개. 상태 수와 구분한다.
- P4 목적지 완전 열거: 물리 6,632,690개, 잔량 통합 근사 12,594,452개,
  소유자별 정확 엔진 투영 34,516,856개
- 명시적 경로 opening book: 전이 상한으로 미지원
- 목적지 CSP/DP 상태 열거: 지원 근거 확보. 다음 게이트는 행동 동치류 전이 관계다.
- 행동 동치류: 초기 P2 63,360→15,558 함수류, 고정 P2의 P3
  368,640→9,308~12,504 P4류. 2일차 대표 9상태도 각각 4,795~16,513,
  P3 표본은 3,559~12,504로 수천~만 단위다.
- 행동 동치류만 곱한 명시적 전이 관계: 여전히 큼. 전체 상태의 2일차 표본 계획은
  종료하고, 대상별 국소 관계·목적지 직접 평가를 한 상태 전경 탐색에만 적용한다.
- `feasibility_gated`: 벤치마크 실패로 종료. 완전 opening book·전체 상태 사전 열거
  불가, 휴리스틱 유지, 한 상태 전경 탐색만 별도 계측한다.
- 1수 앞 전경 탐색: P2 하나에서 P3 368,640→10,567 P4류, 실제 전이와
  `distanceToLoss` 축별 최악값까지 2.53초. 후보 10개 선형 환산 25.3초로 현재 구현은
  폰 즉시 비교 범위가 아니다.
- `6,182`와 P2 100개 93% 주장은 생성 코드·상태 키가 없어 재현 불가로 폐기했다.
- 상세 결과: `results/firstSteps-2-engine-state.md`,
  `results/firstSteps-2-p4-destinations.md`,
  `results/firstSteps-2-action-equivalence.md`,
  `results/firstSteps-2-one-ply-search.md`
