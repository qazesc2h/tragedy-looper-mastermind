import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { characterDataOf } from "../../src/data";
import { createGameState } from "../../src/engine/game";
import {
  mastermindCautions,
  type MastermindCautions,
} from "../../src/engine/mastermind-cautions";
import { loadScenarioCatalog } from "../../src/scenario-catalog";
import { TRAIT_IMPL } from "../../src/impl/traits";
import { canonicalStringify } from "./canonical-state";
import { sha256 } from "./measure-action-equivalence";

interface OfficialCautionExpectation {
  label: string;
  matches: (cautions: MastermindCautions) => boolean;
}

const cautionKey = (label: string, key: string): OfficialCautionExpectation => ({
  label,
  matches: (cautions) => [
    ...cautions.identityExposure,
    ...cautions.uncontrolledRisks,
    ...cautions.protagonistTools,
  ].some((caution) => caution.key === key),
});

const cautionPrefix = (
  label: string,
  prefix: string,
): OfficialCautionExpectation => ({
  label,
  matches: (cautions) => [
    ...cautions.identityExposure,
    ...cautions.uncontrolledRisks,
    ...cautions.protagonistTools,
  ].some(({ key }) => key.startsWith(prefix)),
});

const OFFICIAL_CAUTION_EXPECTATIONS: Readonly<Record<
  string,
  OfficialCautionExpectation[]
>> = {
  "basicTragedy:1": [
    cautionPrefix("연쇄 살인마 강제 발동", "risk:serial-killer:"),
    cautionPrefix("핵심 인물 즉시 종료", "risk:key-person:"),
    cautionPrefix("친구 사망 공개", "risk:friend:"),
    cautionKey("연쇄 살인마의 계획 중단", "risk:self-sabotage:serial-key-person"),
  ],
  "basicTragedy:8": [
    cautionPrefix("연쇄 살인마 강제 발동", "risk:serial-killer:"),
    cautionPrefix("변수 조건부 능력", "risk:factor:"),
    cautionPrefix("친구 사망 공개", "risk:friend:"),
  ],
  "basicTragedy:9": [
    cautionPrefix("마녀의 절대 우호 무시", "identity:mandatory-refusal:"),
    cautionPrefix("친구 사망 공개", "risk:friend:"),
    cautionPrefix("병원 사건 강제 효과", "risk:incident:4:hospitalIncident:"),
    cautionKey("인과율", "risk:plot:threads-fate"),
  ],
  "basicTragedy:10": [
    cautionPrefix("시간 여행자 우호 금지 무시", "identity:time-traveler:"),
    cautionPrefix("연쇄 살인마 강제 발동", "risk:serial-killer:"),
    cautionKey("연인 연쇄 불안", "risk:lovers:counterpart-death"),
    cautionPrefix("친구 사망 공개", "risk:friend:"),
  ],
  "basicTragedy:11": [
    cautionPrefix("변수 조건부 능력", "risk:factor:"),
    cautionKey("망상 확대 바이러스", "risk:plot:paranoia-virus"),
    cautionPrefix("핵심 인물 즉시 종료", "risk:key-person:"),
    cautionPrefix("병원 사건 강제 효과", "risk:incident:5:hospitalIncident:"),
  ],
  "basicTragedy:12": [
    cautionPrefix("시간 여행자 우호 금지 무시", "identity:time-traveler:"),
    cautionKey("인과율", "risk:plot:threads-fate"),
    cautionKey("망상 확대 바이러스", "risk:plot:paranoia-virus"),
    cautionKey("하수인 사건 억제", "tool:goodwill:henchman:1"),
  ],
  "basicTragedy:13": [
    cautionPrefix("핵심 인물 즉시 종료", "risk:key-person:"),
    cautionPrefix("친구 사망 공개", "risk:friend:"),
    cautionKey("연인 연쇄 불안", "risk:lovers:counterpart-death"),
    cautionKey("청부업자 경로 중단", "risk:self-sabotage:killer-route"),
  ],
  "basicTragedy:14": [
    cautionPrefix("마녀의 절대 우호 무시", "identity:mandatory-refusal:"),
    cautionKey("연인 연쇄 불안", "risk:lovers:counterpart-death"),
    cautionKey("신의 지연 등장", "risk:trait:entry:godlyBeing"),
  ],
};

const A_PRIORITY_GAPS = new Set([
  "basicTragedy:1",
  "basicTragedy:8",
  "basicTragedy:9",
  "basicTragedy:11",
]);

