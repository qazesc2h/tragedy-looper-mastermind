import { characterDataOf } from "../data";
import { PLOT_IMPL } from "../impl/plots";
import { ROLE_IMPL } from "../impl/roles";
import { tragedySetDefinition } from "../tragedy-sets";
import {
  type CharacterId,
  effectiveRole,
  type GameState,
  type Location,
  type PlotId,
  type RoleId,
  withCharacterLife,
} from "../types";
import {
  buildRolePossibilityTable,
  enumerateRuleCombinations,
  explainableLossConditions,
  hypotheticalLossObservation,
  type RuleCombination,
} from "./hypothesis";

export type DecoyTargetKind = "location" | "character" | "incident";

export interface IntrigueRequirementAuditEntry {
  key: string;
  owner: string;
  targetKind: "location" | "character";
  target: string;
  amount: number;
}

/** 장소 카운터와 캐릭터 카운터를 섞지 않기 위한 원문 계약표. */
export const INTRIGUE_REQUIREMENT_AUDIT: readonly IntrigueRequirementAuditEntry[] = [
  { key: "plot:sealedItem", owner: "봉인된 것", targetKind: "location", target: "신사", amount: 2 },
  { key: "plot:giantTimeBomb", owner: "거대 시한폭탄 X의 존재", targetKind: "location", target: "장소 X", amount: 2 },
  { key: "plot:lightAvenger", owner: "복수자의 등불", targetKind: "location", target: "장소 X", amount: 2 },
  { key: "plot:placeProtect", owner: "지켜야 할 장소", targetKind: "location", target: "학교", amount: 2 },
  { key: "plot:signWithMe", owner: "나와 계약하자!", targetKind: "character", target: "핵심 인물", amount: 2 },
  { key: "role:killer:keyPerson", owner: "살인 청부업자", targetKind: "character", target: "핵심 인물", amount: 2 },
  { key: "role:killer:self", owner: "살인 청부업자", targetKind: "character", target: "본인", amount: 4 },
] as const;

export interface AttributeRequirementAuditEntry {
  tragedySet: string;
  owner: string;
  requirement: string;
  attribute:
    | "girl"
    | "man"
    | "sameSex"
    | "oppositeSex"
    | "supernatural"
    | "afterDeath";
  kind: "scriptBuild" | "dynamic";
  sourcePath: string;
}

/**
 * 공개 확장 데이터의 plots.jsonc/roles.jsonc 원문을 전수 검색한 결과다.
 * 런타임이 아직 지원하지 않는 참극 세트도 감사 범위에서 빠뜨리지 않는다.
 */
