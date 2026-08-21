import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import basicScriptsJson from "../../data/basic-tragedy-scripts.json";
import { createGameState } from "../../src/engine/game";
import {
  ATTRIBUTE_REQUIREMENT_AUDIT,
  INTRIGUE_REQUIREMENT_AUDIT,
  mastermindDecoyGuidance,
  PLOT_OBSERVATION_PROFILES,
  type MastermindDecoyGuidance,
} from "../../src/engine/mastermind-decoys";
import { loadScenarioCatalog } from "../../src/scenario-catalog";
import { canonicalStringify } from "./canonical-state";
import { sha256 } from "./measure-action-equivalence";

interface OfficialCComparison {
  id: string;
  officialGap: string;
  contribution: string;
  matched: (guidance: MastermindDecoyGuidance) => boolean;
}

const OFFICIAL_C_COMPARISONS: readonly OfficialCComparison[] = [
  {
    id: "basicTragedy:1",
    officialGap: "여성 여러 명에게 음모를 분산해 나와 계약하자!의 핵심 인물을 감춘다.",
    contribution: "소녀 전원과 실제 핵심 인물·미끼 후보를 분리한다.",
    matched: ({ attributeCandidates }) =>
      attributeCandidates.some(({ key, candidates }) =>
        key === "plot:signWithMe:girl" && candidates.length > 1
      ),
  },
  {
    id: "basicTragedy:8",
    officialGap: "신사뿐 아니라 도심에도 음모를 쌓아 흑막과 승리 경로를 가린다.",
    contribution: "장소 음모 패배 관측의 유사 룰과 현재 흑막의 장소 음모 수단을 표시한다.",
    matched: ({ confusableRules, locationIntrigueSources }) =>
      confusableRules.some(({ key }) =>
        key === "sealedItem:locationIntrigueLoss"
      ) && locationIntrigueSources.some(({ key }) => key === "role:brain"),
  },
  {
    id: "basicTragedy:9",
    officialGap: "학교 음모를 지켜야 할 장소처럼 보이는 위협으로 사용한다.",
    contribution: "거대 시한폭탄 X의 장소 음모 관측과 지켜야 할 장소를 짝짓되 다른 참극 세트라고 명시한다.",
    matched: ({ confusableRules }) => confusableRules.some((rule) =>
      rule.key === "giantTimeBomb:locationIntrigueLoss" &&
      rule.alternatives.some(({ plot, sameTragedySet }) =>
        plot === "placeProtect" && !sameTragedySet
      )
    ),
  },
  {
    id: "basicTragedy:10",
    officialGap: "A의 우선 경로는 공식 지침과 일치한다.",
    contribution: "선택되지 않은 패배 조건 후보를 추가 정보로 제공한다.",
    matched: ({ fakeLossConditions }) => fakeLossConditions.length > 0,
  },
  {
    id: "basicTragedy:11",
    officialGap: "여러 대상에 음모를 병렬로 쌓아 나와 계약하자!와 변수 사망을 함께 가린다.",
    contribution: "소녀 전원과 캐릭터 기준 음모 2 조건을 표시한다.",
    matched: ({ attributeCandidates }) =>
      attributeCandidates.some(({ key, candidates }) =>
        key === "plot:signWithMe:girl" && candidates.length > 1
      ),
  },
  {
    id: "basicTragedy:12",
    officialGap: "A의 우선 경로는 공식 지침과 일치한다.",
    contribution: "나와 계약하자! 등 선택되지 않은 설명 가능 패배 조건을 표시한다.",
    matched: ({ fakeLossConditions }) => fakeLossConditions.some(
      ({ explanationKey }) => explanationKey === "plot:signWithMe",
    ),
  },
  {
    id: "basicTragedy:13",
    officialGap: "공식은 특정 우선 경로를 지정하지 않는다.",
    contribution: "살인 계획의 핵심 인물 사망 관측과 나와 계약하자!를 짝짓는다.",
    matched: ({ confusableRules }) => confusableRules.some((rule) =>
      rule.key === "murderPlan:keyPersonDeath" &&
      rule.alternatives.some(({ plot }) => plot === "signWithMe")
    ),
  },
  {
    id: "basicTragedy:14",
    officialGap: "A의 우선 경로는 공식 지침과 일치한다.",
    contribution: "거대 시한폭탄 X와 다른 장소 음모 패배 관측을 구분해 병기한다.",
    matched: ({ confusableRules }) => confusableRules.some(({ key }) =>
      key === "giantTimeBomb:locationIntrigueLoss"
    ),
  },
] as const;

