---
name: tl-incident
description: 라운드 7단계(사건) 구현 + incidents.ts 훅 10개.
---

src/engine/incident.ts 를 작성하라. 라운드 7단계다.

발생 조건 2가지를 모두 만족하면 반드시 발생한다. 각본가에게 선택권이 없다.
  ① 범인 캐릭터가 생존 상태
  ② 범인에 최대 불안 수치 이상의 불안 카운터

효과가 아무것도 하지 않더라도 "발생했다"는 사실 자체는 결과에 포함시켜라.
(FAQ Q23 — 각본가는 "사건이 발생했지만 아무 일도 일어나지 않았습니다"라고 전달해야 한다)

반환 타입에 fired: boolean 과 effectApplied: boolean 을 분리해서 담아라.

src/impl/incidents.ts 의 훅 10개도 함께 채워라.

통과 기준: 픽스처의 incident-trigger-condition 3개 케이스.
