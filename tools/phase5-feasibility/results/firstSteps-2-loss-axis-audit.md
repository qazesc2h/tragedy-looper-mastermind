# `distanceToLoss` 축 계약 감사와 First Steps 2 재계측

- 실행일: 2026-08-21
- 계약 감사 코드: `tools/phase5-feasibility/audit-distance-to-loss-contracts.ts`
- 재계측 코드: `tools/phase5-feasibility/measure-loss-axis-audit.ts`
- 범위: 번들 각본 47개 난이도의 초기 상태 계약 감사, `firstSteps:2` 1루프
  1~3일차 P2 결정 상태의 결정론적 P2 분위 표본 각 100개

## 판정

기존 89%/94%/94%는 수치 자체는 재현되지만 전략적 결론에는 쓸 수 없다.
`distanceToLoss`의 `role:keyPerson:girlStudent`는 핵심 인물 음모 거리가 아니라
**이미 죽었는지 0/1**만 반환한다. P4 직후에는 아직 P9 사망 판정 전이므로 이 값이
항상 1 남은 것은 “대응이 무의미”하다는 뜻이 아니다.

First Steps 2 원문에 적힌 네 승리 경로를 모두 별도 축으로 보존하면 세 날짜 모두
**모든 P2 표본에서 주인공 대응에 따라 평가 벡터가 갈렸다.** 따라서 “대부분의
후보에서 대응이 평가에 무의미하다”와 그 비율을 전제한 날짜별 탐색 설계는 폐기한다.
근사 조기 종료를 배제한다는 기존 안전 판정만 유지한다.

| 날짜 | 문자 그대로의 `distanceToLoss` 불변 | 완전 사망 경로 벡터 불변 |
|---|---:|---:|
| 1일차 | 89/100 (89%) | **0/100 (0%)** |
| 2일차 | 94/100 (94%) | **0/100 (0%)** |
| 3일차 | 94/100 (94%) | **0/100 (0%)** |

문자 그대로의 열은 기존 상태 hash와 P2 표본을 그대로 사용해 기존 수치를 격리
재현한 것이다. 올바른 결론은 오른쪽 열이다.

2·3일차 상태를 고르던 `representativeStateForDay` 자체도 불완전한
`distanceToLoss remaining` 사전식 순서를 사용했다. 이번 감사에서는 수치 변화의 원인만
격리하기 위해 기존 hash(`03cb93d8...d9f33c`, `3deba1c6...8e343`)를 그대로 썼다.
따라서 이 두 상태를 더 이상 “올바른 손실 축의 임계 스트레스 대표”라고 부르지 않으며,
새 축으로 다시 선택하기 전에는 날짜 전체로 외삽하지 않는다.

## First Steps 2의 완전 사망 경로 축

합산 점수를 만들지 않고 다음 필드를 각각 보존했다.

- 현재 핵심 인물 사망 여부
- 살인 청부업자의 핵심 인물 살해: 핵심 인물 음모 2까지의 잔량, 둘의 동소 여부
- 연쇄 살인마의 핵심 인물 살해: 핵심 인물 동소 여부, 연쇄 살인마 위치의 다른 생존자 수,
  현재 단둘 조건 성립 여부
- 3일차 자살: 범인의 불안 한계까지의 잔량, 현재 날짜 발동 여부
- 살인 청부업자의 주인공 살해: 청부업자 본인 음모 4까지의 잔량

| 세부 축 | 1일차 가변 P2 | 2일차 가변 P2 | 3일차 가변 P2 |
|---|---:|---:|---:|
| 핵심 인물 음모 잔량 | 3/100 | 0/100 | 0/100 |
| 핵심 인물·청부업자 동소 | 100/100 | 100/100 | 100/100 |
| 연쇄 살인마 단둘 조건 | 100/100 | 100/100 | 100/100 |
| 자살 범인 불안 잔량 | 96/100 | 95/100 | 95/100 |
| 청부업자 본인 음모 잔량 | 11/100 | 6/100 | 6/100 |

