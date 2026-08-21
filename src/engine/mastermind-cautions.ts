import { characterDataOf, type GoodwillAbilityData } from "../data";
import { INCIDENT_IMPL } from "../impl/incidents";
import { PLOT_IMPL } from "../impl/plots";
import { ROLE_IMPL } from "../impl/roles";
import {
  characterEntryTiming,
  effectiveRole,
  type CharacterId,
  type GameState,
  type Location,
  type RoleId,
} from "../types";

export type MastermindCautionCategory =
  | "identityExposure"
  | "uncontrolledRisk"
  | "protagonistTool";

export type MastermindCautionSeverity = "critical" | "warning" | "note";

export interface MastermindCaution {
  key: string;
  category: MastermindCautionCategory;
  title: string;
  condition: string;
  description: string;
  source: string;
  severity: MastermindCautionSeverity;
}

export interface MastermindCautions {
  identityExposure: MastermindCaution[];
  uncontrolledRisks: MastermindCaution[];
  protagonistTools: MastermindCaution[];
  total: number;
}

const DEATH_INCIDENTS = new Set([
  "farawayMurder",
  "hospitalIncident",
  "murder",
  "suicide",
]);

const INCIDENT_EFFECTS: Readonly<Record<string, string>> = {
  butterflyEffect: "범인과 같은 장소의 캐릭터 1명에게 원하는 카운터 1개를 놓습니다.",
  farawayMurder: "음모 2개 이상인 캐릭터 1명이 사망합니다.",
  foulEvil: "신사에 음모 2개가 놓입니다.",
  hospitalIncident: "병원 음모 1개 이상이면 병원의 전원이 사망하고, 2개 이상이면 주인공 사망도 판정합니다.",
  increasingUnease: "캐릭터 1명에게 불안 2개, 다른 캐릭터 1명에게 음모 1개를 놓습니다.",
  missingPerson: "범인을 원하는 장소로 옮기고 그 장소에 음모 1개를 놓습니다.",
  murder: "범인과 같은 장소의 다른 캐릭터 1명이 사망합니다.",
  spreading: "캐릭터 1명의 우호를 최대 2개 제거한 뒤 다른 캐릭터에게 우호 2개를 놓습니다.",
  suicide: "범인이 사망합니다.",
};

function roleName(role: RoleId): string {
  return ROLE_IMPL[role]?.ko ?? role;
}

function characterName(character: CharacterId): string {
  return characterDataOf(character).ko;
}

function plotName(plot: string): string {
  return PLOT_IMPL[plot]?.ko ?? plot;
}

function incidentName(incident: string): string {
  return INCIDENT_IMPL[incident]?.ko ?? incident;
}

function activePlots(state: GameState): string[] {
  return [state.scenario.mainPlot, ...state.scenario.subPlots];
}

function castCharacters(state: GameState): CharacterId[] {
  return Object.keys(state.scenario.cast).sort((left, right) =>
    characterName(left).localeCompare(characterName(right), "ko")
  );
}

function holders(state: GameState, role: RoleId): CharacterId[] {
  return castCharacters(state).filter(
    (character) => effectiveRole(state, character) === role,
  );
}

function actualRoleCondition(state: GameState, character: CharacterId): string {
  return `${characterName(character)}이(가) ${roleName(effectiveRole(state, character))}일 때`;
}

function locationName(location: Location): string {
  const names: Readonly<Record<Location, string>> = {
    Hospital: "병원",
    Shrine: "신사",
    City: "도심",
    School: "학교",
  };
  return names[location];
}

function rankedAbilities(character: CharacterId): Array<{
  ability: GoodwillAbilityData;
  abilityIndex: number;
}> {
  return characterDataOf(character).goodwillAbilities.flatMap(
    (ability, abilityIndex) => ability.rank === null
      ? []
      : [{ ability, abilityIndex }],
  );
}

function cannotBeRefused(ability: GoodwillAbilityData): boolean {
  return ability.immuneToGoodwillRefusel ||
    ability.en.toLowerCase().includes("cannot be refused");
}

