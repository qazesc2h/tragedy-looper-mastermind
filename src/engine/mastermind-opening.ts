import { characterDataOf } from "../data";
import {
  type ActionCard,
  characterLocation,
  type GameState,
  isCharacterAlive,
  type Location,
  type PlacedCard,
  resolvePlaceX,
  type Target,
} from "../types";
import { validatePlacement } from "./legal";
import {
  mastermindGuidance,
  type GuidancePlacementNeed,
  type MastermindGuidanceRoute,
} from "./mastermind-guidance";
import {
  mastermindDecoyGuidance,
  type FakeLossCondition,
} from "./mastermind-decoys";
import {
  mastermindCoverGuidance,
  type MastermindCoverGuidance,
} from "./mastermind-cover";
import { destinationOf, type MoveCard } from "./movement";

export type OpeningTargetKind = "location" | "character";
export type OpeningContributionSource = "A" | "C";

export interface OpeningContribution {
  source: OpeningContributionSource;
  key: string;
  title: string;
  priority: number;
  targetKind: OpeningTargetKind;
  amount: number;
  reason: string;
}

export interface OpeningPlacement {
  card: ActionCard;
  cardLabel: string;
  target: Target;
  targetLabel: string;
  targetKind: OpeningTargetKind;
  contributions: OpeningContribution[];
  reason: string;
  protagonistResponse: string;
}

export interface OpeningProgress {
  primary: number;
  alternatives: number;
  decoys: number;
  total: number;
}

export interface OpeningProfile {
  key: string;
  placements: OpeningPlacement[];
  unopposed: OpeningProgress;
  guaranteed: OpeningProgress;
  worstResponse: string;
  concealmentTieBreak: number;
  concealment: string;
}

export interface ExcludedOpeningDecoy {
  key: string;
  title: string;
  reason: string;
}

export interface MastermindOpeningGuidance {
  horizonDays: 1;
  horizonReason: string;
  allP2Count: 63_360;
  contributingPlacementCount: number;
  candidateProfileCount: number;
  eligibleDecoyCount: number;
  excludedDecoys: ExcludedOpeningDecoy[];
  recommendations: OpeningProfile[];
  axisContract: string;
}

interface CandidatePlacement extends OpeningPlacement {
  key: string;
}

const LOCATION_LABELS: Readonly<Record<Location, string>> = {
  Hospital: "병원",
  Shrine: "신사",
  City: "도심",
  School: "학교",
};

const CARD_LABELS: Readonly<Partial<Record<ActionCard, string>>> = {
  intriguePlus1: "음모 +1",
  intriguePlus2: "음모 +2",
  paranoiaPlus1: "불안 +1",
  moveVertical: "이동↕",
  moveHorizontal: "이동↔",
  moveDiagonal: "이동⤢",
};

function targetKey(target: Target): string {
  return target.kind === "character"
    ? `character:${target.id}`
    : `location:${target.at}`;
}

function placementKey(card: ActionCard, target: Target): string {
  return `${card}|${targetKey(target)}`;
}

function targetLabel(target: Target): string {
  return target.kind === "character"
    ? characterDataOf(target.id).ko
    : LOCATION_LABELS[target.at];
}

function targetFromKey(state: GameState, key: string): Target | undefined {
  if (key.startsWith("character:")) {
    const id = key.slice("character:".length);
    const position = state.loop.board[id];
    return position !== undefined && isCharacterAlive(position) && id !== "illusion"
      ? { kind: "character", id }
      : undefined;
  }
  if (key === "location:X") {
    const at = resolvePlaceX(state);
    return at === undefined ? undefined : { kind: "location", at };
  }
  if (key.startsWith("location:")) {
    const raw = key.slice("location:".length);
    const at = (Object.keys(LOCATION_LABELS) as Location[]).find(
      (location) => location === raw,
    );
    return at === undefined ? undefined : { kind: "location", at };
  }
  return undefined;
}

