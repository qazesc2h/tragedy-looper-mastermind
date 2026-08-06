export interface CharacterChipLayoutViolation {
  character: string;
  element:
    | "wrap"
    | "chip"
    | "chip-content"
    | "counters"
    | "counters-content"
    | "counter";
  left: number;
  right: number;
  parentLeft: number;
  parentRight: number;
}

const TOLERANCE_PX = 0.5;

export function horizontallyContained(
  left: number,
  right: number,
  parentLeft: number,
  parentRight: number,
): boolean {
  return left >= parentLeft - TOLERANCE_PX &&
    right <= parentRight + TOLERANCE_PX;
}

function horizontalViolation(
  character: string,
  element: CharacterChipLayoutViolation["element"],
  rect: DOMRect,
  parentRect: DOMRect,
): CharacterChipLayoutViolation | undefined {
  if (horizontallyContained(
    rect.left,
    rect.right,
    parentRect.left,
    parentRect.right,
  )) {
    return undefined;
  }
  return {
    character,
    element,
    left: rect.left,
    right: rect.right,
    parentLeft: parentRect.left,
    parentRight: parentRect.right,
  };
}

/** 실제 렌더 좌표로 캐릭터 칩과 카운터가 부모 경계를 넘는지 검사한다. */
export function characterChipLayoutViolations(
  root: ParentNode,
): CharacterChipLayoutViolation[] {
  const violations: CharacterChipLayoutViolation[] = [];

  for (const grid of root.querySelectorAll(".character-grid")) {
    const gridRect = grid.getBoundingClientRect();
    for (const wrap of grid.querySelectorAll(".character-chip-wrap")) {
      const chip = wrap.querySelector(".character-chip");
      const counters = wrap.querySelector(".character-chip-counters");
      if (!chip || !counters) continue;
      const character = chip.getAttribute("aria-label") ?? "unknown";
      const wrapViolation = horizontalViolation(
        character,
        "wrap",
        wrap.getBoundingClientRect(),
        gridRect,
      );
      if (wrapViolation) violations.push(wrapViolation);

      const chipRect = chip.getBoundingClientRect();
      const chipViolation = horizontalViolation(
        character,
        "chip",
        chipRect,
        wrap.getBoundingClientRect(),
      );
      if (chipViolation) violations.push(chipViolation);
      if (chip.scrollWidth > chip.clientWidth + TOLERANCE_PX) {
        violations.push({
          character,
          element: "chip-content",
          left: chipRect.left,
          right: chipRect.left + chip.scrollWidth,
          parentLeft: chipRect.left,
          parentRight: chipRect.right,
        });
      }

      const countersRect = counters.getBoundingClientRect();
      const countersViolation = horizontalViolation(
        character,
        "counters",
        countersRect,
        chipRect,
      );
      if (countersViolation) violations.push(countersViolation);
      if (counters.scrollWidth > counters.clientWidth + TOLERANCE_PX) {
        violations.push({
          character,
          element: "counters-content",
          left: countersRect.left,
          right: countersRect.left + counters.scrollWidth,
          parentLeft: countersRect.left,
          parentRight: countersRect.right,
        });
      }

      for (const counter of counters.children) {
        const counterViolation = horizontalViolation(
          character,
          "counter",
          counter.getBoundingClientRect(),
          countersRect,
        );
        if (counterViolation) violations.push(counterViolation);
      }
    }
  }

  return violations;
}
