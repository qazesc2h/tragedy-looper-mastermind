# 규칙 해석 질문

## 미해결

- 없음.

## 해결됨

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