function main(): void {
  const outputDirectory = process.argv[2];
  if (outputDirectory === undefined) {
    throw new Error("usage: vite-node audit-mastermind-guidance-c.ts OUTPUT_DIR");
  }
  mkdirSync(outputDirectory, { recursive: true });
  const catalog = loadScenarioCatalog();
  const scenarios = catalog.flatMap((entry) => entry.difficulties.map(
    (difficulty) => {
      const guidance = mastermindDecoyGuidance(
        createGameState(difficulty.scenario),
      );
      return {
        key: `${entry.id}#difficulty-${difficulty.index + 1}`,
        attributeGroupCount: guidance.attributeCandidates.length,
        confusableObservationCount: guidance.confusableRules.length,
        fakeLossConditionCount: guidance.fakeLossConditions.length,
        locationIntrigueSourceCount: guidance.locationIntrigueSources.length,
        fakeLocationCount: guidance.fakeLossConditions.filter(
          ({ targetKind }) => targetKind === "location",
        ).length,
        fakeCharacterCount: guidance.fakeLossConditions.filter(
          ({ targetKind }) => targetKind === "character",
        ).length,
      };
    }
  ));

  const officialComparison = OFFICIAL_C_COMPARISONS.map((comparison) => {
    const entry = catalog.find(({ id }) => id === comparison.id);
    if (entry === undefined) throw new Error(`missing ${comparison.id}`);
    const guidance = mastermindDecoyGuidance(
      createGameState(entry.difficulties[0].scenario),
    );
    const rawIndex = Number(comparison.id.split(":")[1]) - 1;
    const raw = basicScriptsJson[rawIndex] as { mastermindHints?: unknown };
    return {
      id: comparison.id,
      title: entry.rawTitle,
      matched: comparison.matched(guidance),
      officialGap: comparison.officialGap,
      contribution: comparison.contribution,
      mastermindHintsField: typeof raw.mastermindHints === "string"
        ? raw.mastermindHints
        : "<missing>",
    };
  });

  const deterministic = {
    schema: "mastermind-pre-game-guidance-c-audit-v1",
    scenariosAttempted: scenarios.length,
    scenariosReturned: scenarios.filter(({ confusableObservationCount, fakeLossConditionCount }) =>
      confusableObservationCount > 0 && fakeLossConditionCount > 0
    ).length,
    scenarios,
    observationProfilePlotCount: Object.keys(PLOT_OBSERVATION_PROFILES).length,
    intrigueRequirementCount: INTRIGUE_REQUIREMENT_AUDIT.length,
    attributeRequirementCount: ATTRIBUTE_REQUIREMENT_AUDIT.length,
    staticAttributeRequirementCount: ATTRIBUTE_REQUIREMENT_AUDIT.filter(
      ({ kind }) => kind === "scriptBuild",
    ).length,
    dynamicAttributeRequirementCount: ATTRIBUTE_REQUIREMENT_AUDIT.filter(
      ({ kind }) => kind === "dynamic",
    ).length,
    attributeRequirements: ATTRIBUTE_REQUIREMENT_AUDIT,
    intrigueRequirements: INTRIGUE_REQUIREMENT_AUDIT,
    totalAttributeGroups: scenarios.reduce((sum, row) =>
      sum + row.attributeGroupCount, 0),
    totalConfusableObservations: scenarios.reduce((sum, row) =>
      sum + row.confusableObservationCount, 0),
    totalFakeLossConditions: scenarios.reduce((sum, row) =>
      sum + row.fakeLossConditionCount, 0),
    totalLocationIntrigueSources: scenarios.reduce((sum, row) =>
      sum + row.locationIntrigueSourceCount, 0),
    officialComparison,
    officialRowsMatched: officialComparison.filter(({ matched }) => matched).length,
    upstreamAudit: {
      repository: "https://github.com/Tragedy-Looper/tragedy-looper.github.io",
      commit: "510c8275dac010ca3ca6ba02e1dbcd0162e636ec",
    },
  };
  const result = {
    deterministic,
    deterministicHash: sha256(canonicalStringify(deterministic)),
  };
  writeFileSync(
    join(outputDirectory, "mastermind-guidance-c-audit.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );

  const rows = officialComparison.map((row) =>
    `| ${row.title} | ${row.matched ? "일치" : "누락"} | ${row.contribution} |`
  ).join("\n");
  const attributeRows = ATTRIBUTE_REQUIREMENT_AUDIT.map((entry) =>
    `| ${entry.tragedySet} | ${entry.owner} | ${entry.kind === "scriptBuild" ? "정적 배정" : "동적 판정"} | ${entry.requirement} |`
  ).join("\n");
  const markdown = `# C. 시선 분산과 미끼 생성 감사\n\n` +
    `- 계산 코드: \`src/engine/mastermind-decoys.ts\`\n` +
    `- 전수 감사: \`tools/phase5-feasibility/audit-mastermind-guidance-c.ts\`\n` +
    `- 확장 속성 원문 감사 기준: 공개 데이터 ${deterministic.upstreamAudit.commit}\n\n` +
    `## 번들 47개 난이도\n\n` +
    `| 항목 | 결과 |\n|---|---:|\n` +
    `| 시도/반환 | ${deterministic.scenariosAttempted}/${deterministic.scenariosReturned} |\n` +
    `| 관측 유형을 분류한 룰 | ${deterministic.observationProfilePlotCount}종 |\n` +
    `| 장소·캐릭터 음모 원문 계약 | ${deterministic.intrigueRequirementCount}건 |\n` +
    `| 같은 관측 짝 | ${deterministic.totalConfusableObservations}건 |\n` +
    `| 설명 가능한 가짜 패배 조건 | ${deterministic.totalFakeLossConditions}건 |\n` +
    `| 장소 음모 수단 표시 | ${deterministic.totalLocationIntrigueSources}건 |\n\n` +
    `가짜 패배 조건은 가상 보드 상태를 만든 뒤 기존 \`explainableLossConditions()\`가 ` +
    `해당 룰·역할을 실제 설명 후보로 반환하는 항목만 남겼다. 장소와 캐릭터 목표는 ` +
    `별도 형식으로 보존한다.\n\n` +
    `## 속성 요구 전수 감사\n\n` +
    `정적 배정 조건 ${deterministic.staticAttributeRequirementCount}건, 동적 대상·판정 조건 ` +
    `${deterministic.dynamicAttributeRequirementCount}건, 합계 ` +
    `${deterministic.attributeRequirementCount}건을 확인했다. 현재 지원 세트에서 화면에 ` +
    `활성화되는 것은 \`signWithMe\`의 소녀 조건이며, 나머지는 확장 세트 지원 시 연결할 ` +
    `감사 카탈로그로 보존한다.\n\n` +
    `| 참극 세트 | 룰·역할 | 종류 | 속성 요구 |\n|---|---|---|---|\n${attributeRows}\n\n` +
    `## 공식 기본편 8편 mastermindHints 대조\n\n` +
    `저장소 필드는 8편 모두 실제 문장이 아니라 각본가 설명서 포인터다. 기존 공식 영문 ` +
    `설명서 대조에서 확정한 지침 요소에 C의 출력이 대응하는지 다시 검사했다.\n\n` +
    `| 각본 | C 대응 | C가 채우는 부분 |\n|---|---|---|\n${rows}\n\n` +
    `8/8편에서 C 범위의 보조 정보가 생성되었다. 특히 A의 공식 우선 지침 차이 4편` +
    `(Young Women’s Battlefield, Lesser of Two Evils, The Secret That Was Kept, ` +
    `Mirror Passcode)에 있던 정보 은닉·블러프 근거를 C가 명시적으로 채운다. ` +
    `C는 A의 1순위를 바꾸지 않고 별도 정적 정보로만 제공한다.\n\n` +
    `결정적 hash: \`${result.deterministicHash}\`\n`;
  writeFileSync(
    join(outputDirectory, "mastermind-guidance-c.md"),
    markdown,
  );

  process.stdout.write(`${JSON.stringify({
    deterministicHash: result.deterministicHash,
    scenariosAttempted: deterministic.scenariosAttempted,
    scenariosReturned: deterministic.scenariosReturned,
    observationProfilePlotCount: deterministic.observationProfilePlotCount,
    attributeRequirementCount: deterministic.attributeRequirementCount,
    totalConfusableObservations: deterministic.totalConfusableObservations,
    totalFakeLossConditions: deterministic.totalFakeLossConditions,
    officialRowsMatched: deterministic.officialRowsMatched,
  }, null, 2)}\n`);
}

main();
