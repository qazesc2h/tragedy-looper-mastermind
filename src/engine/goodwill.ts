import { characterDataOf, type GoodwillAbilityData } from "../data";
import { ROLE_IMPL } from "../impl/roles";
import {
  characterLocation,
  effectiveRole,
  isCharacterAlive,
  isCharacterDead,
  isCharacterPresent,
  type ActionCard,
  type CharacterId,
  type GameState,
  type IncidentChoice,
  type IncidentSelection,
  type PlotId,
  type PublicInformation,
  type RoleId,
  type ScheduledIncident,
  type Target,
} from "../types";
import { killCharacter, reviveCharacter, withDeathBatch } from "./death";
import { resolveIncidentEffect } from "./incident";
import { recordPhaseLog } from "./phase-log";

export type GoodwillResponse = "resolve" | "refuse";
export type GoodwillRefusalKind = "none" | "optional" | "mandatory";

export interface GoodwillResponseAvailability {
  role: RoleId;
  refusalKind: GoodwillRefusalKind;
  resolveAllowed: boolean;
  refuseAllowed: boolean;
}

/** 리더가 선언하는 우호 능력과 그 효과에 필요한 선택. */
export interface GoodwillDeclaration {
  user: CharacterId;
  rank: number;
  /** 같은 랭크가 둘 이상이면 data/characters.json 배열의 인덱스가 필요하다. */
  abilityIndex?: number;
  target?: CharacterId | Target;
  paranoiaDelta?: -1 | 1;
  card?: ActionCard;
  incident?: IncidentSelection;
  incidentChoice?: IncidentChoice;
  declaredSubplot?: PlotId;
  revealedSubplot?: PlotId;
}

export interface GoodwillUse extends GoodwillDeclaration {
  mastermindResponse: GoodwillResponse;
}

export interface GoodwillResult {
  user: CharacterId;
  rank: number;
  abilityIndex: number;
  response: GoodwillResponse;
  resolved: boolean;
  refused: boolean;
  effectApplied: boolean;
}

interface SelectedAbility {
  ability: GoodwillAbilityData;
  index: number;
}

function selectAbility(
  declaration: GoodwillDeclaration,
): SelectedAbility {
  const abilities = characterDataOf(declaration.user).goodwillAbilities;

  if (declaration.abilityIndex !== undefined) {
    const ability = abilities[declaration.abilityIndex];
    if (!ability || ability.rank !== declaration.rank) {
      throw new Error(
        `character "${declaration.user}" has no rank ${declaration.rank} ` +
        `goodwill ability at index ${declaration.abilityIndex}`,
      );
    }
    return { ability, index: declaration.abilityIndex };
  }

  const matches = abilities
    .map((ability, index) => ({ ability, index }))
    .filter(({ ability }) => ability.rank === declaration.rank);
  if (matches.length === 0) {
    throw new Error(
      `character "${declaration.user}" has no rank ${declaration.rank} ` +
      "goodwill ability",
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `character "${declaration.user}" has multiple rank ` +
      `${declaration.rank} goodwill abilities; abilityIndex is required`,
    );
  }
  return matches[0];
}

function abilityUseKey(user: CharacterId, abilityIndex: number): string {
  return `${user}:goodwill:${abilityIndex}`;
}