function cardForResource(resource: string): ActionCard[] {
  if (resource === "card:intriguePlus1") return ["intriguePlus1"];
  if (resource === "card:intriguePlus2") return ["intriguePlus2"];
  if (resource.startsWith("card:paranoiaPlus1:")) return ["paranoiaPlus1"];
  if (resource === "card:movement") {
    return ["moveVertical", "moveHorizontal", "moveDiagonal"];
  }
  return [];
}

function routeCharacters(state: GameState, route: MastermindGuidanceRoute): string[] {
  return route.key.split(":").filter((part) => part in state.scenario.cast);
}

function movementDestination(
  state: GameState,
  route: MastermindGuidanceRoute,
  moving: string,
): Location | undefined {
  if (route.key.includes("hospitalIncident") || route.key.includes("Hospital")) {
    return "Hospital";
  }
  const counterpart = routeCharacters(state, route).find(
    (character) => character !== moving && isCharacterAlive(state.loop.board[character]),
  );
  return counterpart === undefined
    ? undefined
    : characterLocation(state.loop.board[counterpart], counterpart);
}

function movementContributes(
  state: GameState,
  route: MastermindGuidanceRoute,
  target: Target,
  card: ActionCard,
): boolean {
  if (target.kind !== "character") return false;
  if (card !== "moveVertical" && card !== "moveHorizontal" && card !== "moveDiagonal") {
    return false;
  }
  const desired = movementDestination(state, route, target.id);
  const position = state.loop.board[target.id];
  if (desired === undefined || !isCharacterAlive(position)) return false;
  const destination = destinationOf(position.at, card);
  return destination === desired &&
    !characterDataOf(target.id).forbiddenLocation.includes(destination);
}

function mergeCandidate(
  byKey: Map<string, CandidatePlacement>,
  card: ActionCard,
  target: Target,
  contribution: OpeningContribution,
): void {
  const key = placementKey(card, target);
  const previous = byKey.get(key);
  if (previous !== undefined) {
    if (!previous.contributions.some(({ key: existing }) => existing === contribution.key)) {
      previous.contributions.push(contribution);
    }
    return;
  }
  byKey.set(key, {
    key,
    card,
    cardLabel: CARD_LABELS[card] ?? card,
    target,
    targetLabel: targetLabel(target),
    targetKind: target.kind,
    contributions: [contribution],
    reason: contribution.reason,
    protagonistResponse: card === "intriguePlus1" || card === "intriguePlus2"
      ? "주인공 「음모 금지」가 그날 정확히 1장 활성화되면 막힌다. 2장 이상이면 금지끼리 상쇄된다."
      : card === "paranoiaPlus1"
      ? "같은 대상의 주인공 「불안 -1」로 당일 진척을 상쇄할 수 있다."
      : "같은 대상의 주인공 「이동 금지」로 막을 수 있다.",
  });
}

function addRouteCandidates(
  state: GameState,
  route: MastermindGuidanceRoute,
  priority: number,
  byKey: Map<string, CandidatePlacement>,
): void {
  const addNeed = (need: GuidancePlacementNeed): void => {
    const target = targetFromKey(state, need.targetKey);
    if (target === undefined) return;
    for (const card of cardForResource(need.resource)) {
      if (need.resource === "card:movement" &&
        !movementContributes(state, route, target, card)) continue;
      mergeCandidate(byKey, card, target, {
        source: "A",
        key: `A:${route.conditionKey}|${route.key}`,
        title: route.title,
        priority,
        targetKind: target.kind,
        amount: card === "intriguePlus2" ? 2 : 1,
        reason: need.resource === "card:movement"
          ? `${route.title}의 위치 관계를 시작 장소에서 한 칸 진척시킨다.`
          : `${route.title}의 ${target.kind === "location" ? "장소" : "캐릭터"} 기준 카운터를 ${card === "intriguePlus2" ? 2 : 1}칸 진척시킨다.`,
      });
    }
  };
  route.placementNeeds.forEach(addNeed);
}

function locationFromLabel(label: string): Location | undefined {
  return (Object.keys(LOCATION_LABELS) as Location[]).find(
    (location) => LOCATION_LABELS[location] === label,
  );
}