function cleanRuleText(text: string): string {
  const replacements: Readonly<Record<string, string>> = {
    ":goodwill:": "우호",
    ":paranoia:": "불안",
    ":intrigue:": "음모",
    ":ai:": "AI",
    ":person:": "엑스트라",
    ":student:": "학생",
    ":patient:": "환자",
  };
  return Object.entries(replacements).reduce(
    (result, [token, replacement]) => result.split(token).join(replacement),
    text,
  );
}

function addIdentityExposure(
  state: GameState,
  output: MastermindCaution[],
): void {
  for (const role of ["cultist", "witch"] as const) {
    for (const character of holders(state, role)) {
      const refusable = rankedAbilities(character).filter(
        ({ ability }) => !cannotBeRefused(ability),
      );
      if (refusable.length === 0) continue;
      output.push({
        key: `identity:mandatory-refusal:${character}`,
        category: "identityExposure",
        title: `${characterName(character)} · 절대 우호 무시`,
        condition: actualRoleCondition(state, character),
        description: `이 캐릭터의 우호 능력은 반드시 거부해야 합니다. 주인공이 우호 능력을 쓰는 순간 ${roleName(role)} 계열임이 드러납니다.`,
        source: `${roleName(role)} 역할 · 주인공 설명서 28p`,
        severity: "warning",
      });
    }
  }

  for (const character of holders(state, "timeTraveler")) {
    output.push({
      key: `identity:time-traveler:${character}`,
      category: "identityExposure",
      title: `${characterName(character)} · 우호 금지 무시`,
      condition: actualRoleCondition(state, character),
      description: "이 캐릭터의 우호 금지는 강제로 무시됩니다. 우호 금지를 놓으면 불사 계열임이 드러납니다.",
      source: "시간 여행자 [강제] · 주인공 설명서 34p",
      severity: "warning",
    });
  }

  for (const character of castCharacters(state)) {
    for (const { ability, abilityIndex } of rankedAbilities(character)) {
      if (!cannotBeRefused(ability)) continue;
      output.push({
        key: `identity:cannot-refuse:${character}:${abilityIndex}`,
        category: "identityExposure",
        title: `${characterName(character)} [우호${ability.rank ?? "-"}] · 거부 불가`,
        condition: actualRoleCondition(state, character),
        description: `이 능력은 역할의 우호 무시 종류와 관계없이 거부할 수 없습니다. 각본가에게 선택권이 없습니다.`,
        source: `${characterName(character)} [우호${ability.rank ?? "-"}] 원문`,
        severity: "warning",
      });
    }
  }
}