function assertAbilityAvailable(
  state: GameState,
  declaration: GoodwillDeclaration,
  selected: SelectedAbility,
): void {
  const position = state.loop.board[declaration.user];
  const counters = state.loop.charCounters[declaration.user];
  if (!position || !counters) {
    throw new Error(`unknown goodwill ability user "${declaration.user}"`);
  }
  if (state.loop.phase !== "P6_GOODWILL") {
    throw new Error("goodwill abilities can only be used during P6_GOODWILL");
  }
  if (!isCharacterAlive(position)) {
    if (!isCharacterPresent(position)) {
      throw new Error(
        `character "${declaration.user}" is absent and cannot use goodwill abilities`,
      );
    }
    throw new Error(
      `character "${declaration.user}" is dead and cannot use goodwill abilities`,
    );
  }
  if (
    selected.ability.minLoop !== null &&
    state.loop.loop < selected.ability.minLoop
  ) {
    throw new Error(
      `rank ${declaration.rank} goodwill ability for ` +
      `"${declaration.user}" is available from loop ` +
      `${selected.ability.minLoop}`,
    );
  }
  if (counters.goodwill < declaration.rank) {
    throw new Error(
      `character "${declaration.user}" needs ${declaration.rank} goodwill`,
    );
  }
  if (
    selected.ability.restrictedToLocation !== null &&
    !selected.ability.restrictedToLocation.includes(
      characterLocation(position, declaration.user),
    )
  ) {
    throw new Error(
      `rank ${declaration.rank} goodwill ability for ` +
      `"${declaration.user}" cannot be used at ${characterLocation(
        position,
        declaration.user,
      )}`,
    );
  }

  const key = abilityUseKey(declaration.user, selected.index);
  if (state.loop.abilitiesUsedThisRound.includes(key)) {
    throw new Error(
      `rank ${declaration.rank} goodwill ability for ` +
      `"${declaration.user}" is already used this round`,
    );
  }

  const limit = selected.ability.timesPerLoop;
  if (limit !== null) {
    const used = state.loop.abilitiesUsedThisLoop.filter(
      (usedKey) => usedKey === key,
    ).length;
    if (used >= limit) {
      throw new Error(
        `rank ${declaration.rank} goodwill ability for ` +
        `"${declaration.user}" is already spent this loop`,
      );
    }
  }
}

function recordAbilityUse(
  state: GameState,
  declaration: GoodwillDeclaration,
  selected: SelectedAbility,
): void {
  const key = abilityUseKey(declaration.user, selected.index);
  state.loop.abilitiesUsedThisRound.push(key);
  if (selected.ability.timesPerLoop !== null) {
    state.loop.abilitiesUsedThisLoop.push(key);
  }
}

function normalizeTarget(target: GoodwillDeclaration["target"]):
  | Target
  | undefined {
  if (typeof target === "string") {
    return { kind: "character", id: target };
  }
  return target;
}

function requireCharacterTarget(
  state: GameState,
  declaration: GoodwillDeclaration,
): CharacterId {
  const target = normalizeTarget(declaration.target);
  if (target?.kind !== "character" || !state.loop.board[target.id]) {
    throw new Error("goodwill ability requires a character target");
  }
  if (!isCharacterPresent(state.loop.board[target.id])) {
    throw new Error("goodwill ability cannot target an absent character");
  }
  return target.id;
}

function requireLivingCharacterInSameLocation(
  state: GameState,
  declaration: GoodwillDeclaration,
): CharacterId {
  const target = requireCharacterTarget(state, declaration);
  const userPosition = state.loop.board[declaration.user];
  const targetPosition = state.loop.board[target];
  if (
    !isCharacterAlive(targetPosition) ||
    !isCharacterAlive(userPosition) ||
    characterLocation(targetPosition, target) !==
      characterLocation(userPosition, declaration.user)
  ) {
    throw new Error(
      "goodwill ability target must be a living character in the same location",
    );
  }
  return target;
}

function requireLivingCharacterInTurf(
  state: GameState,
  declaration: GoodwillDeclaration,
): CharacterId {
  const target = requireCharacterTarget(state, declaration);
  const targetPosition = state.loop.board[target];
  const turf = state.loop.turfLocations[declaration.user];
  if (
    target === declaration.user ||
    !isCharacterAlive(targetPosition) ||
    turf === undefined ||
    characterLocation(targetPosition, target) !== turf
  ) {
    throw new Error(
      "boss rank 5 goodwill ability requires another living character in turf",
    );
  }
  return target;
}

function changeParanoia(
  state: GameState,
  target: CharacterId,
  amount: -1 | 1 | 2,
): boolean {
  const counters = state.loop.charCounters[target];
  const before = counters.paranoia;
  counters.paranoia = Math.max(0, before + amount);
  return counters.paranoia !== before;
}

