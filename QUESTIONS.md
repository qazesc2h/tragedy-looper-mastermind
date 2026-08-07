# 규칙 해석 질문

## 미해결

- 없음.

## 해결됨

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