function addRoleRisks(
  state: GameState,
  output: MastermindCaution[],
): void {
  const keyPeople = holders(state, "keyPerson");
  const serialKillers = holders(state, "serialKiller");

  for (const character of serialKillers) {
    output.push({
      key: `risk:serial-killer:${character}`,
      category: "uncontrolledRisk",
      title: `${characterName(character)} · 연쇄 살인마 강제 사망`,
      condition: actualRoleCondition(state, character),
      description: "라운드 종료에 같은 장소의 다른 생존자가 정확히 1명이면 그 캐릭터가 강제로 사망합니다. 각본가가 발동을 막을 수 없습니다.",
      source: "연쇄 살인마 [강제] 역할 원문",
      severity: "critical",
    });
  }

  for (const character of keyPeople) {
    output.push({
      key: `risk:key-person:${character}`,
      category: "uncontrolledRisk",
      title: `${characterName(character)} · 사망 즉시 루프 종료`,
      condition: actualRoleCondition(state, character),
      description: "어떤 원인으로든 사망하면 즉시 루프가 끝납니다. 사건과 연쇄 살인마의 사망 대상이 되지 않도록 배치를 확인하십시오.",
      source: "핵심 인물 [상시] 역할 원문",
      severity: "critical",
    });
  }

  for (const character of holders(state, "friend")) {
    output.push({
      key: `risk:friend:${character}`,
      category: "uncontrolledRisk",
      title: `${characterName(character)} · 사망 시 역할 공개`,
      condition: actualRoleCondition(state, character),
      description: "사망한 채 루프가 끝나면 역할을 공개하고, 공개된 뒤의 다음 루프부터 우호 1개를 받고 시작합니다.",
      source: "친구 [루프 종료/루프 시작] 역할 원문",
      severity: "warning",
    });
  }

  const lovedOnes = holders(state, "lovedOne");
  const lovers = holders(state, "lover");
  if (lovedOnes.length > 0 && lovers.length > 0) {
    const names = [...lovedOnes, ...lovers].map(characterName).join(" · ");
    output.push({
      key: "risk:lovers:counterpart-death",
      category: "uncontrolledRisk",
      title: `${names} · 상대 사망 시 불안 6`,
      condition: `${lovedOnes.map(characterName).join(" · ")}이(가) 연인A이고 ${lovers.map(characterName).join(" · ")}이(가) 연인B일 때`,
      description: "한쪽이 사망하면 살아 있는 상대에게 불안 6개가 강제로 놓입니다. 연인A의 사망 조건이나 사건 발생 판정이 뜻밖에 열릴 수 있습니다.",
      source: "연인A·연인B [강제] 역할 원문",
      severity: "critical",
    });
  }

  for (const character of holders(state, "factor")) {
    output.push({
      key: `risk:factor:${character}`,
      category: "uncontrolledRisk",
      title: `${characterName(character)} · 장소 음모에 따른 강제 능력 획득`,
      condition: actualRoleCondition(state, character),
      description: "학교 음모 2개 이상이면 선동가 능력, 도심 음모 2개 이상이면 핵심 인물의 ‘사망 즉시 루프 종료’ 능력을 얻습니다. 역할 자체는 바뀌지 않습니다.",
      source: "변수 [상시·강제] 역할 원문",
      severity: "critical",
    });
  }

  const deadlyIncidentLabels = state.scenario.incidents.filter(
    ({ incident, culprit }) => DEATH_INCIDENTS.has(incident) &&
      (incident !== "suicide" || keyPeople.includes(culprit)),
  ).map(({ day, incident }) => `${day}일 ${incidentName(incident)}`);
  if (
    keyPeople.length > 0 && holders(state, "killer").length > 0 &&
    deadlyIncidentLabels.length > 0
  ) {
    output.push({
      key: "risk:self-sabotage:killer-route",
      category: "uncontrolledRisk",
      title: "자기 승리 방해 · 청부업자 경로 소멸",
      condition: `${keyPeople.map(characterName).join(" · ")}가 사건으로 먼저 사망할 수 있을 때`,
      description: `핵심 인물이 먼저 죽으면 살인 청부업자로 죽이는 계획은 더 진행할 수 없습니다. 관련 사건: ${deadlyIncidentLabels.join(" · ")}.`,
      source: "핵심 인물 즉시 종료 + 사건 사망 원문",
      severity: "critical",
    });
  }
  if (keyPeople.length > 0 && serialKillers.length > 0) {
    output.push({
      key: "risk:self-sabotage:serial-key-person",
      category: "uncontrolledRisk",
      title: "자기 승리 방해 · 연쇄 살인마가 핵심 인물 사망", 
      condition: `${serialKillers.map(characterName).join(" · ")}와 ${keyPeople.map(characterName).join(" · ")}가 단둘이 될 수 있을 때`,
      description: "강제 사망 직후 루프가 즉시 끝나므로, 같은 날 뒤에 준비한 사건이나 다른 패배 조건 계획은 무산됩니다.",
      source: "연쇄 살인마 강제 사망 + 핵심 인물 즉시 종료",
      severity: "critical",
    });
  }
}

