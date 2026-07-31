---
name: tl-roles
description: src/impl/roles.ts 의 when/effect 를 채운다. 한 번에 3~4개씩. 인자로 대상 역할을 넘길 수 있다.
---

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

## 인자

`$ARGUMENTS` 가 주어지면 그 역할들만 구현한다. 비어 있으면 TODO.md 에서 아직 안 된 것 중 앞에서 3~4개를 고른다.

예: `/tl-roles keyPerson killer brain`

