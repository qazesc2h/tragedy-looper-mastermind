import koTermsJson from "../../data/ko-terms.json";
import koRulesTextJson from "../../data/ko-rules-text.json";
import koTranslationsJson from "../../data/ko-translations.json";
import type { ActionCard } from "../types";

export type TermSection =
  | "characters"
  | "roles"
  | "incidents"
  | "plots"
  | "tragedySets"
  | "misc";

interface TermEntry {
  ko?: unknown;
}

const koTerms = koTermsJson as unknown as Record<
  TermSection,
  Record<string, TermEntry>
>;
const koTranslations = koTranslationsJson as unknown as Record<
  string,
  unknown
>;
const incidentRules = (
  koRulesTextJson as unknown as {
    incidents?: Record<string, { "사건 효과"?: unknown }>;
  }
).incidents;

/** 카드 원문을 키로 하는 축약형 번역. 빈 번역은 영문으로 폴백한다. */
export function translatedText(
  english: string,
  englishFallback = english,
): string {
  const ko = koTranslations[english];
  return typeof ko === "string" && ko.length > 0 ? ko : englishFallback;
}

/** 정발 용어가 없을 때만 호출자가 제공한 영문을 그대로 사용한다. */
export function term(
  section: TermSection,
  id: string,
  englishFallback = id,
): string {
  const ko = koTerms[section]?.[id]?.ko;
  return typeof ko === "string" && ko.length > 0
    ? ko
    : translatedText(englishFallback);
}

export function misc(id: string, englishFallback = id): string {
  return term("misc", id, englishFallback);
}

const actionCardTerms = (
  koTermsJson as unknown as {
    misc?: { actionCard?: Partial<Record<ActionCard, TermEntry>> };
  }
).misc?.actionCard;

export function actionCardTerm(
  id: ActionCard,
  englishFallback = id,
): string {
  const ko = actionCardTerms?.[id]?.ko;
  return typeof ko === "string" && ko.length > 0 ? ko : englishFallback;
}

const TOKEN_MISC_IDS: Readonly<Record<string, string>> = {
  goodwill: "Goodwill",
  intrigue: "Intrigue",
  paranoia: "Paranoia",
  student: "Student",
  girl: "Girl",
};

function tokenTerm(id: string): string | undefined {
  for (const section of [
    "characters",
    "roles",
    "incidents",
    "plots",
  ] as const) {
    const ko = koTerms[section]?.[id]?.ko;
    if (typeof ko === "string" && ko.length > 0) return ko;
  }

  const miscId = TOKEN_MISC_IDS[id];
  const ko = miscId === undefined ? undefined : koTerms.misc?.[miscId]?.ko;
  return typeof ko === "string" && ko.length > 0 ? ko : undefined;
}

/** 번역 뒤에도 보존된 :token:을 기존 정발 용어로 치환한다. */
export function gameText(english: string): string {
  return translatedText(english).replace(
    /:([A-Za-z][A-Za-z0-9]*):/g,
    (token, id: string) => tokenTerm(id) ?? token,
  );
}

/** 사건 해결 화면은 누락 없는 설명서 상세문을 우선하고 카드 번역을 폴백으로 쓴다. */
export function incidentRuleText(
  incident: string,
  englishDescriptions: readonly string[],
): string {
  const detail = incidentRules?.[incident]?.["사건 효과"];
  if (typeof detail === "string" && detail.length > 0) {
    return gameText(detail);
  }
  return englishDescriptions.map(gameText).join(" / ");
}