function decoyTargetCards(
  state: GameState,
  decoy: FakeLossCondition,
): Array<{ card: ActionCard; target: Target; amount: number; reason: string }> {
  const intrigueCards = (target: Target, detail: string) => [
    { card: "intriguePlus1" as const, target, amount: 1, reason: detail },
    { card: "intriguePlus2" as const, target, amount: 2, reason: detail },
  ];
  switch (decoy.explanationKey) {
    case "plot:lightAvenger":
    case "plot:placeProtect":
    case "plot:sealedItem":
    case "plot:giantTimeBomb":
      return decoy.targets.flatMap((label) => {
        const at = locationFromLabel(label);
        return at === undefined ? [] : intrigueCards(
          { kind: "location", at },
          `${decoy.title}로 설명 가능한 ${label}(장소) 음모 조건을 1일차에 진척시킨다.`,
        );
      });
    case "plot:signWithMe":
      return decoy.candidateCharacters.flatMap((id) => {
        const target = targetFromKey(state, `character:${id}`);
        return target === undefined ? [] : intrigueCards(
          target,
          `${decoy.title}의 소녀 핵심 인물 후보 ${characterDataOf(id).ko}(캐릭터) 음모 조건을 진척시킨다.`,
        );
      });
    case "plot:changeOfFuture": {
      const incident = state.scenario.incidents.find(
        ({ incident: id }) => id === "butterflyEffect",
      );
      if (incident === undefined) return [];
      const target = targetFromKey(state, `character:${incident.culprit}`);
      return target === undefined ? [] : [{
        card: "paranoiaPlus1",
        target,
        amount: 1,
        reason: `나비의 날갯짓 범인 ${characterDataOf(incident.culprit).ko}의 사건 발동 조건을 1칸 진척시킨다.`,
      }];
    }
    case "role:factor":
      return intrigueCards(
        { kind: "location", at: "City" },
        "언노운의 사망 조건 중 도심(장소) 음모 2개를 진척시킨다. 캐릭터 사망 조건은 별도로 남는다.",
      );
    case "role:killer":
      return decoy.candidateCharacters.flatMap((id) => {
        const target = targetFromKey(state, `character:${id}`);
        return target === undefined ? [] : intrigueCards(
          target,
          `살인 청부업자 후보 ${characterDataOf(id).ko} 본인(캐릭터) 음모 4 조건을 진척시킨다.`,
        );
      });
    case "role:lovedOne":
      return decoy.candidateCharacters.flatMap((id) => {
        const target = targetFromKey(state, `character:${id}`);
        return target === undefined ? [] : [
          ...intrigueCards(
            target,
            `연인A 후보 ${characterDataOf(id).ko} 본인(캐릭터)의 음모 조건을 진척시킨다.`,
          ),
          {
            card: "paranoiaPlus1" as const,
            target,
            amount: 1,
            reason: `연인A 후보 ${characterDataOf(id).ko} 본인(캐릭터)의 불안 조건을 진척시킨다.`,
          },
        ];
      });
    default:
      return [];
  }
}

function excludedDecoyReason(decoy: FakeLossCondition): string {
  switch (decoy.explanationKey) {
    case "role:keyPerson": return "1일차 행동 카드만으로 후보를 사망시킬 수 없어 즉시 진척 배치가 없다.";
    case "role:friend": return "1일차 행동 카드만으로 사망과 루프 종료 판정을 함께 진척시킬 수 없다.";
    case "role:timeTraveler": return "각본가 행동 카드로 낮은 우호 조건을 적극 진척시킬 수 없다.";
    default: return "카드 3장 안에서 해당 조건을 직접 진척시키는 1일차 배치가 없다.";
  }
}

