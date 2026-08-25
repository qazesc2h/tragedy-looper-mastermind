import { characterDataOf, type GoodwillAbilityData } from "../data";
import { PLOT_IMPL } from "../impl/plots";
import { ROLE_IMPL } from "../impl/roles";
import { tragedySetDefinition } from "../tragedy-sets";
import {
  effectiveRole,
  type CharacterId,
  type GameState,
  LOCATIONS,
  type RoleId,
} from "../types";
import {
  mastermindGuidance,
  type MastermindGuidanceRoute,
} from "./mastermind-guidance";

export type CoverDifficulty = "hard" | "controlled" | "passive";
export type ExposureControl = "automatic" | "mastermind" | "protagonist";

export interface RoleExposurePath {
  key: string;
  title: string;
  observation: string;
  control: ExposureControl;
  avoidable: boolean;
  avoidance: string;
  sacrifice: string;
}

export interface RoleCoverCandidate {
  character: CharacterId;
  characterName: string;
  role: RoleId;
  roleName: string;
  baseDifficulty: CoverDifficulty;
  difficulty: CoverDifficulty;
  difficultyLabel: string;
  alreadyRevealed: boolean;
  exposurePaths: RoleExposurePath[];
  exposurePathCount: number;
  automaticPathCount: number;
  mastermindPathCount: number;
  protagonistPathCount: number;
  affectedVictoryRouteCount: number;
  affectedVictoryRoutes: string[];
  activePlots: string[];
  possiblePlotCount: number;
  plotExposure: string;
  recommendationReason: string;
}

export interface CommonRoleExposure {
  key: string;
  title: string;
  observation: string;
  targetCharacterNames: string[];
  excludedCharacterNames: string[];
}

export interface MastermindCoverGuidance {
  hasFinalGuess: boolean;
  earlyPrinciple: string;
  latePrinciple: string;
  finalDefensePrinciple: string;
  commonExposure: CommonRoleExposure[];
  recommendation?: RoleCoverCandidate;
  candidates: RoleCoverCandidate[];
}

const BASE_DIFFICULTY: Readonly<Partial<Record<RoleId, CoverDifficulty>>> = {
  curmudgeon: "controlled",
  keyPerson: "controlled",
  killer: "controlled",
  brain: "controlled",
  cultist: "controlled",
  timeTraveler: "hard",
  witch: "passive",
  friend: "hard",
  conspiracyTheorist: "controlled",
  lover: "hard",
  lovedOne: "hard",
  serialKiller: "hard",
  factor: "hard",
};

function difficultyLabel(difficulty: CoverDifficulty): string {
  switch (difficulty) {
    case "hard": return "숨기기 어려움";
    case "controlled": return "숨기기 쉬움";
    case "passive": return "가장 숨기기 쉬움";
  }
}

function wasRevealed(state: GameState, character: CharacterId): boolean {
  return Boolean(
    state.loop.revealedRoleCharacters?.includes(character) ||
    state.history.some((loop) =>
      loop.revealedRoleCharacters?.includes(character)
    ),
  );
}

function isRefusable(ability: GoodwillAbilityData): boolean {
  return ability.rank !== null && !ability.immuneToGoodwillRefusel &&
    !ability.en.toLowerCase().includes("cannot be refused");
}

function goodwillAbilityCondition(ability: GoodwillAbilityData): string {
  const locations: Readonly<Record<string, string>> = {
    Hospital: "병원", Shrine: "신사", City: "도심", School: "학교",
  };
  const conditions = [
    `우호 ${ability.rank ?? "-"}`,
    ...(ability.minLoop === null ? [] : [`${ability.minLoop}루프부터`]),
    ...(ability.restrictedToLocation === null
      ? []
      : [`${ability.restrictedToLocation.map((location) =>
        locations[location] ?? location
      ).join("/")}에서만`]),
    ...(ability.timesPerLoop === null
      ? []
      : [`루프당 ${ability.timesPerLoop}회`]),
  ];
  return conditions.join(" · ");
}

