# 규칙 해석 질문

## 미해결

### Q6. 신수 — "카운터 1개"에 보호 카운터도 포함되는가?
- source: "Each turn, the Leader may move 1 counter on this character to another character at this location."
- 해석 A: 카운터 종류를 한정하지 않았으므로 우호·불안·음모·보호를 모두 옮길 수 있다.
- 해석 B: 보호 카운터는 형사 능력으로 놓는 전용 자원이므로 통상 3종 카운터만 옮긴다.
- 현재 처리: 해석 A. 원문에 없는 카운터 종류 제한을 추가하지 않는 문자 그대로의 임시
  판정이며, 보호 카운터를 제외한다는 공식 근거가 확인되면 수정 필요.

### Q5. 신수 — 리더가 매 라운드 카운터를 옮기는 정확한 시점은 언제인가?
- source: "Each turn, the Leader may move 1 counter on this character to another character at this location."
- 해석 A: P4 행동 해결 직후, P5 각본가 능력 단계로 넘어가기 전에 별도 선택한다.
- 해석 B: P6 주인공 능력 단계에 함께 처리한다.
- 해석 C: 기존 9단계와 별개의 전용 단계를 둔다.
- 현재 처리: 해석 A. 공식 설명서의 P6는 캐릭터의 우호 능력과 그 시점에 쓸 수 있다고
  명시된 룰 능력을 사용하는 단계이므로, 우호 능력이 아닌 공개 특성을 P6 거부 처리에
  섞지 않는다. 별도 10단계도 원문 근거가 없으므로 만들지 않았다. P4의 카드 효과를 모두
  공개·해결한 뒤 입력을 열어 그날 놓인 카운터도 선택 후보에 포함한다. 정확한 공식 시점은
  추가 확인 필요.

### Q4. 메이드 대신 사망 — 메이드 자신이 불사일 때 원래 주인은 죽는가?
- source: "If any onf them dies at her location, she dies instead."
- 공식 FAQ Q24는 주인(재벌가 손녀)이 불사라서 사망이 발생하지 않으면 대신 사망도
  발생하지 않는다고 확인하지만, 대신 사망 대상으로 바뀐 메이드 자신이 불사인 경우는
  설명하지 않는다.
- 해석 A: 사망 대상이 메이드로 교체된 뒤 메이드의 불사가 적용되어 아무도 죽지 않는다.
- 해석 B: 메이드가 죽지 못하면 원래 주인이 죽는다.
- 현재 처리: 해석 A. 대체 이후 메이드에게 통상 불사·보호 검사를 적용하되, 실패해도
  원래 주인에게 사망을 되돌리지 않는다. 원문에 없는 재귀·되돌림을 만들지 않는
  보수적 임시 판정이며 공식 확인 필요.

## 해결됨

### Q7. 사용자 시나리오 「못된 고양이」 — 메이드 시작 장소
- 정정: 메이드의 도시/학교 후보는 하수인처럼 매 루프 각본가가 고르는 특성이 아니다.
  시나리오 작성 시 한 곳을 확정해 `scenario.scriptSpecified["startLocation:servant"]`에
  저장한다.
- 사용자 확인: 「못된 고양이」의 메이드 시작 장소는 학교다. 재벌가 손녀와 같은 장소에서
  시작하므로 1일차부터 동행 이동이 가능하다.
- 판정: 커뮤니티 시나리오 원시 데이터에 `startLocation: School` 메타데이터를 기록하고,
  런타임 시작 장소 입력 UI는 제거했다. 복수 후보를 가진 비-하수인 캐릭터의 고정값이
  누락되면 `validateScenario()`가 시나리오를 거부한다.

### Q3. 공식 각본 `Those with Antibodies`의 선동가 2명 배정
- 원본 인쇄: `richStudent`와 `informer`가 모두 `conspiracyTheorist`로 적혀 있어, `paranoiaVirus`가 추가하는 1명과 선동가 최대 인원 1명을 초과한다.
- 정오표: `informer`의 역할을 `person`으로 정정한다.
- 근거: 원본 각본 카드가 잘못 인쇄되었고 게임사가 뒤에 정오표로 바로잡았음을 사용자가 실물로 확인했다.
- 판정: upstream 데이터는 원본 인쇄물을 충실히 옮긴 것이므로 데이터 오류로 고치지 않는다. `data/errata.json`의 정오표 오버레이를 파싱 후·검증 전에 적용한다.