export const ATTRIBUTE_REQUIREMENT_AUDIT: readonly AttributeRequirementAuditEntry[] = [
  { tragedySet: "base-game", owner: "signWithMe", requirement: "핵심 인물은 소녀", attribute: "girl", kind: "scriptBuild", sourcePath: "data/base-game/plots.jsonc" },
  { tragedySet: "cosmic-evil", owner: "nobleBloodline", requirement: "핵심 인물과 흡혈귀는 서로 이성", attribute: "oppositeSex", kind: "scriptBuild", sourcePath: "data/cosmic-evil/plots.jsonc" },
  { tragedySet: "cosmic-evil", owner: "keyGirl", requirement: "핵심 인물은 소녀", attribute: "girl", kind: "scriptBuild", sourcePath: "data/cosmic-evil/plots.jsonc" },
  { tragedySet: "haunted-stage", owner: "strangeStory", requirement: "흡혈귀와 악몽은 같은 성별", attribute: "sameSex", kind: "scriptBuild", sourcePath: "data/haunted-stage/plots.jsonc" },
  { tragedySet: "midnight-circle", owner: "maleConfrontation", requirement: "닌자는 남성", attribute: "man", kind: "scriptBuild", sourcePath: "data/midnight-circle/plots.jsonc" },
  { tragedySet: "last-liar", owner: "worldRebellion", requirement: "핵심 인물과 파편은 모두 소녀", attribute: "girl", kind: "scriptBuild", sourcePath: "data/last-liar/plots.jsonc" },
  { tragedySet: "rei", owner: "throughLookingGlass", requirement: "앨리스는 소녀", attribute: "girl", kind: "scriptBuild", sourcePath: "data/rei/plots.jsonc" },
  { tragedySet: "another-horizon", owner: "fanaticSacrifices", requirement: "광신도와 같은 성별의 다른 캐릭터 3명 이상 사망", attribute: "sameSex", kind: "dynamic", sourcePath: "data/another-horizon/plots.jsonc" },
  { tragedySet: "supernatural", owner: "metamorphosis", requirement: "탄원자는 생존한 초자연 캐릭터", attribute: "supernatural", kind: "dynamic", sourcePath: "data/supernatural/plots.jsonc" },
  { tragedySet: "haunted-stage", owner: "zombieApocalypse", requirement: "사후 능력이 없는 시체가 좀비 후보", attribute: "afterDeath", kind: "dynamic", sourcePath: "data/haunted-stage/plots.jsonc" },
  { tragedySet: "haunted-stage", owner: "vampireHaunted", requirement: "이성 캐릭터를 대상으로 하며 이성 시체 수를 센다", attribute: "oppositeSex", kind: "dynamic", sourcePath: "data/haunted-stage/roles.jsonc" },
  { tragedySet: "supernatural", owner: "seeder", requirement: "같은 장소의 비초자연 캐릭터", attribute: "supernatural", kind: "dynamic", sourcePath: "data/supernatural/roles.jsonc" },
  { tragedySet: "visual-novel", owner: "heavyLovers", requirement: "같은 장소의 동성 캐릭터", attribute: "sameSex", kind: "dynamic", sourcePath: "data/visual-novel/roles.jsonc" },
  { tragedySet: "another-horizon", owner: "animus", requirement: "캐릭터의 성별을 반전", attribute: "oppositeSex", kind: "dynamic", sourcePath: "data/another-horizon/roles.jsonc" },
] as const;

export interface AttributeCandidateGroup {
  key: string;
  source: string;
  requirement: string;
  attributeLabel: string;
  candidates: CharacterId[];
  actualHolders: CharacterId[];
}

export interface ConfusableRule {
  key: string;
  selectedPlot: PlotId;
  selectedPlotName: string;
  observationType: string;
  observationLabel: string;
  alternatives: Array<{
    plot: PlotId;
    plotName: string;
    sameTragedySet: boolean;
  }>;
}

export interface FakeLossCondition {
  key: string;
  explanationKey: string;
  title: string;
  kind: "plot" | "role";
  targetKind: DecoyTargetKind;
  requirement: string;
  targets: string[];
  candidateCharacters: CharacterId[];
}

export interface LocationIntrigueSource {
  key: string;
  title: string;
  controller: "각본가" | "주인공" | "자동";
  timing: string;
  targetScope: string;
  condition: string;
}

export interface MastermindDecoyGuidance {
  attributeCandidates: AttributeCandidateGroup[];
  confusableRules: ConfusableRule[];
  fakeLossConditions: FakeLossCondition[];
  locationIntrigueSources: LocationIntrigueSource[];
  total: number;
}

export interface ObservationProfile {
  type: string;
  label: string;
}

export const PLOT_OBSERVATION_PROFILES: Readonly<
  Record<PlotId, readonly ObservationProfile[]>