function addPlotRisks(
  state: GameState,
  output: MastermindCaution[],
): void {
  const plots = activePlots(state);
  if (plots.includes("threadsFate")) {
    output.push({
      key: "risk:plot:threads-fate",
      category: "uncontrolledRisk",
      title: `${plotName("threadsFate")} · 직전 우호 보유자 전원 불안 2`,
      condition: "인과율이 선택된 시나리오",
      description: "루프 시작 시 직전 루프 종료 때 우호가 있던 생존 캐릭터 전원에게 불안 2개가 강제로 놓입니다.",
      source: "인과율 [루프 시작·강제] 룰 원문",
      severity: "critical",
    });
  }
  if (plots.includes("paranoiaVirus")) {
    const people = holders(state, "person");
    output.push({
      key: "risk:plot:paranoia-virus",
      category: "uncontrolledRisk",
      title: `${plotName("paranoiaVirus")} · 엑스트라의 연쇄 살인마 변이`,
      condition: "망상 확대 바이러스가 선택된 시나리오",
      description: `${people.length === 0 ? "엑스트라" : people.map(characterName).join(" · ")}에게 불안 3개 이상이 놓이면 연쇄 살인마로 취급되어 단둘이 사망 효과가 강제 발동할 수 있습니다.`,
      source: "망상 확대 바이러스 [상시·강제] 룰 원문",
      severity: "critical",
    });
  }
}

function addTraitRisks(
  state: GameState,
  output: MastermindCaution[],
): void {
  const cast = new Set(castCharacters(state));
  if (cast.has("blackCat")) {
    output.push({
      key: "risk:trait:black-cat-loop-start",
      category: "uncontrolledRisk",
      title: "검은 고양이 · 루프 시작 신사 음모 1",
      condition: "검은 고양이가 캐스트에 있을 때",
      description: "매 루프 시작 시 신사에 음모 1개가 강제로 놓입니다.",
      source: "검은 고양이 [루프 시작·강제] 특성 원문",
      severity: "warning",
    });
  }
  if (cast.has("scientist")) {
    output.push({
      key: "risk:trait:scientist",
      category: "uncontrolledRisk",
      title: "학자 · 루프 시작 카운터 필수 선택",
      condition: "학자가 캐스트에 있을 때",
      description: "매 루프 시작 시 학자에게 불안·우호·음모 중 1개를 반드시 놓습니다. 시작 전에 종류를 선택해야 합니다.",
      source: "학자 [루프 시작·강제] 특성 원문",
      severity: "warning",
    });
  }
  if (cast.has("henchman")) {
    output.push({
      key: "risk:trait:henchman-placement",
      category: "uncontrolledRisk",
      title: "하수인 · 매 루프 시작 장소 선택",
      condition: "하수인이 캐스트에 있을 때",
      description: "각본가가 매 루프 새 시작 장소를 반드시 선택합니다. 장소 X가 하수인의 역할을 참조하면 이 선택이 장소 X도 바꿉니다.",
      source: "하수인 [루프 시작] 특성 원문",
      severity: "warning",
    });
  }
  if (cast.has("boss")) {
    const turf = state.loop.turfLocations.boss;
    output.push({
      key: "risk:trait:boss-turf",
      category: "uncontrolledRisk",
      title: `거물 · ${turf === undefined ? "세력권" : locationName(turf)}에도 능력 도달`,
      condition: actualRoleCondition(state, "boss"),
      description: `사건을 제외한 모든 능력에서 실제 장소뿐 아니라 ${turf === undefined ? "지정 세력권" : locationName(turf)}에 있는 것으로도 취급할 수 있습니다. 역할 능력과 우호 능력의 범위를 실제 위치만 보고 놓치지 마십시오.`,
      source: "거물 [상시] 특성 원문",
      severity: "warning",
    });
  }
  if (cast.has("illusion")) {
    output.push({
      key: "risk:trait:illusion",
      category: "uncontrolledRisk",
      title: "환상 · 장소 카드가 함께 적용",
      condition: "환상이 캐스트에 있을 때",
      description: "환상에는 행동 카드를 직접 놓을 수 없고, 환상이 있는 장소에 놓인 모든 행동 카드가 환상에게도 적용됩니다.",
      source: "환상 [카드 배치/해결·강제] 특성 원문",
      severity: "critical",
    });
  }
  if (cast.has("sectFounder")) {
    output.push({
      key: "risk:trait:sect-founder",
      category: "uncontrolledRisk",
      title: "교주 · 범인인 사건 효과 2회 해결",
      condition: "교주가 사건 범인일 때",
      description: "교주가 범인인 사건이 해결되면 그 사건 효과를 두 번 해결합니다. 첫 해결 뒤의 상태를 기준으로 두 번째 효과까지 대비해야 합니다.",
      source: "교주 [강제] 특성 원문",
      severity: "critical",
    });
  }
  if (cast.has("sacredTree")) {
    const role = effectiveRole(state, "sacredTree");
    const hasRefusal = ROLE_IMPL[role]?.goodwillRefusal !== undefined;
    output.push({
      key: "risk:trait:sacred-tree",
      category: "uncontrolledRisk",
      title: "신수 · 카운터 이동",
      condition: actualRoleCondition(state, "sacredTree"),
      description: hasRefusal
        ? "리더가 매 라운드 신수의 카운터 1개를 같은 장소의 다른 캐릭터에게 옮길 수 있습니다. 우호 무시 역할이므로 각본가도 능력 단계에 반드시 같은 이동을 해야 합니다."
        : "리더가 매 라운드 신수의 카운터 1개를 같은 장소의 다른 캐릭터에게 옮길 수 있습니다.",
      source: "신수 특성 원문",
      severity: hasRefusal ? "critical" : "warning",
    });
  }

  for (const character of ["godlyBeing", "transferStudent"] as const) {
    if (!cast.has(character)) continue;
    const entry = characterEntryTiming(state.scenario, character);
    if (entry === undefined) continue;
    const timing = entry.kind === "loop"
      ? `${entry.value}루프 시작`
      : `${entry.value}일 시작`;
    output.push({
      key: `risk:trait:entry:${character}`,
      category: "uncontrolledRisk",
      title: `${characterName(character)} · ${timing}에 등장`,
      condition: `${characterName(character)}이(가) 캐스트에 있을 때`,
      description: `그전까지 게임판에 없고 ${timing}에 강제로 등장합니다. 사망·사건·장소 계획에 너무 일찍 포함하지 마십시오.`,
      source: `${characterName(character)} 등장 특성 원문`,
      severity: "warning",
    });
  }
}