function revealRole(state: GameState, character: CharacterId): boolean {
  const revealed = state.loop.revealedRoleCharacters ??= [];
  if (revealed.includes(character)) return false;
  revealed.push(character);
  recordPublicInformation(state, {
    kind: "roleReveal",
    character,
    role: effectiveRole(state, character),
    loop: state.loop.loop,
    day: state.loop.day,
  });
  return true;
}

function removeLocationRestriction(
  state: GameState,
  character: CharacterId,
): boolean {
  const removed = state.loop.locationRestrictionsRemoved ??= [];
  if (removed.includes(character)) return false;
  removed.push(character);
  return true;
}

function requireScenarioIncident(
  state: GameState,
  declaration: GoodwillDeclaration,
): ScheduledIncident {
  const selected = declaration.incident;
  if (selected === undefined) {
    throw new Error("goodwill ability requires an incident choice");
  }
  const scheduled = state.scenario.incidents.find(({ day, incident }) =>
    day === selected.day && incident === selected.incident
  );
  if (scheduled === undefined) {
    throw new Error("chosen incident is not in the scenario");
  }
  return scheduled;
}

function recordPublicInformation(
  state: GameState,
  information: PublicInformation,
): void {
  const records = state.loop.publicInformationThisLoop ??= [];
  records.push(information);
}

function addCharacterOnce(
  characters: CharacterId[],
  character: CharacterId,
): boolean {
  if (characters.includes(character)) return false;
  characters.push(character);
  return true;
}

function suppressOwnIncidents(
  state: GameState,
  character: CharacterId,
): boolean {
  const suppressed = state.loop.incidentCulpritSuppressedFor ??= [];
  return addCharacterOnce(suppressed, character);
}

function preventProtagonistDeath(
  state: GameState,
  character: CharacterId,
): boolean {
  const preventers = state.loop.protagonistDeathPreventedBy ??= [];
  return addCharacterOnce(preventers, character);
}

function revealScenarioIncidentCulprit(
  state: GameState,
  declaration: GoodwillDeclaration,
  source: "godlyBeing" | "policeOfficer",
): boolean {
  const scheduled = requireScenarioIncident(state, declaration);
  if (source === "policeOfficer") {
    const fired = state.loop.incidentOccurrencesFiredThisLoop?.some(
      ({ day, incident, culprit }) =>
        day === scheduled.day &&
        incident === scheduled.incident &&
        culprit === scheduled.culprit,
    ) ?? false;
    if (!fired) {
      throw new Error(
        "policeOfficer goodwill ability requires an incident that fired this loop",
      );
    }
  }

  recordPublicInformation(state, {
    kind: "incidentCulprit",
    source,
    day: scheduled.day,
    incident: scheduled.incident,
    culprit: scheduled.culprit,
  });
  return true;
}

function revealActiveSubplot(
  state: GameState,
  declaration: GoodwillDeclaration,
): boolean {
  const declaredSubplot = declaration.declaredSubplot;
  const revealedSubplot = declaration.revealedSubplot;
  if (!declaredSubplot) {
    throw new Error("informer goodwill ability requires the leader's subplot declaration");
  }
  if (!revealedSubplot) {
    throw new Error("informer goodwill ability requires a subplot to reveal");
  }
  if (!state.scenario.subPlots.includes(revealedSubplot)) {
    throw new Error("informer can only reveal an active subplot");
  }
  if (declaredSubplot === revealedSubplot) {
    throw new Error("informer must reveal a different active subplot");
  }

  recordPublicInformation(state, {
    kind: "subplot",
    source: "informer",
    declaredSubplot,
    revealedSubplot,
  });
  return true;
}

function resolveIncidentAsAi(
  state: GameState,
  declaration: GoodwillDeclaration,
): boolean {
  const scheduled = requireScenarioIncident(state, declaration);
  const effectApplied = resolveIncidentEffect(
    state,
    scheduled.incident,
    declaration.user,
    declaration.incidentChoice,
  );
  recordPublicInformation(state, {
    kind: "incidentEffect",
    source: "ai",
    day: scheduled.day,
    incident: scheduled.incident,
    culprit: declaration.user,
    effectApplied,
  });
  return effectApplied;
}

