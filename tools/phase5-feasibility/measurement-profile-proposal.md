# Section 2 측정 프로필 (2026-08-20 승인)

사용자가 이 프로필을 승인했다. 한 시나리오가 끝날 때마다 결과를 보고하고 다음
시나리오는 별도 진행한다.

## 대상과 순서

각본의 첫 번째 난이도 변형을 기본 대상으로 삼고, 난이도 변형은 별도 프로필 ID로
분리한다.

1. `firstSteps:2` — The First Script (NT), 캐스트 6명, 3일 × 3루프. 가장 작은
   입문편 pilot이다.
2. `firstSteps:1` — The First Script, 캐스트 6명, 4일 × 3루프. pilot에서 하루를
   늘렸을 때의 성장률을 확인한다.
3. `firstSteps:5` — Thunder in the City, 캐스트 7명, 5일 × 5루프. 입문편 최대
   horizon이다. 앞 단계가 완전 열거 가능 판정을 받은 경우에만 완전 열거한다.
4. `basicTragedy:3` — The Cat Box, 캐스트 7명, 5일 × 3루프. 기본편의 최소 캐스트와
   짧은 기본 horizon을 가진 대표 pilot이다.
5. `basicTragedy:4` — Crushed by the Hospital Building in Doronoki, 캐스트 9명,
   6일 × 5루프. `paranoiaVirus`와 후속 선택을 포함하는 기본편 stress 대표다. 앞선
   기본편 pilot이 완전 열거 가능 판정을 받은 경우에만 완전 열거한다.

작은 각본이 불가 판정을 받으면 더 큰 같은 세트 각본은 완전 열거하지 않는다. 다만
다음 세트의 대표 pilot은 아래와 같은 동일 상한의 capped diagnostic으로 한 번 실행해
세트 차이를 기록한다.

## 자원 상한

| 항목 | pilot (`firstSteps:2`, `:1`, `basicTragedy:3`) | 확대/stress |
|---|---:|---:|
| 단일 실행 wall time | 30분 | 60분 |
| 프로세스 RSS | 4 GiB | 8 GiB |
| 결과·frontier 디스크 | 10 GiB | 25 GiB |
| canonical 고유 상태 | 5,000,000 | 10,000,000 |
| 검증된 전이 | 50,000,000 | 100,000,000 |

상한은 독립 실행 하나마다 적용한다. 운영체제 전체 메모리가 아니라 계측 프로세스의
peak RSS를 기록한다. 임시·완료 산출물을 합친 디스크 사용량을 기록한다.

## 기록 항목

각 결정 계층 `(loop, day, phase, depth)`마다 다음을 newline-delimited manifest로
기록한다.

- 입력 frontier 상태 수, 새 canonical 상태 수, 중복 병합 상태 수
- 합법 전이 수, 종결 수와 종결 사유별 수
- 누적·계층별 병합률: `1 - unique_children / generated_children`
- 상태/초 및 전이/초, 계층 wall time
- 현재·peak RSS, frontier 및 결과 파일의 디스크 바이트
- canonical key schema version, 커밋, 시나리오·난이도·프로필 ID
- 계층별 정렬된 canonical 상태 해시와 최종 manifest SHA-256

P2/P3/P5/P6/P7/P9의 모든 자식은 generator에서 소비하는 즉시 기존 엔진과
`legal.ts` 경로의 검증을 통과해야 한다. 측정기는 자식 배열 전체를 실체화하지 않는다.

## 독립 재실행

완료 가능한 대상은 같은 커밋과 프로필로 두 번 실행한다.

1. 실행 A와 B에 서로 다른 새 임시 디렉터리를 만든다.
2. frontier, 결과 DB, OS 임시 캐시를 공유하지 않는다. 프로세스도 각각 새로 시작한다.
3. 순회 순서와 무관하도록 계층별 canonical key 해시를 정렬해 SHA-256 manifest를
   만든다.
4. 계층별 수치, 종결 사유 수, 최종 manifest 해시가 모두 같아야 통과한다.

중단된 대상도 같은 cap으로 독립 prefix 재실행해 마지막 완료 checkpoint 해시가
일치하는지 확인한다. 이는 결정성만 확인하며 완전 열거 acceptance를 충족한 것으로
표시하지 않는다.

## 중단 및 불가 판정

다음 중 하나가 발생하면 현재 각본을 즉시 checkpoint 후 중단하고 **완전 canonical
opening book 불가(이 프로필의 로컬 자원 범위)**로 판정한다.

- 고유 canonical 상태가 해당 프로필의 5백만/1천만 상한에 도달
- 검증된 전이가 5천만/1억 상한에 도달
- peak RSS 또는 디스크 사용량이 표의 상한에 도달
- wall time 상한에 도달
- 완전히 센 현재 frontier의 합법 자식 수만으로 다음 계층 전이가 전이 상한을 넘는
  것이 확정됨

조기 예측은 판정과 구분한다. 한 계층을 끝낸 뒤 frontier가 두 계층 연속 4배 이상
증가하고, 현재 처리량으로 남은 최소 두 계층의 하한이 시간·상태·전이 상한을 넘으면
`projected-infeasible`로 중단할 수 있다. 이 경우 보고서에는 관측값, 계산식, 마지막
완료 checkpoint를 남기며 수학적 완전 열거 불가가 아니라 **승인된 자원 프로필에서의
포기**라고 표시한다.

특히 P2/P3에서 첫날 공동 행동 폭이 수백억으로 투영되면 1억 전이를 생성하지 않는다.
완료한 부모 frontier의 정확한 자식 수와 남은 부모 수로 다음 계층 전이 하한이 1억을
넘는 순간 그 시나리오를 중단한다. 표본 평균만으로는 확정 판정을 하지 않고
`projected-infeasible`만 사용할 수 있다.

중단 뒤에는 더 큰 같은 세트 각본의 완전 열거를 건너뛴다. 다음 예약 대상에는 capped
diagnostic만 수행하고, 이후 평가는 전경 탐색(현재 날짜 종료까지)과 백그라운드 반복
심화의 깊이·처리량 측정으로 전환한다.

## 최종 게이트 판정

`firstSteps:2`의 P4-폐쇄 행동 동치류도 초기 P2 15,558개, 고정 P2의 P3 중앙값
10,567개로 확인됐다. 한 결정 상태의 동치류 곱만 약 1.64억이므로 완전 opening book과
전체 상태 공간 사전 열거는 이 프로필에서 **불가로 확정**한다.

명세 exit condition `feasibility_gated`는 벤치마크 실패 상태로 충족됐다. 완전 opening
book은 연구 가설로 남기되 통과하는 새 벤치마크가 나오기 전에는 휴리스틱을 제거하지
않는다. 후속 계측은 현재 상태에서 후보 몇 개를 비교하는 전경 탐색에 한정한다.
