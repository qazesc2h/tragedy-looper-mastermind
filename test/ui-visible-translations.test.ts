import { describe, expect, it } from "vitest";

import { misc } from "../src/ui/terms";

describe("explicit UI translation fallbacks", () => {
  it("uses the user-specified labels missing from generated translation data", () => {
    expect(misc("Spent cards", "소진 카드")).toBe("소진 카드");
    expect(misc("Alive", "생존")).toBe("생존");
    expect(misc("Dead", "사망")).toBe("사망");
  });

  it("uses the existing official label for the final guess screen", () => {
    expect(misc("Final Guess", "임시 번역")).toBe("최후의 싸움");
  });

  it.each([
    ["Leader", "리더"],
    ["Leader change", "리더 교대"],
    ["Counter", "카운터"],
    ["Location", "장소"],
    ["Target", "대상"],
    ["Spent", "소진"],
    ["Refuse", "거부"],
    ["Resolve", "해결"],
    ["Loop Judgment", "승패 판정"],
    ["Game Setup", "게임 준비"],
    ["Game Over", "게임 종료"],
    ["No effect", "효과 없음"],
    ["Cannot be refused", "거부 불가"],
  ])("uses the specified game term for %s", (english, korean) => {
    expect(misc(english)).toBe(korean);
  });

  it.each([
    ["3 cards required", "카드 3장 필요"],
    ["6 cards required", "카드 6장 필요"],
    ["Activate", "발동"],
    ["Current turn", "현재 차례"],
    ["Days left", "남은 일수"],
    ["Invalid placement", "배치할 수 없음"],
    ["It is not this player's turn", "이 플레이어의 차례가 아님"],
    ["Next phase", "다음 단계"],
    ["Ready", "준비"],
    ["Result summary", "결과 요약"],
    ["Select", "선택"],
    ["Select a card", "카드 선택"],
    ["Select a card first", "카드를 먼저 선택"],
    ["Select a card, then select a target", "카드를 고른 뒤 대상을 선택"],
    ["Select a target", "대상 선택"],
    ["Snapshots", "기록"],
    ["None", "없음"],
    ["Other target", "다른 대상"],
    ["No character", "캐릭터 없음"],
    ["No available ability", "사용 가능한 능력 없음"],
    ["No eligible target", "가능한 대상 없음"],
    ["No loss condition", "패배 조건 없음"],
    ["No spent card to recover", "회수할 소진 카드 없음"],
  ])("uses the specified compact UI label for %s", (english, korean) => {
    expect(misc(english)).toBe(korean);
  });

  it.each([
    ["This ability requires multiple targets", "복수 대상 미지원"],
  ])("uses the compact diagnostic for %s", (english, korean) => {
    expect(misc(english)).toBe(korean);
  });
});