function roleRevealAbilityTargets(
  state: GameState,
  user: CharacterId,
  target: CharacterId,
  ability: GoodwillAbilityData,
): boolean {
  const text = ability.en.toLowerCase();
  if (!text.includes("role")) return false;
  if (
    text.includes("own role") ||
    text.includes("this character's role") ||
    text.includes("this character’s role")
  ) {
    return user === target;
  }
  if (text.includes("one student") &&
    !characterDataOf(target).tags.includes("student")) {
    return false;
  }
  if (text.includes("another character") && user === target) return false;
  if (text.includes("same role as")) {
    return effectiveRole(state, user) === effectiveRole(state, target);
  }
  return true;
}

function canShareRequiredLocation(
  user: CharacterId,
  target: CharacterId,
  ability: GoodwillAbilityData,
): boolean {
  const text = ability.en.toLowerCase();
  if (!text.includes("same location") && !text.includes("this location")) {
    return true;
  }
  const userData = characterDataOf(user);
  const targetData = characterDataOf(target);
  return LOCATIONS.some((location) =>
    !userData.forbiddenLocation.includes(location) &&
    !targetData.forbiddenLocation.includes(location) &&
    (ability.restrictedToLocation === null ||
      ability.restrictedToLocation.includes(location))
  );
}

function goodwillRevealPaths(
  state: GameState,
  target: CharacterId,
): RoleExposurePath[] {
  return characterDataOf(target).goodwillAbilities.flatMap(
    (ability, abilityIndex) => {
      if (ability.rank === null ||
        !roleRevealAbilityTargets(state, target, target, ability)) {
        return [];
      }
      return [{
        key: `goodwill-reveal:${target}:${abilityIndex}:${target}`,
        title: `${characterDataOf(target).ko} [우호${ability.rank}] 역할 공개`,
        observation: `${goodwillAbilityCondition(ability)} · 이 캐릭터의 역할이 직접 공개된다.`,
        control: "protagonist" as const,
        avoidable: true,
        avoidance: ROLE_IMPL[effectiveRole(state, target)]?.goodwillRefusal
          ? "능력을 거부하거나 우호 기준 도달을 막는다. 거부 자체가 역할 후보를 좁힐 수 있다."
          : "우호 금지, 이동, 우호 기준 미달 유지로 사용 기회를 막는다.",
        sacrifice: "우호 금지 카드와 배치 여유를 쓰며, 다른 위험 캐릭터의 우호 능력 견제를 포기한다.",
      }];
    },
  );
}

function commonGoodwillRevealPaths(
  state: GameState,
  candidates: readonly CharacterId[],
): CommonRoleExposure[] {
  return Object.keys(state.scenario.cast).flatMap((user) =>
    characterDataOf(user).goodwillAbilities.flatMap((ability, abilityIndex) => {
      if (ability.rank === null) return [];
      const targets = candidates.filter((target) =>
        user !== target && roleRevealAbilityTargets(state, user, target, ability) &&
        canShareRequiredLocation(user, target, ability)
      );
      if (targets.length === 0) return [];
      const targetSet = new Set(targets);
      const excluded = candidates.filter((target) => !targetSet.has(target));
      return [{
        key: `common-goodwill-reveal:${user}:${abilityIndex}`,
        title: `${characterDataOf(user).ko} [우호${ability.rank}] 역할 공개`,
        observation: `${goodwillAbilityCondition(ability)} · 대상으로 고른 캐릭터의 역할을 공개한다.`,
        targetCharacterNames: targets.map((target) => characterDataOf(target).ko),
        excludedCharacterNames: excluded.map((target) => characterDataOf(target).ko),
      }];
    })
  );
}