function addIncidentRisks(
  state: GameState,
  output: MastermindCaution[],
): void {
  for (const scheduled of [...state.scenario.incidents].sort(
    (left, right) => left.day - right.day,
  )) {
    const culprit = characterName(scheduled.culprit);
    let description = INCIDENT_EFFECTS[scheduled.incident] ??
      "사건 원문의 효과를 해결합니다.";
    let severity: MastermindCautionSeverity = DEATH_INCIDENTS.has(
      scheduled.incident,
    ) ? "critical" : "warning";
    if (scheduled.culprit === "blackCat") {
      description = "불안 한계 판정상 사건은 발생하지만 효과는 없습니다. 발생 이력은 남으므로 ‘발생한 사건’ 조건에는 사용됩니다.";
      severity = "critical";
    } else if (scheduled.culprit === "sectFounder") {
      description += " 교주 특성 때문에 이 효과를 두 번 해결합니다.";
      severity = "critical";
    }
    output.push({
      key: `risk:incident:${scheduled.day}:${scheduled.incident}:${scheduled.culprit}`,
      category: "uncontrolledRisk",
      title: `${scheduled.day}일 ${incidentName(scheduled.incident)} · 범인 ${culprit}`,
      condition: `${scheduled.day}일에 ${culprit}이(가) 생존·등장 중이고 사건 불안 한계를 충족할 때`,
      description,
      source: `${incidentName(scheduled.incident)} [강제] 사건 원문`,
      severity,
    });
  }

  const aiIncidents = state.scenario.incidents.filter(
    ({ culprit }) => culprit === "ai",
  );
  if (aiIncidents.length > 0) {
    output.push({
      key: "risk:trait:ai-incident-counters",
      category: "uncontrolledRisk",
      title: "AI · 모든 카운터를 불안으로 사건 판정",
      condition: `AI가 ${aiIncidents.map(({ day, incident }) => `${day}일 ${incidentName(incident)}`).join(" · ")}의 범인일 때`,
      description: "AI가 범인인 사건의 발생 여부를 판정할 때 AI 위의 우호·불안·음모·보호 카운터를 모두 불안으로 셉니다.",
      source: "AI [사건 판정·강제] 특성 원문",
      severity: "critical",
    });
  }
}