function applyStudentParanoiaReduction(
  state: GameState,
  declaration: GoodwillDeclaration,
): boolean {
  const target = requireLivingCharacterInSameLocation(state, declaration);
  if (!characterDataOf(target).tags.includes("student")) {
    throw new Error("goodwill ability target must be a student");
  }
  return changeParanoia(state, target, -1);
}

function applyRichStudentAbility(
  state: GameState,
  declaration: GoodwillDeclaration,
): boolean {
  const target = requireLivingCharacterInSameLocation(state, declaration);
  state.loop.charCounters[target].goodwill += 1;
  return true;
}

function applyDoctorAbility(
  state: GameState,
  declaration: GoodwillDeclaration,
): boolean {
  if (declaration.rank === 2) {
    const target = requireLivingCharacterInSameLocation(state, declaration);
    if (
      declaration.paranoiaDelta !== -1 &&
      declaration.paranoiaDelta !== 1
    ) {
      throw new Error("doctor rank 2 goodwill ability requires paranoiaDelta");
    }
    return changeParanoia(state, target, declaration.paranoiaDelta);
  }

  const target = requireCharacterTarget(state, declaration);
  if (target !== "patient") {
    throw new Error("doctor rank 3 goodwill ability must target patient");
  }
  return removeLocationRestriction(state, target);
}