function mandatoryRefusalPath(
  state: GameState,
  character: CharacterId,
  role: RoleId,
): RoleExposurePath[] {
  if (ROLE_IMPL[role]?.goodwillRefusal !== "Mandatory") return [];
  const abilities = characterDataOf(character).goodwillAbilities.filter(
    isRefusable,
  );
  if (abilities.length === 0) return [];
  return [{
    key: `role:${role}:mandatory-refusal`,
    title: "절대 우호 무시 · 반드시 거부",
    observation: `거부 가능한 우호 능력 ${abilities.length}개 중 하나가 선언되면 반드시 거부해 광신도·마녀 후보로 좁혀진다.`,
    control: "protagonist",
    avoidable: true,
    avoidance: "우호 금지와 이동으로 이 캐릭터의 우호 기준 도달을 막는다.",
    sacrifice: "이 캐릭터의 우호 능력 활용을 미끼로 쓰기 어렵고, 우호 금지 카드·이동을 계속 배정해야 한다.",
  }];
}

function roleSpecificPaths(
  state: GameState,
  character: CharacterId,
  role: RoleId,
): RoleExposurePath[] {
  const paths = mandatoryRefusalPath(state, character, role);
  const add = (path: RoleExposurePath): void => { paths.push(path); };
  switch (role) {
    case "person":
      if (state.scenario.subPlots.includes("paranoiaVirus")) {
        add({
          key: "plot:paranoia-virus:person-transformation",
          title: "망상 확대 바이러스 · 불안 3 변이",
          observation: "불안 3개 이상에서 연쇄 살인마로 취급되고 강제 사망이 발생할 수 있어, 변하지 않는 캐릭터와 비교하면 엑스트라 여부가 좁혀진다.",
          control: "automatic", avoidable: true,
          avoidance: "이 캐릭터의 불안을 2 이하로 유지하고 단둘이 배치를 피한다.",
          sacrifice: "불안 확산 미끼와 이 캐릭터를 연쇄 살인마로 바꾸는 사망 경로를 포기한다.",
        });
      }
      break;
    case "witch":
      break;
    case "curmudgeon":
      add({
        key: "role:curmudgeon:optional-refusal",
        title: "선택 우호 거부",
        observation: "우호 능력을 거부하면 선택 거부 역할 후보로 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "우호 능력을 거부하지 않는다.",
        sacrifice: "불리한 우호 능력을 그대로 해결해야 한다.",
      });
      break;
    case "keyPerson":
      add({
        key: "role:keyPerson:death-loss",
        title: "사망 즉시 루프 종료",
        observation: "이 캐릭터의 사망 직후 루프가 끝나 핵심 인물과 연결된 룰 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "이 캐릭터를 죽이는 승리 경로를 쓰지 않는다.",
        sacrifice: "핵심 인물 사망으로 끝나는 모든 빠른 승리 경로를 포기한다.",
      });
      break;
    case "killer":
      add({
        key: "role:killer:key-person-kill",
        title: "핵심 인물 살해 능력",
        observation: "음모 2인 핵심 인물을 같은 장소에서 죽이면 살인 청부업자 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "능력을 사용하지 않고 본인 음모 4 또는 다른 패배 조건을 노린다.",
        sacrifice: "핵심 인물 살해 승리 경로를 포기한다.",
      });
      add({
        key: "role:killer:self-intrigue",
        title: "본인 음모 4 패배 조건",
        observation: "본인 음모 4로 패배하면 살인 청부업자 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "본인에게 음모를 쌓지 않는다.",
        sacrifice: "살인 청부업자 자체 패배 조건을 포기한다.",
      });
      break;
    case "brain":
      add({
        key: "role:brain:intrigue",
        title: "흑막 음모 +1 능력",
        observation: "P5에 같은 장소의 인물·장소 음모가 늘면 흑막 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "흑막 능력을 사용하지 않는다.",
        sacrifice: "음모가 필요한 패배 조건의 진척 1개를 매일 포기한다.",
      });
      break;
    case "cultist":
      add({
        key: "role:cultist:ignore-forbid-intrigue",
        title: "음모 금지 무시",
        observation: "음모 금지가 무시되면 같은 장소의 광신도 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "음모 금지 무시 능력을 사용하지 않는다.",
        sacrifice: "막힌 음모 배치를 복구하지 못해 장소·캐릭터 음모 승리 경로가 늦어진다.",
      });
      break;
    case "timeTraveler":
      add({
        key: "role:timeTraveler:forbid-goodwill",
        title: "우호 금지 무시",
        observation: "이 캐릭터의 우호 금지가 무시되면 시간 여행자임이 강하게 드러난다.",
        control: "mastermind", avoidable: true,
        avoidance: "이 캐릭터에게 우호 금지를 놓지 않는다.",
        sacrifice: "우호 2 이하를 유지하는 마지막 날 승리 경로를 주인공의 우호 배치에 맡긴다.",
      });
      add({
        key: "role:timeTraveler:immortal",
        title: "불사 · 사망 무효",
        observation: "사망 효과의 대상이 되었는데 살아남으면 시간 여행자 후보가 강하게 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "사건·역할·우호 능력의 사망 대상으로 이 캐릭터가 선택되지 않게 한다.",
        sacrifice: "이 캐릭터를 안전한 사망 미끼나 사망 대상 후보로 쓰는 배치 선택을 포기한다.",
      });
      break;
    case "friend":
      add({
        key: "role:friend:death-reveal",
        title: "사망 시 역할 공개",
        observation: "사망한 채 루프가 끝나면 친구 역할이 직접 공개된다.",
        control: "automatic", avoidable: true,
        avoidance: "친구를 살려 둔다.",
        sacrifice: "친구 사망 패배 조건과 친구를 대상으로 한 사망 경로를 포기한다.",
      });
      break;
    case "conspiracyTheorist":
      add({
        key: "role:conspiracy-theorist:paranoia",
        title: "선동가 불안 +1 능력",
        observation: "P5에 같은 장소의 캐릭터 불안이 늘면 선동가 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "선동가 능력을 사용하지 않는다.",
        sacrifice: "사건과 불안 기반 패배 조건의 진척 1개를 매일 포기한다.",
      });
      break;
    case "lover":
    case "lovedOne":
      add({
        key: `role:${role}:counterpart-death`,
        title: "상대 사망 시 불안 6",
        observation: "연인 상대가 죽을 때 불안 6개가 강제로 놓여 연인A·B 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "상대 연인을 살려 둔다.",
        sacrifice: "상대 사망 경로와 그 연쇄로 여는 연인A 패배 조건을 포기한다.",
      });
      if (role === "lovedOne") {
        add({
          key: "role:loved-one:loss",
          title: "연인A 불안 3·음모 1 패배 조건",
          observation: "해당 보드 상태로 패배하면 연인A 후보가 좁혀진다.",
          control: "mastermind", avoidable: true,
          avoidance: "연인A 자체 패배 조건을 사용하지 않는다.",
          sacrifice: "불안 3·음모 1의 저비용 승리 경로를 포기한다.",
        });
      }
      break;
    case "serialKiller":
      add({
        key: "role:serial-killer:forced-kill",
        title: "단둘이 강제 사망",
        observation: "정확히 한 명과 같은 장소에 남으면 그 캐릭터가 강제로 죽어 연쇄 살인마 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "항상 세 명 이상을 유지하거나 혼자 두고, 이동 뒤 배치를 확인한다.",
        sacrifice: "연쇄 살인마 사망 승리 경로와 단둘이 배치를 이용한 압박을 포기한다.",
      });
      break;
    case "factor":
      add({
        key: "role:factor:gained-abilities",
        title: "장소 음모에 따른 강제 능력 획득",
        observation: "학교·도심 음모 2에서 선동가·핵심 인물 능력이 붙어 변수 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "학교와 도심의 음모를 2 미만으로 유지한다.",
        sacrifice: "두 장소의 음모 기반 승리·미끼와 변수의 추가 능력을 포기한다.",
      });
      break;
  }
  return paths;
}