function candidatePlacements(state: GameState): {
  candidates: CandidatePlacement[];
  eligibleDecoyCount: number;
  excludedDecoys: ExcludedOpeningDecoy[];
} {
  const byKey = new Map<string, CandidatePlacement>();
  const guidance = mastermindGuidance(state);
  if (guidance.primary !== undefined) addRouteCandidates(state, guidance.primary, 0, byKey);
  guidance.alternatives.forEach((route, index) =>
    addRouteCandidates(state, route, index + 1, byKey)
  );

  let eligibleDecoyCount = 0;
  const excludedDecoys: ExcludedOpeningDecoy[] = [];
  for (const decoy of mastermindDecoyGuidance(state).fakeLossConditions) {
    const placements = decoyTargetCards(state, decoy);
    if (placements.length === 0) {
      excludedDecoys.push({
        key: decoy.key,
        title: decoy.title,
        reason: excludedDecoyReason(decoy),
      });
      continue;
    }
    eligibleDecoyCount += 1;
    for (const placement of placements) {
      mergeCandidate(byKey, placement.card, placement.target, {
        source: "C",
        key: `C:${decoy.key}`,
        title: decoy.title,
        priority: 3,
        targetKind: placement.target.kind,
        amount: placement.amount,
        reason: placement.reason,
      });
    }
  }
  return { candidates: [...byKey.values()], eligibleDecoyCount, excludedDecoys };
}

function cardCapacityOk(placements: readonly CandidatePlacement[]): boolean {
  const counts = new Map<ActionCard, number>();
  for (const { card } of placements) counts.set(card, (counts.get(card) ?? 0) + 1);
  return [...counts].every(([card, count]) =>
    count <= (card === "paranoiaPlus1" ? 2 : 1)
  );
}

function profileIsLegal(state: GameState, placements: readonly CandidatePlacement[]): boolean {
  const projected = structuredClone(state);
  for (const placement of placements) {
    const card: PlacedCard = {
      owner: "mastermind",
      card: placement.card,
      target: placement.target,
    };
    if (!validatePlacement(projected, card).ok) return false;
    projected.loop.placed.push(card);
  }
  return true;
}

function progressOf(
  placements: readonly CandidatePlacement[],
  blocked: ReadonlySet<number>,
): OpeningProgress {
  let primary = 0;
  let alternatives = 0;
  let decoys = 0;
  placements.forEach((placement, index) => {
    if (blocked.has(index)) return;
    for (const contribution of placement.contributions) {
      if (contribution.source === "C") decoys += contribution.amount;
      else if (contribution.priority === 0) primary += contribution.amount;
      else alternatives += contribution.amount;
    }
  });
  return { primary, alternatives, decoys, total: primary + alternatives + decoys };
}

function compareProgress(left: OpeningProgress, right: OpeningProgress): number {
  return left.primary - right.primary ||
    left.alternatives - right.alternatives ||
    left.decoys - right.decoys ||
    left.total - right.total;
}

function worstProgress(placements: readonly CandidatePlacement[]): {
  progress: OpeningProgress;
  response: string;
} {
  const alwaysBlocked = new Set<number>();
  const intrigue: number[] = [];
  placements.forEach(({ card }, index) => {
    if (card === "intriguePlus1" || card === "intriguePlus2") intrigue.push(index);
    else alwaysBlocked.add(index);
  });
  const choices: Array<{ blocked: Set<number>; response: string }> = [
    { blocked: new Set(alwaysBlocked), response: "이동은 이동 금지, 불안은 불안 -1로 각각 상쇄" },
    ...intrigue.map((index) => ({
      blocked: new Set([...alwaysBlocked, index]),
      response: `${placements[index]?.targetLabel ?? "한 대상"}에 음모 금지 1장 집중`,
    })),
  ];
  return choices.reduce((worst, choice) => {
    const progress = progressOf(placements, choice.blocked);
    return compareProgress(progress, worst.progress) < 0
      ? { progress, response: choice.response }
      : worst;
  }, {
    progress: progressOf(placements, choices[0]?.blocked ?? new Set()),
    response: choices[0]?.response ?? "직접 상쇄 수단 없음",
  });
}

