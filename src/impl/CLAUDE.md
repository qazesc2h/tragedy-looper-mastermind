# CLAUDE.md — src/impl/

**이 디렉터리에서 규칙을 지어내면 프로젝트가 망가진다.**

루트 `CLAUDE.md`의 "절대 규칙"이 여기 전부 적용된다. 특히:

## 유일한 근거는 `source` 필드다

각 훅에 박혀 있는 원문이 전부다. 이 문장 밖의 조건을 추가하지 마라.

```ts
source: {
  timing: "Day End",
  prerequisite: `The :keyPerson: has at least 2 :intrigue: and is in this character's location`,
  description: `Kill the :keyPerson:`,
}
```

- `prerequisite` → `when`
- `description` → `effect`

**"at least 2"는 `>= 2`다. `> 2`가 아니다.**
**"other character"는 자신을 제외한다. "character"는 제외하지 않는다.**
**"in this character's location"은 생존 여부를 따지지 않는 한 시체를 포함하지 않는다** —
`카드`(card)라고 쓰여 있을 때만 시체를 포함한다.

## 토큰

| 토큰 | 의미 | 코드 |
|---|---|---|
| `:intrigue:` | 음모 카운터 | `charCounters[c].intrigue` / `locIntrigue[at]` |
| `:goodwill:` | 우호 카운터 | `charCounters[c].goodwill` |
| `:paranoia:` | 불안 카운터 | `charCounters[c].paranoia` |
| `:keyPerson:` | 핵심 인물 역할 | `effectiveRole()`로 탐색 |

## 반드시

- 역할 조회는 `effectiveRole(state, char)`. `scenario.cast` 직접 참조 금지.
- 장소 X는 `resolvePlaceX(state)`.
- `source` 필드를 삭제하지 마라. 런타임에 안 쓰여도 검증 근거다.
- 이 파일들의 `Record<string, {...}>` 구조를 바꾸지 마라. 생성기와 형태를 맞춰야 한다.

## 모호하면 멈춰라

두 가지로 읽히는 문장은 구현하지 말고 `QUESTIONS.md`에 적어라.
추측한 구현은 나중에 찾기가 매우 어렵다. 지금 멈추는 편이 싸다.

## 한 번에 3~4개씩

훅을 한꺼번에 다 채우지 마라. 후반부에 근거 없는 패턴 복사가 시작된다.
3~4개 구현 → 테스트 작성 → 멈춤. 이 단위를 지켜라.
