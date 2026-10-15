import { characterDataOf, type GoodwillAbilityData } from "../data";
import { PLOT_IMPL } from "../impl/plots";
import { effectiveGoodwillRefusal, ROLE_IMPL } from "../impl/roles";
import { tragedySetDefinition } from "../tragedy-sets";
import { actionCardRestriction } from "./legal";
import { roleClaimOptions } from "./role-reveal";
import {
  effectiveRole,
  type CharacterId,
  type GameState,
  LOCATIONS,
  type RoleId,
} from "../types";
import {
  mastermindGuidance,
  type MastermindGuidance,
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
  rolePoolPressure: string;
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
  poisoner: "hard",
  fool: "hard",
  privateInvestigator: "hard",
  therapist: "hard",
  paranoiac: "controlled",
  twin: "hard",
  obstinate: "hard",
  vampire: "hard",
  werewolf: "hard",
  nightmare: "hard",
  ghost: "hard",
  showOff: "hard",
  coward: "hard",
  zombie: "hard",
  sacrifice: "hard",
  deepOne: "hard",
  wizard: "hard",
  witness: "hard",
  faceless: "hard",
};

function difficultyLabel(difficulty: CoverDifficulty): string {
  switch (difficulty) {
    case "hard": return "숨기기 어려움";
    case "controlled": return "숨기기 쉬움";
    case "passive": return "가장 숨기기 쉬움";
  }
}

function wasRevealed(state: GameState, character: CharacterId): boolean {
  return [...state.history, state.loop].some((loop) => {
    const resolutions = loop.roleRevealResolutionsThisLoop ?? [];
    if (resolutions.some((resolution) =>
      resolution.character === character &&
      resolution.result === "truthful" &&
      (
        resolution.claimedRole === "person" ||
        resolution.claimedRole === "ninja" ||
        !Object.values(state.scenario.cast).includes("ninja")
      )
    )) return true;
    // 구 저장처럼 공개 주장만 있고 전용 해결 기록이 없으면 기존처럼 실제 공개로 본다.
    return !resolutions.some((resolution) =>
        resolution.character === character
      ) &&
      (loop.publicInformationThisLoop ?? []).some((information) =>
        information.kind === "roleClaim" && information.character === character
      );
  });
}

function ninjaLieIsAvailable(
  state: GameState,
  character: CharacterId,
): boolean {
  return roleClaimOptions(state, character).some(
    ({ result }) => result === "ninjaLie",
  );
}