function concealmentTieBreak(
  cover: MastermindCoverGuidance,
  placements: readonly CandidatePlacement[],
): { score: number; text: string } {
  const routeTitles = new Set(placements.flatMap(({ contributions }) =>
    contributions.filter(({ source }) => source === "A").map(({ title }) => title)
  ));
  const protectedCandidates = cover.candidates.filter((candidate) =>
    candidate.mastermindPathCount > 0 &&
    candidate.affectedVictoryRoutes.some((title) => routeTitles.has(title))
  );
  if (protectedCandidates.length === 0) {
    return { score: 0, text: "역할 능력 대신 카드만 사용하므로 이 배치 자체로 역할은 드러나지 않는다." };
  }
  const rank = new Map(cover.candidates.map((candidate, index) => [
    candidate.character,
    cover.candidates.length - index,
  ]));
  return {
    score: protectedCandidates.reduce(
      (sum, candidate) => sum + (rank.get(candidate.character) ?? 0),
      0,
    ),
    text: `${protectedCandidates.map(({ characterName, roleName }) =>
      `${characterName}(${roleName})`
    ).join("·")}의 능력을 쓰지 않고 카드로 진척해 정체 노출을 아낀다. 대신 주인공 카드에 막힐 수 있다.`,
  };
}

function compareProfiles(left: OpeningProfile, right: OpeningProfile): number {
  return compareProgress(right.guaranteed, left.guaranteed) ||
    compareProgress(right.unopposed, left.unopposed) ||
    right.concealmentTieBreak - left.concealmentTieBreak ||
    left.key.localeCompare(right.key);
}

function profiles(state: GameState, candidates: readonly CandidatePlacement[]): OpeningProfile[] {
  const result: OpeningProfile[] = [];
  const cover = mastermindCoverGuidance(state);
  for (let first = 0; first < candidates.length; first += 1) {
    for (let second = first + 1; second < candidates.length; second += 1) {
      for (let third = second + 1; third < candidates.length; third += 1) {
        const selected = [candidates[first], candidates[second], candidates[third]];
        if (selected.some((candidate) => candidate === undefined)) continue;
        const concrete = selected as CandidatePlacement[];
        if (new Set(concrete.map(({ target }) => targetKey(target))).size !== 3 ||
          !cardCapacityOk(concrete) || !profileIsLegal(state, concrete)) continue;
        const worst = worstProgress(concrete);
        const concealment = concealmentTieBreak(cover, concrete);
        result.push({
          key: concrete.map(({ key }) => key).sort().join("|"),
          placements: concrete,
          unopposed: progressOf(concrete, new Set()),
          guaranteed: worst.progress,
          worstResponse: worst.response,
          concealmentTieBreak: concealment.score,
          concealment: concealment.text,
        });
      }
    }
  }
  return result.sort(compareProfiles);
}

/**
 * 모든 루프가 공유하는 1일차 시작 상태에서 한 번만 계산한다.
 * D는 후보를 늘리지 않고, 같은 진척의 후보를 정렬할 때만 사용한다.
 */
export function mastermindOpeningGuidance(state: GameState): MastermindOpeningGuidance {
  const generated = candidatePlacements(state);
  const candidateProfiles = profiles(state, generated.candidates);
  return {
    horizonDays: 1,
    horizonReason: `1일차 기여 배치 ${generated.candidates.length}개에서 합법적인 3장 조합 ${candidateProfiles.length}개를 전수 평가했다. 2일차는 각 조합마다 주인공 3장 대응 분기가 다시 곱해지므로 이번 정적 지침 범위에서 제외했다.`,
    allP2Count: 63_360,
    contributingPlacementCount: generated.candidates.length,
    candidateProfileCount: candidateProfiles.length,
    eligibleDecoyCount: generated.eligibleDecoyCount,
    excludedDecoys: generated.excludedDecoys,
    recommendations: candidateProfiles.slice(0, 3),
    axisContract: "224개 패배 위험 경로가 쓰는 목표를 장소 음모·캐릭터 음모·캐릭터 불안·위치 관계로 다시 나눴다. 음모 금지 상쇄는 그날 낸 장수를 전체로 세지만, 활성 금지는 카드를 놓은 대상에만 적용된다. 따라서 최악 대응은 음모 배치 한 곳과 모든 이동·불안 배치를 막는 것으로 계산한다.",
  };
}
