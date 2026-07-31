# 규칙 해석 질문

## 미해결

- 없음.

## 해결됨

### Q1. 광신도 — 장소에 놓인 음모 금지도 무시하는가?
- source: "You may ignore all Forbid :intrigue: effects on this location and on all characters in this location."
- 해석 A: 광신도가 있는 장소와 그 장소의 모든 캐릭터를 대상으로 한 음모 금지를 무시한다.
- 해석 B: 광신도가 있는 장소의 캐릭터를 대상으로 한 음모 금지만 무시한다.
- 근거: `data/ko-rules-text.json`의 cultist 항목 — "이 캐릭터와 동일한 장소에 있는 캐릭터 및 이 캐릭터가 있는 장소에 내려놓은 음모 금지 카드를 무시할 수 있습니다."
- 판정: 해석 A로 확정. 캐릭터와 장소를 대상으로 한 음모 금지를 모두 무시한다.
