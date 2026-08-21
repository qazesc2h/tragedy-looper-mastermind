# C. 시선 분산과 미끼 생성 감사

- 계산 코드: `src/engine/mastermind-decoys.ts`
- 전수 감사: `tools/phase5-feasibility/audit-mastermind-guidance-c.ts`
- 확장 속성 원문 감사 기준: 공개 데이터 510c8275dac010ca3ca6ba02e1dbcd0162e636ec

## 번들 47개 난이도

| 항목 | 결과 |
|---|---:|
| 시도/반환 | 47/47 |
| 관측 유형을 분류한 룰 | 16종 |
| 장소·캐릭터 음모 원문 계약 | 7건 |
| 같은 관측 짝 | 225건 |
| 설명 가능한 가짜 패배 조건 | 270건 |
| 장소 음모 수단 표시 | 143건 |

가짜 패배 조건은 가상 보드 상태를 만든 뒤 기존 `explainableLossConditions()`가 해당 룰·역할을 실제 설명 후보로 반환하는 항목만 남겼다. 장소와 캐릭터 목표는 별도 형식으로 보존한다.

## 속성 요구 전수 감사

정적 배정 조건 7건, 동적 대상·판정 조건 7건, 합계 14건을 확인했다. 현재 지원 세트에서 화면에 활성화되는 것은 `signWithMe`의 소녀 조건이며, 나머지는 확장 세트 지원 시 연결할 감사 카탈로그로 보존한다.

| 참극 세트 | 룰·역할 | 종류 | 속성 요구 |
|---|---|---|---|
| base-game | signWithMe | 정적 배정 | 핵심 인물은 소녀 |
| cosmic-evil | nobleBloodline | 정적 배정 | 핵심 인물과 흡혈귀는 서로 이성 |
| cosmic-evil | keyGirl | 정적 배정 | 핵심 인물은 소녀 |
| haunted-stage | strangeStory | 정적 배정 | 흡혈귀와 악몽은 같은 성별 |
| midnight-circle | maleConfrontation | 정적 배정 | 닌자는 남성 |
| last-liar | worldRebellion | 정적 배정 | 핵심 인물과 파편은 모두 소녀 |
| rei | throughLookingGlass | 정적 배정 | 앨리스는 소녀 |
| another-horizon | fanaticSacrifices | 동적 판정 | 광신도와 같은 성별의 다른 캐릭터 3명 이상 사망 |
| supernatural | metamorphosis | 동적 판정 | 탄원자는 생존한 초자연 캐릭터 |
| haunted-stage | zombieApocalypse | 동적 판정 | 사후 능력이 없는 시체가 좀비 후보 |
| haunted-stage | vampireHaunted | 동적 판정 | 이성 캐릭터를 대상으로 하며 이성 시체 수를 센다 |
| supernatural | seeder | 동적 판정 | 같은 장소의 비초자연 캐릭터 |
| visual-novel | heavyLovers | 동적 판정 | 같은 장소의 동성 캐릭터 |
| another-horizon | animus | 동적 판정 | 캐릭터의 성별을 반전 |

## 공식 기본편 8편 mastermindHints 대조

저장소 필드는 8편 모두 실제 문장이 아니라 각본가 설명서 포인터다. 기존 공식 영문 설명서 대조에서 확정한 지침 요소에 C의 출력이 대응하는지 다시 검사했다.

| 각본 | C 대응 | C가 채우는 부분 |
|---|---|---|
| Young Women’s Battlefield | 일치 | 소녀 전원과 실제 핵심 인물·미끼 후보를 분리한다. |
| Lesser of Two Evils | 일치 | 장소 음모 패배 관측의 유사 룰과 현재 흑막의 장소 음모 수단을 표시한다. |
| The Secret That Was Kept | 일치 | 거대 시한폭탄 X의 장소 음모 관측과 지켜야 할 장소를 짝짓되 다른 참극 세트라고 명시한다. |
| The Future of the Gods | 일치 | 선택되지 않은 패배 조건 후보를 추가 정보로 제공한다. |
| Mirror Passcode | 일치 | 소녀 전원과 캐릭터 기준 음모 2 조건을 표시한다. |
| Those with Antibodies | 일치 | 나와 계약하자! 등 선택되지 않은 설명 가능 패배 조건을 표시한다. |
| Prologue | 일치 | 살인 계획의 핵심 인물 사망 관측과 나와 계약하자!를 짝짓는다. |
| Neverending Happy & Sad Story | 일치 | 거대 시한폭탄 X와 다른 장소 음모 패배 관측을 구분해 병기한다. |

8/8편에서 C 범위의 보조 정보가 생성되었다. 특히 A의 공식 우선 지침 차이 4편(Young Women’s Battlefield, Lesser of Two Evils, The Secret That Was Kept, Mirror Passcode)에 있던 정보 은닉·블러프 근거를 C가 명시적으로 채운다. C는 A의 1순위를 바꾸지 않고 별도 정적 정보로만 제공한다.

결정적 hash: `a64799f414739f2dc9b5045e698c2cd45ce91c3ef7d526d3848402102bcfeea1`