function routeUsesRole(
  route: MastermindGuidanceRoute,
  character: CharacterId,
  role: RoleId,
): boolean {
  const key = `${route.key}|${route.conditionKey}`;
  switch (role) {
    case "brain": return [...route.actions.cardLabels, ...route.actions.abilityLabels]
      .some((label) => label.includes("음모"));
    case "conspiracyTheorist":
      return [...route.actions.cardLabels, ...route.actions.abilityLabels]
        .some((label) => label.includes("불안"));
    case "killer": return key.includes(`killer:${character}`);
    case "serialKiller": return key.includes(`serialKiller:${character}`);
    case "timeTraveler": return key.includes(`timeTraveler:${character}`);
    case "friend": return key.includes(`friend:${character}`);
    case "lovedOne": return key.includes(`lovedOne:${character}`);
    case "factor": return key.includes(`factor:${character}`);
    case "keyPerson": return key.includes(`keyPerson:${character}`);
    default: return false;
  }
}

function plotExposure(
  state: GameState,
  role: RoleId,
): { activePlots: string[]; possiblePlotCount: number; text: string } {
  const definition = tragedySetDefinition(state.scenario.tragedySet);
  const selected = [state.scenario.mainPlot, ...state.scenario.subPlots];
  const allPlots = [...definition.mainPlots, ...definition.subPlots];
  const hasRole = (plot: string): boolean =>
    Object.hasOwn(PLOT_IMPL[plot]?.addsRoles ?? {}, role);
  const activePlots = selected.filter(hasRole).map((plot) => PLOT_IMPL[plot].ko);
  const possiblePlotCount = new Set(allPlots.filter(hasRole)).size;
  if (role === "person") {
    return { activePlots, possiblePlotCount, text: "엑스트라는 선택 룰을 직접 특정하지 않는다." };
  }
  if (activePlots.length === 0) {
    return {
      activePlots,
      possiblePlotCount,
      text: "현재 선택 룰이 직접 부여한 역할이 아니어서 룰을 바로 특정하지 않는다.",
    };
  }
  return {
    activePlots,
    possiblePlotCount,
    text: `현재 ${activePlots.join("·")}와 연결된다. 이 참극 세트에서 이 역할을 쓰는 룰 ${possiblePlotCount}개로 가설을 좁힌다.`,
  };
}

