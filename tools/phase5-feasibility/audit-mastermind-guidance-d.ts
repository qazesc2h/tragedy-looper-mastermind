import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import basicScriptsJson from "../../data/basic-tragedy-scripts.json";
import {
  mastermindCoverGuidance,
  type MastermindCoverGuidance,
} from "../../src/engine/mastermind-cover";
import { createGameState } from "../../src/engine/game";
import { loadScenarioCatalog } from "../../src/scenario-catalog";
import { canonicalStringify } from "./canonical-state";
import { sha256 } from "./measure-action-equivalence";

interface OfficialDComparison {
  id: string;
  officialFocus: string;
  contribution: string;
  officialFinalCandidateRoles?: readonly string[];
  matched: (guidance: MastermindCoverGuidance) => boolean;
}

const OFFICIAL_D_COMPARISONS: readonly OfficialDComparison[] = [
  {
    id: "basicTragedy:1",
    officialFocus: "친구를 최후까지 숨기고, 연쇄 살인마는 노출 뒤 승리에 사용한다.",
    officialFinalCandidateRoles: ["friend"],
    contribution: "친구 사망의 직접 공개와 연쇄 살인마의 단둘이 강제 사망을 각각 강제 경로로 계산한다.",
    matched: ({ candidates }) =>
      candidates.some(({ role, exposurePaths }) =>
        role === "friend" && exposurePaths.some(({ key }) =>
          key === "role:friend:death-reveal"
        )
      ) && candidates.some(({ role, automaticPathCount }) =>
        role === "serialKiller" && automaticPathCount > 0
      ),
  },
  {
    id: "basicTragedy:8",
    officialFocus: "친구 또는 광신도를 숨기되, 흑막은 숨김보다 첫날부터 승리 진척에 쓴다.",
    officialFinalCandidateRoles: ["friend", "cultist"],
    contribution: "세 역할의 노출 경로와 흑막을 숨길 때 줄어드는 현재 승리 경로를 함께 표시한다.",
    matched: ({ candidates }) =>
      candidates.some(({ role }) => role === "friend") &&
      candidates.some(({ role, exposurePaths }) =>
        role === "cultist" && exposurePaths.some(({ key }) =>
          key === "role:cultist:ignore-forbid-intrigue"
        )
      ) && candidates.some(({ role, affectedVictoryRouteCount }) =>
        role === "brain" && affectedVictoryRouteCount > 0
      ),
  },
  {
    id: "basicTragedy:9",
    officialFocus: "마녀의 강제 우호 거부를 막고, 최후의 싸움에는 생존시키기 쉬운 친구를 숨긴다.",
    officialFinalCandidateRoles: ["friend"],
    contribution: "마녀의 실제 캐릭터에 거부 가능한 우호 능력이 있는지와 친구 사망 공개를 별도로 계산한다.",
    matched: ({ candidates }) =>
      candidates.some(({ role, exposurePaths }) =>
        role === "witch" && exposurePaths.some(({ key }) =>
          key.includes("mandatory-refusal")
        )
      ) && candidates.some(({ role, exposurePaths }) =>
        role === "friend" && exposurePaths.some(({ key }) =>
          key === "role:friend:death-reveal"
        )
      ),
  },
  {
    id: "basicTragedy:10",
    officialFocus: "쉬운 은폐 역할이 없으므로 시간 여행자·친구·광신도 중 하나를 상황에 따라 지킨다.",
    officialFinalCandidateRoles: ["timeTraveler", "friend", "cultist"],
    contribution: "세 역할 모두 어려움으로 분류하고 각각 우호 금지, 사망 공개, 강제 거부의 다른 비용을 표시한다.",
    matched: ({ candidates }) => ["timeTraveler", "friend", "cultist"].every(
      (role) => candidates.some((candidate) =>
        candidate.role === role && candidate.exposurePathCount > 0
      ),
    ) && candidates.some(({ role, difficulty }) =>
      role === "timeTraveler" && difficulty === "hard"
    ),
  },
  {
    id: "basicTragedy:11",
    officialFocus: "다른 역할이 드러나도 두 소녀 중 핵심 인물이 누구인지는 숨긴다.",
    officialFinalCandidateRoles: ["keyPerson"],
    contribution: "핵심 인물 사망 관측과 그 역할이 현재 룰 가설을 좁히는 파급을 명시한다.",
    matched: ({ candidates }) => candidates.some(({ role, activePlots }) =>
      role === "keyPerson" && activePlots.length > 0
    ),
  },
  {
    id: "basicTragedy:12",
    officialFocus: "엑스트라의 망상 확대 바이러스 변이 여부가 최후 추리의 핵심 관측이다.",
    contribution: "엑스트라마다 불안 3 변이·강제 사망 경로와 이를 막을 때 포기하는 미끼를 계산한다.",
    matched: ({ candidates }) => candidates.some(({ role, exposurePaths }) =>
      role === "person" && exposurePaths.some(({ key }) =>
        key === "plot:paranoia-virus:person-transformation"
      )
    ),
  },
  {
    id: "basicTragedy:13",
    officialFocus: "특정 은폐 답을 주지 않고 역할·사건의 얽힘을 직접 판단하게 한다.",
    contribution: "모든 캐릭터를 동일한 정적 축으로 비교하되 추천을 최적해로 단정하지 않는다.",
    matched: ({ candidates, recommendation }) =>
      candidates.length > 0 && recommendation !== undefined,
  },
  {
    id: "basicTragedy:14",
    officialFocus: "초반에는 연인A를 일부러 노출해 견제를 유도하고 흑막·선동가 능력은 승리에 사용한다.",
    contribution: "종반 승리를 위해 노출을 감수하는 원칙과 각 능력을 숨길 때 잃는 승리 경로 수를 병기한다.",
    matched: ({ latePrinciple, candidates }) =>
      latePrinciple.includes("노출을 감수") &&
      candidates.some(({ role, affectedVictoryRouteCount }) =>
        role === "brain" && affectedVictoryRouteCount > 0
      ) && candidates.some(({ role, affectedVictoryRouteCount }) =>
        role === "conspiracyTheorist" && affectedVictoryRouteCount > 0
      ),
  },
] as const;