function ninjaClaimCouldKeepRoleAmbiguous(
  state: GameState,
  character: CharacterId,
): boolean {
  const role = effectiveRole(state, character);
  if (role === "person" || role === "ninja") {
    return ninjaLieIsAvailable(state, character);
  }
  return Object.values(state.scenario.cast).includes("ninja");
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
  if (user === "copycat" && text.includes("same role as")) return false;
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
      const forbidAvailable = actionCardRestriction(
        state,
        "mastermind",
        "forbidGoodwill",
      ) === undefined;
      return [{
        key: `goodwill-reveal:${target}:${abilityIndex}:${target}`,
        title: `${characterDataOf(target).ko} [우호${ability.rank}] 역할 공개`,
        observation: `${goodwillAbilityCondition(ability)} · ${
          ninjaClaimCouldKeepRoleAmbiguous(state, target)
            ? "선언한 역할만 공개되며 닌자의 거짓 공개 가능성은 남는다."
            : "이 캐릭터의 실제 역할이 직접 공개된다."
        }`,
        control: "protagonist" as const,
        avoidable: true,
        avoidance: effectiveGoodwillRefusal(state, target)
          ? "능력을 거부하거나 우호 기준 도달을 막는다. 거부 자체가 역할 후보를 좁힐 수 있다."
          : forbidAvailable
          ? "우호 금지, 이동, 우호 기준 미달 유지로 사용 기회를 막는다."
          : "특수 규칙상 우호 금지를 쓸 수 없으므로 이동과 우호 기준 미달 유지로 사용 기회를 막는다.",
        sacrifice: forbidAvailable
          ? "우호 금지 카드와 배치 여유를 쓰며, 다른 위험 캐릭터의 우호 능력 견제를 포기한다."
          : "이동 카드와 배치 여유를 쓰며, 우호 금지 없이 기준 도달을 막아야 한다.",
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
        observation: `${goodwillAbilityCondition(ability)} · ${
          targets.some((target) =>
            ninjaClaimCouldKeepRoleAmbiguous(state, target)
          )
            ? "대상의 선언 역할을 공개한다. 닌자는 거짓 선언으로 실제 역할 노출을 피할 수 있다."
            : "대상으로 고른 캐릭터의 실제 역할을 공개한다."
        }`,
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
  if (effectiveGoodwillRefusal(state, character) !== "Mandatory") return [];
  const abilities = characterDataOf(character).goodwillAbilities.filter(
    isRefusable,
  );
  if (abilities.length === 0) return [];
  const forbidAvailable = actionCardRestriction(
    state,
    "mastermind",
    "forbidGoodwill",
  ) === undefined;
  return [{
    key: `role:${role}:mandatory-refusal`,
    title: "절대 우호 무시 · 반드시 거부",
    observation: `거부 가능한 우호 능력 ${abilities.length}개 중 하나가 선언되면 반드시 거부해 광신도·마녀 후보로 좁혀진다.`,
    control: "protagonist",
    avoidable: true,
    avoidance: forbidAvailable
      ? "우호 금지와 이동으로 이 캐릭터의 우호 기준 도달을 막는다."
      : "특수 규칙상 우호 금지를 쓸 수 없으므로 이동과 우호 기준 미달 유지로 막는다.",
    sacrifice: forbidAvailable
      ? "이 캐릭터의 우호 능력 활용을 미끼로 쓰기 어렵고, 우호 금지 카드·이동을 계속 배정해야 한다."
      : "우호 금지 없이 이동과 배치만으로 우호 능력 사용 기회를 막아야 한다.",
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
      if (
        actionCardRestriction(state, "mastermind", "forbidGoodwill") ===
          undefined
      ) {
        add({
          key: "role:timeTraveler:forbid-goodwill",
          title: "우호 금지 무시",
          observation: "이 캐릭터의 우호 금지가 무시되면 시간 여행자임이 강하게 드러난다.",
          control: "mastermind", avoidable: true,
          avoidance: "이 캐릭터에게 우호 금지를 놓지 않는다.",
          sacrifice: "우호 2 이하를 유지하는 마지막 날 승리 경로를 주인공의 우호 배치에 맡긴다.",
        });
      }
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
    case "ninja":
      add({
        key: "role:ninja:false-reveal",
        title: "역할 거짓 공개",
        observation: "다른 비-엑스트라 역할을 선언할 수 있어 선언만으로 닌자 여부는 확정되지 않는다.",
        control: "mastermind", avoidable: true,
        avoidance: "진실을 선언한다.",
        sacrifice: "거짓 선언으로 역할표 후보를 분산하는 기회를 포기한다.",
      });
      add({
        key: "role:ninja:loss",
        title: "동소 음모 2 이상 패배 조건",
        observation: "해당 상태의 라운드 종료 패배는 닌자 후보를 좁힌다.",
        control: "mastermind", avoidable: true,
        avoidance: "닌자의 선택 패배 조건을 발동하지 않는다.",
        sacrifice: "닌자의 주인공 사망 경로를 포기한다.",
      });
      break;
    case "obstinate":
      add({
        key: "role:obstinate:incident",
        title: "불안과 무관한 사건 발생",
        observation: "불안 한계 미만인데 사건이 발생하면 절대자 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "사건 전에 불안을 인쇄 한계까지 올린다.",
        sacrifice: "불안 카드를 다른 패배 경로에 쓰지 못한다.",
      });
      break;
    case "poisoner":
      add({
        key: "role:poisoner:gauge-kill",
        title: "게이지 2 이상 동소 사망",
        observation: "특수 게이지 2 이상에서 같은 장소 캐릭터가 라운드 종료에 사망하면 바리스타 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "바리스타 사망 능력을 쓰지 않거나 특수 게이지를 2 미만으로 유지한다.",
        sacrifice: "바리스타의 사망 경로를 포기한다.",
      });
      add({
        key: "role:poisoner:gauge-loss",
        title: "게이지 4 이상 주인공 사망",
        observation: "특수 게이지 4 이상에서 라운드 종료 패배가 발생하면 바리스타 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "라운드 종료 전에 특수 게이지를 4 미만으로 유지한다.",
        sacrifice: "바리스타의 주인공 사망 경로를 포기한다.",
      });
      break;
    case "fool":
      add({
        key: "role:fool:paranoia-reset",
        title: "사건 발생 뒤 불안 전부 제거",
        observation: "범인이 사건을 발생시킨 직후 그 캐릭터의 불안이 모두 사라지면 어리석은 자 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "사건 전에 이 캐릭터의 불안을 0으로 만들어 변화가 드러나지 않게 한다.",
        sacrifice: "사건 한계를 맞추는 데 불안 카운터를 쓸 수 없다.",
      });
      break;
    case "privateInvestigator":
      add({
        key: "role:private-investigator:forced-incident",
        title: "게이지 0 동소 사건 강제 발생",
        observation: "특수 게이지 0에서 불안 한계 미만 사건이 발생하면 같은 장소의 명탐정 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "게이지를 1 이상으로 유지하거나 사건 전에 범인을 명탐정과 다른 장소에 둔다.",
        sacrifice: "게이지 0에서 불안 없이 사건을 여는 경로를 포기한다.",
      });
      add({
        key: "role:private-investigator:immortal",
        title: "불사 · 사망 무효",
        observation: "사망 효과의 대상이 되었는데 살아남으면 명탐정 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "사망 효과의 대상으로 선택하지 않는다.",
        sacrifice: "명탐정을 안전한 사망 미끼로 쓰지 못한다.",
      });
      break;
    case "therapist":
      add({
        key: "role:therapist:paranoia-removal",
        title: "게이지 1 이상 동소 불안 제거",
        observation: "P5에 같은 장소의 다른 캐릭터 불안이 1개 줄면 심리 치료사 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "게이지를 0으로 유지하거나 같은 장소의 다른 캐릭터 불안을 0으로 둔다.",
        sacrifice: "사건 발생을 늦추는 강제 불안 제거를 이용하지 못한다.",
      });
      break;
    case "paranoiac":
      add({
        key: "role:paranoiac:self-counter",
        title: "본인 음모·불안 +1",
        observation: "P5에 자기 자신에게 음모나 불안이 늘면 편집증 환자 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "편집증 환자 능력을 사용하지 않는다.",
        sacrifice: "자기 카운터를 매일 1개씩 쌓는 경로를 포기한다.",
      });
      break;
    case "twin":
      add({
        key: "role:twin:virtual-location",
        title: "사건 처리 중 대각선 가상 위치",
        observation: "사건의 발생 판정과 효과가 실제 장소가 아니라 대각선 장소를 기준으로 나타나면 쌍둥이 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "실제 장소와 대각선 장소의 차이가 결과에 드러나지 않는 사건·배치를 고른다.",
        sacrifice: "쌍둥이의 대각선 사건 배치를 이용하지 못한다.",
      });
      break;
    case "magician":
      add({
        key: "role:magician:movement",
        title: "P5 인접 이동",
        observation: "불안이 있는 캐릭터가 P5에 인접 장소로 이동하면 마술사 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "마술사 이동 능력을 사용하지 않는다.",
        sacrifice: "이동으로 사건·사망 배치를 조정하는 경로를 포기한다.",
      });
      break;
    case "immortalRole":
      add({
        key: "role:immortal:death",
        title: "불사 · 사망 무효",
        observation: "사망 효과의 대상이 되었는데 살아남으면 불멸자 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "사망 효과의 대상으로 선택하지 않는다.",
        sacrifice: "불멸자를 안전한 사망 미끼로 쓰지 못한다.",
      });
      break;
    case "sacrifice":
      add({
        key: "role:sacrifice:immortal",
        title: "불사 · 사망 무효",
        observation: "사망 효과의 대상이 되었는데 살아남으면 인간 제물 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "사망 효과의 대상으로 선택하지 않는다.",
        sacrifice: "인간 제물을 안전한 사망 미끼로 쓰지 못한다.",
      });
      add({
        key: "role:sacrifice:incident-intrigue",
        title: "사건 판정에서 음모를 불안으로 합산",
        observation: "본인이 범인인 사건이 인쇄 불안 한계 미만인데 음모를 합쳐 발생하면 인간 제물 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "사건 전에 인쇄 불안 한계를 채워 음모 합산 여부가 드러나지 않게 한다.",
        sacrifice: "사건 발생에 불안 카드를 더 써야 한다.",
      });
      add({
        key: "role:sacrifice:loss",
        title: "불안 2·음모 2 전원 사망",
        observation: "해당 상태에서 모든 캐릭터와 주인공이 사망하면 인간 제물 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "인간 제물의 선택 패배 조건을 발동하지 않는다.",
        sacrifice: "불안 2·음모 2의 주인공 사망 경로를 포기한다.",
      });
      break;
    case "deepOne":
      add({
        key: "role:deep-one:optional-refusal",
        title: "선택 우호 거부",
        observation: "우호 능력을 거부하면 심해인을 포함한 선택 우호 거부 역할 후보로 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "우호 능력을 거부하지 않는다.",
        sacrifice: "불리한 우호 능력을 그대로 해결해야 한다.",
      });
      add({
        key: "role:deep-one:intrigue",
        title: "동소 음모 +1",
        observation: "P5에 같은 장소나 캐릭터의 음모가 늘면 심해인 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "심해인 능력을 사용하지 않는다.",
        sacrifice: "음모가 필요한 패배 조건의 진척 1개를 매일 포기한다.",
      });
      add({
        key: "role:deep-one:death-reveal",
        title: "사망 시 역할 공개·게이지 증가",
        observation: "사망 직후 역할이 공개되고 특수 게이지가 1 오르면 심해인임이 확정된다.",
        control: "automatic", avoidable: true,
        avoidance: "심해인을 살려 둔다.",
        sacrifice: "심해인 사망을 게이지 증가 수단으로 쓰지 못한다.",
      });
      break;
    case "wizard":
      add({
        key: "role:wizard:death-loss",
        title: "사망 시 루프 종료 패배",
        observation: "사망한 채 루프가 끝나면 마법사와 연결된 패배 조건이 드러난다.",
        control: "automatic", avoidable: true,
        avoidance: "마법사를 살려 둔다.",
        sacrifice: "마법사 사망 패배 경로를 포기한다.",
      });
      add({
        key: "role:wizard:goodwill-reveal",
        title: "우호 능력 해결 뒤 역할 공개",
        observation: "우호 능력이 해결되면 역할이 공개되고 리더가 게이지 증가 여부를 고른다.",
        control: "protagonist", avoidable: true,
        avoidance: "우호 금지와 이동으로 우호 능력 사용을 막는다.",
        sacrifice: "우호 금지 카드·이동을 계속 배정해야 한다.",
      });
      break;
    case "witness":
      add({
        key: "role:witness:forced-death",
        title: "불안 4 강제 사망·게이지 증가",
        observation: "불안 4 이상에서 라운드 종료에 사망하고 게이지가 오르면 목격자 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "불안을 3 이하로 유지한다.",
        sacrifice: "불안을 사건 발생과 다른 패배 경로에 쓰기 어렵다.",
      });
      break;
    case "faceless":
      add({
        key: "role:faceless:optional-refusal",
        title: "선택 우호 거부",
        observation: "우호 능력을 거부하면 얼굴 없는 자를 포함한 선택 우호 거부 역할 후보로 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "우호 능력을 거부하지 않는다.",
        sacrifice: "불리한 우호 능력을 그대로 해결해야 한다.",
      });
      add({
        key: "role:faceless:immortal",
        title: "불사 · 사망 무효",
        observation: "사망 효과의 대상이 되었는데 살아남으면 얼굴 없는 자 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "사망 효과의 대상으로 선택하지 않는다.",
        sacrifice: "얼굴 없는 자를 안전한 사망 미끼로 쓰지 못한다.",
      });
      add({
        key: "role:faceless:gauge-abilities",
        title: "게이지에 따른 선동가·심해인 능력",
        observation: "게이지 1 이하에서는 선동가, 2 이상에서는 심해인 능력이 나타나 얼굴 없는 자 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "획득한 선택 능력을 사용하지 않는다.",
        sacrifice: "불안·음모 진척 능력을 포기한다.",
      });
      break;
    case "prophet":
      add({
        key: "role:prophet:placement",
        title: "각본가 카드 배치 금지",
        observation: "각본가가 이 캐릭터를 카드 대상으로 삼을 수 없어 예언자 후보가 좁혀질 수 있다.",
        control: "automatic", avoidable: false,
        avoidance: "강제 제한이라 피할 수 없다.",
        sacrifice: "없음",
      });
      add({
        key: "role:prophet:incident",
        title: "다른 장소 사건 억제",
        observation: "발생할 사건이 억제되면 예언자와 범인의 장소 관계가 드러난다.",
        control: "automatic", avoidable: true,
        avoidance: "범인을 예언자와 같은 장소에 둔다.",
        sacrifice: "사건 전 이동·배치 선택이 제한된다.",
      });
      break;
    case "vampire":
      add({
        key: "role:vampire:optional-refusal",
        title: "선택 우호 거부",
        observation: "우호 능력을 거부하면 뱀파이어를 포함한 선택 우호 거부 역할 후보로 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "우호 능력을 거부하지 않는다.",
        sacrifice: "불리한 우호 능력을 그대로 해결해야 한다.",
      });
      add({
        key: "role:vampire:immortal",
        title: "불사 · 사망 무효",
        observation: "사망 효과의 대상이 되었는데 살아남으면 뱀파이어를 포함한 불사 역할 후보로 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "사망 효과의 대상으로 선택하지 않는다.",
        sacrifice: "뱀파이어를 안전한 사망 미끼로 쓰지 못한다.",
      });
      add({
        key: "role:vampire:key-person-kill",
        title: "핵심 인물 살해 능력",
        observation: "같은 장소의 음모 2 이상 핵심 인물을 라운드 종료에 죽이면 뱀파이어 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "뱀파이어의 사망 능력을 사용하지 않는다.",
        sacrifice: "핵심 인물 살해 경로를 포기한다.",
      });
      add({
        key: "role:vampire:corpse-loss",
        title: "시작 장소 시체 2구 패배 조건",
        observation: "시작 장소의 시체 2구로 주인공이 사망하면 뱀파이어 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "뱀파이어의 선택 패배 조건을 발동하지 않는다.",
        sacrifice: "시체 수를 이용한 주인공 사망 경로를 포기한다.",
      });
      break;
    case "werewolf":
      add({
        key: "role:werewolf:optional-refusal",
        title: "선택 우호 거부",
        observation: "우호 능력을 거부하면 늑대인간을 포함한 선택 우호 거부 역할 후보로 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "우호 능력을 거부하지 않는다.",
        sacrifice: "불리한 우호 능력을 그대로 해결해야 한다.",
      });
      add({
        key: "role:werewolf:placement",
        title: "각본가 카드 배치 금지",
        observation: "각본가가 이 캐릭터에게 행동 카드를 놓을 수 없어 늑대인간 후보가 좁혀질 수 있다.",
        control: "automatic", avoidable: false,
        avoidance: "강제 제한이라 피할 수 없다.",
        sacrifice: "없음",
      });
      add({
        key: "role:werewolf:night-madness-loss",
        title: "밤의 광기 발생일 패배 조건",
        observation: "밤의 광기가 발생한 날 주인공이 사망하면 늑대인간 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "늑대인간의 선택 패배 조건을 발동하지 않는다.",
        sacrifice: "밤의 광기와 결합한 주인공 사망 경로를 포기한다.",
      });
      break;
    case "nightmare":
      add({
        key: "role:nightmare:optional-refusal",
        title: "선택 우호 거부",
        observation: "우호 능력을 거부하면 악몽을 포함한 선택 우호 거부 역할 후보로 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "우호 능력을 거부하지 않는다.",
        sacrifice: "불리한 우호 능력을 그대로 해결해야 한다.",
      });
      add({
        key: "role:nightmare:immortal",
        title: "불사 · 사망 무효",
        observation: "사망 효과의 대상이 되었는데 살아남으면 악몽을 포함한 불사 역할 후보로 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "사망 효과의 대상으로 선택하지 않는다.",
        sacrifice: "악몽을 안전한 사망 미끼로 쓰지 못한다.",
      });
      add({
        key: "role:nightmare:kill",
        title: "동소 캐릭터 살해 능력",
        observation: "같은 장소의 캐릭터가 라운드 종료에 사망하면 악몽 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "악몽의 사망 능력을 사용하지 않는다.",
        sacrifice: "동소 캐릭터 살해 경로를 포기한다.",
      });
      add({
        key: "role:nightmare:corpse-intrigue-loss",
        title: "시체 위 음모 3 패배 조건",
        observation: "실제 시체 위 음모 합계 3으로 주인공이 사망하면 악몽 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "악몽의 선택 패배 조건을 발동하지 않는다.",
        sacrifice: "시체 위 음모를 이용한 주인공 사망 경로를 포기한다.",
      });
      break;
    case "ghost":
      add({
        key: "role:ghost:corpse-paranoia",
        title: "시체의 강제 불안 +1",
        observation: "시체가 된 뒤 현재 장소 또는 시작 장소의 캐릭터에게 P5 불안 1개를 놓으면 유령 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "유령을 살려 두거나 두 장소에 생존 캐릭터를 남기지 않는다.",
        sacrifice: "유령의 강제 불안 진척을 이용하지 못한다.",
      });
      break;
    case "showOff":
      add({
        key: "role:show-off:conditional-immortal",
        title: "불안 2 이하 불사 · 불안 3에서 상실",
        observation: "공개 불안 수에 따라 사망 무효 여부와 절대 우호 무시가 바뀌면 허당 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "사망 효과의 대상으로 삼지 않고 불안을 3 미만으로 유지한다.",
        sacrifice: "허당을 안전한 사망 미끼로 쓰거나 절대 우호 무시를 여는 선택을 포기한다.",
      });
      break;
    case "coward":
      add({
        key: "role:coward:forced-movement",
        title: "불안 2 이상 P5 강제 이동",
        observation: "불안 2 이상에서 인접 장소로 강제 이동하면 겁쟁이 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "이 캐릭터의 불안을 1 이하로 유지한다.",
        sacrifice: "불안을 사건 발생과 다른 패배 경로에 쓰기 어렵다.",
      });
      break;
    case "zombie":
      add({
        key: "role:zombie:majority-kill",
        title: "좀비 과반 장소 강제 사망",
        observation: "좀비가 비좀비보다 많은 장소에서 캐릭터 1명이 강제로 사망하면 좀비 역할 후보가 좁혀진다.",
        control: "automatic", avoidable: true,
        avoidance: "어느 장소에서도 좀비가 생존 비좀비보다 많아지지 않게 한다.",
        sacrifice: "좀비 과반을 이용한 강제 사망 경로를 포기한다.",
      });
      add({
        key: "role:zombie:corpse-movement",
        title: "좀비 시체 이동",
        observation: "라운드 종료에 좀비 시체를 인접 장소로 옮기면 좀비 역할 후보가 좁혀진다.",
        control: "mastermind", avoidable: true,
        avoidance: "좀비 시체 이동 능력을 사용하지 않는다.",
        sacrifice: "시체 수와 익명 시체 배치를 조정하는 경로를 포기한다.",
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
    case "ninja": return key.includes(`ninja:${character}`);
    case "magician": return route.actions.abilityLabels.some((label) =>
      label.includes("마술사") || label.includes("역할 공개")
    );
    case "immortalRole": return key.includes(`immortalRole:${character}`);
    case "sacrifice": return key.includes(`sacrifice:${character}`);
    case "wizard": return key.includes(`wizard:${character}`);
    case "prophet": return key.includes(`prophet:${character}`);
    case "obstinate": return key.includes(`obstinate:${character}`);
    case "poisoner": return key.includes(`poisoner:${character}`);
    case "vampire": return key.includes(`vampire:${character}`);
    case "werewolf": return key.includes(`werewolf:${character}`);
    case "nightmare": return key.includes(`nightmare:${character}`);
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
  victoryGuidance: MastermindGuidance = mastermindGuidance(state),
): MastermindCoverGuidance {
  const victoryRoutes = victoryGuidance.routes;
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
    const mandatoryRefusal = effectiveGoodwillRefusal(state, character) ===
      "Mandatory";
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
  const plotRoleNames = [...new Set(
    [state.scenario.mainPlot, ...state.scenario.subPlots].flatMap((plot) =>
      Object.keys(PLOT_IMPL[plot]?.addsRoles ?? {})
    ),
  )].map((role) => ROLE_IMPL[role]?.ko ?? role);
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
    rolePoolPressure: definition.hasFinalGuess
      ? `선택한 룰이 공급하는 역할은 ${plotRoleNames.length}종(${plotRoleNames.join(" · ")})뿐입니다. 아웃사이더의 룰 외 역할은 별도지만, 현재 룰 역할 후보 폭이 좁아 주인공이 최후의 싸움에서 역전하기 쉬우므로 룰 Y와 역할 대응을 흐릴 필요가 있습니다.`
      : "최후의 싸움이 없어 역할 후보 수 자체가 최종 판정으로 이어지지 않습니다.",
    commonExposure,
    ...(recommendation === undefined ? {} : { recommendation }),
    candidates,
  };
}