> = {
  murderPlan: [
    { type: "keyPersonDeath", label: "핵심 인물 사망으로 즉시 패배" },
    { type: "mastermindIntrigue", label: "각본가 능력으로 음모 증가" },
    { type: "protagonistDeath", label: "라운드 종료 때 주인공 사망" },
  ],
  lightAvenger: [
    { type: "locationIntrigueLoss", label: "장소 음모 2개로 루프 종료 패배" },
    { type: "mastermindIntrigue", label: "각본가 능력으로 음모 증가" },
  ],
  placeProtect: [
    { type: "locationIntrigueLoss", label: "장소 음모 2개로 루프 종료 패배" },
    { type: "keyPersonDeath", label: "핵심 인물 사망으로 즉시 패배" },
    { type: "intrigueForbidIgnored", label: "음모 금지 무시" },
  ],
  sealedItem: [
    { type: "locationIntrigueLoss", label: "장소 음모 2개로 루프 종료 패배" },
    { type: "mastermindIntrigue", label: "각본가 능력으로 음모 증가" },
    { type: "intrigueForbidIgnored", label: "음모 금지 무시" },
  ],
  signWithMe: [
    { type: "characterIntrigueLoss", label: "캐릭터 음모 2개로 루프 종료 패배" },
    { type: "keyPersonDeath", label: "핵심 인물 사망으로 즉시 패배" },
  ],
  changeOfFuture: [
    { type: "incidentLoss", label: "특정 사건 발생 뒤 루프 종료 패배" },
    { type: "lastDayLowGoodwill", label: "마지막 날 낮은 우호로 패배" },
    { type: "intrigueForbidIgnored", label: "음모 금지 무시" },
  ],
  giantTimeBomb: [
    { type: "locationIntrigueLoss", label: "장소 음모 2개로 루프 종료 패배" },
    { type: "goodwillRefusal", label: "우호 능력 거부" },
  ],
  circleFriends: [
    { type: "friendDeath", label: "사망 뒤 루프 종료 때 역할 공개·패배" },
    { type: "mastermindParanoia", label: "각본가 능력으로 불안 증가" },
  ],
  loveAffair: [
    { type: "pairedDeath", label: "상대 역할 사망에 연동된 사망" },
    { type: "protagonistDeath", label: "라운드 종료 때 주인공 사망" },
  ],
  hiddenFreak: [
    { type: "isolatedDeath", label: "둘만 남은 장소에서 캐릭터 사망" },
    { type: "friendDeath", label: "사망 뒤 루프 종료 때 역할 공개·패배" },
  ],
  shadowRipper: [
    { type: "isolatedDeath", label: "둘만 남은 장소에서 캐릭터 사망" },
    { type: "mastermindParanoia", label: "각본가 능력으로 불안 증가" },
  ],
  unsettlingRumor: [
    { type: "mastermindLocationIntrigue", label: "각본가 능력으로 장소 음모 증가" },
    { type: "mastermindParanoia", label: "각본가 능력으로 불안 증가" },
  ],
  hideousScript: [
    { type: "friendDeath", label: "사망 뒤 루프 종료 때 역할 공개·패배" },
    { type: "mastermindParanoia", label: "각본가 능력으로 불안 증가" },
    { type: "goodwillRefusal", label: "우호 능력 거부" },
  ],
  paranoiaVirus: [
    { type: "isolatedDeath", label: "둘만 남은 장소에서 캐릭터 사망" },
    { type: "mastermindParanoia", label: "각본가 능력으로 불안 증가" },
  ],
  threadsFate: [
    { type: "loopStartParanoia", label: "루프 시작 때 불안 2개 증가" },
  ],
  unknownFactor: [
    { type: "keyPersonDeath", label: "핵심 인물 사망으로 즉시 패배" },
    { type: "mastermindParanoia", label: "각본가 능력으로 불안 증가" },
    { type: "conditionalRole", label: "장소 음모에 따라 다른 역할 능력 획득" },
  ],
};

const LOCATION_NAMES: Readonly<Record<Location, string>> = {
  Hospital: "병원",
  Shrine: "신사",
  City: "도심",
  School: "학교",
};

function activePlots(state: GameState): PlotId[] {
  return [state.scenario.mainPlot, ...state.scenario.subPlots];
}

function castCharacters(state: GameState): CharacterId[] {
  return Object.keys(state.scenario.cast).sort((left, right) =>
    characterDataOf(left).ko.localeCompare(characterDataOf(right).ko, "ko")
  );
}

function combinationsWithPlot(
  combinations: readonly RuleCombination[],
  plot: PlotId,
): RuleCombination[] {
  return combinations.filter((combination) =>
    combination.mainPlot === plot || combination.subPlots.includes(plot)
  );
}

function roleCandidates(
  state: GameState,
  combinations: readonly RuleCombination[],
  role: RoleId,
): CharacterId[] {
  if (combinations.length === 0) return [];
  const characters = castCharacters(state);
  const table = buildRolePossibilityTable(
    state.scenario.tragedySet,
    characters,
    combinations,
    [],
  );
  return characters.filter((character) =>
    table.cells[character]?.[role]?.status !== "impossible"
  );
}

