# 구현 체크리스트 — 기본편

스캐폴딩에 `when` / `effect` 구멍이 뚫려 있는 지점 전체.
생성기가 넣어둔 `source` 원문을 술어와 효과로 옮기면 된다.

## 역할 — 13종 / 훅 16개

- [x] **엑스트라** (`person`) — 능력 없음
- **핵심 인물** (`keyPerson`)
  - [x] [Always] This character dies. → The loop ends immediately.
- **살인 청부업자** (`killer`)
  - [x] [Day End] The :keyPerson: has at least 2 :intrigue: and is in this character‘s location → Kill the :keyPerson:
  - [x] [Day End] This character has at least 4 :intrigue:
- **흑막** (`brain`)
  - [x] [Mastermind Ability] You may place 1 :intrigue: on this location or on any character in this location.
- **광신도** (`cultist`)
  - [x] [Card resolve] You may ignore all Forbid :intrigue: effects on this location and on all characters in this location.
- **시간 여행자** (`timeTraveler`)
  - [x] [Card resolve] Ignore Forbid :goodwill: on this character.
  - [x] [Day End,Last Day] There is 2 or less :goodwill: on this character. → Loop ends
- [x] **마녀** (`witch`) — 능력 없음
- **친구** (`friend`)
  - [x] [Loop End] This character is dead. → Reveal its role.
  - [x] [Loop Start] This role has been revealed → This character gets 1 :goodwill:.
- **선동가** (`conspiracyTheorist`)
  - [x] [Mastermind Ability] You may place 1 :paranoia: on any character in this location.
- **연인B** (`lover`)
  - [x] [Always] The :lovedOne: dies → This character gets 6 :paranoia:.
- **연인A** (`lovedOne`)
  - [x] [Always] The :lover: dies → This character gets 6 :paranoia:.
  - [x] [Day End] This character has at least 3 :paranoia: and at least 1 :intrigue:.
- **연쇄 살인마** (`serialKiller`)
  - [x] [Day End] There is exactly 1 other (living) character in this location → That character dies.
- **변수** (`factor`)
  - [x] [Always] There is at least 2 :intrigue: on the School → This character gains the :conspiracyTheorist:‘s ability, but no
  - [x] [Always] There is at least 2 :intrigue: on the City → This character gains the :keyPerson:’s ability, but not its role.

## 룰(플롯) — 12종 / 훅 8개

- [x] **살인 계획** (`murderPlan`) — 능력 없음
- **봉인된 것** (`sealedItem`)
  - [ ] [Loop End] 2 :intrigue: on the Shrine.
- **나와 계약하자!** (`signWithMe`)
  - [ ] [—] :keyPerson: must be a :girl:.
  - [ ] [Loop End] 2 :intrigue: on the :keyPerson:.
- **미래 변경 계획** (`changeOfFuture`)
  - [ ] [Loop End] ˝:butterflyEffect:˝ has occured this loop.
- **거대 시한폭탄 X의 존재** (`giantTimeBomb`)
  - [ ] [Loop End] 2 :intrigue: on the :witch:’s starting location.
- [x] **친목 동아리** (`circleFriends`) — 능력 없음
- [x] **연애의 풍경** (`loveAffair`) — 능력 없음
- [x] **숨어 있는 살인귀** (`hiddenFreak`) — 능력 없음
- **불온한 소문** (`unsettlingRumor`)
  - [ ] [Mastermind Ability] You may place 1 :intrigue: on any location.
- **망상 확대 바이러스** (`paranoiaVirus`)
  - [ ] [Always] All :person:s with at least 3 :paranoia: turn into :serialKiller:s.
- **인과율** (`threadsFate`)
  - [ ] [Loop Start] Place 2 :paranoia: on all characters who had :goodwill: last loop.
- [x] **불확정 인자 χ** (`unknownFactor`) — 능력 없음

## 사건 — 9종 / 훅 10개

- **나비의 날갯짓** (`butterflyEffect`)
  - [x] [—] Put any counter on any character in culprit’s Location.
- **원격 살인** (`farawayMurder`)
  - [x] [—] One character with at least 2 :intrigue: dies.
- **사악한 기운의 오염** (`foulEvil`)
  - [x] [—] Place 2 :intrigue: on the Shrine.
- **병원 사건** (`hospitalIncident`)
  - [x] [—] 1 :intrigue: on the Hospital → Everyone in the Hospital dies.
  - [x] [—] 2 :intrigue: on the Hospital
- **불안 확대** (`increasingUnease`)
  - [x] [—] Place 2 :paranoia: on any character, then 1 :intrigue: on any other character.
- **행방불명** (`missingPerson`)
  - [x] [—] Move culprit to any Location. Put 1 :intrigue: on that Location.
- **살인 사건** (`murder`)
  - [x] [—] One (1) other character in culprit’s Location dies
- **유포** (`spreading`)
  - [x] [—] Remove 2 :goodwill: (or 1 if they only have that) from a character, and then add 2 :goodwill: to another chara
- **자살** (`suicide`)
  - [x] [—] The culprit dies.

---

**총 34개 훅.**
