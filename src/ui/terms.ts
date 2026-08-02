import koTermsJson from "../../data/ko-terms.json";

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

/** 정발 용어가 없을 때만 호출자가 제공한 영문을 그대로 사용한다. */
export function term(
  section: TermSection,
  id: string,
  englishFallback = id,
): string {
  const ko = koTerms[section]?.[id]?.ko;
  return typeof ko === "string" && ko.length > 0 ? ko : englishFallback;
}

export function misc(id: string, englishFallback = id): string {
  return term("misc", id, englishFallback);
}