function main(): void {
  const outputDirectory = process.argv[2];
  if (outputDirectory === undefined) {
    throw new Error("usage: vite-node audit-mastermind-cautions.ts OUTPUT_DIR");
  }
  mkdirSync(outputDirectory, { recursive: true });

  const catalog = loadScenarioCatalog();
  const scenarios = catalog.flatMap((entry) => entry.difficulties.map(
    (difficulty) => {
      const state = createGameState(difficulty.scenario);
      const cautions = mastermindCautions(state);
      const expectedGoodwillTools = Object.keys(state.scenario.cast).reduce(
        (sum, character) => sum + characterDataOf(character).goodwillAbilities
          .filter(({ rank }) => rank !== null).length,
        0,
      );
      const goodwillTools = cautions.protagonistTools.filter(
        ({ key }) => key.startsWith("tool:goodwill:"),
      ).length;
      return {
        key: `${entry.id}#difficulty-${difficulty.index + 1}`,
        identityExposure: cautions.identityExposure.length,
        uncontrolledRisks: cautions.uncontrolledRisks.length,
        protagonistTools: cautions.protagonistTools.length,
        expectedGoodwillTools,
        goodwillTools,
        total: cautions.total,
      };
    }
  ));

  const selectedCharacters = new Set(catalog.flatMap((entry) =>
    entry.difficulties.flatMap(({ scenario }) => Object.keys(scenario.cast))
  ));
  const selectedTraits = Object.keys(TRAIT_IMPL).filter((character) =>
    selectedCharacters.has(character)
  ).sort();
  const selectedRoles = new Set(catalog.flatMap((entry) =>
    entry.difficulties.flatMap(({ scenario }) => Object.values(scenario.cast))
  ));
  const reviewedForcedRoles = [...selectedRoles].filter(
    (role) => role !== "person" && role !== "curmudgeon",
  ).sort();
  const selectedIncidents = [...new Set(catalog.flatMap((entry) =>
    entry.difficulties.flatMap(({ scenario }) =>
      scenario.incidents.map(({ incident }) => incident)
    )
  ))].sort();
  const selectedPlots = [...new Set(catalog.flatMap((entry) =>
    entry.difficulties.flatMap(({ scenario }) => [
      scenario.mainPlot,
      ...scenario.subPlots,
    ])
  ))].sort();

  const officialComparison = Object.entries(OFFICIAL_CAUTION_EXPECTATIONS).map(
    ([id, expectations]) => {
      const entry = catalog.find((candidate) => candidate.id === id);
      if (entry === undefined) throw new Error(`missing official scenario ${id}`);
      const cautions = mastermindCautions(createGameState(
        entry.difficulties[0].scenario,
      ));
      const checks = expectations.map(({ label, matches }) => ({
        label,
        matched: matches(cautions),
      }));
      return {
        id,
        title: entry.rawTitle,
        expectedCautions: checks.length,
        matchedCautions: checks.filter(({ matched }) => matched).length,
        missing: checks.filter(({ matched }) => !matched).map(({ label }) => label),
        wasAPriorityGap: A_PRIORITY_GAPS.has(id),
      };
    },
  );

  const deterministic = {
    schema: "mastermind-pre-game-cautions-audit-v1",
    scenariosAttempted: scenarios.length,
    scenariosReturned: scenarios.filter(({ total }) => total > 0).length,
    scenariosWithNoCaution: scenarios.filter(({ total }) => total === 0)
      .map(({ key }) => key),
    scenariosWithMissingGoodwillTool: scenarios.filter(
      ({ expectedGoodwillTools, goodwillTools }) =>
        expectedGoodwillTools !== goodwillTools,
    ).map(({ key }) => key),
    totalIdentityExposure: scenarios.reduce(
      (sum, { identityExposure }) => sum + identityExposure,
      0,
    ),
    totalUncontrolledRisks: scenarios.reduce(
      (sum, { uncontrolledRisks }) => sum + uncontrolledRisks,
      0,
    ),
    totalProtagonistTools: scenarios.reduce(
      (sum, { protagonistTools }) => sum + protagonistTools,
      0,
    ),
    sourceUniverse: {
      forcedRolesReviewed: reviewedForcedRoles,
      selectedTraitRecordsReviewed: selectedTraits,
      incidentsReviewed: selectedIncidents,
      plotsReviewed: selectedPlots,
    },
    scenarios,
    officialComparison,
    officialCautionsExpected: officialComparison.reduce(
      (sum, { expectedCautions }) => sum + expectedCautions,
      0,
    ),
    officialCautionsMatched: officialComparison.reduce(
      (sum, { matchedCautions }) => sum + matchedCautions,
      0,
    ),
    aPriorityGapsWithBMatches: officialComparison.filter(
      ({ wasAPriorityGap, missing }) => wasAPriorityGap && missing.length === 0,
    ).length,
  };
  const result = {
    deterministic,
    deterministicHash: sha256(canonicalStringify(deterministic)),
  };
  writeFileSync(
    join(outputDirectory, "mastermind-cautions-audit.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );

  const officialRows = officialComparison.map((row) =>
    `| ${row.title} | ${row.matchedCautions}/${row.expectedCautions} | ${
      row.missing.length === 0 ? "일치" : `누락: ${row.missing.join(" · ")}`
    }${row.wasAPriorityGap ? " · A 우선순위 차이편" : ""} |`
  ).join("\n");
  const markdown = `# B. 시나리오별 주의사항 생성 감사

- 실행일: 2026-08-21
- 계산 코드: \`src/engine/mastermind-cautions.ts\`
- 전수 감사: \`tools/phase5-feasibility/audit-mastermind-cautions.ts\`

## 규칙 원문 전수 확인

번들에서 실제 선택되는 역할 중 능력이 없는 엑스트라·골칫거리를 뺀 역할 ${reviewedForcedRoles.length}종,
캐스트에 실제 포함되는 특성 원문 ${selectedTraits.length}종, 사건 ${selectedIncidents.length}종,
룰 ${selectedPlots.length}종을 훑었다. 요청서의 ‘특성 11종’과 달리 현재 번들에는 모방자 특성까지
포함되어 원본 레코드가 12종이다. 모방자는 시나리오 작성 특성뿐이지만 거부 불가 [우호3]은
주인공 수단으로 표시한다. 룰도 현재 번들이 실제 선택하는 16종 전체를 감사했다.

## 번들 47개 난이도

| 항목 | 결과 |
|---|---:|
| 시도/반환 | ${deterministic.scenariosAttempted}/${deterministic.scenariosReturned} |
| 경고 0개 시나리오 | ${deterministic.scenariosWithNoCaution.length} |
| 정체 노출 경고 합계 | ${deterministic.totalIdentityExposure} |
| 통제 불가능·실수 위험 합계 | ${deterministic.totalUncontrolledRisks} |
| 주인공 수단 합계 | ${deterministic.totalProtagonistTools} |
| 누락된 캐스트 우호 능력 | ${deterministic.scenariosWithMissingGoodwillTool.length} |

각 난이도에서 캐스트의 랭크가 있는 우호 능력을 전부 다시 세어 생성 행과 비교했다.
47개 모두 일치했고 실행 예외가 없었다.

## 공식 기본편 8편 대조

| 각본 | 공식 주의 메커니즘 | B 대조 |
|---|---:|---|
${officialRows}

공식 지침에서 B 범위에 해당하는 강제 발동·정체 노출·주인공 수단 ${deterministic.officialCautionsExpected}개를
대조해 ${deterministic.officialCautionsMatched}/${deterministic.officialCautionsExpected}개가 생성되었다.
A의 우선 지침 차이 4편 모두에서 공식이 함께 경고한 B 요소가 생성되었다. 이는 A의 거리 기반
1순위를 바꾸는 보정이 아니라, 각본가가 그 경로를 실행할 때 읽어야 하는 사고·정보 노출 경고를
별도 층으로 채운 것이다.

결정적 hash: \`${result.deterministicHash}\`
`;
  writeFileSync(
    join(outputDirectory, "mastermind-guidance-b.md"),
    markdown,
  );

  process.stdout.write(`${JSON.stringify({
    deterministicHash: result.deterministicHash,
    scenariosAttempted: deterministic.scenariosAttempted,
    scenariosReturned: deterministic.scenariosReturned,
    scenariosWithNoCaution: deterministic.scenariosWithNoCaution,
    scenariosWithMissingGoodwillTool:
      deterministic.scenariosWithMissingGoodwillTool,
    sourceUniverseCounts: {
      forcedRolesReviewed: reviewedForcedRoles.length,
      selectedTraitRecordsReviewed: selectedTraits.length,
      incidentsReviewed: selectedIncidents.length,
      plotsReviewed: selectedPlots.length,
    },
    officialCautionsExpected: deterministic.officialCautionsExpected,
    officialCautionsMatched: deterministic.officialCautionsMatched,
    aPriorityGapsWithBMatches: deterministic.aPriorityGapsWithBMatches,
  }, null, 2)}\n`);
}

main();
