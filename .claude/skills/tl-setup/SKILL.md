---
name: tl-setup
description: 환경 구축: package.json, tsconfig, vitest 세팅. 게임 로직은 건드리지 않는다. 가장 먼저 실행할 것.
---

이 저장소는 보드게임 트래지디 루퍼의 각본가 보조 도구다.
먼저 AGENTS.md 와 HANDOFF.md 를 읽어라. 특히 AGENTS.md 의 "절대 규칙"을 지켜라.

이번 작업은 환경 구축만 한다. 게임 로직은 건드리지 마라.

1. package.json, tsconfig.json 생성
   - TypeScript strict, target es2022, module esnext, moduleResolution bundler
   - 테스트 러너는 vitest
   - 런타임 의존성 없음. devDependencies 만.
2. `npx tsc --noEmit` 이 통과하는지 확인
3. test/fixtures/manual-examples.json 을 읽어 구조를 파악하고,
   이 픽스처를 로드하는 헬퍼 test/helpers.ts 를 작성
4. 아직 통과하지 않아도 좋으니, 픽스처의 cases 배열을 순회하며
   describe/it 껍데기만 만든 test/resolve.test.ts 를 작성 (전부 it.todo)

통과 기준: `npx tsc --noEmit` 무오류, `npx vitest run` 이 todo 목록을 출력.
