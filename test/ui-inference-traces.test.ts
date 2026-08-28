import { describe, expect, it } from "vitest";

import { groupInferenceTraces } from "../src/ui/inference-traces";

describe("role inference trace grouping", () => {
  it("groups repeated dates under the same conclusion and condition", () => {
    const groups = groupInferenceTraces([
      {
        conclusion: "형사 = 연쇄 살인마 아님",
        condition: "무녀가 불사가 아닐 때",
        reason: {
          type: "단둘 비사망",
          at: "1루프 2일",
          fact: "병원에서 무녀와 단둘, 사망 없음",
        },
      },
      {
        conclusion: "형사 = 연쇄 살인마 아님",
        condition: "무녀가 불사가 아닐 때",
        reason: {
          type: "단둘 비사망",
          at: "1루프 3일",
          fact: "병원에서 무녀와 단둘, 사망 없음",
        },
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      conclusion: "형사 = 연쇄 살인마 아님",
      condition: "무녀가 불사가 아닐 때",
      reasons: [{ at: "1루프 2일" }, { at: "1루프 3일" }],
      reasonTypes: [{
        type: "단둘 비사망",
        facts: [{
          fact: "병원에서 무녀와 단둘, 사망 없음",
          occurrences: ["1루프 2일", "1루프 3일"],
        }],
      }],
    });
  });

  it("keeps different conditions separate and different reason types together", () => {
    const groups = groupInferenceTraces([
      {
        conclusion: "무녀 = 흑막 아님",
        reason: {
          type: "위치 관측",
          at: "1루프 2일",
          fact: "관측 시점 병원에 없었음",
        },
      },
      {
        conclusion: "무녀 = 흑막 아님",
        reason: {
          type: "우호 반응",
          at: "2루프 1일",
          fact: "우호 능력이 거부되지 않음",
        },
      },
      {
        conclusion: "형사 = 연쇄 살인마 아님",
        condition: "무녀가 불사가 아닐 때",
        reason: { type: "단둘 비사망", at: "1루프 2일", fact: "사망 없음" },
      },
      {
        conclusion: "형사 = 연쇄 살인마 아님",
        condition: "학생 회장이 불사가 아닐 때",
        reason: { type: "단둘 비사망", at: "1루프 3일", fact: "사망 없음" },
      },
    ]);

    expect(groups).toHaveLength(3);
    expect(groups[0]?.reasonTypes.map(({ type }) => type)).toEqual([
      "위치 관측",
      "우호 반응",
    ]);
    expect(groups.slice(1).map(({ condition }) => condition)).toEqual([
      "무녀가 불사가 아닐 때",
      "학생 회장이 불사가 아닐 때",
    ]);
  });
});