### 아웃사이더 — 엑스트라 배정 불가
- source: "Always has a role not associated with current plot."
- 확정: 아웃사이더는 엑스트라를 맡을 수 없다. 반드시 참극 세트의 역할 중 현재 시나리오의 룰에 쓰이지 않은 역할을 맡는다.
- 데이터 확인: 기본편 18번 `Trouble in Paradise`와 번들 밖 `Vertinari Gambit` 팬 제작 모음의 한 시나리오가 이 확정 규칙을 위반한다. 공식 시나리오의 위반은 0건이다.
- 판정: 두 사례 모두 공식 데이터 결함이나 upstream 보고 대상이 아니라 팬 제작 시나리오의 규칙 위반이다. 올바른 대체 역할은 임의로 정하지 않는다.

### Q2. 캐릭터 우호 능력·특성의 정발 한국어 문구
- 원인: 번역은 각 세트의 `data/*/translation.ko.jsonc`가 아니라 포크 저장소 루트의 `translations/ko.jsonc`에 있었다. 전자는 빈 스켈레톤이고, 후자가 영문 원문을 키로 하는 실제 한국어 번역 사전이다.
- 판정: 원본 영문 `description`을 키로 조회해 우호 능력 32건과 캐릭터 특성 21건을 채웠다.
- `godlyBeing` 특성 `Enters game on predefined loop`만 사전 값이 비어 있어, 미스터리 서클 추리 참조표 문구 `정해진 루프까지는 등장하지 않음`을 직접 기록했다.
- 카드 기반 축약문은 `data/ko-translations.json`을 UI에 사용하고, 설명서 기반 상세문인 `data/ko-rules-text.json`은 규칙 대조와 상세 설명 용도로 유지한다.

### 데이터 결함. data/characters.json 의 immuneToGoodwillRefusel 누락
- 원본 저장소 `data/base-game/characters.jsonc`에는 `mysteryBoy` [우호3]과 `nurse` [우호2]에 `immuneToGoodwillRefusel: true`가 명시되어 있다. 전체 원본 데이터에서 이 필드를 가진 능력은 두 건뿐이다.
- 파생 파일을 만드는 `gen.py`가 `goodwillAbilities`에 `rank` / `en` / `timesPerLoop` / `restrictedToLocation`만 복사해 이 필드를 누락했다.
- 판정: 두 능력 모두 우호 무시·절대 우호 무시 역할에도 거부되지 않는다. `data/characters.json`을 수동 보정하고 `src/engine/goodwill.ts`가 구조화된 필드를 참조하도록 반영했다.

### 데이터 결함. 병원 사건 — 두 번째 효과의 description 누락
- 영문 원본 `incidents.jsonc`의 `hospitalIncident`에는 효과가 두 항목 있지만, 두 번째 효과의 `description`이 비어 있다.
- 근거: `data/ko-rules-text.json` — "병원에 음모 카운터가 1개 이상인 경우, 병원에 있는 모든 캐릭터가 사망합니다. 또한 병원에 음모 카운터가 2개 이상 놓인 경우, 주인공은 사망합니다."
- 판정: 병원 음모가 2개 이상이면 주인공이 사망한다. 해석 문제가 아니라 영문 원본의 누락이며, `hospitalIncident`의 두 번째 효과와 패배 평가에 반영되어 있다.

### Q1. 광신도 — 장소에 놓인 음모 금지도 무시하는가?
- source: "You may ignore all Forbid :intrigue: effects on this location and on all characters in this location."
- 해석 A: 광신도가 있는 장소와 그 장소의 모든 캐릭터를 대상으로 한 음모 금지를 무시한다.
- 해석 B: 광신도가 있는 장소의 캐릭터를 대상으로 한 음모 금지만 무시한다.
- 근거: `data/ko-rules-text.json`의 cultist 항목 — "이 캐릭터와 동일한 장소에 있는 캐릭터 및 이 캐릭터가 있는 장소에 내려놓은 음모 금지 카드를 무시할 수 있습니다."
- 판정: 해석 A로 확정. 캐릭터와 장소를 대상으로 한 음모 금지를 모두 무시한다.