function responseLabel(
  state: GameState,
  character: CharacterId,
  ability: GoodwillAbilityData,
): string {
  if (cannotBeRefused(ability)) return "거부 불가";
  const refusal = ROLE_IMPL[effectiveRole(state, character)]?.goodwillRefusal;
  if (refusal === "Mandatory") return "반드시 거부";
  if (refusal === "Optional") return "각본가가 거부 가능";
  return "거부 불가";
}

function abilityAvailability(ability: GoodwillAbilityData): string[] {
  const conditions: string[] = [];
  if (ability.minLoop !== null) conditions.push(`${ability.minLoop}루프부터`);
  if (ability.restrictedToLocation !== null) {
    conditions.push(`${ability.restrictedToLocation.map(locationName).join("/")}에서만`);
  }
  if (ability.timesPerLoop !== null) {
    conditions.push(`루프당 ${ability.timesPerLoop}회`);
  }
  return conditions;
}

function addProtagonistTools(
  state: GameState,
  output: MastermindCaution[],
): void {
  for (const character of castCharacters(state)) {
    for (const { ability, abilityIndex } of rankedAbilities(character)) {
      const availability = abilityAvailability(ability);
      let description = cleanRuleText(ability.ko);
      if (character === "henchman" && ability.rank === 3) {
        description += " 주인공이 쓰면 이후 이 캐릭터가 범인인 예정 사건은 발생하지 않습니다.";
      }
      if (character === "ai" && ability.rank === 3) {
        description += " 오늘 이후의 사건도 미리 골라 해결할 수 있어 각본가의 배치·사망 계획을 흐트러뜨릴 수 있습니다. 이 해결은 사건 발생 이력에는 남지 않습니다.";
      }
      output.push({
        key: `tool:goodwill:${character}:${abilityIndex}`,
        category: "protagonistTool",
        title: `${characterName(character)} [우호${ability.rank ?? "-"}] · ${responseLabel(state, character, ability)}`,
        condition: `${actualRoleCondition(state, character)}${availability.length === 0 ? "" : ` · ${availability.join(" · ")}`}`,
        description,
        source: `${characterName(character)} [우호${ability.rank ?? "-"}] 원문`,
        severity: character === "ai" || character === "henchman" ||
            description.includes("사망") || description.includes("역할") ||
            description.includes("음모")
          ? "critical"
          : "note",
      });
    }
  }

  if (state.scenario.cast.sacredTree !== undefined) {
    output.push({
      key: "tool:trait:sacred-tree",
      category: "protagonistTool",
      title: "신수 특성 · 매 라운드 카운터 이동",
      condition: "신수가 캐스트에 있을 때",
      description: "리더는 매 라운드 신수의 카운터 1개를 같은 장소의 다른 캐릭터에게 옮길 수 있습니다.",
      source: "신수 특성 원문",
      severity: "critical",
    });
  }
}

export function mastermindCautions(state: GameState): MastermindCautions {
  const identityExposure: MastermindCaution[] = [];
  const uncontrolledRisks: MastermindCaution[] = [];
  const protagonistTools: MastermindCaution[] = [];

  addIdentityExposure(state, identityExposure);
  addRoleRisks(state, uncontrolledRisks);
  addPlotRisks(state, uncontrolledRisks);
  addTraitRisks(state, uncontrolledRisks);
  addIncidentRisks(state, uncontrolledRisks);
  addProtagonistTools(state, protagonistTools);

  const keys = [...identityExposure, ...uncontrolledRisks, ...protagonistTools]
    .map(({ key }) => key);
  if (new Set(keys).size !== keys.length) {
    throw new Error("mastermind caution keys must be unique");
  }

  return {
    identityExposure,
    uncontrolledRisks,
    protagonistTools,
    total: keys.length,
  };
}