후반 대표 경로에서 핵심 인물 음모 잔량이 안 갈린 것은 그 축만의 결과다. 이동으로
청부업자·연쇄 살인마의 조건이 매 후보에서 갈리므로 전체 벡터는 항상 가변이다.

## `distanceToLoss` 반환 계약 전수 감사

번들 각본 47개 난이도의 `createGameState` 초기 상태를 모두 호출했다. 반환에 성공한
47개 전체에서 다음 12종 계약을 확인했고, 코드에 적은 기대 계약과의 불일치는 0건,
미지원 예외는 0건이었다.

| 반환 종류 | 실제 의미 | 요구조건 key |
|---|---|---|
| `plot:lightAvenger` | 장소 X 음모 2 | `placeXIntrigue` |
| `plot:placeProtect` | 학교 음모 2 | `schoolIntrigue` |
| `plot:sealedItem` | 신사 음모 2 | `shrineIntrigue` |
| `plot:signWithMe` | 실제 핵심 인물 음모 2 | `keyPersonIntrigue` |
| `plot:changeOfFuture` | 나비의 날갯짓 발생 여부 | `butterflyEffectFired` |
| `plot:giantTimeBomb` | 장소 X 음모 2 | `placeXIntrigue` |
| `role:keyPerson:*` | 현재 핵심 인물 사망 여부 | `dead` |
| `role:friend:*` | 현재 친구 사망 여부 | `dead` |
| `role:timeTraveler:*` | 마지막 날 우호 3 | `goodwill` |
| `role:killer:*` | 청부업자 본인 음모 4 | `intrigue` |
| `role:lovedOne:*` | 불안 3과 음모 1 | `paranoia`, `intrigue` |
| `incident:hospitalIncident:*` | 범인 생존·불안 한계·병원 음모 2 | `culpritAlive`, `culpritParanoia`, `hospitalIntrigue` |

같은 종류의 소비 오류는 복수 요구조건에서도 발견했다. `lovedOne`과
`hospitalIncident`의 최상위 `remaining`은 서로 다른 요구조건의 결손을 산술 합산한다.
축별 탐색에서는 반드시 `requirements`를 개별로 읽어야 한다. 또한 `keyPerson`과
`friend`는 종착 상태만 재므로, 그 인물을 죽이는 역할·사건·이동 경로를 자동으로
포함하지 않는다.

## 정확성 및 재현성

P4 경로 필드에 영향을 주는 주인공 카드 효과만 보존해 원시 대응을 정확 동치류로
줄였다. 각 날짜의 첫 P2 표본에서는 축약 전 원시 대응을 전수 대조했고, P2 표본
100개마다 상징 투영을 실제 엔진 P4 경로와 대조했다.

| 날짜 | 원시 P3 대응 | 정확 효과류 | 원시 전수 불일치 | 엔진 대조 불일치 |
|---|---:|---:|---:|---:|
| 1일차 | 368,640 | 5,459 | 0 | 0/100 |
| 2일차 | 322,560 | 5,439 | 0 | 0/100 |
| 3일차 | 246,960 | 5,109 | 0 | 0/100 |

A/B 실행의 결정적 hash는 모두
`54a908f03d9c84dadc46dcc4788c6d0c5ce6790bff820ffe22a12e2c7f3c9498`였다.
실행 시간은 A 36.50초, B 36.57초였다. 계약 감사 A/B hash는 모두
`474d0d8561568ab598898c57c2f6152b2d9483ec50a13e1a58b48e322366b1d0`였다.

```bash
npx vite-node tools/phase5-feasibility/measure-loss-axis-audit.ts /tmp/loss-axis-a
npx vite-node tools/phase5-feasibility/measure-loss-axis-audit.ts /tmp/loss-axis-b
npx vite-node tools/phase5-feasibility/audit-distance-to-loss-contracts.ts /tmp/loss-contract-a
npx vite-node tools/phase5-feasibility/audit-distance-to-loss-contracts.ts /tmp/loss-contract-b
```

이 계측은 사용자가 지정한 순서의 1번만 다룬다. 연쇄 살인마 관련성 축소, 광신도
지원 범위, P5~P9 분산은 아직 측정하지 않았다.