function possibleStartLocations(
  state: GameState,
  characters: readonly CharacterId[],
): Location[] {
  const locations = new Set<Location>();
  for (const character of characters) {
    const choices = characterDataOf(character).startLocation;
    const selected = state.scenario.scriptSpecified?.[`startLocation:${character}`];
    if (typeof selected === "string" && choices.includes(selected as Location)) {
      locations.add(selected as Location);
      continue;
    }
    for (const location of choices) locations.add(location);
  }
  return [...locations];
}

function projectedConditionIsExplainable(
  state: GameState,
  plan: FakeLossCondition,
  combinations: readonly RuleCombination[],
): boolean {
  const projected = structuredClone(state);
  const character = plan.candidateCharacters[0];
  projected.scenario.scriptSpecified ??= {};
  for (const castCharacter of castCharacters(projected)) {
    const choices = characterDataOf(castCharacter).startLocation;
    const key = `startLocation:${castCharacter}`;
    if (choices.length > 1 && projected.scenario.scriptSpecified[key] === undefined) {
      projected.scenario.scriptSpecified[key] = choices[0];
    }
  }
  projected.loop.phase = "P9_ROUND_END";
  projected.loop.day = projected.scenario.daysPerLoop;

  switch (plan.explanationKey) {
    case "plot:lightAvenger":
    case "plot:placeProtect":
    case "plot:sealedItem":
    case "plot:giantTimeBomb": {
      const location = Object.entries(LOCATION_NAMES).find(([, name]) =>
        plan.targets.includes(name)
      )?.[0] as Location | undefined;
      if (location === undefined) return false;
      projected.loop.locIntrigue[location] = Math.max(
        projected.loop.locIntrigue[location],
        2,
      );
      break;
    }
    case "plot:signWithMe":
      if (character === undefined) return false;
      projected.loop.charCounters[character].intrigue = Math.max(
        projected.loop.charCounters[character].intrigue,
        2,
      );
      break;
    case "plot:changeOfFuture":
      projected.loop.incidentOccurrencesFiredThisLoop = [
        ...(projected.loop.incidentOccurrencesFiredThisLoop ?? []),
        {
          day: projected.loop.day,
          incident: "butterflyEffect",
          culprit: projected.scenario.incidents.find(
            ({ incident }) => incident === "butterflyEffect",
          )?.culprit ?? castCharacters(projected)[0],
        },
      ];
      break;
    case "role:keyPerson":
    case "role:friend":
    case "role:factor":
      if (character === undefined) return false;
      if (projected.loop.board[character].status === "absent") {
        const at = characterDataOf(character).startLocation[0];
        projected.loop.board[character] = { status: "dead", at };
      } else {
        projected.loop.board[character] = withCharacterLife(
          projected.loop.board[character],
          false,
          character,
        );
      }
      if (plan.explanationKey === "role:factor") {
        projected.loop.locIntrigue.City = Math.max(
          projected.loop.locIntrigue.City,
          2,
        );
      }
      break;
    case "role:timeTraveler":
      if (character === undefined) return false;
      projected.loop.charCounters[character].goodwill = Math.min(
        projected.loop.charCounters[character].goodwill,
        2,
      );
      break;
    case "role:killer":
      if (character === undefined) return false;
      projected.loop.charCounters[character].intrigue = Math.max(
        projected.loop.charCounters[character].intrigue,
        4,
      );
      break;
    case "role:lovedOne":
      if (character === undefined) return false;
      projected.loop.charCounters[character].paranoia = Math.max(
        projected.loop.charCounters[character].paranoia,
        3,
      );
      projected.loop.charCounters[character].intrigue = Math.max(
        projected.loop.charCounters[character].intrigue,
        1,
      );
      break;
    default:
      return false;
  }

  const timing = plan.explanationKey === "role:killer" ||
      plan.explanationKey === "role:lovedOne"
    ? "protagonistDeath"
    : plan.explanationKey === "role:keyPerson" ||
        plan.explanationKey === "role:factor"
    ? "effect"
    : "lastDay";
  const observation = hypotheticalLossObservation(projected, timing);
  return explainableLossConditions(
    projected,
    observation,
    combinations,
    [],
  ).some(({ key }) => key === plan.explanationKey);
}