function applySimpleBaseAbility(
  state: GameState,
  declaration: GoodwillDeclaration,
  selected: SelectedAbility,
): boolean | undefined {
  const key = `${declaration.user}:${selected.index}`;

  switch (key) {
    case "boyStudent:0":
    case "girlStudent:0":
      return applyStudentParanoiaReduction(state, declaration);

    case "richStudent:0":
      return applyRichStudentAbility(state, declaration);

    case "classRep:0": {
      if (!declaration.card) {
        throw new Error("classRep goodwill ability requires a card choice");
      }
      const spent = state.loop.spentOncePerLoop.protagonists[state.loop.leader];
      const cardIndex = spent.indexOf(declaration.card);
      if (cardIndex < 0) {
        throw new Error("the chosen leader card is not spent");
      }
      spent.splice(cardIndex, 1);
      return true;
    }

    case "mysteryBoy:1":
    case "officeWorker:0":
      return revealRole(state, declaration.user);

    case "boss:1": {
      const target = requireLivingCharacterInTurf(state, declaration);
      return revealRole(state, target);
    }

    case "shrineMaiden:0": {
      const before = state.loop.locIntrigue.Shrine;
      state.loop.locIntrigue.Shrine = Math.max(0, before - 1);
      return state.loop.locIntrigue.Shrine !== before;
    }

    case "shrineMaiden:1": {
      const target = requireLivingCharacterInSameLocation(state, declaration);
      return revealRole(state, target);
    }

    case "alien:0": {
      const target = requireLivingCharacterInSameLocation(state, declaration);
      return killCharacter(state, target);
    }

    case "alien:1": {
      const target = requireCharacterTarget(state, declaration);
      const userPosition = state.loop.board[declaration.user];
      const targetPosition = state.loop.board[target];
      if (
        !isCharacterDead(targetPosition) ||
        !isCharacterAlive(userPosition) ||
        characterLocation(targetPosition, target) !==
          characterLocation(userPosition, declaration.user)
      ) {
        throw new Error(
          "alien rank 5 goodwill ability requires a corpse in the same location",
        );
      }
      return reviveCharacter(state, target);
    }

    case "godlyBeing:1":
      return revealScenarioIncidentCulprit(
        state,
        declaration,
        "godlyBeing",
      );

    case "godlyBeing:2": {
      const target = normalizeTarget(declaration.target);
      const userLocation = characterLocation(
        state.loop.board[declaration.user],
        declaration.user,
      );
      if (target?.kind === "location") {
        if (target.at !== userLocation) {
          throw new Error("goodwill ability location target must be this location");
        }
        const before = state.loop.locIntrigue[target.at];
        state.loop.locIntrigue[target.at] = Math.max(0, before - 1);
        return state.loop.locIntrigue[target.at] !== before;
      }
      const character = requireLivingCharacterInSameLocation(
        state,
        declaration,
      );
      const counters = state.loop.charCounters[character];
      const before = counters.intrigue;
      counters.intrigue = Math.max(0, before - 1);
      return counters.intrigue !== before;
    }

    case "policeOfficer:0":
      return revealScenarioIncidentCulprit(
        state,
        declaration,
        "policeOfficer",
      );

    case "policeOfficer:1": {
      const target = requireLivingCharacterInSameLocation(state, declaration);
      if (target === declaration.user) {
        throw new Error("policeOfficer protection target must be another character");
      }
      state.loop.charCounters[target].protection += 1;
      return true;
    }

    case "popIdol:0": {
      const target = requireLivingCharacterInSameLocation(state, declaration);
      return changeParanoia(state, target, -1);
    }

    case "popIdol:1": {
      const target = requireLivingCharacterInSameLocation(state, declaration);
      state.loop.charCounters[target].goodwill += 1;
      return true;
    }

    case "journalist:0": {
      const target = requireCharacterTarget(state, declaration);
      if (target === declaration.user) {
        throw new Error("journalist paranoia target must be another character");
      }
      return changeParanoia(state, target, 1);
    }

    case "journalist:1": {
      const target = normalizeTarget(declaration.target);
      const location = characterLocation(
        state.loop.board[declaration.user],
        declaration.user,
      );
      if (target?.kind === "location") {
        if (target.at !== location) {
          throw new Error("journalist target must be this location");
        }
        state.loop.locIntrigue[target.at] += 1;
        return true;
      }
      const character = requireLivingCharacterInSameLocation(
        state,
        declaration,
      );
      state.loop.charCounters[character].intrigue += 1;
      return true;
    }

    case "doctor:0":
    case "doctor:1":
      return applyDoctorAbility(state, declaration);

    case "nurse:0": {
      const target = requireLivingCharacterInSameLocation(state, declaration);
      const counters = state.loop.charCounters[target];
      if (counters.paranoia < characterDataOf(target).paranoiaLimit) {
        throw new Error("nurse goodwill ability target must be panicked");
      }
      return changeParanoia(state, target, -1);
    }

    case "henchman:1":
      return suppressOwnIncidents(state, declaration.user);

    case "teacher:0": {
      const target = requireLivingCharacterInSameLocation(state, declaration);
      if (!characterDataOf(target).tags.includes("student")) {
        throw new Error("teacher goodwill ability target must be a student");
      }
      if (
        declaration.paranoiaDelta !== -1 &&
        declaration.paranoiaDelta !== 1
      ) {
        throw new Error("teacher rank 3 goodwill ability requires paranoiaDelta");
      }
      return changeParanoia(state, target, declaration.paranoiaDelta);
    }

    case "teacher:1": {
      const target = requireLivingCharacterInSameLocation(state, declaration);
      if (!characterDataOf(target).tags.includes("student")) {
        throw new Error("teacher goodwill ability target must be a student");
      }
      return revealRole(state, target);
    }

    case "transferStudent:1": {
      const target = requireLivingCharacterInSameLocation(state, declaration);
      if (target === declaration.user) {
        throw new Error("transferStudent target must be another character");
      }
      const counters = state.loop.charCounters[target];
      if (counters.intrigue < 1) {
        throw new Error("transferStudent target must have an intrigue counter");
      }
      counters.intrigue -= 1;
      counters.goodwill += 1;
      return true;
    }

    case "soldier:0": {
      const target = requireLivingCharacterInSameLocation(state, declaration);
      if (target === declaration.user) {
        throw new Error("soldier target must be another character");
      }
      return changeParanoia(state, target, 2);
    }

    case "soldier:1":
      return preventProtagonistDeath(state, declaration.user);

    case "forensicSpecialist:1": {
      const target = requireCharacterTarget(state, declaration);
      if (!isCharacterDead(state.loop.board[target])) {
        throw new Error("forensicSpecialist rank 5 target must be a corpse");
      }
      return revealRole(state, target);
    }

    case "informer:0":
      return revealActiveSubplot(state, declaration);

    case "ai:2":
      return resolveIncidentAsAi(state, declaration);

    default:
      return undefined;
  }
}