function main(): void {
  const outputDirectory = process.argv[2];
  if (outputDirectory === undefined) {
    throw new Error("usage: vite-node audit-mastermind-guidance-d.ts OUTPUT_DIR");
  }
  mkdirSync(outputDirectory, { recursive: true });
  const catalog = loadScenarioCatalog();
  const scenarios = catalog.flatMap((entry) => entry.difficulties.map(
    (difficulty) => {
      const guidance = mastermindCoverGuidance(
        createGameState(difficulty.scenario),
      );
      return {
        key: `${entry.id}#difficulty-${difficulty.index + 1}`,
        hasFinalGuess: guidance.hasFinalGuess,
        castSize: Object.keys(difficulty.scenario.cast).length,
        candidateCount: guidance.candidates.length,
        recommendation: guidance.recommendation === undefined ? null : {
          character: guidance.recommendation.character,
          role: guidance.recommendation.role,
          difficulty: guidance.recommendation.difficulty,
          exposurePathCount: guidance.recommendation.exposurePathCount,
          affectedVictoryRouteCount:
            guidance.recommendation.affectedVictoryRouteCount,
        },
        hardCount: guidance.candidates.filter(({ difficulty: value }) =>
          value === "hard"
        ).length,
        controlledCount: guidance.candidates.filter(({ difficulty: value }) =>
          value === "controlled"
        ).length,
        passiveCount: guidance.candidates.filter(({ difficulty: value }) =>
          value === "passive"
        ).length,
      };
    }
  ));
  const officialComparison = OFFICIAL_D_COMPARISONS.map((comparison) => {
    const entry = catalog.find(({ id }) => id === comparison.id);
    if (entry === undefined) throw new Error(`missing ${comparison.id}`);
    const guidance = mastermindCoverGuidance(
      createGameState(entry.difficulties[0].scenario),
    );
    const rawIndex = Number(comparison.id.split(":")[1]) - 1;
    const raw = basicScriptsJson[rawIndex] as { mastermindHints?: unknown };
    return {
      id: comparison.id,
      officialFocus: comparison.officialFocus,
      contribution: comparison.contribution,
      matched: comparison.matched(guidance),
      mastermindHintsField: typeof raw.mastermindHints === "string"
        ? raw.mastermindHints
        : "<missing>",
      recommendation: guidance.recommendation === undefined
        ? null
        : `${guidance.recommendation.character}:${guidance.recommendation.role}`,
      recommendationMatchesOfficial: comparison.officialFinalCandidateRoles ===
          undefined
        ? null
        : guidance.recommendation !== undefined &&
          comparison.officialFinalCandidateRoles.includes(
            guidance.recommendation.role,
          ),
    };
  });
  const serialScenario = catalog.find(({ id }) => id === "basicTragedy:2");
  if (serialScenario === undefined) throw new Error("missing basicTragedy:2");
  const serialGuidance = mastermindCoverGuidance(
    createGameState(serialScenario.difficulties[0].scenario),
  );
  const serialKiller = serialGuidance.candidates.find(({ role }) =>
    role === "serialKiller"
  );
  const report = {
    bundledDifficultyCount: scenarios.length,
    completeRankingCount: scenarios.filter(({ castSize, candidateCount }) =>
      castSize === candidateCount
    ).length,
    officialMatchedCount: officialComparison.filter(({ matched }) => matched).length,
    officialPriorityComparableCount: officialComparison.filter(
      ({ recommendationMatchesOfficial }) =>
        recommendationMatchesOfficial !== null
    ).length,
    officialPriorityMatchedCount: officialComparison.filter(
      ({ recommendationMatchesOfficial }) => recommendationMatchesOfficial
    ).length,
    officialComparison,
    requestedNaughtyCatJudgment: {
      note: "못된 고양이는 정적 번들 제목에 없어, 같은 판단을 요구하는 연쇄 살인마 포함 시나리오에서 일반 판정을 검증했다.",
      proxyScenario: "basicTragedy:2",
      generated: serialKiller === undefined ? null : {
        difficulty: serialKiller.difficulty,
        automaticPathCount: serialKiller.automaticPathCount,
        reason: serialKiller.recommendationReason,
        avoidance: serialKiller.exposurePaths.find(({ key }) =>
          key === "role:serial-killer:forced-kill"
        )?.avoidance,
        sacrifice: serialKiller.exposurePaths.find(({ key }) =>
          key === "role:serial-killer:forced-kill"
        )?.sacrifice,
      },
      matched: serialKiller?.difficulty === "hard" &&
        serialKiller.recommendationReason.includes("후순위") === true,
    },
    scenarios,
  };
  const json = `${canonicalStringify(report)}\n`;
  writeFileSync(join(outputDirectory, "mastermind-guidance-d-audit.json"), json);
  const markdown = `# 지침 생성 D 검증\n\n` +
    `- 번들 난이도: ${report.bundledDifficultyCount}개\n` +
    `- 캐스트 전원 순위 생성: ${report.completeRankingCount}개\n` +
    `- 공식 은폐 메커니즘 회수: ${report.officialMatchedCount}/8\n` +
    `- 공식이 최종 후보를 명시한 편의 정적 1순위 일치: ${report.officialPriorityMatchedCount}/${report.officialPriorityComparableCount}\n` +
    `- 결정적 출력 SHA-256: \`${sha256(json)}\`\n\n` +
    `## 공식 기본편 8편 mastermindHints 대조\n\n` +
    officialComparison.map((row) =>
      `- **${row.id}** · 메커니즘 ${row.matched ? "회수" : "누락"}` +
      `${row.recommendationMatchesOfficial === null
        ? ""
        : ` · 최상위 후보 ${row.recommendationMatchesOfficial ? "일치" : "차이"}`}\n` +
      `  - 공식 초점: ${row.officialFocus}\n` +
      `  - D의 보완: ${row.contribution}\n`
    ).join("") +
    `\n## 사용자 시나리오 요청 판단\n\n` +
    `- 못된 고양이: ${report.requestedNaughtyCatJudgment.matched ? "판정 생성 확인" : "판정 누락"}\n` +
    `- 번들에 제목이 없어 프록시 ${report.requestedNaughtyCatJudgment.proxyScenario}에서 연쇄 살인마 일반 판정을 검증했다.\n` +
    `- 결과: ${report.requestedNaughtyCatJudgment.generated?.reason ?? "연쇄 살인마 없음"}\n`;
  writeFileSync(join(outputDirectory, "mastermind-guidance-d.md"), markdown);
  process.stdout.write(`${sha256(json)}\n`);
}

main();
