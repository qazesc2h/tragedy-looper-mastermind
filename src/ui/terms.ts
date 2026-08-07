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

/** 생성 데이터에 없는 기본편 UI 문구. 정발 데이터가 추가되면 그쪽이 우선한다. */
const MISC_KO_FALLBACKS: Readonly<Record<string, string>> = {
  "Leader": "리더",
  "Leader change": "리더 교대",
  "Counter": "카운터",
  "Location": "장소",
  "Target": "대상",
  "Spent": "소진",
  "Refuse": "거부",
  "Resolve": "해결",
  "Loop Judgment": "승패 판정",
  "Game Setup": "게임 준비",
  "Game Over": "게임 종료",
  "No effect": "효과 없음",
  "Cannot be refused": "거부 불가",
  "3 cards required": "카드 3장 필요",
  "6 cards required": "카드 6장 필요",
  "Activate": "발동",
  "Current turn": "현재 차례",
  "Days left": "남은 일수",
  "Invalid placement": "배치할 수 없음",
  "It is not this player's turn": "이 플레이어의 차례가 아님",
  "Next phase": "다음 단계",
  "Ready": "준비",
  "Result summary": "결과 요약",
  "Select": "선택",
  "Select a card": "카드 선택",
  "Select a card first": "카드를 먼저 선택",
  "Select a card, then select a target": "카드를 고른 뒤 대상을 선택",
  "Select a target": "대상 선택",
  "Snapshots": "기록",
  "None": "없음",
  "Other target": "다른 대상",
  "No character": "캐릭터 없음",
  "No available ability": "사용 가능한 능력 없음",
  "No eligible target": "가능한 대상 없음",
  "No loss condition": "패배 조건 없음",
  "No spent card to recover": "회수할 소진 카드 없음",
  "Turf target cannot be determined from the current state":
    "세력권 상태 미구현",
  "This ability requires multiple targets": "복수 대상 미지원",
};

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
  const ko = koTerms.misc?.[id]?.ko;
  if (typeof ko === "string" && ko.length > 0) return ko;
  return translatedText(id, MISC_KO_FALLBACKS[id] ?? englishFallback);
}

const actionCardTerms = (
  koTermsJson as unknown as {
    misc?: { actionCard?: Partial<Record<ActionCard, TermEntry>> };
  }
).misc?.actionCard;

export function actionCardTerm(
  id: ActionCard,
  englishFallback: string = id,
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

/** 개별 한국어 문구를 우선하고, 없을 때만 영문 키 번역을 사용한다. */
export function gameText(
  english: string,
  koreanOverride?: string | null,
): string {
  const localized = typeof koreanOverride === "string" &&
      koreanOverride.length > 0
    ? koreanOverride
    : translatedText(english);
  return localized.replace(
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
  return englishDescriptions.map((description) => gameText(description))
    .join(" / ");
}