function abilityCannotBeRefused(ability: GoodwillAbilityData): boolean {
  return ability.immuneToGoodwillRefusel;
}

/** effectiveRole 기준으로 각본가가 이 능력을 해결하거나 거부할 수 있는지 계산한다. */
export function goodwillResponseAvailability(
  state: GameState,
  character: CharacterId,
  cannotBeRefused: boolean,
): GoodwillResponseAvailability {
  const role = effectiveRole(state, character);
  const refusal = ROLE_IMPL[role]?.goodwillRefusal;
  const refusalKind: GoodwillRefusalKind = refusal === "Optional"
    ? "optional"
    : refusal === "Mandatory"
      ? "mandatory"
      : "none";
  return {
    role,
    refusalKind,
    resolveAllowed: refusalKind !== "mandatory" || cannotBeRefused,
    refuseAllowed: refusalKind !== "none" && !cannotBeRefused,
  };
}

/** 선언 하나를 현재 상태에서 판정하고, 각본가의 응답에 따라 즉시 해결한다. */
export function resolveGoodwillAbility(
  state: GameState,
  declaration: GoodwillDeclaration,
  mastermindResponse: GoodwillResponse,
): GoodwillResult {
  const selected = selectAbility(declaration);
  assertAbilityAvailable(state, declaration, selected);

  const cannotBeRefused = abilityCannotBeRefused(selected.ability);
  const availability = goodwillResponseAvailability(
    state,
    declaration.user,
    cannotBeRefused,
  );

  if (mastermindResponse === "refuse" && cannotBeRefused) {
    throw new Error("this goodwill ability cannot be refused");
  }
  if (mastermindResponse === "refuse" && !availability.refuseAllowed) {
    throw new Error(
      `role "${availability.role}" cannot refuse goodwill abilities`,
    );
  }

  if (!availability.resolveAllowed || mastermindResponse === "refuse") {
    recordAbilityUse(state, declaration, selected);
    recordPublicInformation(state, {
      kind: "goodwillRefusal",
      character: declaration.user,
      rank: declaration.rank,
      abilityIndex: selected.index,
      loop: state.loop.loop,
      day: state.loop.day,
    });
    recordPhaseLog(state, {
      loop: state.loop.loop,
      day: state.loop.day,
      phase: "P6_GOODWILL",
      kind: "goodwillUsed",
      character: declaration.user,
      rank: declaration.rank,
      abilityIndex: selected.index,
      response: "refuse",
      effectApplied: false,
    });
    return {
      user: declaration.user,
      rank: declaration.rank,
      abilityIndex: selected.index,
      response: "refuse",
      resolved: false,
      refused: true,
      effectApplied: false,
    };
  }

  // P6 선언 하나의 효과가 끝나면 사망 배치를 즉시 닫는다.
  const effectApplied = withDeathBatch(state, () =>
    applySimpleBaseAbility(
      state,
      declaration,
      selected,
    )
  );
  if (effectApplied === undefined) {
    throw new Error(
      `goodwill effect is not implemented for "${declaration.user}" ` +
      `ability index ${selected.index}`,
    );
  }
  recordAbilityUse(state, declaration, selected);
  recordPhaseLog(state, {
    loop: state.loop.loop,
    day: state.loop.day,
    phase: "P6_GOODWILL",
    kind: "goodwillUsed",
    character: declaration.user,
    rank: declaration.rank,
    abilityIndex: selected.index,
    response: "resolve",
    effectApplied,
  });

  return {
    user: declaration.user,
    rank: declaration.rank,
    abilityIndex: selected.index,
    response: "resolve",
    resolved: true,
    refused: false,
    effectApplied,
  };
}

/** 단일 선언 해결의 짧은 공개 이름. */
export const resolveGoodwill = resolveGoodwillAbility;

/** 같은 P6에서 선언 순서대로 해결한다. 앞 효과는 다음 선언의 조건에 반영된다. */
export function resolveGoodwillPhase(
  state: GameState,
  uses: readonly GoodwillUse[],
): GoodwillResult[] {
  return uses.map(({ mastermindResponse, ...declaration }) =>
    resolveGoodwillAbility(state, declaration, mastermindResponse)
  );
}