function compareCandidates(
  left: RoleCoverCandidate,
  right: RoleCoverCandidate,
): number {
  const difficultyRank: Record<CoverDifficulty, number> = {
    passive: 0, controlled: 1, hard: 2,
  };
  return Number(left.alreadyRevealed) - Number(right.alreadyRevealed) ||
    left.automaticPathCount - right.automaticPathCount ||
    left.protagonistPathCount - right.protagonistPathCount ||
    left.mastermindPathCount - right.mastermindPathCount ||
    left.affectedVictoryRouteCount - right.affectedVictoryRouteCount ||
    difficultyRank[left.baseDifficulty] - difficultyRank[right.baseDifficulty] ||
    left.characterName.localeCompare(right.characterName, "ko");
}

export function mastermindCoverGuidance(
  state: GameState,
): MastermindCoverGuidance {
  const victoryRoutes = mastermindGuidance(state).routes;
  const candidateCharacters = Object.keys(state.scenario.cast).filter(
    (character) => effectiveRole(state, character) !== "person",
  );
  const commonExposure = commonGoodwillRevealPaths(state, candidateCharacters);
  const candidates = candidateCharacters.map((character) => {
    const role = effectiveRole(state, character);
    const rolePaths = roleSpecificPaths(state, character, role);
    const exposurePaths = [
      ...rolePaths,
      ...goodwillRevealPaths(state, character),
    ];
    const automaticPathCount = exposurePaths.filter(
      ({ control }) => control === "automatic",
    ).length;
    const protagonistPathCount = exposurePaths.filter(
      ({ control }) => control === "protagonist",
    ).length;
    const mastermindPathCount = exposurePaths.filter(
      ({ control }) => control === "mastermind",
    ).length;
    const affected = victoryRoutes.filter((route) =>
      routeUsesRole(route, character, role)
    );
    const plots = plotExposure(state, role);
    const alreadyRevealed = wasRevealed(state, character);
    const baseDifficulty = BASE_DIFFICULTY[role] ?? "controlled";
    const difficulty: CoverDifficulty = baseDifficulty === "hard" ||
        automaticPathCount > 0 ||
        rolePaths.some(({ control }) => control === "protagonist")
      ? "hard"
      : rolePaths.length > 0 || protagonistPathCount > 0
      ? "controlled"
      : baseDifficulty;
    const roleName = ROLE_IMPL[role]?.ko ?? role;
    const affectedVictoryRoutes = [...new Set(affected.map(({ title }) => title))];
    const mandatoryRefusal = ROLE_IMPL[role]?.goodwillRefusal === "Mandatory";
    const rankedAbilities = characterDataOf(character).goodwillAbilities.filter(
      ({ rank }) => rank !== null,
    );
    const refusalHiddenByAbilities = mandatoryRefusal &&
      rankedAbilities.length > 0 && rankedAbilities.every((ability) =>
        !isRefusable(ability)
      );
    const reason = alreadyRevealed
      ? "이미 공개되어 최종 은폐 후보가 될 수 없다."
      : refusalHiddenByAbilities
      ? `${characterDataOf(character).ko}의 우호 능력은 거부 불가라 절대 우호 무시 여부가 드러나지 않는다. 음모 금지 무시를 쓰지 않으면 역할을 숨기기 쉽다.`
      : automaticPathCount > 0
      ? `강제 노출 경로 ${automaticPathCount}개를 피해야 하므로 끝까지 지킬 후보로는 후순위다.`
      : baseDifficulty === "hard"
      ? "역할 고유 관측이 강해 끝까지 지키려면 관련 행동을 계속 제한해야 하므로 후순위다."
      : rolePaths.length === 0 && protagonistPathCount === 0
      ? "역할 고유 발동과 현재 캐스트의 직접 공개 경로가 없어 끝까지 지킬 후보에 적합하다."
      : `강제 노출은 없고, ${mastermindPathCount > 0 ? "능력을 쓰지 않으면" : "우호 공개 수단을 막으면"} 숨길 수 있다.`;
    return {
      character,
      characterName: characterDataOf(character).ko,
      role,
      roleName,
      baseDifficulty,
      difficulty,
      difficultyLabel: difficultyLabel(difficulty),
      alreadyRevealed,
      exposurePaths,
      exposurePathCount: exposurePaths.length,
      automaticPathCount,
      mastermindPathCount,
      protagonistPathCount,
      affectedVictoryRouteCount: affectedVictoryRoutes.length,
      affectedVictoryRoutes,
      activePlots: plots.activePlots,
      possiblePlotCount: plots.possiblePlotCount,
      plotExposure: plots.text,
      recommendationReason: reason,
    } satisfies RoleCoverCandidate;
  }).sort(compareCandidates);
  const definition = tragedySetDefinition(state.scenario.tragedySet);
  const recommendation = candidates.find(({ alreadyRevealed }) =>
    !alreadyRevealed
  );
  return {
    hasFinalGuess: definition.hasFinalGuess,
    earlyPrinciple: "초반: 역할 노출을 아껴 룰 가설과 패배 조건의 특정 속도를 늦춘다.",
    latePrinciple: "종반: 승리에 필요한 능력·패배 조건은 노출을 감수하고 사용하되, 가능하면 후보 한 명의 경로는 닫아 둔다.",
    finalDefensePrinciple: definition.hasFinalGuess
      ? "최후의 싸움: 주인공은 전원의 역할을 맞혀야 하므로 한 명만 틀려도 각본가가 이긴다. 이는 최종 방어선이며 루프 전략의 주축은 아니다."
      : "이 참극 세트에는 최후의 싸움이 없다. 후보 순서는 룰 은폐 비용만 비교한다.",
    commonExposure,
    ...(recommendation === undefined ? {} : { recommendation }),
    candidates,
  };
}