function attributeCandidates(state: GameState): AttributeCandidateGroup[] {
  if (!activePlots(state).includes("signWithMe")) return [];
  const candidates = castCharacters(state).filter((character) =>
    characterDataOf(character).tags.includes("girl")
  );
  return [{
    key: "plot:signWithMe:girl",
    source: PLOT_IMPL.signWithMe.ko,
    requirement: "핵심 인물은 소녀여야 합니다.",
    attributeLabel: "소녀",
    candidates,
    actualHolders: candidates.filter((character) =>
      effectiveRole(state, character) === "keyPerson"
    ),
  }];
}

function confusableRules(state: GameState): ConfusableRule[] {
  const definition = tragedySetDefinition(state.scenario.tragedySet);
  const setPlots = new Set([...definition.mainPlots, ...definition.subPlots]);
  return activePlots(state).flatMap((selectedPlot) =>
    (PLOT_OBSERVATION_PROFILES[selectedPlot] ?? []).flatMap((profile) => {
      const alternatives = Object.entries(PLOT_OBSERVATION_PROFILES).flatMap(
        ([plot, profiles]) => plot !== selectedPlot &&
            profiles.some(({ type }) => type === profile.type)
          ? [{
            plot,
            plotName: PLOT_IMPL[plot]?.ko ?? plot,
            sameTragedySet: setPlots.has(plot),
          }]
          : [],
      );
      return alternatives.length === 0 ? [] : [{
        key: `${selectedPlot}:${profile.type}`,
        selectedPlot,
        selectedPlotName: PLOT_IMPL[selectedPlot]?.ko ?? selectedPlot,
        observationType: profile.type,
        observationLabel: profile.label,
        alternatives,
      }];
    })
  );
}

function fakeLossConditions(state: GameState): FakeLossCondition[] {
  const combinations = enumerateRuleCombinations(state.scenario.tragedySet);
  const selectedPlots = new Set(activePlots(state));
  const plans: FakeLossCondition[] = [];
  const addPlot = (
    plot: PlotId,
    targetKind: DecoyTargetKind,
    requirement: string,
    targets: string[],
    candidates: CharacterId[] = [],
  ): void => {
    if (selectedPlots.has(plot)) return;
    const relevant = combinationsWithPlot(combinations, plot);
    if (relevant.length === 0 || (targets.length === 0 && candidates.length === 0)) {
      return;
    }
    plans.push({
      key: `fake:plot:${plot}`,
      explanationKey: `plot:${plot}`,
      title: PLOT_IMPL[plot]?.ko ?? plot,
      kind: "plot",
      targetKind,
      requirement,
      targets,
      candidateCharacters: candidates,
    });
  };

  const lightCombinations = combinationsWithPlot(combinations, "lightAvenger");
  const lightCandidates = roleCandidates(state, lightCombinations, "brain");
  addPlot(
    "lightAvenger",
    "location",
    "흑막 후보의 시작 장소에 음모 2개",
    possibleStartLocations(state, lightCandidates).map((at) => LOCATION_NAMES[at]),
    lightCandidates,
  );
  addPlot("placeProtect", "location", "학교(장소)에 음모 2개", ["학교"]);
  addPlot("sealedItem", "location", "신사(장소)에 음모 2개", ["신사"]);

  const signCombinations = combinationsWithPlot(combinations, "signWithMe");
  const signCandidates = roleCandidates(state, signCombinations, "keyPerson")
    .filter((character) => characterDataOf(character).tags.includes("girl"));
  addPlot(
    "signWithMe",
    "character",
    "소녀인 핵심 인물 후보(캐릭터)에 음모 2개",
    signCandidates.map((character) => characterDataOf(character).ko),
    signCandidates,
  );

  if (state.scenario.incidents.some(({ incident }) =>
    incident === "butterflyEffect"
  )) {
    addPlot(
      "changeOfFuture",
      "incident",
      "이번 루프에 나비의 날갯짓 발생",
      ["나비의 날갯짓"],
    );
  }

  const giantCombinations = combinationsWithPlot(combinations, "giantTimeBomb");
  const witchCandidates = roleCandidates(state, giantCombinations, "witch");
  addPlot(
    "giantTimeBomb",
    "location",
    "마녀 후보의 시작 장소에 음모 2개",
    possibleStartLocations(state, witchCandidates).map((at) => LOCATION_NAMES[at]),
    witchCandidates,
  );

  const actualRoles = new Set(castCharacters(state).map((character) =>
    effectiveRole(state, character)
  ));
  const addRole = (
    role: RoleId,
    targetKind: DecoyTargetKind,
    requirement: string,
  ): void => {
    if (actualRoles.has(role)) return;
    const relevant = combinations.filter((combination) =>
      Object.keys(PLOT_IMPL[combination.mainPlot]?.addsRoles ?? {}).includes(role) ||
      combination.subPlots.some((plot) =>
        Object.keys(PLOT_IMPL[plot]?.addsRoles ?? {}).includes(role)
      )
    );
    const candidates = roleCandidates(state, relevant, role);
    if (candidates.length === 0) return;
    plans.push({
      key: `fake:role:${role}`,
      explanationKey: `role:${role}`,
      title: ROLE_IMPL[role]?.ko ?? role,
      kind: "role",
      targetKind,
      requirement,
      targets: candidates.map((character) => characterDataOf(character).ko),
      candidateCharacters: candidates,
    });
  };
  addRole("keyPerson", "character", "후보 캐릭터 사망");
  addRole("friend", "character", "후보 캐릭터 사망 후 루프 종료 판정");
  addRole("timeTraveler", "character", "마지막 날 후보 캐릭터의 우호 2개 이하");
  addRole("factor", "character", "도심(장소) 음모 2개와 후보 캐릭터 사망");
  addRole("killer", "character", "후보 캐릭터(본인)에 음모 4개");
  addRole("lovedOne", "character", "후보 캐릭터(본인)에 불안 3개와 음모 1개");

  return plans.filter((plan) =>
    projectedConditionIsExplainable(state, plan, combinations)
  );
}

function locationIntrigueSources(state: GameState): LocationIntrigueSource[] {
  const sources: LocationIntrigueSource[] = [
    {
      key: "card:intriguePlus1",
      title: "각본가 「음모+1」",
      controller: "각본가",
      timing: "행동 해결",
      targetScope: "원하는 장소 1곳",
      condition: "한 대상에는 그날 각본가 카드 1장만 놓을 수 있음",
    },
    {
      key: "card:intriguePlus2",
      title: "각본가 「음모+2」",
      controller: "각본가",
      timing: "행동 해결",
      targetScope: "원하는 장소 1곳",
      condition: "1루프당 1회",
    },
  ];
  const characters = castCharacters(state);
  const brainHolders = characters.filter((character) =>
    effectiveRole(state, character) === "brain"
  );
  if (brainHolders.length > 0) {
    sources.push({
      key: "role:brain",
      title: `흑막 (${brainHolders.map((c) => characterDataOf(c).ko).join("·")})`,
      controller: "각본가",
      timing: "각본가 능력 단계",
      targetScope: "흑막이 능력을 미치는 장소",
      condition: "그 장소 또는 그곳의 캐릭터에 음모 1개",
    });
  }
  if (characters.includes("journalist")) {
    sources.push({
      key: "goodwill:journalist:2",
      title: "기자 [우호2]",
      controller: "주인공",
      timing: "주인공 능력 단계",
      targetScope: "기자가 있는 장소",
      condition: "그 장소 또는 그곳의 캐릭터에 음모 1개",
    });
  }
  if (activePlots(state).includes("unsettlingRumor")) {
    sources.push({
      key: "plot:unsettlingRumor",
      title: "불온한 소문",
      controller: "각본가",
      timing: "각본가 능력 단계",
      targetScope: "원하는 장소 1곳",
      condition: "1루프당 1회, 음모 1개",
    });
  }
  if (characters.includes("blackCat")) {
    sources.push({
      key: "trait:blackCat",
      title: "검은 고양이 특성",
      controller: "자동",
      timing: "루프 시작",
      targetScope: "신사",
      condition: "신사(장소)에 음모 1개",
    });
  }
  return sources;
}

export function mastermindDecoyGuidance(
  state: GameState,
): MastermindDecoyGuidance {
  const attributes = attributeCandidates(state);
  const confusing = confusableRules(state);
  const fakeLosses = fakeLossConditions(state);
  const locationSources = locationIntrigueSources(state);
  return {
    attributeCandidates: attributes,
    confusableRules: confusing,
    fakeLossConditions: fakeLosses,
    locationIntrigueSources: locationSources,
    total: attributes.length + confusing.length + fakeLosses.length,
  };
}
