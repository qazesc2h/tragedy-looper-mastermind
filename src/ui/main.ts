import { characterDataOf } from "../data";
import {
  goodwillResponseAvailability,
  resolveGoodwillAbility,
} from "../engine/goodwill";
import { withDeathBatch } from "../engine/death";
import {
  previewCurrentLossDisclosure,
  previewP5Disclosure,
  previewP6GoodwillRefusal,
  previewP9HookDisclosure,
  previewP9OptionalLossDisclosure,
  type DisclosureRisk,
  type P5DisclosurePreview,
  type P6DisclosurePreview,
  type P9DisclosurePreview,
} from "../engine/disclosure-preview";
import {
  advanceGame,
  chooseInitialLeader,
  continueAfterLoopJudgment,
  continueFromTimeGap,
  createGameState,
  loopStartTraitChoicesComplete,
  settleGameFlow,
  setLoopStartTraitCounterChoice,
  setLoopStartTraitLocationChoice,
  skipToFinalGuess,
  startHouseRuleExtraLoop,
  submitFinalGuess,
} from "../engine/game";
import {
  incidentFailureReasons,
  incidentFires,
} from "../engine/incident";
import {
  actionCardRestriction,
  validatePlacement,
} from "../engine/legal";
import {
  distanceToLoss,
  setOptionalLossActivation,
  type LossRoute,
  type LossRouteControl,
} from "../engine/loss";
import {
  mastermindGuidance,
  type MastermindGuidanceRoute,
} from "../engine/mastermind-guidance";
import {
  mastermindCautions,
  type MastermindCaution,
} from "../engine/mastermind-cautions";
import {
  mastermindDecoyGuidance,
  type AttributeCandidateGroup,
  type ConfusableRule,
  type FakeLossCondition,
  type LocationIntrigueSource,
  type MastermindDecoyGuidance,
} from "../engine/mastermind-decoys";
import {
  mastermindCoverGuidance,
  type CommonRoleExposure,
  type MastermindCoverGuidance,
  type RoleCoverCandidate,
} from "../engine/mastermind-cover";
import {
  mastermindOpeningGuidance,
  type MastermindOpeningGuidance,
  type OpeningProfile,
} from "../engine/mastermind-opening";
import { intrigueForbidActive } from "../engine/movement";
import { type ProtagonistObservation } from "../engine/hypothesis";
import { applyHookEffect, collectHooks } from "../engine/phases";
import { recordPhaseLog } from "../engine/phase-log";
import {
  publicBoardChanges,
  publicObservationContext,
} from "../engine/public-observation";
import {
  resolveSacredTreeLeaderTransfer,
  resolveSacredTreeMastermindTransfer,
  sacredTreeHasGoodwillRefusal,
  sacredTreeLeaderChoiceRequired,
  sacredTreeLeaderStepResolved,
  sacredTreeMastermindChoiceRequired,
  sacredTreeMastermindStepResolved,
  sacredTreeTransferCondition,
  sacredTreeTransferEligible,
} from "../engine/sacred-tree";
import {
  loadScenarioCatalog,
  scenarioSourceLabel,
  scenarioValidationHeading,
  type ScenarioCatalogEntry,
} from "../scenario-catalog";
import {
  rolesForTragedySet,
  tragedySetDefinition,
} from "../tragedy-sets";
import {
  MASTERMIND_ONCE_PER_LOOP,
  PROTAGONIST_ONCE_PER_LOOP,
  currentServantFollowOptions,
  resolveMovement,
  setServantMovementChoice,
} from "../engine/resolve";
import { INCIDENT_IMPL } from "../impl/incidents";
import { ROLE_IMPL } from "../impl/roles";
import {
  abilityLocationsOf,
  characterEntryTiming,
  characterLocation,
  effectiveRole,
  isActionCard,
  isCharacterAlive,
  isCharacterPresent,
  LOCATIONS,
  PHASE_ORDER,
  type ActionCard,
  type CharacterId,
  type GameState,
  type Hook,
  type IncidentChoice,
  type IncidentCounter,
  type Location,
  type Phase,
  type PhaseLogEntry,
  type PlacedCard,
  type Scenario,
  type SacredTreeCounter,
  type Target,
  withCharacterLife,
  withCharacterLocation,
} from "../types";
import {
  collectResolutionReport,
  cardPanelShouldReopenAfterPlacement,
  compactActionCardLabel,
  groupPlacementsByTarget,
  handCardIsPlaced,
  MASTERMIND_HAND,
  nextProtagonist,
  placedCardCanBeRecalled,
  placedCardShowsName,
  placementsForOwner,
  PROTAGONIST_HAND,
  protagonistOrder,
  recallPlacedCard,
  type CardOwner,
  type HandCard,
  type ResolutionReportItem,
} from "./action-cards";
import { APP_VERSION } from "./app-version";
import {
  aiIncidentChoiceFields,
  decodeIncidentSelection,
  encodeIncidentSelection,
  goodwillAbilityViews,
  goodwillRefusalHistory,
  subplotRevealOptions,
  type GoodwillAbilityView,
  type GoodwillDisabledReason,
} from "./goodwill-abilities";
import { characterLocationInformation } from "./character-locations";
import {
  deductionTablesSummary,
  incidentDayLabelsForCharacter,
  incidentDaysForCharacter,
  incidentScheduleSummary,
  incidentScheduleRows,
  incidentScheduleRowsForCharacter,
  lossDistanceSummary,
  ruleHypothesisSummary,
  spentCardsSummary,
  type DeductionTablesSummary,
  type IncidentScheduleRow,
  type RuleHypothesisSummary,
} from "./mastermind-panel";
import {
  phaseLogDayIsOpen,
  phaseLogLoopGroups,
  phaseLogLoopIsOpen,
} from "./phase-log";
import {
  clearAppStorage,
  emptyTrackerStore,
  loadTrackerStore,
  persistGameState,
  persistTrackerPreferences,
  prepareNewGame,
  STORAGE_WRITE_WARNING,
  type StoredGame,
  type TrackerStore,
} from "./storage";
import { serializeCurrentStateDump } from "./state-dump";
import { characterTagLabels } from "./character-tags";
import {
  actionCardTerm,
  gameText,
  incidentRuleText,
  misc,
  term,
} from "./terms";
import "./styles.css";

interface ScenarioEntry extends Omit<ScenarioCatalogEntry, "rawTitle"> {
  title: string;
}

/** 긴 정보 목록에서 처음부터 펼쳐 두는 항목 수를 한 곳에서 통일한다. */
const DEFAULT_EXPANDED_LIST_LIMIT = 4;

interface SelectedHandCard extends HandCard {
  owner: CardOwner;
}

interface ResolutionReceipt {
  scenarioId: string;
  loop: number;
  day: number;
  cards: PlacedCard[];
  items: ResolutionReportItem[];
}

interface OptionalHookSelection {
  selected: boolean;
  target?: string;
}

type GoodwillDraftField =
  | "target"
  | "delta"
  | "card"
  | "choice"
  | "reveal"
  | "incident-target"
  | "incident-other-target"
  | "incident-location"
  | "incident-counter";

const PHASE_TERM: Record<Phase, () => string> = {
  P1_ROUND_START: () => misc("Day Start"),
  P2_MASTERMIND_ACTION: () =>
    `${misc("Mastermind")} · ${misc("Placing Cards")}`,
  P3_PROTAGONIST_ACTION: () =>
    `${misc("Protagonists")} · ${misc("Placing Cards")}`,
  P4_RESOLVE: () => misc("Card resolve"),
  P5_MASTERMIND_ABILITY: () => misc("Mastermind Ability"),
  P6_GOODWILL: () => misc("Goodwill"),
  P7_INCIDENT: () => misc("Incident step"),
  P8_LEADER_PASS: () => misc("Leader change"),
  P9_ROUND_END: () => misc("Day End"),
};

const ACTION_CARD_EN: Partial<Record<ActionCard, string>> = {
  moveVertical: "Movement - vertical",
  moveHorizontal: "Movement - horizontal",
  moveDiagonal: "Movement - diagonal",
  paranoiaPlus1: "Paranoia +1",
  paranoiaMinus1: "Paranoia -1",
  forbidParanoia: "Forbid Paranoia",
  goodwillPlus1: "Goodwill +1",
  goodwillPlus2: "Goodwill +2",
  forbidGoodwill: "Forbid Goodwill",
  intriguePlus1: "Intrigue +1",
  intriguePlus2: "Intrigue +2",
  forbidIntrigue: "Forbid Intrigue",
  forbidMove: "Forbid movement",
};

const INCIDENT_CHOICE_FIELDS: Record<string, readonly string[]> = {
  butterflyEffect: ["target", "counter"],
  farawayMurder: ["target"],
  increasingUnease: ["target", "otherTarget"],
  missingPerson: ["location"],
  murder: ["target"],
  spreading: ["target", "otherTarget"],
};

const MYSTERY_BOY_PLOT_LESS_ROLE_TEXT =
  "항상 현재 어느 룰로도 정해지지 않은 역할을 맡습니다.";

const scenarioEntries: ScenarioEntry[] = loadScenarioCatalog().map(
  ({ rawTitle, ...entry }) => ({
    ...entry,
    title: gameText(rawTitle),
  }),
);

function requireUiRoot(): HTMLElement {
  const element = document.getElementById("app");
  if (!element) throw new Error("UI root element not found");
  return element;
}

const root = requireUiRoot();

let notice = "";
let storageWriteWarning = "";
let selectedHandCard: SelectedHandCard | undefined;
let resolutionReceipt: ResolutionReceipt | undefined;
let openCharacterModal: CharacterId | undefined;
let openLocationModal: Location | undefined;
let finalGuessConfirmationOpen = false;
let operationSheetOpen = false;
const optionalHookSelections = new Map<string, OptionalHookSelection>();
const uiInputDrafts = new Map<string, string>();
let uiInputDraftScope = "";
let noticeDismissTimer: number | undefined;
let uiActionInProgress = false;
const NOTICE_DURATION_MS = 5_000;
const MAX_RUNTIME_ERRORS = 10;

interface UiTransactionSnapshot {
  game: StoredGame;
  selectedHandCard?: SelectedHandCard;
  resolutionReceipt?: ResolutionReceipt;
  openCharacterModal?: CharacterId;
  openLocationModal?: Location;
  finalGuessConfirmationOpen: boolean;
  operationSheetOpen: boolean;
  optionalHookSelections: Map<string, OptionalHookSelection>;
  uiInputDrafts: Map<string, string>;
  uiInputDraftScope: string;
}

function goodwillDraftKey(key: string, field: GoodwillDraftField): string {
  return `goodwill:${key}:${field}`;
}

function incidentDraftKey(field: string): string {
  return `incident:${field}`;
}

function draftValue(key: string): string {
  return uiInputDrafts.get(key) ?? "";
}

function selectedDraftOption(key: string, value: string): string {
  return draftValue(key) === value ? "selected" : "";
}

function ensureUiInputDraftScope(scope: string): void {
  if (uiInputDraftScope === scope) return;
  uiInputDrafts.clear();
  uiInputDraftScope = scope;
}

function clearGoodwillDraft(key: string): void {
  const prefix = `goodwill:${key}:`;
  for (const draftKey of uiInputDrafts.keys()) {
    if (draftKey.startsWith(prefix)) uiInputDrafts.delete(draftKey);
  }
}

function defaultStoredGame(scenarioId: string): StoredGame | undefined {
  const entry = scenarioEntries.find(({ id }) => id === scenarioId);
  if (entry === undefined) return undefined;
  return {
    state: createGame(entry),
    observationsByLoop: {},
    updatedAt: new Date(0).toISOString(),
  };
}

let tracker: TrackerStore;
try {
  tracker = loadTrackerStore(window.localStorage, defaultStoredGame);
} catch (error) {
  tracker = emptyTrackerStore();
  notice = errorMessage(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderCollapsedHtmlList(
  items: readonly string[],
  className: string,
  summary: string,
): string {
  if (items.length === 0) return "";
  return `<details class="long-list-details">
    <summary><strong>${escapeHtml(summary)}</strong><span class="long-list-toggle" aria-hidden="true"></span></summary>
    <ul class="${className}">${items.join("")}</ul>
  </details>`;
}

function renderBoundedHtmlList(
  items: readonly string[],
  className: string,
  overflowLabel: string,
): string {
  if (items.length === 0) return "";
  const visible = items.slice(0, DEFAULT_EXPANDED_LIST_LIMIT);
  const overflow = items.slice(DEFAULT_EXPANDED_LIST_LIMIT);
  return `<ul class="${className}">${visible.join("")}</ul>${
    renderCollapsedHtmlList(
      overflow,
      className,
      `${overflowLabel} ${overflow.length}건`,
    )
  }`;
}

function scheduleNoticeDismiss(): void {
  if (noticeDismissTimer !== undefined) {
    window.clearTimeout(noticeDismissTimer);
    noticeDismissTimer = undefined;
  }
  if (notice === "") return;
  const scheduledNotice = notice;
  noticeDismissTimer = window.setTimeout(() => {
    noticeDismissTimer = undefined;
    if (notice !== scheduledNotice) return;
    notice = "";
    root.querySelector(".notice-toast")?.remove();
  }, NOTICE_DURATION_MS);
}

function activeScenarioEntry(): ScenarioEntry {
  return scenarioEntries.find(({ id }) => id === tracker.activeScenarioId) ??
    scenarioEntries[0];
}

function scenarioAtDifficulty(
  entry: ScenarioEntry,
  difficultyIndex = 0,
): ScenarioCatalogEntry["difficulties"][number] {
  const difficulty = entry.difficulties.find(
    (candidate) => candidate.index === difficultyIndex,
  );
  if (difficulty === undefined) {
    throw new Error(
      `scenario "${entry.id}" has no difficulty at index ${difficultyIndex}`,
    );
  }
  return difficulty;
}

function createGame(entry: ScenarioEntry, difficultyIndex = 0): GameState {
  const scenario = structuredClone(
    scenarioAtDifficulty(entry, difficultyIndex).scenario,
  );
  return createGameState(scenario);
}

function scenarioErrataLines(entry: ScenarioEntry): string[] {
  return entry.errata.map((correction) => {
    const character = correction.field.slice("cast.".length);
    return `${characterName(character)} 역할: ` +
      `${roleName(correction.printed)} → ${roleName(correction.corrected)} ` +
      `· ${correction.source} · ${correction.verifiedBy}`;
  });
}

function saveState(
  scenarioId: string,
  state: GameState,
  reason: string,
): void {
  const saved = persistGameState(
    window.localStorage,
    tracker,
    scenarioId,
    state,
    reason,
  );
  storageWriteWarning = saved ? "" : STORAGE_WRITE_WARNING;
}

function renderStorageWriteWarning(): string {
  return storageWriteWarning === ""
    ? ""
    : `<div class="storage-write-warning" role="alert">${
      escapeHtml(storageWriteWarning)
    }</div>`;
}

function captureUiTransaction(game: StoredGame): UiTransactionSnapshot {
  return {
    game: structuredClone(game),
    selectedHandCard: structuredClone(selectedHandCard),
    resolutionReceipt: structuredClone(resolutionReceipt),
    openCharacterModal,
    openLocationModal,
    finalGuessConfirmationOpen,
    operationSheetOpen,
    optionalHookSelections: structuredClone(optionalHookSelections),
    uiInputDrafts: structuredClone(uiInputDrafts),
    uiInputDraftScope,
  };
}

function recordRuntimeError(
  state: GameState,
  action: string,
  error: unknown,
): void {
  const errors = state.runtimeErrors ??= [];
  errors.push({
    occurredAt: new Date().toISOString(),
    action,
    message: errorMessage(error),
    gamePhase: state.gamePhase,
    loop: structuredClone(state.loop),
    ...(state.pendingLoopEnd === undefined
      ? {}
      : { pendingLoopEnd: structuredClone(state.pendingLoopEnd) }),
  });
  if (errors.length > MAX_RUNTIME_ERRORS) {
    errors.splice(0, errors.length - MAX_RUNTIME_ERRORS);
  }
}

function rollbackUiTransaction(
  scenarioId: string,
  snapshot: UiTransactionSnapshot,
  action: string,
  error: unknown,
): void {
  tracker.games[scenarioId] = snapshot.game;
  selectedHandCard = snapshot.selectedHandCard;
  resolutionReceipt = snapshot.resolutionReceipt;
  openCharacterModal = snapshot.openCharacterModal;
  openLocationModal = snapshot.openLocationModal;
  finalGuessConfirmationOpen = snapshot.finalGuessConfirmationOpen;
  operationSheetOpen = snapshot.operationSheetOpen;
  optionalHookSelections.clear();
  for (const [key, selection] of snapshot.optionalHookSelections) {
    optionalHookSelections.set(key, selection);
  }
  uiInputDrafts.clear();
  for (const [key, value] of snapshot.uiInputDrafts) {
    uiInputDrafts.set(key, value);
  }
  uiInputDraftScope = snapshot.uiInputDraftScope;

  const state = tracker.games[scenarioId].state;
  recordRuntimeError(state, action, error);
  notice = errorMessage(error);
  const saved = persistGameState(
    window.localStorage,
    tracker,
    scenarioId,
    state,
    `error:${action}`,
  );
  storageWriteWarning = saved ? "" : STORAGE_WRITE_WARNING;
  render();
}

function runLockedUiAction(
  button: HTMLButtonElement,
  action: () => void,
): void {
  if (uiActionInProgress) return;
  uiActionInProgress = true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    action();
  } finally {
    uiActionInProgress = false;
  }
}

function currentState(): GameState {
  const entry = activeScenarioEntry();
  const saved = tracker.games[entry.id];
  if (!saved) throw new Error(`missing saved game for ${entry.id}`);
  return saved.state;
}

function resetTransientUi(): void {
  selectedHandCard = undefined;
  resolutionReceipt = undefined;
  openCharacterModal = undefined;
  openLocationModal = undefined;
  finalGuessConfirmationOpen = false;
  operationSheetOpen = false;
  optionalHookSelections.clear();
  uiInputDrafts.clear();
  uiInputDraftScope = "";
}

function startFreshScenario(
  entry: ScenarioEntry,
  difficultyIndex: number,
): void {
  const difficulty = scenarioAtDifficulty(entry, difficultyIndex);
  if (!difficulty.validation.ok) {
    notice = difficulty.validation.errors.join(" ");
    render();
    return;
  }
  delete tracker.games[entry.id];
  tracker.activeScenarioId = entry.id;
  resetTransientUi();
  notice = "";
  saveState(entry.id, createGame(entry, difficultyIndex), "scenario-start");
  render();
}

function requestNewGame(): void {
  if (tracker.activeScenarioId === "") return;
  const state = currentState();
  const warning = state.gamePhase === "GAME_OVER"
    ? "새 게임을 시작하면 현재 게임 기록이 사라집니다. 계속하시겠습니까?"
    : "새 게임을 시작하면 진행 중인 게임이 사라집니다. 계속하시겠습니까?";
  if (!window.confirm(warning)) return;
  try {
    prepareNewGame(window.localStorage, tracker);
    storageWriteWarning = "";
    resetTransientUi();
    notice = "";
  } catch {
    storageWriteWarning = STORAGE_WRITE_WARNING;
  }
  render();
}

function requestCompleteStorageDeletion(): void {
  const warning = "경고: 이 앱의 모든 저장 데이터를 완전히 삭제합니다. 모든 게임 진행과 설정이 사라지며 되돌릴 수 없습니다. 계속하시겠습니까?";
  if (!window.confirm(warning)) return;
  try {
    clearAppStorage(window.localStorage);
    tracker = emptyTrackerStore();
    resetTransientUi();
    notice = "";
  } catch (error) {
    notice = errorMessage(error);
  }
  render();
}

function copyCurrentState(): void {
  const clipboard = navigator.clipboard;
  if (clipboard === undefined) {
    notice = "클립보드를 사용할 수 없습니다.";
    render();
    return;
  }
  const json = serializeCurrentStateDump(currentState());
  void clipboard.writeText(json).then(
    () => {
      notice = "현재 상태를 복사했습니다.";
      render();
    },
    (error: unknown) => {
      notice = `상태 복사 실패: ${errorMessage(error)}`;
      render();
    },
  );
}

function commit(reason: string, mutate: (state: GameState) => void): void {
  const entry = activeScenarioEntry();
  const state = currentState();
  mutate(state);
  settleGameFlow(state);
  notice = "";
  saveState(entry.id, state, reason);
  render();
}

function characterName(character: CharacterId): string {
  const data = characterDataOf(character);
  return term("characters", character, data.en);
}

function plotLessRoleTraitText(
  character: CharacterId,
): string | undefined {
  if (character !== "mysteryBoy") return undefined;
  return characterDataOf(character).plotLessRole
    ? MYSTERY_BOY_PLOT_LESS_ROLE_TEXT
    : undefined;
}

const BOSS_TURF_TRAIT_TEXT =
  "모든 능력에 대해(사건은 제외), 자신의 세력권에 있는 것으로 취급할 수 있습니다.";

function characterTraitText(
  state: GameState,
  character: CharacterId,
): string | undefined {
  if (character === "boss" && state.loop.turfLocations.boss !== undefined) {
    return BOSS_TURF_TRAIT_TEXT;
  }
  return plotLessRoleTraitText(character);
}

function locationName(location: Location): string {
  return misc(location, location);
}

function roleName(role: string): string {
  return term("roles", role, role);
}

function incidentName(incident: string): string {
  return term("incidents", incident, incident);
}

function plotName(plot: string): string {
  return term("plots", plot, plot);
}

function phaseName(phase: Phase): string {
  return PHASE_TERM[phase]();
}

function incidentFailureLabel(reason: string): string {
  if (reason === "culpritAbsent") return "범인 미등장";
  if (reason === "culpritDead") return "범인 사망";
  if (reason === "insufficientParanoia") return "불안 미달";
  if (reason === "culpritSuppressed") return "사건 발생 억제";
  return reason;
}

function actionCardName(card: ActionCard): string {
  const english = ACTION_CARD_EN[card] ?? card;
  return actionCardTerm(card, english);
}

function sameTarget(left: Target, right: Target): boolean {
  if (left.kind === "character" && right.kind === "character") {
    return left.id === right.id;
  }
  if (left.kind === "location" && right.kind === "location") {
    return left.at === right.at;
  }
  return false;
}

function receiptFor(state: GameState): ResolutionReceipt | undefined {
  const receipt = resolutionReceipt;
  if (
    receipt?.scenarioId !== activeScenarioEntry().id ||
    receipt.loop !== state.loop.loop ||
    receipt.day !== state.loop.day
  ) {
    return undefined;
  }
  return receipt;
}

function renderCardsOnTarget(state: GameState, target: Target): string {
  const receipt = receiptFor(state);
  const resolved = receipt !== undefined;
  const cards = resolved ? receipt.cards : state.loop.placed;
  const matching = cards
    .map((placement, placementIndex) => ({ placement, placementIndex }))
    .filter(({ placement }) => sameTarget(placement.target, target))
    .map(({ placement, placementIndex }) => {
      const fullName = actionCardName(placement.card);
      return {
        placement,
        placementIndex,
        showName: placedCardShowsName(
          state.loop.phase,
          placement.owner,
          resolved,
        ),
        recallable: !resolved && selectedHandCard === undefined &&
          placedCardCanBeRecalled(state.loop.phase, placement),
        fullName,
        displayName: compactActionCardLabel(placement.card, fullName),
      };
    });
  if (matching.length === 0) return "";
  let recallablePlacementIndex: number | undefined;
  for (const item of matching) {
    if (item.recallable) recallablePlacementIndex = item.placementIndex;
  }

  return `
    <div class="placed-card-stack ${
      matching.every(({ showName }) => showName) ? "is-revealed" : "is-facedown"
    }">
      ${matching.map(({
        placement,
        placementIndex,
        showName,
        fullName,
        displayName,
      }) => {
        const recallable = placementIndex === recallablePlacementIndex;
        return `
        <button type="button"
          class="placed-action-card owner-${placement.owner}"
          ${recallable
            ? `data-action="recall-card" data-placement-index="${placementIndex}"`
            : "disabled"}
          ${showName ? `title="${escapeHtml(fullName)}"` : ""}
          aria-label="${escapeHtml(
            showName
              ? `${ownerLabel(placement.owner)} · ${fullName}${recallable ? " · 탭하여 회수" : ""}`
              : `${ownerLabel(placement.owner)}${recallable ? " · 탭하여 회수" : ""}`,
          )}">
          <span>${escapeHtml(ownerLabel(placement.owner))}</span>
          ${showName
            ? `<strong aria-hidden="true">${escapeHtml(displayName)}</strong>`
            : `<b aria-hidden="true">TL</b>`}
        </button>`;
      }).join("")}
    </div>`;
}

function renderCounter(
  character: CharacterId,
  counter: IncidentCounter,
  current: number,
  suffix = "",
): string {
  const labelKey: Record<IncidentCounter, string> = {
    goodwill: "Goodwill",
    paranoia: "Paranoia",
    intrigue: "Intrigue",
  };
  const label = misc(labelKey[counter]);
  return `
    <div class="counter-control">
      <span class="counter-label">${escapeHtml(label)}</span>
      <button type="button" data-action="counter" data-character="${escapeHtml(character)}"
        data-counter="${counter}" data-delta="-1" aria-label="${escapeHtml(label)} -1">−</button>
      <strong>${current}${escapeHtml(suffix)}</strong>
      <button type="button" data-action="counter" data-character="${escapeHtml(character)}"
        data-counter="${counter}" data-delta="1" aria-label="${escapeHtml(label)} +1">+</button>
    </div>`;
}

function renderCharacter(state: GameState, character: CharacterId): string {
  const position = state.loop.board[character];
  const counters = state.loop.charCounters[character];
  const data = characterDataOf(character);
  const role = effectiveRole(state, character);
  const traitText = characterTraitText(state, character);
  const alive = isCharacterAlive(position);
  const aliveLabel = alive
    ? misc("Alive", "생존")
    : misc("Dead", "사망");
  const culpritDayLabels = incidentDayLabelsForCharacter(state, character);
  const culpritBadges = culpritDayLabels.length === 0
    ? ""
    : `<span class="culprit-badges" aria-label="사건 범인 날짜">
        ${culpritDayLabels.map((label) =>
          `<span class="culprit-badge">${escapeHtml(label)}</span>`
        ).join("")}
      </span>`;

  return `
    <article class="character-chip-wrap ${alive ? "is-alive" : "is-dead"}">
      <button type="button" class="character-chip" data-action="board-character"
        data-character="${escapeHtml(character)}"
        aria-label="${escapeHtml(
          `${characterName(character)} — ${roleName(role)} — ${aliveLabel}` +
          (traitText ? ` — 특성: ${traitText}` : ""),
        )}">
        <span class="character-chip-heading">
          <strong>${escapeHtml(characterName(character))}</strong>
          <span class="life-state" aria-label="${escapeHtml(aliveLabel)}"
            title="${escapeHtml(aliveLabel)}">
            <i aria-hidden="true"></i><span class="visually-hidden">${escapeHtml(aliveLabel)}</span>
          </span>
        </span>
        <span class="character-chip-meta">
          <span class="character-chip-role">${escapeHtml(roleName(role))}</span>
          ${traitText
            ? `<span class="character-trait-badge" title="${escapeHtml(traitText)}">특성</span>`
            : ""}
          ${culpritBadges}
        </span>
        <span class="character-chip-counters">
          <span>우 ${counters.goodwill}</span>
          <span>불 ${counters.paranoia}/${data.paranoiaLimit}</span>
          <span>음 ${counters.intrigue}</span>
        </span>
      </button>
      ${renderCardsOnTarget(state, { kind: "character", id: character })}
    </article>`;
}

function renderCharacterTraitInformation(
  state: GameState,
  character: CharacterId,
): string {
  const traitText = characterTraitText(state, character);
  if (!traitText) return "";
  const turf = state.loop.turfLocations[character];
  return `<section class="character-trait-information">
    <h3>특성</h3>
    <p>${escapeHtml(traitText)}</p>
    ${turf === undefined
      ? ""
      : `<strong class="character-turf-location">세력권 · ${escapeHtml(locationName(turf))}</strong>`}
  </section>`;
}

function renderLocation(state: GameState, location: Location): string {
  const characters = Object.keys(state.loop.board).filter(
    (character) => {
      const position = state.loop.board[character];
      return isCharacterPresent(position) && position.at === location;
    },
  );
  return `
    <section class="board-location location-${location.toLowerCase()}">
      <header class="location-header">
        <button type="button" class="location-target" data-action="board-location"
          data-location="${location}">
          <span>${escapeHtml(locationName(location))}</span>
          <strong>${escapeHtml(misc("Intrigue"))} ${state.loop.locIntrigue[location]}</strong>
        </button>
        ${state.loop.turfLocations.boss === location
          ? `<span class="turf-counter" aria-label="거물 세력권">세력권 · 거물</span>`
          : ""}
      </header>
      ${renderCardsOnTarget(state, { kind: "location", at: location })}
      <div class="character-grid">
        ${characters.map((character) => renderCharacter(state, character)).join("") ||
          `<p class="empty-location">${escapeHtml(misc("No character", "No character"))}</p>`}
      </div>
    </section>`;
}

function renderCharacterIncidentInformation(
  state: GameState,
  character: CharacterId,
): string {
  const rows = incidentScheduleRowsForCharacter(state, character);
  return `
    <section class="character-incident-information">
      <h3>범인 사건</h3>
      ${rows.length === 0
        ? `<p class="empty-detail-information">이 캐릭터가 범인인 사건 없음</p>`
        : `<div class="character-incident-list">
            ${rows.map((row) => {
              const conditionStatus = row.conditionMet
                ? "현재 조건 충족"
                : `현재 조건 미충족 · ${row.currentFailureReasons
                  .map(incidentFailureLabel).join(" · ")}`;
              const judgmentStatus = row.outcome
                ? recordedIncidentStatus(row)
                : pendingIncidentStatus(row);
              return `
                <article class="character-incident-row ${row.conditionMet ? "is-met" : "is-unmet"}">
                  <header>
                    <strong>${row.day}일 · ${escapeHtml(incidentName(row.incident))}</strong>
                    <span>${row.conditionMet ? "✓" : "✗"}</span>
                  </header>
                  <p>현재 불안 ${row.paranoia} / 최대 불안 ${row.paranoiaLimit}</p>
                  <small>${escapeHtml(conditionStatus)}</small>
                  <small class="character-incident-judgment">
                    ${escapeHtml(row.outcome ? `지난 판정 · ${judgmentStatus}` : `예정 · ${judgmentStatus}`)}
                  </small>
                </article>`;
            }).join("")}
          </div>`}
    </section>`;
}

function renderCharacterLocationInformation(
  state: GameState,
  character: CharacterId,
): string {
  const information = characterLocationInformation(state, character);
  const startLocation = information.startLocationIsMastermindChoice
    ? `매 루프 각본가 지정 · 이번 루프 ${
      information.selectedStartLocation
        ? locationName(information.selectedStartLocation)
        : "미지정"
    }`
    : information.selectedStartLocation
    ? locationName(information.selectedStartLocation)
    : "없음";
  const forbiddenLocations = information.forbiddenLocations.length === 0
    ? "없음"
    : information.forbiddenLocations.map(locationName).join(" · ");

  return `
    <section class="character-location-information">
      <h3>장소 정보</h3>
      <dl>
        <div>
          <dt>시작 위치</dt>
          <dd>${escapeHtml(startLocation)}</dd>
        </div>
        <div class="${information.restrictionsRemoved ? "is-removed" : ""}">
          <dt>금지 장소</dt>
          <dd>
            <span>${escapeHtml(forbiddenLocations)}</span>
            ${information.restrictionsRemoved
              ? `<strong>해제됨 · 의사[우호3]</strong>`
              : ""}
          </dd>
        </div>
      </dl>
    </section>`;
}

function renderCharacterModal(state: GameState): string {
  const character = openCharacterModal;
  if (!character || state.loop.board[character] === undefined) return "";
  const position = state.loop.board[character];
  if (!isCharacterPresent(position)) return "";
  const counters = state.loop.charCounters[character];
  const data = characterDataOf(character);
  const alive = isCharacterAlive(position);
  const aliveLabel = alive
    ? misc("Alive", "생존")
    : misc("Dead", "사망");
  const tagLabels = characterTagLabels(character);

  return `
    <div class="modal-layer">
      <button type="button" class="modal-scrim" data-action="close-character-modal"
        aria-label="상세 닫기"></button>
      <section class="detail-modal" role="dialog" aria-modal="true"
        aria-labelledby="character-modal-title">
        <header class="detail-modal-header">
          <div>
            <span class="eyebrow">${escapeHtml(roleName(effectiveRole(state, character)))}</span>
            <h2 id="character-modal-title">${escapeHtml(characterName(character))}</h2>
          </div>
          <button type="button" class="icon-button" data-action="close-character-modal"
            aria-label="상세 닫기">×</button>
        </header>
        <div class="detail-modal-body">
          <button type="button" class="life-toggle ${alive ? "is-alive" : "is-dead"}"
            data-action="toggle-character-life" data-character="${escapeHtml(character)}">
            <span>${escapeHtml(aliveLabel)}</span>
            <strong>${alive ? "탭하여 사망 처리" : "탭하여 생존 처리"}</strong>
          </button>
          <div class="detail-counter-list">
            ${renderCounter(character, "goodwill", counters.goodwill)}
            ${renderCounter(
              character,
              "paranoia",
              counters.paranoia,
              `/${data.paranoiaLimit}`,
            )}
            ${renderCounter(character, "intrigue", counters.intrigue)}
          </div>
          <section class="character-tag-information" aria-label="캐릭터 속성">
            <h3>속성</h3>
            <ul>${tagLabels.map((label) =>
              `<li>${escapeHtml(label)}</li>`
            ).join("")}</ul>
          </section>
          ${renderCharacterTraitInformation(state, character)}
          ${renderCharacterLocationInformation(state, character)}
          ${renderCharacterIncidentInformation(state, character)}
          <label class="location-select">
            <span>${escapeHtml(misc("Location", "Location"))}</span>
            <select data-action="move-character" data-character="${escapeHtml(character)}">
              ${LOCATIONS.map((location) => `
                <option value="${location}" ${characterLocation(position, character) === location ? "selected" : ""}>
                  ${escapeHtml(locationName(location))}
                </option>`).join("")}
            </select>
          </label>
        </div>
      </section>
    </div>`;
}

function renderLocationModal(state: GameState): string {
  const location = openLocationModal;
  if (!location) return "";
  return `
    <div class="modal-layer">
      <button type="button" class="modal-scrim" data-action="close-location-modal"
        aria-label="장소 상세 닫기"></button>
      <section class="detail-modal location-detail-modal" role="dialog" aria-modal="true"
        aria-labelledby="location-modal-title">
        <header class="detail-modal-header">
          <div>
            <span class="eyebrow">${escapeHtml(misc("Location", "Location"))}</span>
            <h2 id="location-modal-title">${escapeHtml(locationName(location))}</h2>
          </div>
          <button type="button" class="icon-button" data-action="close-location-modal"
            aria-label="장소 상세 닫기">×</button>
        </header>
        <div class="detail-modal-body">
          <div class="location-modal-counter">
            <span>${escapeHtml(misc("Intrigue"))}</span>
            <button type="button" data-action="location-counter" data-location="${location}"
              data-delta="-1" aria-label="${escapeHtml(`${misc("Intrigue")} -1`)}">−</button>
            <strong>${state.loop.locIntrigue[location]}</strong>
            <button type="button" data-action="location-counter" data-location="${location}"
              data-delta="1" aria-label="${escapeHtml(`${misc("Intrigue")} +1`)}">+</button>
          </div>
        </div>
      </section>
    </div>`;
}

function renderFinalGuessConfirmationModal(state: GameState): string {
  if (!finalGuessConfirmationOpen || state.gamePhase !== "LOOP_TIME_GAP") {
    return "";
  }
  return `<div class="modal-layer final-guess-confirmation-layer">
    <button type="button" class="modal-scrim"
      data-action="close-final-guess-confirmation"
      aria-label="최후의 싸움 이동 취소"></button>
    <section class="detail-modal confirmation-modal" role="dialog"
      aria-modal="true" aria-labelledby="final-guess-confirmation-title"
      aria-describedby="final-guess-confirmation-description">
      <header class="detail-modal-header">
        <div>
          <span class="eyebrow">진행 확인</span>
          <h2 id="final-guess-confirmation-title">최후의 싸움으로 이동할까요?</h2>
        </div>
        <button type="button" class="icon-button"
          data-action="close-final-guess-confirmation" aria-label="취소">×</button>
      </header>
      <div class="detail-modal-body">
        <p id="final-guess-confirmation-description" class="flow-warning">⚠ 남은 루프를 진행하지 않으므로 주인공 측이 더 불리해집니다.</p>
        <p class="confirmation-note">이동하면 현재 루프 준비를 건너뛰고 역할 추리를 시작합니다.</p>
        <div class="flow-actions confirmation-actions">
          <button type="button" data-action="close-final-guess-confirmation">취소</button>
          <button type="button" class="danger-action"
            data-action="confirm-skip-final-guess">그래도 이동</button>
        </div>
      </div>
    </section>
  </div>`;
}

function renderPhases(state: GameState): string {
  return `
    <section class="phase-panel" aria-label="${escapeHtml(misc("Timing"))}">
      <div class="phase-track">
        ${PHASE_ORDER.map((phase, index) => `
          <div class="phase-step ${phase === state.loop.phase ? "is-current" : ""}"
            aria-current="${phase === state.loop.phase ? "step" : "false"}">
            <span>${index + 1}</span>
            <strong>${escapeHtml(phaseName(phase))}</strong>
          </div>`).join("")}
      </div>
    </section>`;
}

function renderPhaseLog(state: GameState): string {
  const loopGroups = phaseLogLoopGroups(state);
  if (loopGroups.length === 0) return "";

  const lines = (
    entry: (typeof loopGroups)[number]["days"][number]["entries"][number],
  ): string[] => {
    if (entry.kind === "notApplicable") {
      return ["해당 없음"];
    }
    if (entry.kind === "phaseCompleted") {
      return ["단계 완료"];
    }
    if (entry.kind === "cardsPlaced") {
      return entry.placements.map((placement) =>
        `${ownerLabel(placement.owner)} · ${targetLabel(placement.target)} · ${
          actionCardName(placement.card)
        }`
      );
    }
    if (entry.kind === "actionResolved") {
      return entry.results;
    }
    if (entry.kind === "abilityActivated") {
      return [
        `${entry.character ? characterName(entry.character) : misc("Extra Rules")} · ${
          gameText(entry.description)
        } 발동`,
      ];
    }
    if (entry.kind === "abilitySkipped") {
      return ["발동한 능력 없음"];
    }
    if (entry.kind === "sacredTreeTransferJudged") {
      const result = !entry.eligible
        ? "발동 조건 불충족"
        : entry.performed
        ? `${entry.counter === undefined
          ? "카운터 없음"
          : sacredTreeCounterName(entry.counter)} → ${
          entry.target === undefined ? "대상 없음" : characterName(entry.target)
        }`
        : "옮기지 않음";
      return [`각본가 · 신수 특성 · ${result}`];
    }
    if (entry.kind === "goodwillUsed") {
      const result = entry.response === "refuse"
        ? misc("Refused", "Refused")
        : entry.effectApplied
        ? "해결 · 효과 적용"
        : "해결 · 효과 없음";
      return [
        `${characterName(entry.character)}[우호${entry.rank}] · ${result}`,
      ];
    }
    if (entry.kind === "goodwillSkipped") {
      return ["사용한 우호 능력 없음"];
    }
    if (entry.kind === "leaderPassed") {
      return [`${ownerLabel(entry.from)} → ${ownerLabel(entry.to)}`];
    }
    if (entry.kind === "roundEnded") {
      return [entry.loopEnded ? "루프 종료 판정" : "다음 날로 진행"];
    }
    const result = entry.fired
      ? entry.effectApplied ? "발생 · 효과 적용" : "발생 · 효과 없음"
      : `발생하지 않음 (${entry.failureReasons.map(incidentFailureLabel).join(" · ")})`;
    return [`${incidentName(entry.incident)} · ${result}`];
  };
  const entryCount = loopGroups.reduce(
    (loopSum, loopGroup) => loopSum + loopGroup.days.reduce(
      (daySum, dayGroup) => daySum + dayGroup.entries.length,
      0,
    ),
    0,
  );

  return `
    <section class="phase-log" aria-label="진행 기록">
      <header class="phase-log-header">
        <strong>진행 기록</strong>
        <span>${entryCount}건</span>
      </header>
      <div class="phase-log-loops">
        ${loopGroups.map((loopGroup) => `
          <details class="phase-log-loop" ${
            phaseLogLoopIsOpen(state, loopGroup) ? "open" : ""
          }>
            <summary>
              <strong>루프 ${loopGroup.loop}</strong>
              <small>${loopGroup.days.length}일</small>
            </summary>
            <div class="phase-log-days">
              ${loopGroup.days.map((dayGroup) => `
                <details class="phase-log-day" ${
                  phaseLogDayIsOpen(state, dayGroup) ? "open" : ""
                }>
                  <summary>
                    <strong>${dayGroup.day}일</strong>
                    <small>${dayGroup.entries.length}건</small>
                  </summary>
                  <ol>${dayGroup.entries.flatMap((entry) =>
                    lines(entry).map((line) => `
                      <li>
                        <b>${escapeHtml(phaseName(entry.phase))}</b>
                        <span>${escapeHtml(line)}</span>
                      </li>`)
                  ).join("")}</ol>
                </details>`).join("")}
            </div>
          </details>`).join("")}
      </div>
    </section>`;
}

function ownerLabel(owner: "mastermind" | 0 | 1 | 2): string {
  if (owner === "mastermind") return misc("Mastermind");
  return misc(`Hero ${String.fromCharCode(65 + owner)}`, `Hero ${String.fromCharCode(65 + owner)}`);
}

function spentCardsFor(
  state: GameState,
  owner: "mastermind" | 0 | 1 | 2,
): readonly ActionCard[] {
  return owner === "mastermind"
    ? state.loop.spentOncePerLoop.mastermind
    : state.loop.spentOncePerLoop.protagonists[owner];
}

function renderSpentOwner(
  state: GameState,
  owner: "mastermind" | 0 | 1 | 2,
): string {
  const available = owner === "mastermind"
    ? [...MASTERMIND_ONCE_PER_LOOP]
    : [...PROTAGONIST_ONCE_PER_LOOP];
  const spent = spentCardsFor(state, owner);
  return `
    <div class="spent-owner">
      <h3>${escapeHtml(ownerLabel(owner))}</h3>
      <div class="spent-card-list">
        ${available.map((card) => `
          <button type="button" class="spent-card ${spent.includes(card) ? "is-spent" : ""}"
            data-action="toggle-spent" data-owner="${owner}" data-card="${card}"
            aria-pressed="${spent.includes(card)}">
            <span>${escapeHtml(actionCardName(card))}</span>
            <b>${spent.includes(card) ? "✓" : "○"}</b>
          </button>`).join("")}
      </div>
    </div>`;
}

function renderSpentCards(state: GameState): string {
  const oncePerLoop = misc("Once per {type}").replace(
    "{type}",
    misc("Loop"),
  );
  return `
    <section class="utility-panel spent-panel">
      <div class="panel-heading">
        <span class="eyebrow">${escapeHtml(oncePerLoop)}</span>
        <h2>${escapeHtml(misc("Spent cards", "소진 카드"))}</h2>
      </div>
      <div class="spent-grid">
        ${renderSpentOwner(state, "mastermind")}
        ${renderSpentOwner(state, 0)}
        ${renderSpentOwner(state, 1)}
        ${renderSpentOwner(state, 2)}
      </div>
    </section>`;
}

function renderAdvanceButton(
  label = misc("Next phase", "Next phase"),
  disabled = false,
  action = "advance",
): string {
  return `
    <button type="button" class="next-phase" data-action="${action}"
      ${disabled ? "disabled" : ""}>
      ${escapeHtml(label)} <span aria-hidden="true">→</span>
    </button>`;
}

function ownerCardIsSpent(
  state: GameState,
  owner: CardOwner,
  card: ActionCard,
): boolean {
  return spentCardsFor(state, owner).includes(card);
}

function renderHand(
  state: GameState,
  owner: CardOwner,
  hand: readonly HandCard[],
  enabled: boolean,
): string {
  const handClass = owner === "mastermind"
    ? "is-mastermind-hand"
    : "is-protagonist-hand";
  return `
    <div class="action-hand ${handClass}">
      ${hand.map((entry, index) => {
        const placed = handCardIsPlaced(state, owner, hand, index);
        const selected = selectedHandCard?.owner === owner &&
          selectedHandCard.key === entry.key;
        const spent = ownerCardIsSpent(state, owner, entry.card);
        const restriction = actionCardRestriction(state, owner, entry.card);
        const once = owner === "mastermind"
          ? MASTERMIND_ONCE_PER_LOOP.has(entry.card)
          : PROTAGONIST_ONCE_PER_LOOP.has(entry.card);
        const fullName = actionCardName(entry.card);
        const displayName = compactActionCardLabel(entry.card, fullName);
        const status = [
          once ? misc("Once per {type}").replace("{type}", misc("Loop")) : "",
          spent ? misc("Spent", "Spent") : "",
          restriction?.reason ?? "",
        ].filter(Boolean).join(" · ");
        const unavailable = !enabled || placed || spent || restriction !== undefined;
        const disabledReason = restriction?.reason ?? (spent
          ? "이번 루프에 사용함"
          : placed
            ? "이미 배치함"
            : !enabled
              ? "현재 차례 아님"
              : "");
        return `
          <button type="button"
            class="hand-card owner-${owner} ${placed ? "is-placed" : ""} ${selected ? "is-selected" : ""} ${spent ? "is-spent" : ""}"
            data-action="select-hand-card" data-owner="${owner}"
            data-card="${entry.card}" data-card-key="${entry.key}"
            ${unavailable ? "disabled" : ""}
            title="${escapeHtml(fullName)}"
            aria-label="${escapeHtml(`${fullName}${status ? ` · ${status}` : ""}`)}"
            aria-pressed="${selected}">
            <span aria-hidden="true">${escapeHtml(displayName)}</span>
            ${once ? `<small>${escapeHtml(misc("Once per {type}").replace("{type}", misc("Loop")))}</small>` : ""}
            ${disabledReason
              ? `<b class="hand-card-disabled-reason">${escapeHtml(disabledReason)}</b>`
              : ""}
          </button>`;
      }).join("")}
    </div>`;
}

function renderPlacementPrompt(): string {
  if (!selectedHandCard) {
    return `<p class="placement-prompt">${escapeHtml(misc("Select a card, then select a target", "Select a card, then select a target"))}</p>`;
  }
  return `
    <p class="placement-prompt is-ready">
      <strong>${escapeHtml(actionCardName(selectedHandCard.card))}</strong>
      <span>${escapeHtml(misc("Select a target", "Select a target"))}</span>
    </p>`;
}

function renderMastermindAction(
  state: GameState,
  correctingBeforeReveal = false,
): string {
  const placed = placementsForOwner(state, "mastermind").length;
  return `
    <section class="operation-panel card-placement-panel has-fixed-footer">
      <div class="operation-panel-scroll">
        <div class="operation-heading">
          <div>
            <span class="eyebrow">${correctingBeforeReveal ? "배치 수정" : "2"} · ${escapeHtml(ownerLabel("mastermind"))}</span>
            <h2>${escapeHtml(
              correctingBeforeReveal
                ? "각본가 카드 다시 배치"
                : phaseName("P2_MASTERMIND_ACTION"),
            )}</h2>
          </div>
          <strong class="placement-progress ${placed === 3 ? "is-complete" : ""}">${placed}/3</strong>
        </div>
        ${renderPlacementPrompt()}
        ${renderHand(state, "mastermind", MASTERMIND_HAND, placed < 3)}
      </div>
      <div class="operation-footer">
        <span>${escapeHtml(misc("3 cards required", "3 cards required"))}</span>
        ${renderAdvanceButton(undefined, placed !== 3)}
      </div>
    </section>`;
}

function renderProtagonistAction(state: GameState): string {
  const current = nextProtagonist(state);
  const order = protagonistOrder(state.loop.leader);
  const placed = state.loop.placed.filter(
    ({ owner }) => owner !== "mastermind",
  ).length;
  return `
    <section class="operation-panel card-placement-panel has-fixed-footer">
      <div class="operation-panel-scroll">
        <div class="operation-heading">
          <div>
            <span class="eyebrow">3 · ${escapeHtml(misc("Protagonists"))}</span>
            <h2>${escapeHtml(phaseName("P3_PROTAGONIST_ACTION"))}</h2>
          </div>
          <strong class="placement-progress ${placed === 3 ? "is-complete" : ""}">${placed}/3</strong>
        </div>
        ${renderPlacementPrompt()}
        <div class="protagonist-hands">
          ${order.map((owner, index) => {
            const done = placementsForOwner(state, owner).length === 1;
            return `
              <section class="protagonist-hand ${owner === current ? "is-current" : ""} ${done ? "is-done" : ""}">
                <header>
                  <div>
                    <span>${index + 1}</span>
                    <h3>${escapeHtml(ownerLabel(owner))}</h3>
                  </div>
                  ${owner === state.loop.leader
                    ? `<b>${escapeHtml(misc("Leader", "Leader"))}</b>`
                    : ""}
                </header>
                ${renderHand(state, owner, PROTAGONIST_HAND, owner === current)}
              </section>`;
          }).join("")}
        </div>
      </div>
      <div class="operation-footer">
        <span>${current === undefined
          ? escapeHtml(misc("Ready", "Ready"))
          : escapeHtml(`${ownerLabel(current)} · ${misc("Current turn", "Current turn")}`)}</span>
        ${renderAdvanceButton(undefined, current !== undefined)}
      </div>
    </section>`;
}

function placementCardClass(card: ActionCard): string {
  if (card.startsWith("move")) return "is-movement";
  if (card.startsWith("forbid")) return "is-forbid";
  return "is-counter";
}

function renderPlacementSummary(state: GameState): string {
  const groups = groupPlacementsByTarget(state.loop.placed);
  const intrigueForbids = state.loop.placed.filter(
    ({ card }) => card === "forbidIntrigue",
  );
  const intrigueForbidCancelled = intrigueForbids.length >= 2 &&
    !intrigueForbidActive(intrigueForbids);

  return `
    <section class="resolution-preview">
      <div class="resolution-preview-heading">
        <span class="eyebrow">${escapeHtml(misc("Resolving Cards"))}</span>
        <h3>배치 요약</h3>
      </div>
      <div class="placement-groups">
        ${groups.map(({ target, placements }) => `
          <article class="placement-group ${placements.length > 1 ? "has-overlap" : ""}">
            <strong>${escapeHtml(targetLabel(target))}</strong>
            <ul>
              ${placements.map((placement) => `
                <li class="${placementCardClass(placement.card)}">
                  <span>${escapeHtml(ownerLabel(placement.owner))}</span>
                  <b>${escapeHtml(actionCardName(placement.card))}</b>
                </li>`).join("")}
            </ul>
          </article>`).join("")}
      </div>
      ${intrigueForbidCancelled
        ? `<p class="resolution-preview-note">음모 금지 ${intrigueForbids.length}장 · 라운드 전체 상쇄</p>`
        : ""}
    </section>`;
}

function counterLabel(counter: IncidentCounter): string {
  const labels: Record<IncidentCounter, string> = {
    goodwill: misc("Goodwill"),
    paranoia: misc("Paranoia"),
    intrigue: misc("Intrigue"),
  };
  return labels[counter];
}

function isIncidentCounterValue(value: string): value is IncidentCounter {
  return value === "goodwill" || value === "paranoia" || value === "intrigue";
}

function isLocationValue(value: string): value is Location {
  return LOCATIONS.some((location) => location === value);
}

function targetLabel(target: Target): string {
  return target.kind === "character"
    ? characterName(target.id)
    : locationName(target.at);
}

function signedDelta(before: number, after: number): string {
  const delta = after - before;
  return delta > 0 ? `+${delta}` : String(delta);
}

function resolutionChangeLine(item: Extract<
  ResolutionReportItem,
  { category: "movement" | "counter" }
>): string {
  const change = item.change;
  if (change.kind === "movement") {
    return `${characterName(change.character)} ${locationName(change.before)} → ${locationName(change.after)}`;
  }
  if (change.kind === "locationIntrigue") {
    return `${locationName(change.location)} ${misc("Intrigue")}${signedDelta(change.before, change.after)}`;
  }
  return `${characterName(change.character)} ${counterLabel(change.counter)}${signedDelta(change.before, change.after)}`;
}

function noEffectResolutionLine(item: Extract<
  ResolutionReportItem,
  { category: "noEffect" }
>): string {
  const { placement, blockedBy, reason } = item.noEffect;
  const cause = blockedBy
    ? actionCardName(blockedBy)
    : reason === "forbiddenLocation"
    ? "금지 장소"
    : reason === "ineffectiveTarget"
    ? "대상에 적용되지 않음"
    : misc("No effect", "No effect");
  return `${ownerLabel(placement.owner)} · ${targetLabel(placement.target)} · ${actionCardName(placement.card)} (${cause})`;
}

function renderResolutionReceipt(state: GameState): string {
  const receipt = receiptFor(state);
  if (!receipt) return "";
  const rows = receipt.items.map((item) => item.category === "noEffect"
    ? {
      category: "무효",
      line: noEffectResolutionLine(item),
      causeHidden: item.causeHidden,
    }
    : {
      category: item.category === "movement" ? "이동" : "카운터",
      line: resolutionChangeLine(item),
      causeHidden: item.causeHidden,
    });
  return `
    <section class="resolution-receipt" aria-live="polite">
      <div>
        <span class="eyebrow">${escapeHtml(misc("Resolving Cards"))}</span>
        <h2>${escapeHtml(misc("Result summary", "Result summary"))}</h2>
      </div>
      <div class="resolution-results">
        <section class="resolution-public">
          <ul>
            ${(rows.length > 0
              ? rows
              : [{
                category: "변동",
                line: misc("No effect", "No effect"),
                causeHidden: false,
              }])
              .map(({ category, line, causeHidden }) => `<li><b>[${escapeHtml(category)}]</b> ${escapeHtml(line)}${
                causeHidden
                  ? ` <em class="resolution-hidden-cause">원인 비공개</em>`
                  : ""
              }</li>`)
              .join("")}
          </ul>
        </section>
      </div>
    </section>`;
}

function hookKey(phase: Phase, self: string, index: number): string {
  return `${phase}:${self || "plot"}:${index}`;
}

function hookTargetOptions(
  state: GameState,
  self: CharacterId,
  hook: Hook,
): Target[] {
  return hook.selectableTargets?.(state, self) ?? [];
}

function cultistIgnoreSummary(
  state: GameState,
  self: CharacterId,
  hook: Hook,
): string {
  if (hook !== ROLE_IMPL.cultist.hooks[0]) return "";

  const movementResolved = structuredClone(state);
  resolveMovement(movementResolved, movementResolved.loop.placed);
  const locations = abilityLocationsOf(movementResolved, self);
  const ignoredCount = state.loop.placed.filter((placement) => {
    if (placement.card !== "forbidIntrigue") return false;
    if (placement.target.kind === "location") {
      return locations.includes(placement.target.at);
    }
    const position = movementResolved.loop.board[placement.target.id];
    return position !== undefined &&
      isCharacterAlive(position) &&
      locations.includes(characterLocation(position, placement.target.id));
  }).length;
  return `${locations.map(locationName).join("·")}의 음모 금지 ${ignoredCount}장 무시`;
}

function encodeTarget(target: Target): string {
  return target.kind === "character"
    ? `character:${target.id}`
    : `location:${target.at}`;
}

function disclosureRiskLabel(risk: DisclosureRisk): string {
  switch (risk) {
    case "critical": return "확정 · 위험";
    case "danger": return "위험";
    case "caution": return "주의";
    case "safe": return "안전";
  }
}

function renderP5DisclosurePreview(
  state: GameState,
  hook: Hook,
  self: CharacterId,
  selection: OptionalHookSelection | undefined,
  targets: readonly Target[],
): string {
  const baseline = `
    <div class="disclosure-baseline">
      <b>미발동</b>
      <span>변화 없음 · 안전</span>
    </div>`;
  const selectedTarget = decodeTarget(selection?.target);
  if (targets.length > 0 && selectedTarget === undefined) {
    return `${baseline}<p class="disclosure-pending">대상 선택 후 노출 계산</p>`;
  }

  const preview = previewP5Disclosure(
    state,
    hook,
    self,
    selectedTarget,
  );
  return `${baseline}${renderDisclosureResult(preview)}`;
}

function renderDisclosureResult(preview: P5DisclosurePreview): string {
  const facts: string[] = [];
  if (
    preview.before.ruleCombinations !== preview.after.ruleCombinations
  ) {
    facts.push(
      `룰 ${preview.before.ruleCombinations} → ${preview.after.ruleCombinations}`,
    );
  }
  if (preview.before.mainPlots !== preview.after.mainPlots) {
    facts.push(`룰 Y 후보 ${preview.before.mainPlots} → ${preview.after.mainPlots}`);
  }
  for (const { character, role } of preview.newlyConfirmedRoles) {
    facts.push(`${characterName(character)} = ${roleName(role)} 확정`);
  }
  if (preview.newlyImpossibleRoleCells > 0) {
    facts.push(`역할 후보 칸 ${preview.newlyImpossibleRoleCells}개 감소`);
  }
  if (facts.length === 0) facts.push("후보 변화 없음");

  return `
    <section class="disclosure-preview risk-${preview.risk}" aria-live="polite">
      <header>
        <b>발동 예고</b>
        <span>${escapeHtml(disclosureRiskLabel(preview.risk))}</span>
      </header>
      <ul>${facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>
    </section>`;
}

function renderP6RefusalPreview(preview: P6DisclosurePreview): string {
  const family = preview.goodwillIgnoreFamilyConfirmed
    ? `${characterName(preview.character)} = 우호 무시 계열 확정`
    : "우호 무시 계열 후보로 좁혀짐";
  return `<small class="goodwill-disclosure-preview risk-${preview.risk}">
    <b>${escapeHtml(disclosureRiskLabel(preview.risk))}</b>
    <span>${escapeHtml(family)}</span>
    <span>후보 ${preview.roleCandidatesBefore.length} → ${preview.roleCandidatesAfter.length}</span>
  </small>`;
}

function explainableLossConditionLabel(
  condition: P9DisclosurePreview["explainableConditions"][number],
): string {
  switch (condition.kind) {
    case "plot": return plotName(condition.plot);
    case "role": return `${roleName(condition.role)} 조건`;
    case "incident": return `${incidentName(condition.incident)} 조건`;
  }
}

function renderP9DisclosurePreview(
  preview: P9DisclosurePreview,
  headingText: string,
): string {
  let summary: string;
  if (preview.explainableConditions.length === 0) {
    summary = "이 상태로는 설명 가능한 패배 조건 없음";
  } else if (preview.newlyConfirmedRoles.length > 0) {
    summary = "이 상태로 패배하면 역할 확정 발생";
  } else if (preview.newlyFixedPlots.length > 0) {
    summary = `이 상태로 패배하면 ${preview.newlyFixedPlots.map(plotName).join(" / ")} 확정`;
  } else {
    summary = `이 상태로 패배하면 룰 노출 없음 (설명 가능한 조건 ${preview.explainableConditions.length}개)`;
  }
  const roleFacts = preview.newlyConfirmedRoles.map(
    ({ character, role }) => `${characterName(character)} = ${roleName(role)} 확정`,
  );
  const conditionLabels = preview.explainableConditions.map(
    explainableLossConditionLabel,
  );
  return `<section class="disclosure-preview p9-disclosure-preview risk-${preview.risk}" aria-live="polite">
    <header>
      <b>${escapeHtml(headingText)}</b>
      <span>${escapeHtml(disclosureRiskLabel(preview.risk))}</span>
    </header>
    <p>${escapeHtml(summary)}</p>
    ${preview.before.ruleCombinations === preview.after.ruleCombinations
      ? ""
      : `<small>룰 후보 ${preview.before.ruleCombinations} → ${preview.after.ruleCombinations}</small>`}
    ${roleFacts.length === 0
      ? ""
      : `<ul>${roleFacts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>`}
    ${conditionLabels.length === 0
      ? ""
      : `<details><summary>설명 가능한 조건 ${conditionLabels.length}개</summary>
          <ul>${conditionLabels.map((label) => `<li>${escapeHtml(label)}</li>`).join("")}</ul>
        </details>`}
  </section>`;
}

function renderP9HookDisclosurePreview(
  state: GameState,
  hook: Hook,
  self: CharacterId,
  selection: OptionalHookSelection | undefined,
  targets: readonly Target[],
): string {
  const baseline = `<div class="disclosure-baseline">
    <b>미발동</b><span>변화 없음 · 안전</span>
  </div>`;
  const selectedTarget = decodeTarget(selection?.target);
  if (targets.length > 0 && selectedTarget === undefined) {
    return `${baseline}<p class="disclosure-pending">대상 선택 후 노출 계산</p>`;
  }
  return `${baseline}${renderP9DisclosurePreview(
    previewP9HookDisclosure(state, hook, self, selectedTarget),
    "발동 뒤 즉시 종료 예고",
  )}`;
}

let currentLossDisclosureCache:
  | { state: GameState; preview: P9DisclosurePreview }
  | undefined;

function currentLossDisclosure(state: GameState): P9DisclosurePreview {
  if (currentLossDisclosureCache?.state !== state) {
    currentLossDisclosureCache = {
      state,
      preview: previewCurrentLossDisclosure(state),
    };
  }
  return currentLossDisclosureCache.preview;
}

function renderCurrentLossDisclosure(state: GameState): string {
  const pendingEnd = state.pendingLoopEnd !== undefined ||
    (state.loop.pendingImmediateLossKeys?.length ?? 0) > 0;
  const naturalLoopEnd = state.loop.phase === "P9_ROUND_END" &&
    state.loop.day === state.scenario.daysPerLoop;
  if (
    state.gamePhase !== "ROUND" ||
    !loopStartTraitChoicesComplete(state) ||
    (!pendingEnd && !naturalLoopEnd)
  ) return "";
  return renderP9DisclosurePreview(
    currentLossDisclosure(state),
    "현재 상태로 루프가 끝나면",
  );
}

function renderHookList(
  state: GameState,
  phase: "P4_RESOLVE" | "P5_MASTERMIND_ABILITY" | "P9_ROUND_END",
  interactive: boolean,
): string {
  const available = collectHooks(state, phase)
    .map((entry, index) => ({ ...entry, index }))
    .filter(({ hook, self }) => hook.when(state, self))
    // 시간 여행자의 "Loop ends" 선택은 아래 패배 조건 발동 컨트롤이
    // activated 기록까지 함께 담당한다. 같은 선택을 두 번 표시하지 않는다.
    .filter(({ hook }) => !(
      phase === "P9_ROUND_END" &&
      hook.kind === "optional" &&
      hook.source.description === "Loop ends"
    ));
  if (available.length === 0) {
    return `<p class="empty-overlay">${escapeHtml(misc("No available ability", "No available ability"))}</p>`;
  }

  return `<div class="hook-list">${available.map(({ hook, self, index }) => {
    const key = hookKey(phase, self, index);
    const selection = optionalHookSelections.get(key);
    const optional = hook.kind === "optional";
    const text = hook.source.description ?? hook.source.prerequisite ?? "";
    const targets = hookTargetOptions(state, self, hook);
    const activationSummary = cultistIgnoreSummary(state, self, hook);
    const disclosurePreview = phase === "P5_MASTERMIND_ABILITY"
      ? renderP5DisclosurePreview(state, hook, self, selection, targets)
      : phase === "P9_ROUND_END" && optional
      ? renderP9HookDisclosurePreview(
        state,
        hook,
        self,
        selection,
        targets,
      )
      : "";
    return `
      <article class="hook-card ${selection?.selected ? "is-selected" : ""}">
        <div>
          <span>${escapeHtml(self ? characterName(self) : misc("Extra Rules"))}</span>
          <strong>${escapeHtml(gameText(text || hook.source.timing))}</strong>
        </div>
        <small>${escapeHtml(hook.kind === "mandatory" ? misc("Mandatory") : misc("Optional"))}</small>
        ${activationSummary
          ? `<p class="hook-activation-summary">${escapeHtml(activationSummary)}</p>`
          : ""}
        ${interactive && optional
          ? `<label class="hook-toggle">
              <input type="checkbox" data-action="optional-hook" data-hook-key="${escapeHtml(key)}"
                ${selection?.selected ? "checked" : ""} />
              <span>${escapeHtml(misc("Activate", "Activate"))}</span>
            </label>`
          : ""}
        ${interactive && optional && targets.length > 0
          ? `<select data-action="optional-hook-target" data-hook-key="${escapeHtml(key)}">
              <option value="">${escapeHtml(misc("Select a target", "Select a target"))}</option>
              ${targets.map((target) => `<option value="${escapeHtml(encodeTarget(target))}"
                ${selection?.target === encodeTarget(target) ? "selected" : ""}>
                ${escapeHtml(targetLabel(target))}</option>`).join("")}
            </select>`
          : ""}
        ${disclosurePreview}
      </article>`;
  }).join("")}</div>`;
}

function goodwillDisabledMessage(
  view: GoodwillAbilityView,
  reason: GoodwillDisabledReason,
): string {
  switch (reason) {
    case "dead":
      return "사망";
    case "minLoop":
      return `${view.schema.minLoop}루프부터`;
    case "notImplemented":
      return "미구현";
    case "usedThisRound":
      return "오늘 사용함";
    case "spent":
      return "이번 루프에 사용함";
    case "restrictedLocation":
      return "장소 제한";
    case "noTarget":
      if (view.schema.target.tags.includes("student")) {
        return "같은 장소에 다른 학생이 없습니다";
      }
      if (view.schema.target.predicates?.includes("dead")) {
        return "대상 시체가 없습니다";
      }
      if (view.schema.target.predicates?.includes("inUserTurf")) {
        return "세력권에 대상 캐릭터가 없습니다";
      }
      if (view.schema.target.predicates?.includes("isPatient")) {
        return "환자가 없습니다";
      }
      if (view.schema.target.predicates?.includes("panicked")) {
        return "같은 장소에 패닉 상태인 캐릭터가 없습니다";
      }
      if (view.schema.target.predicates?.includes("hasIntrigue")) {
        return "같은 장소에 음모가 있는 다른 캐릭터가 없습니다";
      }
      if (
        view.schema.target.scope === "sameLocation" &&
        view.schema.target.excludeSelf
      ) {
        return "같은 장소에 다른 캐릭터가 없습니다";
      }
      if (
        view.schema.target.scope === "anyCharacter" &&
        view.schema.target.excludeSelf
      ) {
        return "다른 생존 캐릭터가 없습니다";
      }
      return "사용 가능한 대상이 없습니다";
    case "noSpentCard":
      return "리더의 소진 카드가 없습니다";
    case "noChoice":
      if (view.choice.kind === "pastIncident") {
        return "이번 루프에 발동한 사건이 없습니다";
      }
      if (view.choice.kind === "incident") {
        return "각본에 사건이 없습니다";
      }
      if (view.choice.kind === "subplot") {
        return "선택 가능한 룰 X가 없습니다";
      }
      return "선택 가능한 항목이 없습니다";
    case "multipleTargets":
      return "복수 대상 미지원";
  }
}

function renderGoodwillTarget(
  view: GoodwillAbilityView,
  disabled: boolean,
): string {
  if (!view.targetRequired || view.targets.length === 0) return "";
  const draftKey = goodwillDraftKey(view.key, "target");
  return `
    <select data-goodwill-target="${escapeHtml(view.key)}"
      data-ui-draft-key="${escapeHtml(draftKey)}"
      aria-label="${escapeHtml(misc("Select a target", "Select a target"))}"
      ${disabled ? "disabled" : ""}>
      <option value="">${escapeHtml(misc("Select a target", "Select a target"))}</option>
      ${view.targets.map((target) => `
        <option value="${escapeHtml(encodeTarget(target))}"
          ${selectedDraftOption(draftKey, encodeTarget(target))}>${escapeHtml(
          target.kind === "character"
            ? characterName(target.id)
            : locationName(target.at),
        )}</option>`).join("")}
    </select>`;
}

function renderAiIncidentChoiceFields(
  state: GameState,
  view: GoodwillAbilityView,
  incident: string | undefined,
  disabled: boolean,
): string {
  if (view.schema.effect.operation !== "resolveIncidentAsSelfWithoutTrigger") {
    return "";
  }
  if (incident === undefined) {
    return `<p class="empty-overlay">사건을 고르면 필요한 선택만 표시합니다.</p>`;
  }
  const livingCharacters = Object.entries(state.loop.board)
    .filter(([, position]) => isCharacterAlive(position))
    .map(([character]) => character);
  const aiLocation = characterLocation(state.loop.board[view.character], view.character);
  const selectedTarget = draftValue(
    goodwillDraftKey(view.key, "incident-target"),
  );
  const eligibleCharacters = (field: "target" | "otherTarget") => {
    if (field === "otherTarget") {
      return livingCharacters.filter((character) => character !== selectedTarget);
    }
    switch (incident) {
      case "murder":
        return livingCharacters.filter((character) =>
          character !== view.character &&
          characterLocation(state.loop.board[character], character) === aiLocation
        );
      case "butterflyEffect":
        return livingCharacters.filter((character) =>
          characterLocation(state.loop.board[character], character) === aiLocation
        );
      case "farawayMurder":
        return livingCharacters.filter((character) =>
          state.loop.charCounters[character].intrigue >= 2
        );
      case "spreading":
        return livingCharacters.filter((character) =>
          state.loop.charCounters[character].goodwill >= 1
        );
      default:
        return livingCharacters;
    }
  };
  const selectCharacter = (
    field: "target" | "otherTarget",
    label: string,
  ) => {
    const draftField = field === "target"
      ? "incident-target"
      : "incident-other-target";
    const draftKey = goodwillDraftKey(view.key, draftField);
    return `
    <label class="goodwill-choice-field">
      <span>${escapeHtml(label)}</span>
      <select data-goodwill-incident-${field === "target" ? "target" : "other-target"}="${escapeHtml(view.key)}"
        ${field === "target" ? `data-action="goodwill-incident-target"` : ""}
        data-ui-draft-key="${escapeHtml(draftKey)}"
        ${disabled ? "disabled" : ""}>
        <option value="">${escapeHtml(misc("Select", "Select"))}</option>
        ${eligibleCharacters(field).map((character) => `
          <option value="${escapeHtml(character)}"
            ${selectedDraftOption(draftKey, character)}>${escapeHtml(characterName(character))}</option>`).join("")}
      </select>
    </label>`;
  };
  const locationDraftKey = goodwillDraftKey(view.key, "incident-location");
  const counterDraftKey = goodwillDraftKey(view.key, "incident-counter");
  const locationField = `<label class="goodwill-choice-field">
      <span>${escapeHtml(misc("Location", "Location"))}</span>
      <select data-goodwill-incident-location="${escapeHtml(view.key)}"
        data-ui-draft-key="${escapeHtml(locationDraftKey)}"
        ${disabled ? "disabled" : ""}>
        <option value="">${escapeHtml(misc("Select", "Select"))}</option>
        ${LOCATIONS.map((location) => `
          <option value="${location}" ${selectedDraftOption(locationDraftKey, location)}>${escapeHtml(locationName(location))}</option>`).join("")}
      </select>
    </label>`;
  const counterField = `<label class="goodwill-choice-field">
      <span>${escapeHtml(misc("Counter", "Counter"))}</span>
      <select data-goodwill-incident-counter="${escapeHtml(view.key)}"
        data-ui-draft-key="${escapeHtml(counterDraftKey)}"
        ${disabled ? "disabled" : ""}>
        <option value="">${escapeHtml(misc("Select", "Select"))}</option>
        ${(["goodwill", "paranoia", "intrigue"] as const).map((counter) => `
          <option value="${counter}" ${selectedDraftOption(counterDraftKey, counter)}>${escapeHtml(misc(
            counter === "goodwill"
              ? "Goodwill"
              : counter === "paranoia"
              ? "Paranoia"
              : "Intrigue",
          ))}</option>`).join("")}
      </select>
    </label>`;
  const fieldHtml = aiIncidentChoiceFields(incident).map((field) => {
    switch (field) {
      case "location":
        return locationField;
      case "counter":
        return counterField;
      case "target":
        return selectCharacter(
          "target",
          incident === "spreading"
            ? "우호 제거 대상"
            : incident === "increasingUnease"
            ? "불안 +2 대상"
            : incident === "butterflyEffect"
            ? "카운터 대상"
            : "사망 대상",
        );
      case "otherTarget":
        return selectCharacter(
          "otherTarget",
          incident === "spreading" ? "우호 추가 대상" : "음모 +1 대상",
        );
    }
  });
  return fieldHtml.length === 0
    ? `<p class="empty-overlay">추가 선택 없이 해결합니다.</p>`
    : fieldHtml.join("");
}

function renderGoodwillChoice(
  state: GameState,
  view: GoodwillAbilityView,
  disabled: boolean,
): string {
  const { choice, key } = view;
  switch (choice.kind) {
    case "none":
      return "";
    case "paranoiaDelta": {
      const draftKey = goodwillDraftKey(key, "delta");
      return `
        <select data-goodwill-delta="${escapeHtml(key)}"
          data-ui-draft-key="${escapeHtml(draftKey)}"
          aria-label="${escapeHtml(misc("Paranoia"))}"
          ${disabled ? "disabled" : ""}>
          <option value="">${escapeHtml(misc("Select", "Select"))}</option>
          ${choice.options.map((delta) => `
            <option value="${delta}" ${selectedDraftOption(draftKey, String(delta))}>${escapeHtml(misc("Paranoia"))} ${delta > 0 ? "+" : ""}${delta}</option>`).join("")}
        </select>`;
      }
    case "spentCard": {
      const draftKey = goodwillDraftKey(key, "card");
      return `
        <select data-goodwill-card="${escapeHtml(key)}"
          data-ui-draft-key="${escapeHtml(draftKey)}"
          ${disabled ? "disabled" : ""}>
          <option value="">${escapeHtml(misc("Select a card", "Select a card"))}</option>
          ${choice.options.map((card) => `
            <option value="${card}" ${selectedDraftOption(draftKey, card)}>${escapeHtml(actionCardName(card))}</option>`).join("")}
        </select>`;
      }
    case "incident":
    case "pastIncident": {
      const draftKey = goodwillDraftKey(key, "choice");
      const selectedIncident = choice.options.find((selection) =>
        encodeIncidentSelection(selection) === draftValue(draftKey)
      );
      return `
        <select data-goodwill-choice="${escapeHtml(key)}"
          ${choice.kind === "incident" ? `data-action="goodwill-incident-selection" data-goodwill-key="${escapeHtml(key)}"` : ""}
          data-ui-draft-key="${escapeHtml(draftKey)}"
          ${disabled ? "disabled" : ""}>
          <option value="">${escapeHtml(misc("Select", "Select"))}</option>
          ${choice.options.map((selection) => `
            <option value="${escapeHtml(encodeIncidentSelection(selection))}"
              ${selectedDraftOption(draftKey, encodeIncidentSelection(selection))}>
              ${escapeHtml(`${misc("Day")} ${selection.day} · ${incidentName(selection.incident)}`)}
            </option>`).join("")}
        </select>
        ${choice.kind === "incident"
          ? renderAiIncidentChoiceFields(
              state,
              view,
              selectedIncident?.incident,
              disabled,
            )
          : ""}`;
    }
    case "subplot": {
      const choiceDraftKey = goodwillDraftKey(key, "choice");
      const revealDraftKey = goodwillDraftKey(key, "reveal");
      const declaredSubplot = choice.options.find(
        (plot) => plot === draftValue(choiceDraftKey),
      );
      const revealOptions = subplotRevealOptions(choice, declaredSubplot);
      return `
        <label class="goodwill-choice-field">
          <span>리더 선언</span>
          <select data-action="goodwill-subplot-declaration"
            data-goodwill-key="${escapeHtml(key)}"
            data-goodwill-choice="${escapeHtml(key)}"
            data-ui-draft-key="${escapeHtml(choiceDraftKey)}"
            ${disabled ? "disabled" : ""}>
            <option value="">${escapeHtml(misc("Select", "Select"))}</option>
            ${choice.options.map((plot) => `
              <option value="${escapeHtml(plot)}" ${selectedDraftOption(choiceDraftKey, plot)}>${escapeHtml(plotName(plot))}</option>`).join("")}
          </select>
        </label>
        <label class="goodwill-choice-field">
          <span>각본가 공개</span>
          <select data-goodwill-reveal="${escapeHtml(key)}"
            data-ui-draft-key="${escapeHtml(revealDraftKey)}"
            ${disabled ? "disabled" : ""}>
            <option value="">${escapeHtml(misc("Select", "Select"))}</option>
            ${revealOptions.map((plot) => `
              <option value="${escapeHtml(plot)}" ${selectedDraftOption(revealDraftKey, plot)}>${escapeHtml(plotName(plot))}</option>`).join("")}
          </select>
        </label>`;
    }
    case "counter": {
      const draftKey = goodwillDraftKey(key, "choice");
      return `
        <select data-goodwill-choice="${escapeHtml(key)}"
          data-ui-draft-key="${escapeHtml(draftKey)}"
          ${disabled ? "disabled" : ""}>
          <option value="">${escapeHtml(misc("Select", "Select"))}</option>
          ${choice.options.map((counter) => `
            <option value="${escapeHtml(counter)}" ${selectedDraftOption(draftKey, counter)}>${escapeHtml(
              counter === "goodwill"
                ? misc("Goodwill")
                : counter === "paranoia"
                ? misc("Paranoia")
                : counter === "intrigue"
                ? misc("Intrigue")
                : counter,
            )}</option>`).join("")}
        </select>`;
    }
  }
}

function syncGoodwillSubplotRevealOptions(
  declarationControl: HTMLSelectElement,
): void {
  const key = declarationControl.dataset.goodwillKey;
  if (!key) {
    throw new Error("goodwill subplot declaration is missing its ability key");
  }
  const view = goodwillAbilityViews(currentState()).find(
    (candidate) => candidate.key === key,
  );
  if (view?.choice.kind !== "subplot") {
    throw new Error(`goodwill ability "${key}" has no subplot choice`);
  }
  const revealControl = root.querySelector<HTMLSelectElement>(
    `[data-goodwill-reveal="${CSS.escape(key)}"]`,
  );
  if (!revealControl) {
    throw new Error(`goodwill ability "${key}" is missing its reveal control`);
  }
  const declaredValue = declarationControl.value;
  const declaredSubplot = declaredValue === ""
    ? undefined
    : view.choice.options.find((plot) => plot === declaredValue);
  if (declaredValue !== "" && declaredSubplot === undefined) {
    throw new Error(`unknown declared subplot: ${declaredValue}`);
  }
  const revealDraftKey = goodwillDraftKey(key, "reveal");
  const previous = draftValue(revealDraftKey);
  const allowed = subplotRevealOptions(view.choice, declaredSubplot);
  revealControl.innerHTML = `
    <option value="">${escapeHtml(misc("Select", "Select"))}</option>
    ${allowed.map((plot) => `
      <option value="${escapeHtml(plot)}">${escapeHtml(plotName(plot))}</option>`).join("")}`;
  revealControl.value = allowed.includes(previous) ? previous : "";
  uiInputDrafts.set(revealDraftKey, revealControl.value);
}

function renderGoodwillAbilities(state: GameState): string {
  const abilities = goodwillAbilityViews(state);
  const refusalHistory = goodwillRefusalHistory(state);
  const historyByCharacter = new Map(
    refusalHistory.map((entry) => [entry.character, entry.occurrences]),
  );
  const occurrenceText = (
    occurrences: ReadonlyArray<{ loop: number; day: number }>,
  ): string => occurrences.map(
    ({ loop, day }) => `${loop}루프 ${day}일`,
  ).join(", ");
  const historyMarkup = refusalHistory.length === 0
    ? ""
    : `<section class="goodwill-refusal-log">
        <strong>우호 무시 발동 이력 <small>공개 정보</small></strong>
        <ul>${refusalHistory.map(({ character, occurrences }) => `
          <li>
            <b>${escapeHtml(characterName(character))}</b>
            <span>거부됨 · ${escapeHtml(occurrenceText(occurrences))}</span>
          </li>`).join("")}</ul>
      </section>`;
  if (abilities.length === 0) {
    return `${historyMarkup}<p class="empty-overlay">${escapeHtml(misc("No available ability", "No available ability"))}</p>`;
  }
  return `${historyMarkup}<div class="goodwill-list">${abilities.map((view) => {
    const {
      character,
      abilityIndex,
      key,
      schema,
      disabledReason,
    } = view;
    const disabled = disabledReason !== undefined;
    const reason = disabledReason === undefined
      ? ""
      : goodwillDisabledMessage(view, disabledReason);
    const availability = goodwillResponseAvailability(
      state,
      character,
      schema.immuneToGoodwillRefusel === true,
    );
    const refusalLabel = availability.refusalKind === "optional"
      ? " · 우호 무시"
      : availability.refusalKind === "mandatory"
        ? " · 절대 우호 무시"
        : "";
    const roleDetail = `${roleName(availability.role)}${refusalLabel}`;
    const disclosedOccurrences = historyByCharacter.get(character);
    const resolveRuleTitle = !availability.resolveAllowed
      ? "절대 우호 무시: 반드시 거부"
      : "";
    const refuseRuleTitle = schema.immuneToGoodwillRefusel
      ? "이 능력은 거부 불가"
      : !availability.refuseAllowed
        ? "우호 무시가 없어 거부 불가"
        : "";
    const resolveDisabledReason = disabled ? reason : resolveRuleTitle;
    const refuseDisabledReason = disabled ? reason : refuseRuleTitle;
    const refusalPreview = !disabled && availability.refuseAllowed
      ? previewP6GoodwillRefusal(state, {
        user: character,
        rank: schema.rank,
        abilityIndex,
      })
      : undefined;
    const resolveChoiceText = availability.refusalKind === "mandatory"
      ? "선택 불가 · 반드시 거부"
      : "변화 없음 · 안전";
    const refuseChoiceText = availability.refusalKind === "mandatory"
      ? "선택 불가 · 반드시 거부"
      : schema.immuneToGoodwillRefusel || availability.refusalKind === "none"
      ? "선택 불가 · 거부 불가"
      : "";
    return `
    <article class="goodwill-card ${disabled ? "is-disabled" : ""}">
      <div class="goodwill-copy">
        <span>${escapeHtml(characterName(character))} (${escapeHtml(roleDetail)}) · ${escapeHtml(misc("Goodwill"))} ${schema.rank}</span>
        <strong>${escapeHtml(gameText(schema._source, schema.ko))}</strong>
        ${disclosedOccurrences
          ? `<small class="goodwill-refusal-disclosed">우호 무시 계열 노출 · ${escapeHtml(occurrenceText(disclosedOccurrences))}</small>`
          : ""}
        ${reason ? `<small class="goodwill-disabled-reason">${escapeHtml(reason)}</small>` : ""}
      </div>
      <div class="goodwill-inputs">
        ${renderGoodwillTarget(view, disabled)}
        ${renderGoodwillChoice(state, view, disabled)}
      </div>
      <div class="goodwill-actions">
        <button type="button" data-action="goodwill" data-response="resolve"
          data-character="${escapeHtml(character)}" data-rank="${schema.rank}"
          data-ability-index="${abilityIndex}" data-goodwill-key="${escapeHtml(key)}"
          ${disabled || !availability.resolveAllowed ? "disabled" : ""}
          ${resolveRuleTitle ? `title="${escapeHtml(resolveRuleTitle)}"` : ""}>
          <span>${escapeHtml(misc("Resolve", "Resolve"))}</span>
          ${!disabled
            ? `<small>${escapeHtml(resolveChoiceText)}</small>`
            : resolveDisabledReason
            ? `<small>${escapeHtml(resolveDisabledReason)}</small>`
            : ""}
        </button>
        <button type="button" data-action="goodwill" data-response="refuse"
          data-character="${escapeHtml(character)}" data-rank="${schema.rank}"
          data-ability-index="${abilityIndex}" data-goodwill-key="${escapeHtml(key)}"
          ${disabled || !availability.refuseAllowed ? "disabled" : ""}
          ${refuseRuleTitle ? `title="${escapeHtml(refuseRuleTitle)}"` : ""}>
          <span>${escapeHtml(misc("Refuse", "Refuse"))}</span>
          ${disabled && refuseDisabledReason
            ? `<small>${escapeHtml(refuseDisabledReason)}</small>`
            : refuseChoiceText
            ? `<small>${escapeHtml(refuseChoiceText)}</small>`
            : ""}
          ${refusalPreview === undefined
            ? ""
            : renderP6RefusalPreview(refusalPreview)}
        </button>
      </div>
    </article>`;
  }).join("")}</div>`;
}

function renderPhaseControls(state: GameState): string {
  const loopEndPending = state.pendingLoopEnd !== undefined ||
    (state.loop.pendingImmediateLossKeys?.length ?? 0) > 0;
  const resultConfirmation = "결과 확인·승패 판정";
  const heading = (step: number, title: string) => `
    <div class="operation-heading">
      <div><span class="eyebrow">${step}</span><h2>${escapeHtml(title)}</h2></div>
    </div>`;

  switch (state.loop.phase) {
    case "P1_ROUND_START":
      return `<section class="operation-panel compact-operation">
        ${heading(1, phaseName(state.loop.phase))}
        ${renderAdvanceButton()}
      </section>`;
    case "P2_MASTERMIND_ACTION":
      return renderMastermindAction(state);
    case "P3_PROTAGONIST_ACTION":
      return placementsForOwner(state, "mastermind").length < 3
        ? renderMastermindAction(state, true)
        : renderProtagonistAction(state);
    case "P4_RESOLVE":
      return `<section class="operation-panel has-fixed-footer">
        <div class="resolve-control-copy operation-panel-scroll">
          ${heading(4, phaseName(state.loop.phase))}
          ${state.loop.actionResolutionComplete
            ? `<p>카드 공개와 효과 해결이 완료되었습니다. 결과 요약을 확인한 뒤 진행하세요.</p>
              ${renderSacredTreeTransferChoice(state, "leader")}`
            : `${renderPlacementSummary(state)}${renderServantMovementChoice(state)}${renderHookList(state, state.loop.phase, true)}`}
        </div>
        <div class="operation-footer">
          <span>${state.loop.actionResolutionComplete ? "P4 해결 완료" : "6장 배치 확정"}</span>
          ${state.loop.actionResolutionComplete
            ? renderAdvanceButton(
              undefined,
              sacredTreeLeaderChoiceRequired(state),
            )
            : renderAdvanceButton(
              "카드 공개·해결",
              state.loop.placed.length !== 6 || servantMovementChoiceMissing(state),
              "reveal-cards",
            )}
        </div>
      </section>`;
    case "P5_MASTERMIND_ABILITY":
      return `<section class="operation-panel has-fixed-footer">
        <div class="operation-panel-scroll">
          ${heading(5, phaseName(state.loop.phase))}
          ${loopEndPending
            ? "<p>능력 결과를 확인한 뒤 승패 판정으로 진행하세요.</p>"
            : `${renderSacredTreeTransferChoice(state, "mastermind")}${renderHookList(state, state.loop.phase, true)}`}
        </div>
          <div class="operation-footer">${renderAdvanceButton(
            loopEndPending ? resultConfirmation : undefined,
            !loopEndPending && sacredTreeMastermindChoiceRequired(state),
          )}</div>
        </section>`;
    case "P6_GOODWILL":
      return `<section class="operation-panel has-fixed-footer">
        <div class="operation-panel-scroll">
          ${heading(6, phaseName(state.loop.phase))}
          ${loopEndPending
            ? "<p>우호 능력 결과를 확인한 뒤 승패 판정으로 진행하세요.</p>"
            : renderGoodwillAbilities(state)}
        </div>
        <div class="operation-footer">${renderAdvanceButton(
          loopEndPending ? resultConfirmation : undefined,
        )}</div>
      </section>`;
    case "P7_INCIDENT":
      return `<section class="operation-panel has-fixed-footer">
        <div class="operation-panel-scroll">
          ${heading(7, phaseName(state.loop.phase))}
          <div class="phase-incident-list">${renderTodayIncidents(state, true)}</div>
        </div>
        <div class="operation-footer">${renderAdvanceButton(
          loopEndPending ? resultConfirmation : misc("Incident trigger"),
        )}</div>
      </section>`;
    case "P8_LEADER_PASS":
      return `<section class="operation-panel compact-operation">
        ${heading(8, phaseName(state.loop.phase))}
        <p>${escapeHtml(`${ownerLabel(state.loop.leader)} → ${ownerLabel(((state.loop.leader + 1) % 3) as 0 | 1 | 2)}`)}</p>
        ${renderAdvanceButton()}
      </section>`;
    case "P9_ROUND_END":
      return `<section class="operation-panel has-fixed-footer">
        <div class="operation-panel-scroll">
          ${heading(9, phaseName(state.loop.phase))}
          ${renderCurrentLossDisclosure(state)}
          <div class="round-end-grid">
            <div>${renderHookList(
              state,
              state.loop.phase,
              Boolean(state.loop.roundEndMandatoryResolved) && !loopEndPending,
            )}</div>
            <div class="loss-list">${renderLossDistance(state)}</div>
          </div>
        </div>
        <div class="operation-footer">${renderAdvanceButton(
          loopEndPending
            ? resultConfirmation
            : !state.loop.roundEndMandatoryResolved
            ? "강제 효과 해결"
            : state.loop.day === state.scenario.daysPerLoop
            ? "루프 종료·승패 판정"
            : misc("Next phase", "Next phase"),
        )}</div>
      </section>`;
  }
}

function servantMovementChoiceMissing(state: GameState): boolean {
  return currentServantFollowOptions(state).length > 0 &&
    state.loop.servantMovementChoice === undefined;
}

function renderServantMovementChoice(state: GameState): string {
  const options = currentServantFollowOptions(state);
  if (options.length === 0) return "";
  const choice = state.loop.servantMovementChoice ?? "";
  return `<article class="hook-card servant-movement-choice">
    <div>
      <span>리더 선택 · 메이드 특성</span>
      <strong>이동할 주인을 따라갈지 선택합니다. 동행하면 메이드 자신의 이동과 이동 금지는 모두 무시됩니다.</strong>
    </div>
    <label>
      <span>동행 대상</span>
      <select data-action="servant-movement-choice">
        <option value="" ${choice === "" ? "selected" : ""}>선택 필요</option>
        <option value="decline" ${choice === "decline" ? "selected" : ""}>동행하지 않음 · 자신의 이동 해결</option>
        ${options.map(({ character, to }) => `<option value="${escapeHtml(character)}"
          ${choice === character ? "selected" : ""}>${escapeHtml(characterName(character))} → ${escapeHtml(locationName(to))}</option>`).join("")}
      </select>
    </label>
  </article>`;
}

type SacredTreeActor = "leader" | "mastermind";

function sacredTreeDraftKey(
  actor: SacredTreeActor,
  field: "counter" | "target",
): string {
  return `sacred-tree:${actor}:${field}`;
}

function sacredTreeCounterName(counter: SacredTreeCounter): string {
  return counter === "protection" ? "보호" : counterLabel(counter);
}

function renderSacredTreeTransferChoice(
  state: GameState,
  actor: SacredTreeActor,
): string {
  const condition = sacredTreeTransferCondition(state);
  const eligible = sacredTreeTransferEligible(condition);
  const resolved = actor === "leader"
    ? sacredTreeLeaderStepResolved(state)
    : sacredTreeMastermindStepResolved(state);
  if (!eligible) return "";
  if (actor === "mastermind" && !sacredTreeHasGoodwillRefusal(state)) {
    return "";
  }
  if (resolved) {
    return `<article class="hook-card sacred-tree-transfer-choice is-selected">
      <div><span>${actor === "leader" ? "리더 선택" : "강제"} · 신수 특성</span>
        <strong>이번 라운드의 카운터 이전을 처리했습니다.</strong></div>
    </article>`;
  }

  const counterKey = sacredTreeDraftKey(actor, "counter");
  const targetKey = sacredTreeDraftKey(actor, "target");
  const selectedCounter = draftValue(counterKey);
  const selectedTarget = draftValue(targetKey);
  const selectionComplete = condition.transferableCounters.some(
    (counter) => counter === selectedCounter,
  ) && condition.eligibleTargets.includes(selectedTarget);
  return `<article class="hook-card sacred-tree-transfer-choice">
    <div>
      <span>${actor === "leader" ? "리더 선택" : "강제"} · 신수 특성</span>
      <strong>${actor === "leader"
        ? "신수의 카운터 1개를 같은 장소의 다른 캐릭터에게 옮길 수 있습니다."
        : "우호 무시 역할이므로 카운터 1개를 반드시 옮겨야 합니다."}</strong>
    </div>
    <label><span>카운터</span>
      <select data-ui-draft-key="${counterKey}">
        <option value="">미선택</option>
        ${condition.transferableCounters.map((counter) =>
          `<option value="${counter}" ${selectedCounter === counter ? "selected" : ""}>${escapeHtml(sacredTreeCounterName(counter))}</option>`
        ).join("")}
      </select>
    </label>
    <label><span>받을 캐릭터</span>
      <select data-ui-draft-key="${targetKey}">
        <option value="">미선택</option>
        ${condition.eligibleTargets.map((target) =>
          `<option value="${escapeHtml(target)}" ${selectedTarget === target ? "selected" : ""}>${escapeHtml(characterName(target))}</option>`
        ).join("")}
      </select>
    </label>
    <div class="hook-actions">
      ${actor === "leader"
        ? `<button type="button" data-action="sacred-tree-leader-decline">옮기지 않음</button>`
        : ""}
      <button type="button" data-action="sacred-tree-${actor}-transfer"
        ${selectionComplete ? "" : "disabled"}>카운터 옮기기</button>
    </div>
  </article>`;
}

interface DockPrimaryAction {
  action: "advance" | "reveal-cards";
  label: string;
  disabled: boolean;
}

function dockPrimaryAction(state: GameState): DockPrimaryAction {
  const loopEndPending = state.pendingLoopEnd !== undefined ||
    (state.loop.pendingImmediateLossKeys?.length ?? 0) > 0;
  if (loopEndPending) {
    return {
      action: "advance",
      label: "결과 확인·승패 판정",
      disabled: false,
    };
  }
  switch (state.loop.phase) {
    case "P2_MASTERMIND_ACTION":
      return {
        action: "advance",
        label: "배치 완료",
        disabled: placementsForOwner(state, "mastermind").length !== 3,
      };
    case "P3_PROTAGONIST_ACTION":
      return {
        action: "advance",
        label: "배치 완료",
        disabled: placementsForOwner(state, "mastermind").length !== 3 ||
          nextProtagonist(state) !== undefined,
      };
    case "P4_RESOLVE":
      return state.loop.actionResolutionComplete
        ? {
          action: "advance",
          label: "다음 단계",
          disabled: sacredTreeLeaderChoiceRequired(state),
        }
        : {
          action: "reveal-cards",
          label: "카드 공개·해결",
          disabled: state.loop.placed.length !== 6 ||
            servantMovementChoiceMissing(state),
        };
    case "P7_INCIDENT":
      return { action: "advance", label: "사건 판정", disabled: false };
    case "P5_MASTERMIND_ABILITY":
      return {
        action: "advance",
        label: "다음 단계",
        disabled: sacredTreeMastermindChoiceRequired(state),
      };
    case "P9_ROUND_END":
      return {
        action: "advance",
        label: !state.loop.roundEndMandatoryResolved
          ? "강제 해결"
          : state.loop.day === state.scenario.daysPerLoop
          ? "루프 종료"
          : "다음 단계",
        disabled: false,
      };
    default:
      return { action: "advance", label: "다음 단계", disabled: false };
  }
}

function dockProgress(state: GameState): string {
  if (selectedHandCard) {
    return `${actionCardName(selectedHandCard.card)} → 대상 선택`;
  }
  if (state.loop.phase === "P2_MASTERMIND_ACTION") {
    return `각본가 카드 ${placementsForOwner(state, "mastermind").length}/3`;
  }
  if (state.loop.phase === "P3_PROTAGONIST_ACTION") {
    const mastermindPlaced = placementsForOwner(state, "mastermind").length;
    if (mastermindPlaced < 3) {
      return `각본가 카드 다시 배치 · ${mastermindPlaced}/3`;
    }
    const placed = state.loop.placed.filter(
      ({ owner }) => owner !== "mastermind",
    ).length;
    const current = nextProtagonist(state);
    return current === undefined
      ? "주인공 카드 3/3"
      : `${ownerLabel(current)} · ${placed}/3`;
  }
  return "조작 열기";
}

function renderOperationDock(state: GameState): string {
  const phaseIndex = PHASE_ORDER.indexOf(state.loop.phase) + 1;
  const primary = dockPrimaryAction(state);
  return `
    <section class="operation-dock" aria-label="현재 단계 조작">
      ${operationSheetOpen
        ? `<button type="button" class="operation-scrim" data-action="close-operation-sheet"
              aria-label="조작 패널 닫기"></button>
            <div class="operation-sheet" role="dialog" aria-modal="true"
              aria-label="${escapeHtml(phaseName(state.loop.phase))} 조작">
              <header class="operation-sheet-header">
                <div><span>${phaseIndex}/9</span><strong>${escapeHtml(phaseName(state.loop.phase))}</strong></div>
                <button type="button" class="icon-button" data-action="close-operation-sheet"
                  aria-label="조작 패널 닫기">×</button>
              </header>
              <div class="operation-sheet-body">${renderPhaseControls(state)}</div>
            </div>`
        : ""}
      <div class="operation-dock-bar">
        <button type="button" class="undo-placeholder" disabled>
          <span>되돌리기</span><small>준비 중</small>
        </button>
        <button type="button" class="phase-dock-status" data-action="toggle-operation-sheet"
          aria-expanded="${operationSheetOpen}">
          <span>${phaseIndex}/9 · ${escapeHtml(phaseName(state.loop.phase))}</span>
          <strong>${escapeHtml(dockProgress(state))}</strong>
        </button>
        <button type="button" class="dock-primary" data-action="${primary.action}"
          ${primary.disabled ? "disabled" : ""}>
          ${escapeHtml(primary.label)}
        </button>
      </div>
    </section>`;
}

function mark(pass: boolean): string {
  return `<span class="condition-mark ${pass ? "pass" : "fail"}">${pass ? "✓" : "✗"}</span>`;
}

function renderIncidentChoice(
  state: GameState,
  incident: string,
  fires: boolean,
): string {
  const fields = INCIDENT_CHOICE_FIELDS[incident] ?? [];
  if (state.loop.phase !== "P7_INCIDENT" || !fires || fields.length === 0) {
    return "";
  }

  const living = Object.entries(state.loop.board)
    .filter(([, position]) => isCharacterAlive(position))
    .map(([character]) => character);
  const characterSelect = (field: string, label: string) => {
    const draftKey = incidentDraftKey(field);
    return `
    <label>
      <span>${escapeHtml(label)}</span>
      <select data-incident-field="${field}"
        data-ui-draft-key="${escapeHtml(draftKey)}">
        <option value="">${escapeHtml(misc("Select", "Select"))}</option>
        ${living.map((character) => `
          <option value="${escapeHtml(character)}"
            ${selectedDraftOption(draftKey, character)}>${escapeHtml(characterName(character))}</option>`).join("")}
      </select>
    </label>`;
  };
  const locationDraftKey = incidentDraftKey("location");
  const counterDraftKey = incidentDraftKey("counter");

  return `
    <div class="incident-choice">
      ${fields.includes("target")
        ? characterSelect("target", misc("Target", "Target"))
        : ""}
      ${fields.includes("otherTarget")
        ? characterSelect("otherTarget", misc("Other target", "Other target"))
        : ""}
      ${fields.includes("location")
        ? `<label><span>${escapeHtml(misc("Location", "Location"))}</span>
            <select data-incident-field="location"
              data-ui-draft-key="${escapeHtml(locationDraftKey)}">
              <option value="">${escapeHtml(misc("Select", "Select"))}</option>
              ${LOCATIONS.map((location) => `<option value="${location}" ${selectedDraftOption(locationDraftKey, location)}>${escapeHtml(locationName(location))}</option>`).join("")}
            </select></label>`
        : ""}
      ${fields.includes("counter")
        ? `<label><span>${escapeHtml(misc("Counter", "Counter"))}</span>
            <select data-incident-field="counter"
              data-ui-draft-key="${escapeHtml(counterDraftKey)}">
              <option value="">${escapeHtml(misc("Select", "Select"))}</option>
              <option value="goodwill" ${selectedDraftOption(counterDraftKey, "goodwill")}>${escapeHtml(misc("Goodwill"))}</option>
              <option value="paranoia" ${selectedDraftOption(counterDraftKey, "paranoia")}>${escapeHtml(misc("Paranoia"))}</option>
              <option value="intrigue" ${selectedDraftOption(counterDraftKey, "intrigue")}>${escapeHtml(misc("Intrigue"))}</option>
            </select></label>`
        : ""}
    </div>`;
}

function renderTodayIncidents(
  state: GameState,
  interactive = false,
): string {
  const scheduled = state.scenario.incidents.filter(
    ({ day }) => day === state.loop.day,
  );
  if (scheduled.length === 0) {
    return `<p class="empty-overlay">${escapeHtml(misc("No incident"))}</p>`;
  }

  return scheduled.map(({ incident, culprit }) => {
    const judgment = [...(state.loop.phaseLog ?? [])].reverse().find(
      (entry): entry is Extract<PhaseLogEntry, { kind: "incidentJudged" }> =>
      entry.loop === state.loop.loop &&
      entry.day === state.loop.day &&
      entry.phase === "P7_INCIDENT" &&
      entry.kind === "incidentJudged" &&
      entry.incident === incident &&
      entry.culprit === culprit,
    );
    const fires = incidentFires(state, culprit);
    const failureReasons = incidentFailureReasons(state, culprit);
    const effectSuppressed = culprit === "blackCat";
    const alive = isCharacterAlive(state.loop.board[culprit]);
    const paranoia = state.loop.charCounters[culprit].paranoia;
    const limit = characterDataOf(culprit).paranoiaLimit;
    const culpritSuppressed = state.loop.incidentCulpritSuppressedFor
      ?.includes(culprit) === true;
    const effectSources = INCIDENT_IMPL[incident]?.hooks
      .map(({ source }) => source.description)
      .filter((description): description is string => Boolean(description)) ??
      [];
    const effectText = effectSuppressed
      ? "효과 없음"
      : incidentRuleText(incident, effectSources);
    return `
      <article class="incident-card">
        <div class="incident-title">
          ${mark(fires)}
          <div><strong>${escapeHtml(incidentName(incident))}</strong>
          <span>${escapeHtml(misc("Culprit"))} · ${escapeHtml(characterName(culprit))}</span></div>
        </div>
        ${effectText
          ? `<p class="incident-effect">${escapeHtml(effectText)}</p>`
          : ""}
        <p class="incident-judgment ${fires ? "is-fired" : "is-not-fired"}">
          ${judgment
            ? judgment.fired
              ? `판정 결과 · 발생 · ${judgment.effectApplied ? "효과 적용" : "효과 없음"}`
              : `판정 결과 · 발생하지 않음 (${judgment.failureReasons.map(incidentFailureLabel).join(" · ")})`
            : fires
            ? "판정 결과 · 발생"
            : `판정 결과 · 발생하지 않음 (${failureReasons.map(incidentFailureLabel).join(" · ")})`}
        </p>
        ${judgment?.deaths && judgment.deaths.length > 0
          ? `<p class="incident-public-result">${escapeHtml(
            `${incidentName(incident)}이 발생하여 ${
              judgment.deaths.map(characterName).join("·")
            }가 사망했습니다.`,
          )}</p>`
          : ""}
        ${judgment?.protagonistsDied
          ? `<p class="incident-public-result">${escapeHtml(
            `${incidentName(incident)}이 발생하여 주인공이 사망했습니다.`,
          )}</p>`
          : ""}
        <div class="incident-conditions">
          <span>${mark(alive)} ${escapeHtml(misc("Alive", "생존"))}</span>
          <span>${mark(paranoia >= limit)} ${escapeHtml(misc("Paranoia"))} ${paranoia}/${limit}</span>
          <span>${mark(!culpritSuppressed)} 발생 억제 없음</span>
        </div>
        ${interactive
          ? renderIncidentChoice(state, incident, fires && !effectSuppressed)
          : ""}
      </article>`;
  }).join("");
}

function renderLossRoutes(routes: readonly LossRoute[]): string {
  if (routes.length === 0) {
    return `<div class="loss-route-list"><p class="loss-route-empty">현재 각본에서 확인된 사망 경로 없음</p></div>`;
  }
  const visible = routes.slice(0, DEFAULT_EXPANDED_LIST_LIMIT);
  const overflow = routes.slice(DEFAULT_EXPANDED_LIST_LIMIT);
  return `<div class="loss-route-list">${visible.map(renderLossRoute).join("")}</div>${
    overflow.length === 0
      ? ""
      : `<details class="long-list-details loss-route-details">
          <summary><strong>추가 패배 위험 경로 ${overflow.length}개</strong><span class="long-list-toggle" aria-hidden="true"></span></summary>
          <div class="loss-route-list">${overflow.map(renderLossRoute).join("")}</div>
        </details>`
  }`;
}

function renderLossDistance(state: GameState): string {
  const conditions = distanceToLoss(state);
  if (conditions.length === 0) {
    return `<p class="empty-overlay">${escapeHtml(misc("No loss condition", "No loss condition"))}</p>`;
  }
  return conditions.map((condition) => {
    return `
      <article class="loss-card ${condition.met ? "is-met" : ""} ${condition.blockedBy ? "is-blocked" : ""}">
        <div class="loss-title">
          ${mark(condition.met)}
          <div><strong>${escapeHtml(condition.ko)}</strong>
          <span>${escapeHtml(condition.when)} · ${escapeHtml(condition.activation === "optional" ? misc("Optional", "Optional") : misc("Mandatory", "Mandatory"))}</span></div>
        </div>
        <p class="loss-current-judgment">현재 판정 · ${escapeHtml(condition.label)}</p>
        ${renderLossRoutes(condition.routes)}
        ${condition.daysLeft === undefined
          ? ""
          : `<small>${escapeHtml(misc("Days left", "Days left"))}: ${condition.daysLeft}</small>`}
        ${condition.blockedBy === undefined
          ? ""
          : `<small class="loss-blocked-by">${escapeHtml(
            `${characterName(condition.blockedBy)}의 능력으로 주인공 사망이 막힘`,
          )}</small>`}
        ${condition.activation === "optional" &&
            condition.met &&
            condition.blockedBy === undefined &&
            state.gamePhase === "ROUND" &&
            state.loop.phase === "P9_ROUND_END" &&
            state.loop.roundEndMandatoryResolved
          ? `<label class="optional-loss-toggle">
              <input type="checkbox" data-action="optional-loss"
                data-loss-key="${escapeHtml(condition.key)}"
                ${condition.activated ? "checked" : ""} />
              <span>이 패배 조건을 발동한다</span>
            </label>`
          : ""}
        ${condition.activation === "optional" &&
            condition.met &&
            condition.blockedBy === undefined &&
            state.gamePhase === "ROUND" &&
            state.loop.phase === "P9_ROUND_END" &&
            state.loop.roundEndMandatoryResolved
          ? `<div class="disclosure-baseline">
              <b>미발동</b><span>변화 없음 · 안전</span>
            </div>${renderP9DisclosurePreview(
              previewP9OptionalLossDisclosure(state, condition.key),
              "발동 뒤 즉시 종료 예고",
            )}`
          : ""}
      </article>`;
  }).join("");
}

function lossRouteControlLabel(control: LossRouteControl): string {
  switch (control) {
    case "automatic": return "자동";
    case "mastermind": return "각본가 선택";
    case "protagonist": return "주인공 선택";
  }
}

function renderLossRoute(route: LossRoute): string {
  const requirementsMet = route.requirements.filter(({ met }) => met).length;
  return `<section class="loss-route ${route.met ? "is-met" : ""} ${
    route.available ? "" : "is-unavailable"
  }">
    <div class="loss-route-heading">
      ${mark(route.met)}
      <div>
        <strong>${escapeHtml(route.ko)}</strong>
        <span>${escapeHtml(route.when)} · ${escapeHtml(
          lossRouteControlLabel(route.control),
        )} · 요구 ${requirementsMet}/${route.requirements.length}</span>
      </div>
    </div>
    <ul class="loss-route-requirements">
      ${route.requirements.map((requirement) => `<li class="${
        requirement.met ? "is-met" : ""
      }">${mark(requirement.met)}<span>${escapeHtml(requirement.label)}</span></li>`).join("")}
    </ul>
  </section>`;
}

function guidanceActionSummary(route: MastermindGuidanceRoute): string {
  const cardDetail = route.actions.cardLabels.length === 0
    ? "없음"
    : route.actions.cardLabels.join(" · ");
  const abilityDetail = route.actions.abilityLabels.length === 0
    ? "없음"
    : route.actions.abilityLabels.join(" · ");
  return `카드 ${route.actions.cards}장 (${cardDetail}) · ` +
    `능력 ${route.actions.abilities}회 (${abilityDetail})`;
}

function renderGuidanceRoute(
  route: MastermindGuidanceRoute,
  rank?: string,
  primaryResources?: ReadonlySet<string>,
): string {
  const overlap = primaryResources === undefined
    ? []
    : route.resources.filter((resource) => primaryResources.has(resource));
  return `<article class="guidance-route guidance-control-${route.control}">
    <div class="guidance-route-heading">
      ${rank === undefined ? "" : `<span class="guidance-rank">${escapeHtml(rank)}</span>`}
      <div>
        <strong>${escapeHtml(route.title)}</strong>
        <span>${escapeHtml(route.controlLabel)} · ${escapeHtml(route.minimumDayLabel)}</span>
      </div>
    </div>
    <dl class="guidance-metrics">
      <div><dt>필요 행동</dt><dd>${escapeHtml(guidanceActionSummary(route))}</dd></div>
      <div><dt>최단 소요</dt><dd>${escapeHtml(route.minimumDayLabel)} · ${escapeHtml(route.timing)}</dd></div>
      <div><dt>통제</dt><dd>${escapeHtml(route.controlLabel)}</dd></div>
      <div><dt>견제 난이도</dt><dd>${escapeHtml(route.interferenceDifficulty)} · ${escapeHtml(route.interference)}</dd></div>
    </dl>
    ${overlap.length === 0 || primaryResources === undefined
      ? primaryResources === undefined ? "" : `<p class="guidance-resource is-disjoint">1순위와 필요한 카드·능력이 겹치지 않음</p>`
      : `<p class="guidance-resource">1순위와 자원 ${overlap.length}종 겹침</p>`}
    ${route.warning === undefined
      ? ""
      : `<p class="guidance-warning">${escapeHtml(route.warning)}</p>`}
  </article>`;
}

function renderMastermindCaution(caution: MastermindCaution): string {
  return `<article class="mastermind-caution caution-${caution.severity}">
    <strong>${escapeHtml(caution.title)}</strong>
    <span class="mastermind-caution-condition">${escapeHtml(caution.condition)}</span>
    <p>${escapeHtml(caution.description)}</p>
    <small>근거 · ${escapeHtml(caution.source)}</small>
  </article>`;
}

function renderCautionCategory(
  title: string,
  cautions: readonly MastermindCaution[],
): string {
  if (cautions.length === 0) return "";
  return `<details class="guidance-caution-category">
    <summary>
      <strong>${escapeHtml(title)}</strong>
      <span>${cautions.length}건</span>
    </summary>
    <div class="guidance-caution-list">
      ${cautions.map(renderMastermindCaution).join("")}
    </div>
  </details>`;
}

function renderAttributeCandidates(group: AttributeCandidateGroup): string {
  const actual = new Set(group.actualHolders);
  return `<article class="decoy-card">
    <div class="decoy-card-heading">
      <strong>${escapeHtml(group.source)} · ${escapeHtml(group.attributeLabel)}</strong>
      <span>속성 후보 ${group.candidates.length}명</span>
    </div>
    <p>${escapeHtml(group.requirement)}</p>
    <ul class="decoy-chip-list">
      ${group.candidates.map((character) => `<li class="${
        actual.has(character) ? "is-actual" : "is-decoy"
      }">${escapeHtml(characterName(character))}<small>${
        actual.has(character) ? "실제 역할" : "미끼 후보"
      }</small></li>`).join("")}
    </ul>
  </article>`;
}

function renderConfusableRule(rule: ConfusableRule): string {
  return `<article class="decoy-card">
    <div class="decoy-card-heading">
      <strong>${escapeHtml(rule.observationLabel)}</strong>
      <span>관측</span>
    </div>
    <small class="decoy-rule-explanation">이 관측을 설명하는 룰 목록</small>
    <ul class="decoy-rule-list">
      <li class="is-actual"><span>${escapeHtml(rule.selectedPlotName)}</span><small>이번 게임</small></li>
      ${rule.alternatives.map((alternative) => `<li>
        <span>${escapeHtml(alternative.plotName)}</span>
        <small>같은 시트 후보</small>
      </li>`).join("")}
    </ul>
  </article>`;
}

function renderFakeLossCondition(condition: FakeLossCondition): string {
  return `<article class="decoy-card fake-loss-condition">
    <div class="decoy-card-heading">
      <strong>${escapeHtml(condition.title)}</strong>
    </div>
    <dl class="decoy-requirement">
      <div><dt>추가 조건</dt><dd>${escapeHtml(condition.requirement)}</dd></div>
      <div><dt>가능 대상</dt><dd>${escapeHtml(condition.targets.join(" · "))}</dd></div>
    </dl>
  </article>`;
}

function renderLocationIntrigueSource(source: LocationIntrigueSource): string {
  return `<li>
    <div><strong>${escapeHtml(source.title)}</strong><span>${escapeHtml(source.controller)}</span></div>
    <p>${escapeHtml(source.timing)} · ${escapeHtml(source.targetScope)}</p>
    <small>${escapeHtml(source.condition)}</small>
  </li>`;
}

function renderDecoyCategory(
  title: string,
  count: number,
  body: string,
): string {
  if (count === 0) return "";
  return `<details class="guidance-caution-category decoy-category">
    <summary>
      <strong>${escapeHtml(title)}</strong>
      <span>${count}건</span>
    </summary>
    <div class="guidance-caution-list">${body}</div>
  </details>`;
}

function renderMastermindDecoys(decoys: MastermindDecoyGuidance): string {
  return `<section class="mastermind-decoys" aria-label="시선 분산과 미끼">
    <div class="mastermind-cautions-heading">
      <span class="eyebrow">C. 시선 분산과 미끼</span>
      <h3>관측을 흐리는 정적 후보</h3>
      <p>같은 시트 안에서 이 관측을 설명할 수 있는 룰과 실제로 성립시킬 수 있는 미끼만 보여줍니다.</p>
    </div>
    ${renderDecoyCategory(
      "같은 속성 캐릭터",
      decoys.attributeCandidates.length,
      decoys.attributeCandidates.map(renderAttributeCandidates).join(""),
    )}
    ${renderDecoyCategory(
      "헷갈리게 만들 수 있는 룰",
      decoys.confusableRules.length,
      decoys.confusableRules.map(renderConfusableRule).join(""),
    )}
    ${renderDecoyCategory(
      "성립시킬 수 있는 가짜 패배 조건",
      decoys.fakeLossConditions.length,
      decoys.fakeLossConditions.map(renderFakeLossCondition).join(""),
    )}
    ${renderDecoyCategory(
      "장소에 음모를 놓는 수단",
      decoys.locationIntrigueSources.length,
      `<ul class="location-intrigue-source-list">${
        decoys.locationIntrigueSources.map(renderLocationIntrigueSource).join("")
      }</ul>`,
    )}
  </section>`;
}

function renderCoverCandidate(
  candidate: RoleCoverCandidate,
  rank?: number,
): string {
  const affected = candidate.affectedVictoryRoutes.length === 0
    ? "현재 계산된 승리 경로 없음"
    : candidate.affectedVictoryRoutes.join(" · ");
  return `<article class="cover-candidate difficulty-${candidate.difficulty}">
    <div class="cover-candidate-heading">
      <div>${rank === undefined ? "" : `<span>${rank}순위</span>`}
        <strong>${escapeHtml(candidate.characterName)} · ${escapeHtml(candidate.roleName)}</strong>
      </div>
      <b>${escapeHtml(candidate.alreadyRevealed ? "이미 공개" : candidate.difficultyLabel)}</b>
    </div>
    <p>${escapeHtml(candidate.recommendationReason)}</p>
    <dl class="cover-metrics">
      <div><dt>노출 경로</dt><dd>${candidate.exposurePathCount}개 · 강제 ${candidate.automaticPathCount} / 각본가 ${candidate.mastermindPathCount} / 주인공 ${candidate.protagonistPathCount}</dd></div>
      <div><dt>숨김 비용</dt><dd>영향받는 현재 승리 경로 ${candidate.affectedVictoryRouteCount}개 · ${escapeHtml(affected)}</dd></div>
      <div><dt>룰 파급</dt><dd>${escapeHtml(candidate.plotExposure)}</dd></div>
    </dl>
    ${candidate.exposurePaths.length === 0 ? "" : `<details>
      <summary>노출 조건과 교환 ${candidate.exposurePaths.length}개</summary>
      <ul>${candidate.exposurePaths.map((path) => `<li>
        <strong>${escapeHtml(path.title)}</strong>
        <span>${escapeHtml(path.observation)}</span>
        <small>회피 · ${escapeHtml(path.avoidance)}</small>
        <small>포기 · ${escapeHtml(path.sacrifice)}</small>
      </li>`).join("")}</ul>
    </details>`}
  </article>`;
}

function renderCommonRoleExposure(exposure: CommonRoleExposure): string {
  return `<li>
    <strong>${escapeHtml(exposure.title)}</strong>
    <span>${escapeHtml(exposure.observation)}</span>
    <small>가능 · ${escapeHtml(exposure.targetCharacterNames.join(" · "))}</small>
    ${exposure.excludedCharacterNames.length === 0 ? "" : `<small>제외 · ${escapeHtml(
      exposure.excludedCharacterNames.join(" · "),
    )}</small>`}
  </li>`;
}

function renderMastermindCover(cover: MastermindCoverGuidance): string {
  return `<section class="mastermind-cover" aria-label="최후의 싸움 역할 은폐">
    <div class="mastermind-cautions-heading">
      <span class="eyebrow">D. 역할 은폐 순서</span>
      <h3>끝까지 지킬 후보</h3>
      <p>노출 경로 수, 통제 가능성, 회피할 때 포기하는 현재 승리 경로를 사전 계산합니다.</p>
    </div>
    <div class="cover-phase-principles">
      <p>${escapeHtml(cover.earlyPrinciple)}</p>
      <p>${escapeHtml(cover.latePrinciple)}</p>
      <p>${escapeHtml(cover.finalDefensePrinciple)}</p>
      <p>${escapeHtml(cover.rolePoolPressure)}</p>
    </div>
    ${cover.commonExposure.length === 0 ? "" : `<details class="guidance-caution-category cover-common-exposure">
      <summary><strong>공통 역할 공개 수단</strong><span>${cover.commonExposure.length}개</span></summary>
      <div class="guidance-caution-list"><ul>${cover.commonExposure.map(
        renderCommonRoleExposure,
      ).join("")}</ul></div>
    </details>`}
    ${cover.recommendation === undefined
      ? `<p class="empty-overlay">지킬 수 있는 미공개 후보가 없습니다.</p>`
      : `<div class="cover-recommendation"><span>정적 우선 후보</span>${
        renderCoverCandidate(cover.recommendation)
      }</div>`}
    <details class="guidance-caution-category cover-ranking">
      <summary><strong>전체 은폐 순서</strong><span>${cover.candidates.length}명</span></summary>
      <div class="guidance-caution-list">${cover.candidates.map((candidate, index) =>
        renderCoverCandidate(candidate, index + 1)
      ).join("")}</div>
    </details>
  </section>`;
}

function renderOpeningProgress(profile: OpeningProfile): string {
  return `1순위 ${profile.guaranteed.primary}/${profile.unopposed.primary} · ` +
    `대안 ${profile.guaranteed.alternatives}/${profile.unopposed.alternatives} · ` +
    `미끼 ${profile.guaranteed.decoys}/${profile.unopposed.decoys}`;
}

function renderOpeningProfile(profile: OpeningProfile, rank?: string): string {
  return `<article class="opening-profile">
    <div class="opening-profile-heading">
      <strong>${escapeHtml(rank ?? "후보 배치")}</strong>
      <span>최악 대응 보장 / 무대응 · ${escapeHtml(renderOpeningProgress(profile))}</span>
    </div>
    <ol class="opening-placement-list">${profile.placements.map((placement) => {
      const reasons = [...new Set(placement.contributions.map(({ reason }) => reason))];
      return `<li>
        <div><strong>${escapeHtml(placement.targetLabel)}에 ${escapeHtml(placement.cardLabel)}</strong></div>
        ${reasons.map((reason) => `<p>${escapeHtml(reason)}</p>`).join("")}
        <small>대응 · ${escapeHtml(placement.protagonistResponse)}</small>
      </li>`;
    }).join("")}</ol>
    <p class="opening-worst-response">최악 대응 · ${escapeHtml(profile.worstResponse)}</p>
    <p class="opening-concealment">은폐 교환 · ${escapeHtml(profile.concealment)}</p>
  </article>`;
}

function renderMastermindOpening(opening: MastermindOpeningGuidance): string {
  const first = opening.recommendations[0];
  return `<section class="mastermind-opening" aria-label="1일차 개시 배치">
    <div class="mastermind-cautions-heading">
      <span class="eyebrow">E. 1일차 개시 배치</span>
      <h3>첫날에 남길 진척과 미끼</h3>
      <p>주인공의 가장 불리한 합법 대응을 받은 뒤에도 남는 진척을 기준으로 정렬했습니다.</p>
    </div>
    <p class="opening-axis-contract">${escapeHtml(opening.axisContract)}</p>
    ${first === undefined
      ? `<p class="empty-overlay">세 장으로 완성되는 기여 배치가 없습니다.</p>`
      : renderOpeningProfile(first, "정적 1순위")}
    ${opening.recommendations.length <= 1 ? "" : `<details class="guidance-caution-category opening-alternatives">
      <summary><strong>다른 개시 배치</strong><span>${opening.recommendations.length - 1}개</span></summary>
      <div class="guidance-caution-list">${opening.recommendations.slice(1).map((profile, index) =>
        renderOpeningProfile(profile, `${index + 2}순위`)
      ).join("")}</div>
    </details>`}
  </section>`;
}

function renderMastermindGuidance(
  state: GameState,
  context: "beforeStart" | "panel",
): string {
  const guidance = mastermindGuidance(state);
  const cautions = mastermindCautions(state);
  const decoys = mastermindDecoyGuidance(state);
  const cover = mastermindCoverGuidance(state);
  const opening = mastermindOpeningGuidance(state);
  const primary = guidance.primary;
  const primaryResources = new Set(primary?.resources ?? []);
  const otherRankedRoutes = guidance.rankedRoutes.slice(3);
  const body = `
    <section class="mastermind-guidance-priorities" aria-label="승리 경로 우선순위">
      <div class="mastermind-cautions-heading">
        <span class="eyebrow">A. 승리 경로 우선순위</span>
        <h3>성립 경로 우선순위</h3>
        <p>최단 소요와 필요한 행동을 먼저 비교하고, 2순위부터는 1순위와 자원이 덜 겹치는 경로를 앞에 둡니다.</p>
      </div>
    <div class="guidance-priority-list">
      ${primary === undefined
        ? `<p class="empty-overlay">각본가가 노릴 수 있는 경로가 없습니다.</p>`
        : renderGuidanceRoute(primary, "1순위")}
      ${guidance.alternatives.map((route, index) =>
        renderGuidanceRoute(route, `${index + 2}순위`, primaryResources)
      ).join("")}
    </div>
    ${otherRankedRoutes.length === 0 ? "" : `<details class="guidance-all-routes">
      <summary>그 외 성립 가능 경로 ${otherRankedRoutes.length}개 보기</summary>
      <div class="guidance-all-routes-body">
        ${otherRankedRoutes.map((route, index) => renderGuidanceRoute(
          route,
          `${index + 4}순위`,
          primaryResources,
        )).join("")}
      </div>
    </details>`}
    ${guidance.protagonistChoices.length === 0
      ? ""
      : `<details class="guidance-all-routes"><summary>주인공 선택으로만 성립하는 경로 ${guidance.protagonistChoices.length}개</summary><div class="guidance-all-routes-body">${guidance.protagonistChoices.map((route) => renderGuidanceRoute(route)).join("")}</div></details>`}
    </section>
    <section class="mastermind-cautions" aria-label="주의사항">
      <div class="mastermind-cautions-heading">
        <span class="eyebrow">B. 주의사항</span>
        <h3>시나리오별 주의사항</h3>
        <p>현재 캐스트의 실제 역할·특성과 선택된 룰·사건만 표시합니다.</p>
      </div>
      ${renderCautionCategory("정체가 드러나는 행동", cautions.identityExposure)}
      ${renderCautionCategory("자동 발동 주의", cautions.uncontrolledRisks)}
      ${renderCautionCategory("사건·운영 체크", cautions.operationalNotes)}
      ${renderCautionCategory("주인공이 쓸 수 있는 수단", cautions.protagonistTools)}
    </section>
    ${renderMastermindDecoys(decoys)}
    ${renderMastermindCover(cover)}
    ${renderMastermindOpening(opening)}`;

  if (context === "beforeStart") {
    return `<details class="pre-game-guidance" aria-label="각본가 시작 지침">
      <summary class="pre-game-guidance-heading">
        <span><small class="eyebrow">게임 전 준비 · 게임 중 다시 확인</small><strong>각본가 시작 지침</strong></span>
        <i aria-hidden="true"></i>
      </summary>
      <div class="pre-game-guidance-body">
        <p class="pre-game-guidance-intro">게임 중에는 각본가 정보의 같은 항목을 접어 두고 다시 확인할 수 있습니다.</p>
        ${body}
      </div>
    </details>`;
  }
  return `<details class="info-accordion mastermind-guidance-information">
    <summary>
      <span><small>정적 지침</small><strong>각본가 시작 지침</strong></span>
      <span class="accordion-summary-value">${guidance.routes.length}개 경로 · 주의 ${cautions.total}건 · 미끼 ${decoys.total}건 · 은폐 ${cover.recommendation === undefined ? "없음" : escapeHtml(cover.recommendation.characterName)} · 개시 ${opening.candidateProfileCount.toLocaleString("ko-KR")}</span>
      <i aria-hidden="true"></i>
    </summary>
    <div class="info-accordion-body mastermind-guidance-body">${body}</div>
  </details>`;
}

function renderOngoingGoodwillEffects(state: GameState): string {
  const items = [
    ...(state.loop.incidentCulpritSuppressedFor ?? []).map(
      (character) =>
        `${characterName(character)}: 자신이 범인인 사건은 발생하지 않음`,
    ),
    ...(state.loop.protagonistDeathPreventedBy ?? []).map(
      (character) =>
        `${characterName(character)}: 이번 루프 동안 주인공 사망 방지`,
    ),
  ];
  if (items.length === 0) return "";

  return `<section>
    <div class="overlay-heading">
      <span class="eyebrow">P6</span>
      <h2>지속 중인 우호 능력</h2>
    </div>
    <ul class="ongoing-effect-list">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  </section>`;
}

function renderLoopStartInformation(state: GameState): string {
  const henchmanStart = state.loop.loopStartTraitLocationChoices?.henchman;
  if (!("henchman" in state.scenario.cast) || henchmanStart === undefined) {
    return "";
  }

  return `<section class="loop-start-information">
    <div class="overlay-heading">
      <span class="eyebrow">${state.loop.loop}루프</span>
      <h2>하수인 시작 장소</h2>
    </div>
    <strong>${escapeHtml(locationName(henchmanStart))}</strong>
  </section>`;
}

function subPlotInclusionDeductionLabel(
  summary: RuleHypothesisSummary,
): string {
  if (summary.remainingCombinations.length === 0) return "후보 없음";
  const fixed = summary.fixedSubPlots.map(plotName);
  return fixed.length === 0
    ? "포함 확정 없음"
    : `${fixed.join(" / ")} 포함 확정`;
}

function renderScenarioInformation(
  state: GameState,
  ruleSummary: RuleHypothesisSummary,
  deductionSummary: DeductionTablesSummary,
  mode: "full" | "selection" = "full",
): string {
  const mainPlotCandidates = ruleSummary.mainPlotCandidates.map(plotName);
  const subPlotCandidates = ruleSummary.subPlotCandidates.map(plotName);
  const fixedSubPlotSet = new Set(ruleSummary.fixedSubPlots);
  const roleRows = new Map(
    deductionSummary.roleRows.map((row) => [row.character, row]),
  );
  const specialRules = state.scenario.specialRules ?? [];

  return `<section class="scenario-information-panel">
    <div class="overlay-heading">
      <span class="eyebrow">${escapeHtml(misc("Script"))}</span>
      <h2>룰과 역할</h2>
    </div>
    <dl class="scenario-rule-list">
      <div class="scenario-rule-row is-rule-y ${
        ruleSummary.ruleYFixed ? "is-confirmed" : ""
      }">
        <dt>룰 Y</dt>
        <dd>
          <span class="scenario-rule-value">${escapeHtml(
            plotName(state.scenario.mainPlot),
          )}</span>
          <i class="scenario-deduction-chip ${
            ruleSummary.ruleYFixed ? "is-danger" : ""
          }" title="공개 후보: ${escapeHtml(
            mainPlotCandidates.join(" / ") || "없음",
          )}">${ruleSummary.ruleYFixed
            ? "확정 · 위험"
            : `후보 ${ruleSummary.mainPlotCandidates.length}개`}</i>
          ${mode === "selection"
            ? ""
            : `<small>공개 후보 · ${escapeHtml(
              mainPlotCandidates.join(" / ") || "없음",
            )}</small>`}
        </dd>
      </div>
      ${state.scenario.subPlots.length === 0
        ? `<div class="scenario-rule-row is-rule-x"><dt>룰 X</dt><dd>${escapeHtml(
          misc("None", "None"),
        )}</dd></div>`
        : state.scenario.subPlots.map((plot, index) => {
          const included = fixedSubPlotSet.has(plot);
          return `<div class="scenario-rule-row is-rule-x ${
            included ? "is-confirmed" : ""
          }">
            <dt>룰 X${index + 1}</dt>
            <dd>
              <span class="scenario-rule-value">${escapeHtml(plotName(plot))}</span>
              ${included
                ? `<i class="scenario-deduction-chip is-confirmed" title="룰 X에 반드시 포함되지만 X1/X2 위치는 미확정">포함 확정</i>`
                : `<i class="scenario-deduction-chip">전체 후보 ${ruleSummary.subPlotCandidates.length}개</i>`}
              ${mode === "selection"
                ? ""
                : `<small title="룰 X 전체 공개 후보: ${escapeHtml(
                  subPlotCandidates.join(" / ") || "없음",
                )}">룰 X 전체 공개 후보 · ${escapeHtml(
                  subPlotCandidates.join(" / ") || "없음",
                )}</small>`}
            </dd>
          </div>`;
        }).join("")}
      ${mode === "selection" || ruleSummary.fixedSubPlots.length === 0
        ? ""
        : `<div class="scenario-rule-row scenario-rule-x-inclusion">
            <dt>룰 X 공통</dt>
            <dd><small class="scenario-rule-deduction" title="전체 공개 후보: ${escapeHtml(
              subPlotCandidates.join(" / ") || "없음",
            )}">공개 추론 · ${escapeHtml(
              subPlotInclusionDeductionLabel(ruleSummary),
            )}</small></dd>
          </div>`}
    </dl>
    ${specialRules.length === 0
      ? ""
      : `<section class="scenario-special-rules" aria-label="시나리오 특수 규칙">
          <h3>시나리오 특수 규칙</h3>
          <ul>${specialRules.map((rule) =>
            `<li>${escapeHtml(gameText(rule))}</li>`
          ).join("")}</ul>
        </section>`}
    <ul class="scenario-cast-list">
      ${Object.keys(state.scenario.cast).map((character) => {
        const roleRow = roleRows.get(character);
        const culpritDays = incidentDaysForCharacter(state, character);
        const traitText = characterTraitText(state, character);
        const facts: string[] = [];
        if (character === "boss") {
          const turf = state.loop.turfLocations.boss;
          if (turf !== undefined) facts.push(`세력권 · ${locationName(turf)}`);
        }
        const entry = characterEntryTiming(state.scenario, character);
        if (entry?.kind === "loop") facts.push(`등장 루프 · ${entry.value}루프`);
        if (entry?.kind === "day") facts.push(`등장 날짜 · ${entry.value}일`);
        if (character === "henchman") {
          const start = state.loop.loopStartTraitLocationChoices?.henchman;
          facts.push(`이번 루프 시작 장소 · ${
            start === undefined ? "미선택" : locationName(start)
          }`);
        }
        if (character === "scientist") {
          const counter = state.loop.loopStartTraitCounterChoices?.scientist;
          facts.push(`이번 루프 카운터 · ${
            counter === undefined ? "미선택" : counterLabel(counter)
          }`);
        }
        const possibleRoleNames = roleRow?.possibleRoles.map(roleName) ?? [];
        const roleStatus = roleRow?.confirmedRole === undefined
          ? `후보 ${possibleRoleNames.length}개`
          : "확정";
        return `<li>
          <span>${escapeHtml(characterName(character))}</span>
          <span class="scenario-role-value">
            <b>${escapeHtml(roleName(effectiveRole(state, character)))}</b>
            <i class="scenario-deduction-chip ${
              roleRow?.confirmedRole === undefined ? "" : "is-confirmed"
            }" title="공개 후보: ${escapeHtml(
              possibleRoleNames.join(" / ") || "없음",
            )}">${roleStatus}</i>
          </span>
          ${culpritDays.length === 0
            ? ""
            : `<em>범인 · ${culpritDays.map((day) => `${day}일`).join(" · ")}</em>`}
          ${mode === "selection"
            ? ""
            : `${traitText
              ? `<small class="scenario-cast-trait"><strong>특성</strong> · ${escapeHtml(traitText)}</small>`
              : ""}${facts.map((fact) =>
                `<small class="scenario-cast-fact">${escapeHtml(fact)}</small>`
              ).join("")}`}
        </li>`;
      }).join("")}
    </ul>
  </section>`;
}

function recordedIncidentStatus(row: IncidentScheduleRow): string {
  if (row.outcome === "fired") {
    if (!row.judgmentRecorded) return "발생 · 상세 기록 없음";
    return row.effectApplied === false ? "발생 · 효과 없음" : "발생";
  }
  if (row.outcome === "notFired") {
    const reasons = row.outcomeReasons.map(incidentFailureLabel);
    return reasons.length > 0
      ? `미발생 · ${reasons.join(" · ")}`
      : "미발생 · 사유 기록 없음";
  }
  return "";
}

function pendingIncidentStatus(row: IncidentScheduleRow): string {
  if (row.timing === "today") {
    return row.conditionMet
      ? "발생 조건 충족"
      : `미달 · ${row.currentFailureReasons.map(incidentFailureLabel).join(" · ")}`;
  }

  const urgency = row.paranoiaNeeded > 0
    ? `불안 ${row.paranoiaNeeded}개 필요`
    : row.conditionMet
    ? "현재 발생 조건 충족"
    : row.currentFailureReasons.map(incidentFailureLabel).join(" · ");
  return `${row.daysUntil}일 남음 · ${urgency}`;
}

function renderIncidentSchedule(
  state: GameState,
  mode: "full" | "selection" = "full",
): string {
  const rows = incidentScheduleRows(state);
  return `<section class="incident-schedule-panel">
    <div class="overlay-heading">
      <span class="eyebrow">${escapeHtml(misc("Incident step"))}</span>
      <h2>사건 일정</h2>
    </div>
    ${rows.length === 0
      ? `<p class="empty-overlay">${escapeHtml(misc("No incident"))}</p>`
      : `<div class="incident-schedule-scroll"><table class="incident-schedule">
          <thead><tr><th>날짜</th><th>사건</th><th>범인</th><th>상태</th></tr></thead>
          <tbody>${rows.map((row) => {
            const timingLabel = row.timing === "past"
              ? "지남"
              : row.timing === "today"
              ? "오늘"
              : `D-${row.daysUntil}`;
            const status = row.outcome
              ? recordedIncidentStatus(row)
              : pendingIncidentStatus(row);
            return `<tr class="is-${row.timing}">
              <td><strong>${row.day}일</strong>${
                mode === "selection" ? "" : `<span>${timingLabel}</span>`
              }</td>
              <td>${escapeHtml(incidentName(row.incident))}</td>
              <td>${escapeHtml(characterName(row.culprit))}${
                mode !== "selection" && row.culpritEntryLabel
                  ? `<span>${escapeHtml(row.culpritEntryLabel)}</span>`
                  : ""
              }</td>
              <td>${row.timing === "past"
                ? ""
                : `<strong>${row.allCountersCountAsParanoia ? "판정 불안" : "불안"} ${row.paranoia}/${row.paranoiaLimit}</strong>`}${
                  mode === "selection" ? "" : `<span>${escapeHtml(status)}</span>`
                }${mode === "selection" ? "" : row.aiEffectResolvedOnDays.map((day) =>
                    `<small class="incident-advance-effect">└ ${day}일차에 AI 능력으로 효과 선행 해결됨</small>`
                  ).join("")
                }</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>`}
  </section>`;
}

function observedCounterLabel(
  counter: IncidentCounter | "protection",
): string {
  return counter === "protection" ? "보호" : counterLabel(counter);
}

function publicAbilityObservationLabel(
  observation: Extract<
    ProtagonistObservation,
    { kind: "mastermindAbilityResult" }
  >,
): string {
  const changeLabels = observation.changes.map((change) => {
    if (change.kind === "counter") {
      const delta = change.delta > 0 ? `+${change.delta}` : String(change.delta);
      return `${targetLabel(change.target)} ${observedCounterLabel(change.counter)}${delta}`;
    }
    if (change.kind === "movement") {
      return `${characterName(change.character)} ${locationName(change.from)} → ${locationName(change.to)}`;
    }
    return `${characterName(change.character)} ${change.to === "dead" ? "사망" : change.to === "alive" ? "생존" : "미등장"}`;
  });
  const timing = observation.timing === "ON_DEATH"
    ? "캐릭터 사망 직후"
    : observation.timing === "LOOP_START"
    ? "루프 시작"
    : observation.timing === "P9_ROUND_END"
    ? "라운드 종료 시"
    : "각본가 능력 결과";
  return `${timing} · ${changeLabels.join(" · ")}`;
}

function hypothesisObservationLabel(
  observation: ProtagonistObservation,
): string {
  switch (observation.kind) {
    case "roleRevealed":
      return `${characterName(observation.character)} = ${roleName(observation.role)} 공개`;
    case "deadAtLoopEndWithoutRoleReveal":
      return `${observation.loop}루프 종료 · ${characterName(observation.character)} 사망 · 역할 공개 없음`;
    case "goodwillRefused":
      return `${characterName(observation.character)} 우호 능력 거부`;
    case "goodwillAccepted":
      return `${characterName(observation.character)} 우호 능력 해결`;
    case "subplotRevealed":
      return `정보원 룰 X 공개 · ${plotName(observation.revealedSubplot)}`;
    case "mastermindAbilityResult":
      return publicAbilityObservationLabel(observation);
    case "incidentOccurred":
      return `${observation.day}일 ${incidentName(observation.incident)} · ${observation.occurred ? "발생" : "미발생"}`;
    case "incidentCulpritRevealed":
      return `${incidentName(observation.incident)} 범인 공개 · ${characterName(observation.culprit)}`;
    case "lossObserved":
      return observation.timing === "protagonistDeath"
        ? `${observation.loop}루프 ${observation.day}일 주인공 사망`
        : `${observation.loop}루프 ${observation.day}일 루프 종료 승패 판정 패배`;
    case "goodwillIncidentEffect":
      return `${observation.day}일 ${incidentName(observation.incident)} 효과 해결`;
    case "intrigueForbidIgnored":
      return `음모 금지 무시 · ${targetLabel(observation.target)} 음모 증가`;
    case "goodwillForbidApplied":
      return `${observation.loop}루프 ${observation.day}일 · ${characterName(observation.character)} 우호 금지 발동`;
    case "sacredTreeMastermindTransferJudged":
      return `${observation.loop}루프 ${observation.day}일 · 각본가 신수 특성 ${
        !observation.eligible
          ? "발동 조건 불충족"
          : observation.performed
          ? "카운터 이전"
          : "미발동"
      }`;
    case "roundEvidence": {
      const deaths = observation.record.deathBatches?.flatMap(
        ({ characters }) => characters,
      ) ?? [];
      const result = deaths.length === 0
        ? "사망 없음"
        : `${deaths.map(characterName).join(", ")} 사망`;
      const immediate = observation.record.immediateLoopEnd === undefined
        ? ""
        : " · 즉시 루프 종료";
      return `${observation.loop}루프 ${observation.record.day}일 라운드 종료 · ${result}${immediate}`;
    }
    case "mandatoryEffectMissing":
      return `${observation.loop}루프 시작 · ${characterName(observation.character)} 인과율 불안 증가 없음`;
  }
}

function ruleCombinationLabel(
  mainPlot: string,
  subPlots: readonly string[],
): string {
  return `${plotName(mainPlot)} + X 조합 ${subPlots.map(plotName).join(" / ")}`;
}

function renderRuleHypotheses(summary: RuleHypothesisSummary): string {
  const remainingCount = summary.remainingCombinations.length;
  const mainCandidateNames = summary.mainPlotCandidates.map(plotName);
  const observationRow = ({
    observation,
    excludedCount,
  }: typeof summary.observationImpacts[number]): string => `<li>
    <span>${escapeHtml(hypothesisObservationLabel(observation))}</span>
    <strong>${excludedCount === 0
      ? "배제 없음"
      : `${excludedCount}개 배제`}</strong>
  </li>`;
  const impactfulObservations = summary.observationImpacts
    .filter(({ excludedCount }) => excludedCount > 0)
    .map(observationRow);
  const zeroImpactObservations = summary.observationImpacts
    .filter(({ excludedCount }) => excludedCount === 0)
    .map(observationRow);
  const remainingList = summary.remainingCombinations.map((combination) => `
    <li>
      <span>${escapeHtml(ruleCombinationLabel(
        combination.mainPlot,
        combination.subPlots,
      ))}</span>
      <b>남음</b>
    </li>`).join("");
  const combinationList = summary.showEveryCombination
    ? `<section class="hypothesis-combinations">
        <h3>전체 조합 ${summary.totalCombinations}개</h3>
        <ul>${summary.evaluatedCombinations.map(({ combination, excluded }) => `
          <li class="${excluded ? "is-excluded" : ""}">
            <span>${escapeHtml(ruleCombinationLabel(
              combination.mainPlot,
              combination.subPlots,
            ))}</span>
            <b>${excluded ? "배제" : "남음"}</b>
          </li>`).join("")}</ul>
      </section>`
    : `<details class="hypothesis-combinations hypothesis-combinations-nested">
        <summary>남은 조합 ${remainingCount}개 보기</summary>
        <ul>${remainingList}</ul>
      </details>`;
  const lossDeductionAlerts = summary.lossDeductions.map((deduction) => {
    const fixed = [
      ...deduction.fixedPlots.map(plotName),
      ...deduction.fixedRoles.map(({ character, role }) =>
        `${characterName(character)} = ${roleName(role)}`
      ),
    ];
    return `<section class="loss-deduction-alert" role="status">
      <span>${deduction.observation.loop}루프 패배 추론</span>
      <strong>이번 패배로 ${escapeHtml(fixed.join(" · "))} 확정됨</strong>
    </section>`;
  }).join("");

  return `${lossDeductionAlerts}
    <details class="info-accordion compact-information rule-hypothesis-information ${
      summary.ruleYFixed ? "is-rule-y-fixed" : ""
    }">
      <summary>
        <strong>룰 후보</strong>
        <span class="accordion-summary-value">
          ${summary.totalCombinations} → ${remainingCount}
          ${summary.ruleYFixed ? `<b>룰 Y 확정</b>` : ""}
        </span>
        <i aria-hidden="true"></i>
      </summary>
      <div class="info-accordion-body hypothesis-body">
        <section class="hypothesis-axis ${summary.ruleYFixed ? "is-danger" : ""}">
          <div>
            <span>룰 Y 후보</span>
            <strong>${summary.mainPlotTotal} → ${summary.mainPlotCandidates.length}</strong>
            ${summary.ruleYFixed ? `<em>확정 · 위험</em>` : ""}
          </div>
          <p>${escapeHtml(mainCandidateNames.join(" / ") || "후보 없음")}</p>
        </section>
        <section class="hypothesis-axis">
          <div>
            <span>룰 X 전체 후보</span>
            <strong>${summary.subPlotTotal} → ${summary.subPlotCandidates.length}</strong>
          </div>
          <p>${escapeHtml(summary.subPlotCandidates.map(plotName).join(" / ") || "후보 없음")}</p>
        </section>
        ${summary.fixedSubPlots.length === 0
          ? ""
          : `<section class="hypothesis-axis hypothesis-x-inclusion">
              <div><span>룰 X 포함 확정</span><strong>${summary.fixedSubPlots.length}개</strong></div>
              <p>${escapeHtml(summary.fixedSubPlots.map(plotName).join(" / "))}</p>
            </section>`}
        <div class="hypothesis-combination-count">
          <span>조합</span><strong>${remainingCount}개</strong>
        </div>
        ${combinationList}
        <section class="hypothesis-exclusions">
          <h3>관측 목록</h3>
          ${summary.observationImpacts.length === 0
            ? `<p class="empty-overlay">아직 관측이 없습니다.</p>`
            : `${renderBoundedHtmlList(
                impactfulObservations,
                "hypothesis-observation-list",
                "추가 배제 관측",
              )}${renderCollapsedHtmlList(
                zeroImpactObservations,
                "hypothesis-observation-list",
                `배제 없음 ${zeroImpactObservations.length}건`,
              )}`}
        </section>
      </div>
    </details>`;
}

function roleCellReasonLabel(code: string): string {
  switch (code) {
    case "roleRevealed": return "역할 공개";
    case "otherRoleConfirmed": return "다른 역할 확정";
    case "effectiveRoleRevealed": return "공개 시점 유효 역할";
    case "otherRoleInferred": return "다른 역할 추론 확정";
    case "onlyRemainingRole": return "유일 역할 후보";
    case "requiredRoleForcedCandidate": return "필수 역할 남은 후보";
    case "roleMaximumReached": return "최대 인원 도달";
    case "outsiderConstraint": return "아웃사이더 제약";
    case "characterConstraint": return "캐릭터 제약";
    case "ruleUnavailable": return "남은 룰에서 불가";
    case "goodwillRefusalRequired": return "우호 거부 관측";
    case "mandatoryGoodwillRefusalMissing": return "절대 우호 거부 없음";
    case "sacredTreeGoodwillRefusalRequired": return "신수 강제 이전 관측";
    case "sacredTreeGoodwillRefusalAbsent": return "신수 강제 이전 없음";
    case "abilityLocationIntersection": return "능력 위치 교집합";
    case "loopEndRoleRevealMissing": return "루프 종료 역할 공개 없음";
    case "lossConditionOnlyCandidate": return "패배 조건 유일 후보";
    case "diedDespiteImmortality": return "사망으로 불사 배제";
    case "deathWithoutImmediateLoss": return "사망했지만 즉시 종료 없음";
    case "goodwillForbidApplied": return "우호 금지 발동으로 불사 배제";
    case "causeConstraint": return "누적 원인 제약";
    default: return code;
  }
}

function incidentCellReasonLabel(code: string): string {
  switch (code) {
    case "culpritRevealed": return "범인 공개";
    case "suicideDeathIdentified": return "자살 사망자 확인";
    case "missingPersonMovementIdentified": return "행방불명 이동 흔적";
    case "incidentTraceLocationMismatch": return "사건 흔적 장소 불일치";
    case "murderVictimCannotBeCulprit": return "살인 사건 피해자";
    case "onlyRemainingCandidate": return "유일 후보";
    case "otherCulpritConfirmed": return "다른 범인 확정";
    case "culpritAlreadyAssigned": return "다른 사건 범인 확정";
    case "firedBelowParanoia": return "발생 시 불안 미달";
    case "firedWhileUnavailable": return "발생 시 생존하지 않음";
    case "didNotFireDespiteConditions": return "충족했지만 미발생";
    default: return code;
  }
}

function possibilityMark(status: "possible" | "impossible" | "confirmed"): string {
  return status === "confirmed" ? "✓" : status === "impossible" ? "×" : "○";
}

function possibilityStatusLabel(
  status: "possible" | "impossible" | "confirmed" | undefined,
): string {
  return status === "confirmed"
    ? "확정"
    : status === "impossible"
    ? "배제"
    : status === "possible"
    ? "후보"
    : "현재 룰 후보에 없음";
}

function renderRoleInferenceTraces(
  summary: ReturnType<typeof deductionTablesSummary>,
): string {
  const traces: string[] = [];
  const virusPossible = summary.remainingCombinations.some(({ subPlots }) =>
    subPlots.includes("paranoiaVirus")
  );
  const immortalMaximum = summary.roleTable.characters.includes("copycat")
    ? 2
    : 1;
  const noDeathPartners = new Map<CharacterId, Set<CharacterId>>();

  for (const observation of summary.observations) {
    if (observation.kind === "sacredTreeMastermindTransferJudged") {
      if (!observation.eligible) continue;
      traces.push(`<li>
        <strong>신수 · 우호 무시 계열 ${observation.performed ? "확정" : "배제"}</strong>
        <span>근거: ${observation.loop}루프 ${observation.day}일 · 발동 조건 충족 · 각본가 강제 이전 ${observation.performed ? "수행" : "없음"}</span>
        <small>카운터나 동소 생존 대상이 없던 날은 이 배제 근거를 만들지 않습니다.</small>
      </li>`);
      continue;
    }
    if (observation.kind === "goodwillForbidApplied") {
      const cell = summary.roleTable.cells[observation.character]
        ?.timeTraveler;
      traces.push(`<li>
        <strong>${escapeHtml(characterName(observation.character))} · 불사 배제</strong>
        <span>근거: ${observation.loop}루프 ${observation.day}일 우호 금지 효과가 실제로 발동</span>
        <small>→ 시간 여행자 ${possibilityStatusLabel(cell?.status)}</small>
      </li>`);
      continue;
    }
    if (observation.kind === "mandatoryEffectMissing") {
      traces.push(`<li>
        <strong>인과율 후보 배제</strong>
        <span>근거: ${observation.loop}루프 시작 · ${escapeHtml(characterName(observation.character))}에게 불안 2 증가 없음</span>
        <small>대상 부재 등 공개 기록으로 발동 여부를 확정할 수 없는 경우에는 이 관측을 만들지 않습니다.</small>
      </li>`);
      continue;
    }
    if (observation.kind === "deadAtLoopEndWithoutRoleReveal") {
      traces.push(`<li>
        <strong>${escapeHtml(characterName(observation.character))} · 친구 배제</strong>
        <span>근거: ${observation.loop}루프 종료 · 사망했지만 역할 공개 없음</span>
      </li>`);
      continue;
    }
    if (observation.kind !== "roundEvidence") continue;

    const deaths = observation.record.deathBatches?.flatMap(
      ({ characters }) => characters,
    ) ?? [];
    const p9Deaths = new Set(
      observation.record.deathBatches?.flatMap((batch) =>
        batch.phase === "P9_ROUND_END" ? batch.characters : []
      ) ?? [],
    );
    if (
      observation.record.immediateLoopEnd?.reason === "effect" &&
      deaths.length > 0
    ) {
      const candidates = deaths.flatMap((character) => {
        const batch = observation.record.deathBatches?.find(({ characters }) =>
          characters.includes(character)
        );
        const roles = [
          summary.roleTable.cells[character]?.keyPerson?.status !== "impossible"
            ? roleName("keyPerson")
            : undefined,
          (batch?.cityIntrigue ?? -1) >= 2 &&
              summary.roleTable.cells[character]?.factor?.status !== "impossible"
            ? `${roleName("factor")}(${locationName("City")} 음모 2+)`
            : undefined,
        ].filter((role): role is string => role !== undefined);
        return roles.length === 0
          ? []
          : [`${characterName(character)}: ${roles.join(" 또는 ")}`];
      });
      const excluded = deaths.filter((character) => {
        const batch = observation.record.deathBatches?.find(({ characters }) =>
          characters.includes(character)
        );
        const keyExcluded = summary.roleTable.cells[character]?.keyPerson
          ?.status === "impossible";
        const factorExcluded = (batch?.cityIntrigue ?? -1) < 2 ||
          summary.roleTable.cells[character]?.factor?.status === "impossible";
        return keyExcluded && factorExcluded;
      });
      const simultaneous = deaths.length > 1
        ? ` · 동시 사망 ${deaths.length}명`
        : "";
      traces.push(`<li>
        <strong>핵심 인물 능력 보유 후보 {${escapeHtml(
          candidates.join(", ") || "설명 가능한 후보 없음",
        )}}</strong>
        <span>근거: ${observation.loop}루프 ${observation.record.day}일 즉시 루프 종료${simultaneous}</span>
        <small>→ 같은 라운드 사망자 전체를 함께 유지하며 한 명에게 원인을 귀속하지 않습니다.${
          excluded.length === 0
            ? ""
            : ` → ${escapeHtml(excluded.map(characterName).join(", "))}: 다른 공개·누적 제약으로 후보에서 제외`
        }</small>
      </li>`);
    }

    for (const character of deaths) {
      if (
        summary.roleTable.cells[character]?.timeTraveler?.status ===
          "impossible"
      ) {
        traces.push(`<li>
          <strong>${escapeHtml(characterName(character))} · 불사 배제</strong>
          <span>근거: ${observation.loop}루프 ${observation.record.day}일 실제 사망</span>
          <small>→ 시간 여행자는 사망하지 않으므로 이후 단둘 비발동 제약의 예외가 될 수 없습니다.</small>
        </li>`);
      }
    }

    for (const batch of observation.record.deathBatches ?? []) {
      if (batch.aliveAfterDeaths === undefined) continue;
      const reactions = observation.deathReactions.filter((reaction) =>
        reaction.deadCharacters.some((character) =>
          batch.characters.includes(character)
        )
      );
      const reacted = new Set(reactions.map(({ target }) => target));
      const silentResponders = batch.aliveAfterDeaths.filter((character) =>
        !reacted.has(character)
      );
      if (silentResponders.length === 0) continue;
      traces.push(`<li>
        <strong>연인 강제 반응 제약</strong>
        <span>근거: ${observation.loop}루프 ${observation.record.day}일 ${escapeHtml(batch.characters.map(characterName).join(", "))} 사망 · ${escapeHtml(silentResponders.map(characterName).join(", "))}에게 불안 6 증가 없음</span>
        <small>사망 직후 생존자만 판정합니다. 이미 시체이거나 부재였던 캐릭터는 반응 후보에 넣지 않습니다.</small>
      </li>`);
    }

    const protectedTargets = new Set(observation.protectedAtRoundEnd);
    for (const pair of observation.record.roundEndPairs ?? []) {
      for (let actorIndex = 0; actorIndex < 2; actorIndex += 1) {
        const actor = pair.characters[actorIndex];
        const target = pair.characters[actorIndex === 0 ? 1 : 0];
        if (actor === undefined || target === undefined) continue;
        const actorName = characterName(actor);
        const targetName = characterName(target);
        if (!p9Deaths.has(target)) {
          if (protectedTargets.has(target)) {
            traces.push(`<li>
              <strong>${escapeHtml(actorName)} · 연쇄 살인마 판정 보류</strong>
              <span>근거: ${observation.loop}루프 ${observation.record.day}일 ${escapeHtml(locationName(pair.location))} 단둘 · ${escapeHtml(targetName)} 사망 없음</span>
              <small>보호 카운터가 소비되어 강제 사망의 부재를 역할 배제에 쓰지 않습니다.</small>
            </li>`);
            continue;
          }
          const partners = noDeathPartners.get(actor) ?? new Set<CharacterId>();
          partners.add(target);
          noDeathPartners.set(actor, partners);
          const serialStatus = summary.roleTable.cells[actor]?.serialKiller
            ?.status;
          const immortalStatus = summary.roleTable.cells[target]?.timeTraveler
            ?.status;
          const immortalPossible = immortalStatus === "possible" ||
            immortalStatus === "confirmed";
          const mutation = virusPossible && (pair.paranoia[actorIndex] ?? 0) >= 3
            ? ` · ${actorName} 불안 3+: 엑스트라+망상 확대 바이러스 변이도 같은 조건`
            : "";
          traces.push(`<li>
            <strong>${escapeHtml(actorName)} · 연쇄 살인마 능력 보유 ${
              immortalPossible
                ? `아님 <em>(단, ${escapeHtml(targetName)}가 불사가 아닐 때)</em>`
                : "배제"
            }</strong>
            <span>근거: ${observation.loop}루프 ${observation.record.day}일 ${escapeHtml(locationName(pair.location))} 단둘 · 사망 없음${escapeHtml(mutation)}</span>
            <small>현재: ${escapeHtml(actorName)} 연쇄 살인마 ${possibilityStatusLabel(serialStatus)} · ${escapeHtml(targetName)} 시간 여행자 ${possibilityStatusLabel(immortalStatus)}</small>
          </li>`);
          continue;
        }

        const alternatives = [
          `${actorName}=연쇄 살인마`,
          virusPossible && (pair.paranoia[actorIndex] ?? 0) >= 3
            ? `${actorName}=엑스트라 + 망상 확대 바이러스 변이`
            : undefined,
          (pair.intrigue?.[actorIndex === 0 ? 1 : 0] ?? -1) >= 2
            ? `${actorName}=살인 청부업자 + ${targetName}=핵심 인물`
            : undefined,
          observation.lastDay ? "마지막 날 시간 여행자 능력" : undefined,
        ].filter((alternative): alternative is string =>
          alternative !== undefined
        );
        traces.push(`<li>
          <strong>${escapeHtml(actorName)}–${escapeHtml(targetName)} 사망 원인 분기</strong>
          <span>근거: ${observation.loop}루프 ${observation.record.day}일 단둘 · ${escapeHtml(targetName)} 사망</span>
          <small>후보: ${escapeHtml(alternatives.join(" / "))}</small>
        </li>`);
      }
    }

    if (
      deaths.length > 0 &&
      observation.record.roundEndPairs !== undefined &&
      observation.record.immediateLoopEnd === undefined
    ) {
      for (const character of deaths) {
        traces.push(`<li>
          <strong>${escapeHtml(characterName(character))} · 핵심 인물 능력 보유 배제</strong>
          <span>근거: ${observation.loop}루프 ${observation.record.day}일 사망 뒤에도 즉시 루프 종료 없음</span>
          <small>핵심 인물 ${possibilityStatusLabel(summary.roleTable.cells[character]?.keyPerson?.status)}</small>
        </li>`);
      }
    }
  }

  for (const [actor, partners] of noDeathPartners) {
    if (partners.size <= immortalMaximum) continue;
    traces.push(`<li>
      <strong>${escapeHtml(characterName(actor))} · 연쇄 살인마 능력 보유 배제</strong>
      <span>서로 다른 단둘 상대 ${partners.size}명 · 가능한 불사 최대 ${immortalMaximum}명</span>
      <small>→ 모든 상대가 불사일 수 없으므로 조건부 제약이 확정 배제로 승격됩니다.</small>
    </li>`);
  }

  if (traces.length === 0) return "";
  return `<section class="role-inference-traces" aria-label="역할 추론 과정">
    <h3>추론 과정 ${traces.length}건</h3>
    ${renderBoundedHtmlList(traces, "role-inference-list", "추가 추론")}
  </section>`;
}

function renderDeductionTables(
  summary: DeductionTablesSummary,
): string {
  const roleInferenceTraces = renderRoleInferenceTraces(summary);
  const roleRows = summary.roleRows.map((row) => {
    const names = row.possibleRoles.map(roleName);
    const text = row.confirmedRole === undefined
      ? names.join(" / ") || "가능한 역할 없음"
      : `${roleName(row.confirmedRole)} 확정`;
    return `<li class="deduction-summary-row ${
      row.confirmedRole === undefined ? "" : "is-confirmed"
    } ${row.narrowed ? "is-narrowed" : ""}">
      <strong>${escapeHtml(characterName(row.character))}</strong>
      <span>${escapeHtml(text)}</span>
      <b>${row.confirmedRole === undefined ? `(${row.possibleRoles.length})` : "✓"}</b>
    </li>`;
  });
  const roleHeader = summary.roleTable.roles.map((role) => `
    <th scope="col" title="${escapeHtml(roleName(role))}" aria-label="${escapeHtml(roleName(role))}">
      <span>${escapeHtml(roleName(role))}</span>
    </th>`).join("");
  const roleGrid = summary.roleTable.characters.map((character) => `
    <tr>
      <th scope="row">${escapeHtml(characterName(character))}</th>
      ${summary.roleTable.roles.map((role) => {
        const cell = summary.roleTable.cells[character]?.[role];
        const status = cell?.status ?? "impossible";
        const reasons = cell?.reasons.map(({ code }) =>
          roleCellReasonLabel(code)
        ).join(" · ") || "가능";
        const label = `${characterName(character)} · ${roleName(role)} · ${
          status === "confirmed" ? "확정" : status === "impossible" ? "불가능" : "가능"
        } · ${reasons}`;
        return `<td class="is-${status}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${possibilityMark(status)}</td>`;
      }).join("")}
    </tr>`).join("");

  const incidentRows = summary.incidentRows.map((row) => {
    const labels = row.possibleColumns.map((column) =>
      `${column.day}일 ${incidentName(column.incident)}`
    );
    const text = row.confirmedColumn === undefined
      ? labels.join(" / ") || "가능한 사건 없음"
      : `${row.confirmedColumn.day}일 ${incidentName(row.confirmedColumn.incident)} 확정`;
    return `<li class="deduction-summary-row ${
      row.confirmedColumn === undefined ? "" : "is-confirmed"
    } ${row.narrowed ? "is-narrowed" : ""}">
      <strong>${escapeHtml(characterName(row.character))}</strong>
      <span>${escapeHtml(text)}</span>
      <b>${row.confirmedColumn === undefined ? `(${row.possibleColumns.length})` : "✓"}</b>
    </li>`;
  });
  const incidentHeader = summary.incidentTable.columns.map((column) => {
    const label = `${column.day}일 ${incidentName(column.incident)}`;
    return `<th scope="col" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><span>${escapeHtml(label)}</span></th>`;
  }).join("");
  const incidentGrid = summary.incidentTable.characters.map((character) => `
    <tr>
      <th scope="row">${escapeHtml(characterName(character))}</th>
      ${summary.incidentTable.columns.map((column) => {
        const cell = summary.incidentTable.cells[character]?.[column.id];
        const status = cell?.status ?? "impossible";
        const reasons = cell?.reasons.map(({ code }) =>
          incidentCellReasonLabel(code)
        ).join(" · ") || "가능";
        const label = `${characterName(character)} · ${column.day}일 ${incidentName(column.incident)} · ${
          status === "confirmed" ? "확정" : status === "impossible" ? "불가능" : "가능"
        } · ${reasons}`;
        return `<td class="is-${status}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${possibilityMark(status)}</td>`;
      }).join("")}
    </tr>`).join("");

  return `
    <details class="info-accordion compact-information deduction-information role-deduction-information">
      <summary>
        <strong>캐릭터별 역할 후보</strong>
        <span class="accordion-summary-value">${summary.roleRows.filter(({ confirmedRole }) => confirmedRole !== undefined).length}명 확정</span>
        <i aria-hidden="true"></i>
      </summary>
      <div class="info-accordion-body deduction-body">
        ${roleInferenceTraces}
        ${renderBoundedHtmlList(
          roleRows,
          "deduction-summary-list",
          "추가 역할 후보",
        )}
        <details class="deduction-grid-details">
          <summary>전체 역할 격자 보기</summary>
          <div class="deduction-grid-scroll">
            <table class="deduction-grid" aria-label="캐릭터별 역할 가능성 격자">
              <thead><tr><th scope="col">캐릭터</th>${roleHeader}</tr></thead>
              <tbody>${roleGrid}</tbody>
            </table>
          </div>
        </details>
      </div>
    </details>
    <details class="info-accordion compact-information deduction-information incident-deduction-information">
      <summary>
        <strong>사건 범인 후보</strong>
        <span class="accordion-summary-value">${summary.incidentRows.filter(({ confirmedColumn }) => confirmedColumn !== undefined).length}건 확정</span>
        <i aria-hidden="true"></i>
      </summary>
      <div class="info-accordion-body deduction-body">
        ${summary.incidentTable.columns.length === 0
          ? `<p class="empty-overlay">시나리오에 사건이 없습니다.</p>`
          : `${renderBoundedHtmlList(
              incidentRows,
              "deduction-summary-list",
              "추가 범인 후보",
            )}
            <details class="deduction-grid-details">
              <summary>전체 범인 격자 보기</summary>
              <div class="deduction-grid-scroll">
                <table class="deduction-grid" aria-label="캐릭터별 사건 범인 가능성 격자">
                  <thead><tr><th scope="col">캐릭터</th>${incidentHeader}</tr></thead>
                  <tbody>${incidentGrid}</tbody>
                </table>
              </div>
            </details>`}
      </div>
    </details>`;
}

function renderMastermindOverlay(state: GameState): string {
  if (!tracker.mastermindOverlay) return "";
  const ruleSummary = ruleHypothesisSummary(state);
  const deductionSummary = deductionTablesSummary(state);
  return `
    <aside class="mastermind-overlay" aria-label="각본가 정보">
      ${renderLoopStartInformation(state)}
      ${renderMastermindGuidance(state, "panel")}
      ${renderCurrentLossDisclosure(state)}
      ${renderRuleHypotheses(ruleSummary)}
      ${renderDeductionTables(deductionSummary)}
      <details class="info-accordion today-information" open>
        <summary>
          <span><small>오늘</small><strong>사건·범인·판정 상태</strong></span>
          <i aria-hidden="true"></i>
        </summary>
        <div class="info-accordion-body phase-incident-list">
          ${renderTodayIncidents(state)}
        </div>
      </details>
      <details class="info-accordion">
        <summary>
          <span><small>시나리오</small><strong>룰과 역할</strong></span>
          <i aria-hidden="true"></i>
        </summary>
        <div class="info-accordion-body">${renderScenarioInformation(
          state,
          ruleSummary,
          deductionSummary,
        )}</div>
      </details>
      <details class="info-accordion compact-information">
        <summary>
          <strong>사건 일정</strong>
          <span class="accordion-summary-value">${escapeHtml(incidentScheduleSummary(state))}</span>
          <i aria-hidden="true"></i>
        </summary>
        <div class="info-accordion-body">${renderIncidentSchedule(state)}</div>
      </details>
      <details class="info-accordion compact-information">
        <summary>
          <strong>${escapeHtml(misc("Victory Conditions"))}</strong>
          <span class="accordion-summary-value">${escapeHtml(lossDistanceSummary(state))}</span>
          <i aria-hidden="true"></i>
        </summary>
        <div class="info-accordion-body loss-list">${renderLossDistance(state)}</div>
      </details>
      <details class="info-accordion spent-information compact-information">
        <summary>
          <strong>${escapeHtml(misc("Spent cards", "소진 카드"))}</strong>
          <span class="accordion-summary-value">${escapeHtml(spentCardsSummary(state))}</span>
          <i aria-hidden="true"></i>
        </summary>
        <div class="info-accordion-body">${renderSpentCards(state)}</div>
      </details>
      ${renderOngoingGoodwillEffects(state)}
    </aside>`;
}

function renderCollapsedMastermindOverlay(
  state: GameState,
  purpose: "finalGuess" | "review",
): string {
  const overlay = renderMastermindOverlay(state);
  if (overlay === "") return "";
  return `<details class="mastermind-archive-information">
    <summary>
      <strong>각본가 정보 보기</strong>
      <span>${purpose === "finalGuess" ? "역할 선언 대조" : "게임 복기"}</span>
    </summary>
    ${overlay}
  </details>`;
}

function renderPublicInformation(state: GameState): string {
  const exactRoleReveals = (state.loop.publicInformationThisLoop ?? []).filter(
    (information) => information.kind === "roleReveal",
  );
  const exactRoleCharacters = new Set(
    exactRoleReveals.map(({ character }) => character),
  );
  const roleItems = [
    ...exactRoleReveals.map(({ character, role }) =>
      `${characterName(character)}의 역할: ${roleName(role)}`
    ),
    ...(state.loop.revealedRoleCharacters ?? [])
      .filter((character) => !exactRoleCharacters.has(character))
      .map((character) =>
        `${characterName(character)}의 역할: ${roleName(effectiveRole(state, character))}`
      ),
  ];
  const informationItems = (state.loop.publicInformationThisLoop ?? []).flatMap(
    (information): string[] => {
      switch (information.kind) {
        case "roleReveal":
        case "goodwillRefusal":
          return [];
        case "incidentCulprit":
          return [`${characterName(information.source)}: ${misc("Day")} ${information.day} · ` +
            `${incidentName(information.incident)}의 범인은 ${characterName(information.culprit)}`];
        case "subplot":
          return [`리더 선언: ${plotName(information.declaredSubplot)} / ` +
            `각본가 공개: ${plotName(information.revealedSubplot)}`];
        case "incidentEffect":
          return [`${information.resolvedOnDay ?? information.day}일차에 AI 능력으로 ` +
            `${misc("Day")} ${information.day} · ${incidentName(information.incident)} 효과 선행 해결` +
            (information.effectApplied ? "" : " (적용된 효과 없음)")];
      }
    },
  );
  const items = [...roleItems, ...informationItems];
  if (items.length === 0) return "";

  return `
    <section class="utility-panel public-information">
      <div class="panel-heading">
        <span class="eyebrow">P6</span>
        <h2>이번 루프 공개 정보</h2>
      </div>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>`;
}

function renderProgressSteps(
  labels: readonly string[],
  completed: number,
  current?: number,
): string {
  return `<div class="game-progress">${labels.map((label, index) => `
    <div class="game-progress-step ${index < completed ? "is-complete" : ""} ${index === current ? "is-current" : ""}">
      <span>${index < completed ? "✓" : index + 1}</span>
      <strong>${escapeHtml(label)}</strong>
    </div>`).join("")}</div>`;
}

function renderLoopOutcomes(state: GameState): string {
  if (state.loopOutcomes.length === 0) {
    return `<p class="empty-overlay">아직 종료된 루프가 없습니다.</p>`;
  }
  return `<div class="loop-outcome-list">${state.loopOutcomes.map((outcome) => `
    <article class="loop-outcome ${outcome.result === "protagonistsLost" ? "is-loss" : "is-win"}">
      <div>
        <strong>${outcome.loop}루프 · ${outcome.day}일${outcome.loop > state.scenario.loops ? " · 추가 루프 (하우스 룰)" : ""}</strong>
        <span>${outcome.result === "protagonistsLost" ? "주인공 패배" : "주인공 승리"}</span>
      </div>
      <p>${outcome.losses.length > 0
        ? outcome.losses.map(({ ko, label }) => `${ko}: ${label}`).map(escapeHtml).join("<br />")
        : "충족된 패배 조건 없음"}</p>
    </article>`).join("")}</div>`;
}

function timeGapRemaining(state: GameState): number {
  const timer = state.timeGapTimer;
  if (!timer) return 10 * 60;
  if (!timer.endsAt) return timer.remainingSeconds;
  return Math.max(0, Math.ceil(
    (new Date(timer.endsAt).getTime() - Date.now()) / 1000,
  ));
}

function timerText(remaining: number): string {
  const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
  const seconds = String(remaining % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function updateTimeGapTimerText(state: GameState): void {
  const timer = root.querySelector<HTMLElement>(".time-gap-timer");
  if (timer === null) return;
  timer.textContent = timerText(timeGapRemaining(state));
}

function renderTimeGap(state: GameState): string {
  const remaining = timeGapRemaining(state);
  const running = Boolean(state.timeGapTimer?.endsAt);
  const scientistAppears = "scientist" in state.scenario.cast;
  const scientistCounter =
    state.loop.loopStartTraitCounterChoices?.scientist;
  const henchmanAppears = "henchman" in state.scenario.cast;
  const henchmanLocation =
    state.loop.loopStartTraitLocationChoices?.henchman;
  const hasFinalGuess = tragedySetDefinition(
    state.scenario.tragedySet,
  ).hasFinalGuess;
  return `<main class="game-flow-screen">
    ${renderProgressSteps([
      "시간의 틈",
      "캐릭터 배치",
      "카운터 제거 및 배치",
      "카드 분배",
    ], 0, 0)}
    <section class="flow-card time-gap-card">
      <span class="eyebrow">${state.loop.loop > state.scenario.loops ? "추가 루프 (하우스 룰) · " : ""}${state.loop.loop}루프 시작</span>
      <h1>시간의 틈</h1>
      <p>주인공 토론 시간입니다. 각본가는 시간만 관리합니다. 권장 시간은 10분입니다.</p>
      <div class="time-gap-timer" aria-live="polite">${timerText(remaining)}</div>
      ${scientistAppears
        ? `<div class="final-guess-form loop-start-trait-choice">
            <label><span>${escapeHtml(characterName("scientist"))} · 루프 시작 카운터</span>
              <select data-action="loop-start-trait-counter" data-character="scientist">
                <option value="">카운터 선택</option>
                ${(["paranoia", "goodwill", "intrigue"] as const).map(
                  (counter) => `<option value="${counter}" ${scientistCounter === counter ? "selected" : ""}>${escapeHtml(counterLabel(counter))}</option>`,
                ).join("")}
              </select>
            </label>
          </div>`
        : ""}
      ${henchmanAppears
        ? `<div class="final-guess-form loop-start-trait-choice">
            <label><span>${escapeHtml(characterName("henchman"))} · 이번 루프 시작 장소</span>
              <select data-action="loop-start-trait-location" data-character="henchman">
                <option value="">장소 선택</option>
                ${LOCATIONS.map(
                  (location) => `<option value="${location}" ${henchmanLocation === location ? "selected" : ""}>${escapeHtml(locationName(location))}</option>`,
                ).join("")}
              </select>
            </label>
          </div>`
        : ""}
      <div class="flow-actions">
        <button type="button" data-action="time-gap-${running ? "pause" : "start"}">${running ? "일시 정지" : "타이머 시작"}</button>
        <button type="button" data-action="time-gap-reset">10분으로 초기화</button>
      </div>
      <div class="flow-actions primary-actions">
        <button type="button" class="next-phase" data-action="continue-loop-start" ${loopStartTraitChoicesComplete(state) ? "" : "disabled"}>루프 준비 계속 →</button>
        ${hasFinalGuess
          ? `<button type="button" class="danger-action" data-action="open-final-guess-confirmation">최후의 싸움으로 이동</button>`
          : ""}
      </div>
    </section>
    ${renderMastermindOverlay(state)}
  </main>`;
}

function renderFinalGuessAttempts(state: GameState): string {
  const attempts = state.finalGuess?.attempts ?? [];
  if (attempts.length === 0) return `<p class="empty-overlay">아직 선언한 역할이 없습니다.</p>`;
  return `<table class="final-guess-table">
    <thead><tr><th>캐릭터</th><th>주인공 선언</th><th>정답</th><th>결과</th></tr></thead>
    <tbody>${attempts.map((attempt) => `<tr>
      <td>${escapeHtml(characterName(attempt.character))}</td>
      <td>${escapeHtml(roleName(attempt.guessedRole))}</td>
      <td>${escapeHtml(roleName(attempt.actualRole))}</td>
      <td>${attempt.correct ? "✓ 정답" : "✗ 오답"}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderFinalGuess(state: GameState): string {
  const guessed = new Set(
    state.finalGuess?.attempts.map(({ character }) => character) ?? [],
  );
  const remaining = Object.keys(state.scenario.cast).filter(
    (character) => !guessed.has(character),
  );
  const characterDraftKey = "final-guess:character";
  const roleDraftKey = "final-guess:role";
  return `<main class="game-flow-screen">
    <section class="flow-card">
      <span class="eyebrow">${escapeHtml(misc("Final Guess"))}</span>
      <h1>최후의 싸움</h1>
      <p>시작 장소·생존 상태·카운터가 초기화되었습니다. 시나리오의 모든 캐릭터는 엑스트라까지 맞혀야 합니다.</p>
      <div class="final-guess-form">
        <label><span>캐릭터</span><select data-final-field="character"
          data-ui-draft-key="${characterDraftKey}">
          <option value="">선택</option>
          ${remaining.map((character) => `<option value="${escapeHtml(character)}" ${selectedDraftOption(characterDraftKey, character)}>${escapeHtml(characterName(character))}</option>`).join("")}
        </select></label>
        <label><span>주인공이 선언한 역할</span><select data-final-field="role"
          data-ui-draft-key="${roleDraftKey}">
          <option value="">선택</option>
          ${rolesForTragedySet(state.scenario.tragedySet).map((role) => `<option value="${escapeHtml(role)}" ${selectedDraftOption(roleDraftKey, role)}>${escapeHtml(roleName(role))}</option>`).join("")}
        </select></label>
        <button type="button" class="next-phase" data-action="submit-final-guess" ${remaining.length === 0 ? "disabled" : ""}>정오 판정</button>
      </div>
      ${renderFinalGuessAttempts(state)}
    </section>
    ${renderCollapsedMastermindOverlay(state, "finalGuess")}
  </main>`;
}

function renderLoopJudgment(state: GameState): string {
  const outcome = state.loopOutcomes.at(-1);
  if (!outcome) return "";
  const finalLoop = state.loop.loop >= state.scenario.loops;
  const hasFinalGuess = tragedySetDefinition(
    state.scenario.tragedySet,
  ).hasFinalGuess;
  return `<main class="game-flow-screen">
    <section class="flow-card">
      <span class="eyebrow">${escapeHtml(misc("Loop Judgment"))}</span>
      <h1>${state.loop.loop}루프 — 주인공 패배</h1>
      <p>승패 판정을 완료했고 루프 종료 스냅샷을 기록했습니다.</p>
      ${renderLoopOutcomes(state)}
      <div class="flow-actions primary-actions">
        ${finalLoop && hasFinalGuess
          ? `<button type="button" class="next-phase" data-action="continue-after-judgment">
              최후의 싸움 →
            </button>
            <button type="button" data-action="start-extra-loop">
              추가 루프 (하우스 룰)
            </button>`
          : finalLoop
          ? `<button type="button" class="next-phase" data-action="continue-after-judgment">
              각본가 승리로 종료
            </button>
            <button type="button" data-action="start-extra-loop">
              추가 루프 (하우스 룰)
            </button>`
          : `<button type="button" class="next-phase" data-action="continue-after-judgment">
              다음 루프 준비 →
            </button>`}
      </div>
    </section>
  </main>`;
}

function renderGameOver(state: GameState): string {
  const protagonistsWon = state.result?.winner === "protagonists";
  return `<main class="game-flow-screen">
    <section class="flow-card game-over-card ${protagonistsWon ? "is-protagonist-win" : "is-mastermind-win"}">
      <span class="eyebrow">${escapeHtml(misc("Game Over"))}</span>
      <h1>${protagonistsWon ? "주인공 승리" : "각본가 승리"}</h1>
      ${state.finalGuess ? renderFinalGuessAttempts(state) : ""}
      ${(state.extraLoopsPlayed ?? 0) > 0
        ? `<p class="flow-warning">추가 루프 (하우스 룰) · ${state.extraLoopsPlayed ?? 0}회 진행</p>`
        : ""}
      <div class="outcome-summary">
        <h2>루프별 결과</h2>
        ${renderLoopOutcomes(state)}
      </div>
      <div class="flow-actions primary-actions">
        <button type="button" class="next-phase" data-action="new-game">새 게임</button>
      </div>
    </section>
    ${renderCollapsedMastermindOverlay(state, "review")}
  </main>`;
}

function renderGameFlow(state: GameState): string {
  switch (state.gamePhase) {
    case "SETUP_SCENARIO":
    case "SETUP_REVEAL":
    case "SETUP_STAGE":
    case "SETUP_LEADER":
      return `<main class="game-flow-screen">
        ${renderProgressSteps(["시나리오 준비", "시나리오 공개", "무대 구축", "리더 결정"], 3, 3)}
        <section class="flow-card">
          <span class="eyebrow">${escapeHtml(misc("Game Setup"))}</span>
          <h1>초기 리더 결정</h1>
          <p>리더는 게임 준비에서 한 번만 정하고 이후 루프에도 유지합니다.</p>
          <div class="leader-choice">${([0, 1, 2] as const).map((leader) => `
            <button type="button" data-action="choose-leader" data-leader="${leader}">${escapeHtml(ownerLabel(leader))}</button>`).join("")}</div>
        </section>
      </main>`;
    case "LOOP_TIME_GAP":
      return renderTimeGap(state);
    case "LOOP_CHARACTER_PLACEMENT":
    case "LOOP_COUNTER_SETUP":
    case "LOOP_CARD_DISTRIBUTION":
      return renderTimeGap(state);
    case "LOOP_JUDGMENT":
      return renderLoopJudgment(state);
    case "FINAL_GUESS":
      return renderFinalGuess(state);
    case "GAME_OVER":
      return renderGameOver(state);
    case "ROUND":
      return "";
  }
}

function observationCount(): number {
  const entry = activeScenarioEntry();
  const observations = tracker.games[entry.id]?.observationsByLoop ?? {};
  return Object.values(observations).reduce(
    (sum, loopObservations) => sum + loopObservations.length,
    0,
  );
}

function renderSiteFooter(): string {
  return `<footer class="site-footer" aria-label="저작권 및 비공식 도구 안내">
    <details class="site-footer-details">
      <summary><span>정보</span><small>v${escapeHtml(APP_VERSION)}</small></summary>
      <div class="site-footer-content">
        <div class="storage-actions" aria-label="저장 데이터 관리">
          <button type="button" data-action="new-game">새 게임 시작</button>
          <button type="button" class="danger-action" data-action="delete-all-storage">저장 데이터 완전 삭제</button>
        </div>
        <p class="storage-actions-note">두 작업은 확인 후 실행되며 되돌릴 수 없습니다.</p>
        <p>
          『트래지디 루퍼』는 BakaFire Party 의 저작물입니다.<br />
          Game Design: BakaFire / Character Design &amp; Illustration: 紺ノ玲<br />
          <a href="https://bakafire.main.jp/rooper/">https://bakafire.main.jp/rooper/</a>
        </p>
        <p>
          한국어판: 엠티에스 게임즈 (번역 홍석철)<br />
          <a href="https://www.mtsgames.kr">https://www.mtsgames.kr</a>
        </p>
        <p>
          본 도구는 팬이 제작한 비공식 보조 도구이며,<br />
          BakaFire Party 및 엠티에스 게임즈와 관련이 없습니다.<br />
          게임을 소유한 사용자의 플레이 보조를 목적으로 합니다.
        </p>
      </div>
    </details>
  </footer>`;
}

function renderScenarioSelection(): void {
  ensureUiInputDraftScope("scenario-selection");
  const scenarioDraftKey = "new-game:scenario";
  const difficultyDraftKey = "new-game:difficulty";
  const selectedScenario = draftValue(scenarioDraftKey) ||
    scenarioEntries[0]?.id || "";
  const selectedEntry = scenarioEntries.find(
    ({ id }) => id === selectedScenario,
  );
  const selectedDifficultyIndex = Number(
    draftValue(difficultyDraftKey) || "0",
  );
  const selectedDifficulty = selectedEntry?.difficulties.find(
    ({ index }) => index === selectedDifficultyIndex,
  ) ?? selectedEntry?.difficulties[0];
  const mysteryBoyRole = selectedDifficulty?.scenario.cast.mysteryBoy;
  const previewState = selectedDifficulty?.validation.ok === true &&
      selectedDifficulty !== undefined
    ? createGameState(structuredClone(selectedDifficulty.scenario))
    : undefined;
  const previewRuleSummary = previewState === undefined
    ? undefined
    : ruleHypothesisSummary(previewState);
  const previewDeductionSummary = previewState === undefined
    ? undefined
    : deductionTablesSummary(previewState);
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <span>${escapeHtml(misc("(제품명) Tragedy Looper", "Tragedy Looper"))}</span>
          <strong>${escapeHtml(misc("Mastermind Aid"))}</strong>
        </div>
      </header>
      <main class="game-flow-screen scenario-selection-screen">
        <section class="flow-card">
          <span class="eyebrow">${escapeHtml(misc("Game Setup"))}</span>
          <h1>시나리오 선택</h1>
          <p>새로 시작할 시나리오를 선택하세요.</p>
          <label class="new-game-scenario-picker">
            <span>${escapeHtml(misc("Script"))}</span>
            <select data-new-game-scenario
              data-ui-draft-key="${scenarioDraftKey}">
              ${scenarioEntries.map((entry) => `
                <option value="${entry.id}" ${selectedScenario === entry.id ? "selected" : ""}>${escapeHtml(entry.title)} · ${escapeHtml(scenarioSourceLabel(entry.source))}${entry.creator === undefined ? "" : ` · ${escapeHtml(entry.creator)}`}${entry.errata.length > 0 ? " · 정오표 적용" : ""}${entry.validation.ok ? "" : " · 시작 불가"}</option>`).join("")}
            </select>
          </label>
          ${selectedEntry === undefined || selectedEntry.difficulties.length < 2
            ? ""
            : `<label class="new-game-scenario-picker">
                <span>루프·난이도 변형</span>
                <select data-new-game-difficulty
                  data-ui-draft-key="${difficultyDraftKey}">
                  ${selectedEntry.difficulties.map((difficulty) => `
                    <option value="${difficulty.index}" ${selectedDifficulty?.index === difficulty.index ? "selected" : ""}>
                      ${difficulty.numberOfLoops}루프 · ${difficulty.difficulty === 0 ? "난이도 미확인" : `난이도 ${difficulty.difficulty}`}
                    </option>`).join("")}
                </select>
              </label>`}
          ${selectedEntry === undefined
            ? ""
            : `<p class="scenario-source-summary">
                출처: <strong>${escapeHtml(scenarioSourceLabel(selectedEntry.source))}</strong>
                ${selectedEntry.creator === undefined
                  ? ""
                  : ` · 제작 ${escapeHtml(selectedEntry.creator)}`}
                ${selectedDifficulty === undefined
                  ? ""
                  : ` · ${selectedDifficulty.numberOfLoops}루프 · ${selectedDifficulty.difficulty === 0 ? "난이도 미확인" : `난이도 ${selectedDifficulty.difficulty}`}`}
                ${selectedEntry.errata.length > 0 ? " · 정오표 적용됨" : ""}
              </p>`}
          ${selectedEntry === undefined || selectedEntry.errata.length === 0
            ? ""
            : `<aside class="scenario-trait-notice scenario-errata-notice">
                <span class="eyebrow">정오표 적용됨</span>
                <strong>인쇄물과 다른 정정값을 사용합니다.</strong>
                ${scenarioErrataLines(selectedEntry).map((line) =>
                  `<p>${escapeHtml(line)}</p>`
                ).join("")}
              </aside>`}
          ${mysteryBoyRole === undefined
            ? ""
            : `<aside class="scenario-trait-notice">
                <span class="eyebrow">캐릭터 특성</span>
                <strong>${escapeHtml(characterName("mysteryBoy"))} · ${escapeHtml(roleName(mysteryBoyRole))}</strong>
                <p>${escapeHtml(MYSTERY_BOY_PLOT_LESS_ROLE_TEXT)}</p>
              </aside>`}
          ${selectedEntry === undefined || selectedDifficulty?.validation.ok
            ? ""
            : `<aside class="scenario-trait-notice scenario-validation-warning">
                <span class="eyebrow">${escapeHtml(scenarioValidationHeading(selectedEntry.source))}</span>
                <strong>${escapeHtml(selectedEntry.title)} · 시작 불가</strong>
                <p>${escapeHtml(selectedDifficulty?.validation.errors.join(" ") ?? "난이도 정보를 읽을 수 없습니다.")}</p>
              </aside>`}
          <div class="flow-actions primary-actions">
            <button type="button" class="next-phase" data-action="start-selected-scenario"
              ${selectedDifficulty?.validation.ok === true ? "" : "disabled"}>게임 시작</button>
          </div>
          ${previewState === undefined || previewRuleSummary === undefined ||
              previewDeductionSummary === undefined
            ? ""
            : `<section class="pre-game-scenario-information" aria-label="선택한 시나리오 비공개 정보표">
                ${renderScenarioInformation(
                  previewState,
                  previewRuleSummary,
                  previewDeductionSummary,
                  "selection",
                )}
                ${renderIncidentSchedule(previewState, "selection")}
              </section>
              ${renderMastermindGuidance(previewState, "beforeStart")}`}
        </section>
      </main>
      ${notice
        ? `<div class="notice-toast" role="alert">
            <span>${escapeHtml(notice)}</span>
            <button type="button" data-action="dismiss-notice" aria-label="알림 닫기">×</button>
          </div>`
        : ""}
      ${renderStorageWriteWarning()}
      ${renderSiteFooter()}
    </div>`;
  scheduleNoticeDismiss();
}

function render(): void {
  currentLossDisclosureCache = undefined;
  if (tracker.activeScenarioId === "") {
    renderScenarioSelection();
    return;
  }
  const entry = activeScenarioEntry();
  const state = currentState();
  ensureUiInputDraftScope(
    `${entry.id}:${state.gamePhase}:${state.loop.loop}:${state.loop.day}:${state.loop.phase}`,
  );
  const tragedySet = term(
    "tragedySets",
    state.scenario.tragedySet,
    state.scenario.tragedySet,
  );
  const gameContent = state.gamePhase === "ROUND"
    ? `${renderPhases(state)}
      ${renderPhaseLog(state)}
      <main class="workspace ${tracker.mastermindOverlay ? "with-overlay" : ""}">
        ${renderMastermindOverlay(state)}
        <div class="primary-column">
          <section class="game-board ${selectedHandCard ? "is-targeting" : ""}"
            aria-label="${escapeHtml(misc("Location", "Location"))}">
            ${LOCATIONS.map((location) => renderLocation(state, location)).join("")}
          </section>
          ${renderResolutionReceipt(state)}
          ${renderPublicInformation(state)}
        </div>
      </main>
      ${renderOperationDock(state)}
      ${renderCharacterModal(state)}
      ${renderLocationModal(state)}`
    : renderGameFlow(state);

  root.innerHTML = `
    <div class="app-shell ${state.gamePhase === "ROUND" ? "has-operation-dock" : ""}">
      <header class="topbar">
        <div class="brand">
          <span>${escapeHtml(misc("(제품명) Tragedy Looper", "Tragedy Looper"))}</span>
          <strong>${escapeHtml(misc("Mastermind Aid"))}</strong>
        </div>
        <div class="session-meta">
          <label class="scenario-picker">
            <span>${escapeHtml(misc("Script"))}</span>
            <select data-action="scenario">
              ${scenarioEntries.map((candidate) => `
                <option value="${candidate.id}" ${candidate.id === entry.id ? "selected" : ""}
                  ${candidate.validation.ok ? "" : "disabled"}>
                  ${escapeHtml(candidate.title)} · ${escapeHtml(scenarioSourceLabel(candidate.source))}${candidate.errata.length > 0 ? " · 정오표 적용" : ""}${candidate.validation.ok ? "" : " · 시작 불가"}
                </option>`).join("")}
            </select>
          </label>
          <div class="round-status">
            <span>${escapeHtml(tragedySet)}</span>
            <strong>${state.loop.loop}루프 / ${state.scenario.loops}루프 시나리오</strong>
            ${state.scenario.difficulty === undefined
              ? ""
              : `<small>${state.scenario.difficulty === 0 ? "난이도 미확인" : `난이도 ${state.scenario.difficulty}`}</small>`}
            ${entry.errata.length > 0
              ? `<small class="scenario-errata-badge" title="${escapeHtml(scenarioErrataLines(entry).join(" / "))}">정오표 적용됨</small>`
              : ""}
            ${state.loop.loop > state.scenario.loops
              ? `<small>추가 루프 (하우스 룰)</small>`
              : ""}
            <strong>${escapeHtml(misc("Day"))} ${state.loop.day}/${state.scenario.daysPerLoop}</strong>
            <small>${escapeHtml(misc("Snapshots", "Snapshots"))} ${observationCount()}</small>
          </div>
          <div class="session-actions">
            <label class="overlay-toggle">
              <input type="checkbox" data-action="overlay" ${tracker.mastermindOverlay ? "checked" : ""} />
              <span>${escapeHtml(misc("Mastermind Aid"))}</span>
            </label>
            <button type="button" class="copy-state-button" data-action="copy-state">
              현재 상태 복사
            </button>
          </div>
        </div>
      </header>

      ${gameContent}
      ${renderFinalGuessConfirmationModal(state)}
      ${renderStorageWriteWarning()}
      ${notice
        ? `<div class="notice-toast" role="alert">
            <span>${escapeHtml(notice)}</span>
            <button type="button" data-action="dismiss-notice" aria-label="알림 닫기">×</button>
          </div>`
        : ""}
      ${renderSiteFooter()}
    </div>`;
  scheduleNoticeDismiss();
}

function incidentChoiceFromDraft(): IncidentChoice | undefined {
  const field = (name: string): string | undefined =>
    draftValue(incidentDraftKey(name)) || undefined;
  const target = field("target");
  const otherTarget = field("otherTarget");
  const location = field("location");
  const counter = field("counter");
  if (!target && !otherTarget && !location && !counter) return undefined;
  return {
    target,
    otherTarget,
    location: location as Location | undefined,
    counter: counter as IncidentCounter | undefined,
  };
}

function decodeTarget(value: string | undefined): Target | undefined {
  if (!value) return undefined;
  const [kind, id] = value.split(":", 2);
  if (kind === "character" && id) return { kind, id };
  if (kind === "location" && LOCATIONS.includes(id as Location)) {
    return { kind, at: id as Location };
  }
  return undefined;
}

function applySelectedOptionalHooks(state: GameState): void {
  const phase = state.loop.phase;
  if (
    phase !== "P4_RESOLVE" &&
    phase !== "P5_MASTERMIND_ABILITY" &&
    !(phase === "P9_ROUND_END" && state.loop.roundEndMandatoryResolved)
  ) return;
  const hooks = collectHooks(state, phase);
  for (const [index, { hook, self }] of hooks.entries()) {
    const selection = optionalHookSelections.get(hookKey(phase, self, index));
    if (!selection?.selected || hook.kind !== "optional") continue;
    if (!hook.when(state, self)) continue;

    const targetOptions = hookTargetOptions(state, self, hook);
    const target = decodeTarget(selection.target);
    if (targetOptions.length > 0 && target === undefined) {
      throw new Error(misc("Select a target", "Select a target"));
    }
    // 선택 훅은 선택한 하나마다 사망 배치를 닫는다. 종료 판정은 단계 결과를
    // 한 번 렌더한 뒤 다음 사용자 입력에서 확정한다.
    withDeathBatch(state, () => {
      applyHookEffect(
        state,
        phase,
        hook,
        self,
        target,
        undefined,
        phase === "P5_MASTERMIND_ABILITY",
      );
    });
  }
}

function placeSelectedCard(target: Target): void {
  const selected = selectedHandCard;
  if (!selected) {
    notice = misc("Select a card first", "Select a card first");
    render();
    return;
  }
  const state = currentState();
  const mastermindNeedsReplacement =
    state.loop.phase === "P3_PROTAGONIST_ACTION" &&
    placementsForOwner(state, "mastermind").length < 3;
  if (
    (state.loop.phase === "P2_MASTERMIND_ACTION" && selected.owner !== "mastermind") ||
    (mastermindNeedsReplacement && selected.owner !== "mastermind") ||
    (
      state.loop.phase === "P3_PROTAGONIST_ACTION" &&
      !mastermindNeedsReplacement &&
      selected.owner !== nextProtagonist(state)
    )
  ) {
    notice = misc("It is not this player's turn", "It is not this player's turn");
    render();
    return;
  }

  const placement: PlacedCard = {
    owner: selected.owner,
    card: selected.card,
    target,
  };
  const legal = validatePlacement(state, placement);
  if (!legal.ok) {
    notice = legal.reason ?? misc("Invalid placement", "Invalid placement");
    render();
    return;
  }

  selectedHandCard = undefined;
  openCharacterModal = undefined;
  openLocationModal = undefined;
  operationSheetOpen = cardPanelShouldReopenAfterPlacement(
    state,
    placement.owner,
  );
  commit("action-card-placement", (game) => {
    game.loop.placed.push(placement);
  });
}

function revealActionCards(): void {
  const entry = activeScenarioEntry();
  const game = tracker.games[entry.id];
  const state = game.state;
  if (
    state.loop.phase !== "P4_RESOLVE" ||
    state.loop.actionResolutionComplete ||
    state.loop.placed.length !== 6
  ) {
    notice = misc("6 cards required", "6 cards required");
    render();
    return;
  }
  if (servantMovementChoiceMissing(state)) {
    notice = "리더가 메이드의 동행 여부를 선택해야 합니다.";
    render();
    return;
  }

  const transaction = captureUiTransaction(game);
  const cards = structuredClone(state.loop.placed);
  try {
    applySelectedOptionalHooks(state);
    const before = structuredClone(state);
    advanceGame(state, undefined, { deferSettlement: true });
    const items = collectResolutionReport(before, state, cards);
    const results = items.length === 0
      ? [misc("No effect", "No effect")]
      : items.map((item) => item.category === "noEffect"
        ? `[무효] ${noEffectResolutionLine(item)}`
        : `[${item.category === "movement" ? "이동" : "카운터"}] ${
          resolutionChangeLine(item)
        }${item.causeHidden ? " · 원인 비공개" : ""}`);
    recordPhaseLog(state, {
      loop: state.loop.loop,
      day: state.loop.day,
      phase: "P4_RESOLVE",
      kind: "actionResolved",
      results,
      placements: cards,
      publicContext: publicObservationContext(before.loop),
      publicChanges: publicBoardChanges(before.loop, state.loop),
    });
    resolutionReceipt = {
      scenarioId: entry.id,
      loop: state.loop.loop,
      day: state.loop.day,
      cards,
      items,
    };
    selectedHandCard = undefined;
    operationSheetOpen = false;
    optionalHookSelections.clear();
    notice = "";
    saveState(entry.id, state, "cards-resolved");
    render();
  } catch (error) {
    rollbackUiTransaction(entry.id, transaction, "cards-resolved", error);
  }
}

function sacredTreeSelectionFromDraft(
  state: GameState,
  actor: SacredTreeActor,
): { counter: SacredTreeCounter; target: CharacterId } {
  const condition = sacredTreeTransferCondition(state);
  const counterValue = draftValue(sacredTreeDraftKey(actor, "counter"));
  const counter = condition.transferableCounters.find(
    (candidate) => candidate === counterValue,
  );
  const target = draftValue(sacredTreeDraftKey(actor, "target"));
  if (counter === undefined || !condition.eligibleTargets.includes(target)) {
    throw new Error("신수의 카운터와 받을 캐릭터를 모두 선택해야 합니다.");
  }
  return { counter, target };
}

function resolveGoodwillFromButton(button: HTMLButtonElement): void {
  const entry = activeScenarioEntry();
  const game = tracker.games[entry.id];
  const transaction = captureUiTransaction(game);
  const character = button.dataset.character;
  const rank = Number(button.dataset.rank);
  const abilityIndex = Number(button.dataset.abilityIndex);
  const key = button.dataset.goodwillKey;
  const response = button.dataset.response;
  if (
    !character || !key || !Number.isInteger(rank) ||
    !Number.isInteger(abilityIndex) ||
    (response !== "resolve" && response !== "refuse")
  ) return;

  const goodwillInput = (field: GoodwillDraftField): string | undefined =>
    draftValue(goodwillDraftKey(key, field)) || undefined;
  const target = decodeTarget(goodwillInput("target"));
  const deltaValue = goodwillInput("delta");
  const cardValue = goodwillInput("card");
  const choiceValue = goodwillInput("choice");
  const revealValue = goodwillInput("reveal");

  try {
    const view = goodwillAbilityViews(game.state).find(
      (candidate) => candidate.key === key,
    );
    if (!view) {
      throw new Error(`missing goodwill ability view "${key}"`);
    }
    let card: ActionCard | undefined;
    if (cardValue !== undefined && cardValue !== "") {
      if (!isActionCard(cardValue)) {
        throw new Error(
          `goodwill card choice has invalid action card "${cardValue}"`,
        );
      }
      card = cardValue;
    }
    const incident = view.choice.kind === "incident" ||
        view.choice.kind === "pastIncident"
      ? decodeIncidentSelection(choiceValue)
      : undefined;
    const declaredSubplot = view.choice.kind === "subplot"
      ? choiceValue || undefined
      : undefined;
    const revealedSubplot = view.choice.kind === "subplot"
      ? revealValue || undefined
      : undefined;
    const incidentTarget = goodwillInput("incident-target");
    const incidentOtherTarget = goodwillInput("incident-other-target");
    const incidentLocation = goodwillInput("incident-location");
    const incidentCounter = goodwillInput("incident-counter");
    if (
      incidentLocation !== undefined &&
      !LOCATIONS.includes(incidentLocation as Location)
    ) {
      throw new Error(`invalid goodwill incident location "${incidentLocation}"`);
    }
    if (
      incidentCounter !== undefined &&
      !["goodwill", "paranoia", "intrigue"].includes(incidentCounter)
    ) {
      throw new Error(`invalid goodwill incident counter "${incidentCounter}"`);
    }
    const incidentChoice = incidentTarget || incidentOtherTarget ||
        incidentLocation || incidentCounter
      ? {
        target: incidentTarget,
        otherTarget: incidentOtherTarget,
        location: incidentLocation as Location | undefined,
        counter: incidentCounter as IncidentCounter | undefined,
      }
      : undefined;
    resolveGoodwillAbility(
      game.state,
      {
        user: character,
        rank,
        abilityIndex,
        target,
        paranoiaDelta:
          deltaValue === "1" ? 1 : deltaValue === "-1" ? -1 : undefined,
        card,
        incident,
        incidentChoice,
        declaredSubplot,
        revealedSubplot,
      },
      response,
    );
    notice = "";
    saveState(entry.id, game.state, `goodwill-${response}`);
    clearGoodwillDraft(key);
    render();
  } catch (error) {
    rollbackUiTransaction(
      entry.id,
      transaction,
      `goodwill-${response}`,
      error,
    );
  }
}

function advanceCurrentPhase(): void {
  const entry = activeScenarioEntry();
  const game = tracker.games[entry.id];
  const transaction = captureUiTransaction(game);
  const state = game.state;
  if (state.gamePhase !== "ROUND") return;
  const phaseBefore = state.loop.phase;

  try {
    if (
      state.pendingLoopEnd !== undefined ||
      (state.loop.pendingImmediateLossKeys?.length ?? 0) > 0
    ) {
      settleGameFlow(state);
      selectedHandCard = undefined;
      operationSheetOpen = false;
      optionalHookSelections.clear();
      notice = "";
      saveState(entry.id, state, "phase-result-confirmed");
      render();
      return;
    }
    if (
      state.loop.phase === "P2_MASTERMIND_ACTION" &&
      placementsForOwner(state, "mastermind").length !== 3
    ) {
      throw new Error(misc("3 cards required", "3 cards required"));
    }
    if (
      state.loop.phase === "P3_PROTAGONIST_ACTION" &&
      (
        placementsForOwner(state, "mastermind").length !== 3 ||
        nextProtagonist(state) !== undefined
      )
    ) {
      throw new Error(misc("3 cards required", "3 cards required"));
    }
    applySelectedOptionalHooks(state);
    if (state.gamePhase === "ROUND") {
      advanceGame(
        state,
        incidentChoiceFromDraft(),
        { deferSettlement: true },
      );
    }
    selectedHandCard = undefined;
    operationSheetOpen = false;
    if (phaseBefore !== "P5_MASTERMIND_ABILITY") {
      resolutionReceipt = undefined;
    }
    optionalHookSelections.clear();
    notice = "";
    saveState(entry.id, state, "phase-advance");
    render();
  } catch (error) {
    rollbackUiTransaction(entry.id, transaction, "phase-advance", error);
  }
}

root.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-action]",
  );
  if (!button) return;
  const action = button.dataset.action;

  if (action === "toggle-operation-sheet") {
    operationSheetOpen = !operationSheetOpen;
    render();
    return;
  }

  if (action === "copy-state") {
    copyCurrentState();
    return;
  }

  if (action === "new-game") {
    requestNewGame();
    return;
  }

  if (action === "delete-all-storage") {
    requestCompleteStorageDeletion();
    return;
  }

  if (action === "start-selected-scenario") {
    const scenarioId = draftValue("new-game:scenario") ||
      scenarioEntries[0]?.id;
    const entry = scenarioEntries.find(({ id }) => id === scenarioId);
    const difficultyIndex = Number(
      draftValue("new-game:difficulty") || "0",
    );
    if (entry !== undefined) startFreshScenario(entry, difficultyIndex);
    return;
  }

  if (action === "dismiss-notice") {
    notice = "";
    render();
    return;
  }

  if (action === "close-operation-sheet") {
    operationSheetOpen = false;
    render();
    return;
  }

  if (action === "close-character-modal") {
    openCharacterModal = undefined;
    render();
    return;
  }

  if (action === "close-location-modal") {
    openLocationModal = undefined;
    render();
    return;
  }

  if (action === "toggle-character-life") {
    const character = button.dataset.character;
    if (!character) return;
    commit("character-life", (state) => {
      const position = state.loop.board[character];
      state.loop.board[character] = withCharacterLife(
        position,
        !isCharacterAlive(position),
        character,
      );
    });
    return;
  }

  if (action === "recall-card") {
    const placementIndex = Number(button.dataset.placementIndex);
    const state = currentState();
    if (!Number.isInteger(placementIndex)) return;
    if (recallPlacedCard(state, placementIndex) === undefined) {
      notice = "이 카드는 공개 전 현재 배치 차례에만 회수할 수 있습니다.";
      render();
      return;
    }
    selectedHandCard = undefined;
    operationSheetOpen = false;
    notice = "";
    saveState(activeScenarioEntry().id, state, "action-card-recall");
    render();
    return;
  }

  if (action === "advance") {
    runLockedUiAction(button, advanceCurrentPhase);
    return;
  }

  if (action === "choose-leader") {
    const leader = Number(button.dataset.leader);
    if (leader !== 0 && leader !== 1 && leader !== 2) return;
    commit("setup-leader", (state) => {
      chooseInitialLeader(state, leader);
    });
    return;
  }

  if (action === "time-gap-start") {
    commit("time-gap-timer-start", (state) => {
      const remaining = timeGapRemaining(state);
      state.timeGapTimer = {
        remainingSeconds: remaining,
        endsAt: new Date(Date.now() + remaining * 1000).toISOString(),
      };
    });
    return;
  }

  if (action === "time-gap-pause") {
    commit("time-gap-timer-pause", (state) => {
      state.timeGapTimer = { remainingSeconds: timeGapRemaining(state) };
    });
    return;
  }

  if (action === "time-gap-reset") {
    commit("time-gap-timer-reset", (state) => {
      state.timeGapTimer = { remainingSeconds: 10 * 60 };
    });
    return;
  }

  if (action === "continue-loop-start") {
    commit("loop-start", (state) => {
      continueFromTimeGap(state);
    });
    return;
  }

  if (action === "open-final-guess-confirmation") {
    finalGuessConfirmationOpen = true;
    render();
    return;
  }

  if (action === "close-final-guess-confirmation") {
    finalGuessConfirmationOpen = false;
    render();
    return;
  }

  if (action === "confirm-skip-final-guess") {
    finalGuessConfirmationOpen = false;
    commit("final-guess-skip", (state) => {
      skipToFinalGuess(state);
    });
    return;
  }

  if (action === "continue-after-judgment") {
    commit("loop-judgment-continue", (state) => {
      continueAfterLoopJudgment(state);
    });
    return;
  }

  if (action === "start-extra-loop") {
    commit("house-rule-extra-loop", (state) => {
      startHouseRuleExtraLoop(state);
    });
    return;
  }

  if (action === "submit-final-guess") {
    const character = draftValue("final-guess:character");
    const guessedRole = draftValue("final-guess:role");
    if (!character || !guessedRole) {
      notice = "캐릭터와 역할을 모두 선택해 주세요.";
      render();
      return;
    }
    uiInputDrafts.delete("final-guess:character");
    uiInputDrafts.delete("final-guess:role");
    commit("final-guess-attempt", (state) => {
      submitFinalGuess(state, character, guessedRole);
    });
    return;
  }

  if (action === "reveal-cards") {
    runLockedUiAction(button, revealActionCards);
    return;
  }

  if (action === "select-hand-card") {
    const ownerValue = button.dataset.owner;
    const cardValue = button.dataset.card;
    const key = button.dataset.cardKey;
    if (cardValue === undefined || !isActionCard(cardValue)) {
      throw new Error(
        `select-hand-card has invalid action card "${cardValue ?? "undefined"}"`,
      );
    }
    const card = cardValue;
    if (!ownerValue || !key) return;
    const owner: CardOwner = ownerValue === "mastermind"
      ? "mastermind"
      : Number(ownerValue) as 0 | 1 | 2;
    const state = currentState();
    const restriction = actionCardRestriction(state, owner, card);
    if (restriction !== undefined) {
      notice = restriction.reason ?? "특수 규칙 때문에 사용할 수 없습니다.";
      render();
      return;
    }
    if (ownerCardIsSpent(state, owner, card)) {
      notice = `${actionCardName(card)} · 소진되어 선택할 수 없습니다`;
      render();
      return;
    }
    const mastermindNeedsReplacement =
      state.loop.phase === "P3_PROTAGONIST_ACTION" &&
      placementsForOwner(state, "mastermind").length < 3;
    const ownerIsActive = state.loop.phase === "P2_MASTERMIND_ACTION"
      ? owner === "mastermind"
      : state.loop.phase === "P3_PROTAGONIST_ACTION" && (
        mastermindNeedsReplacement
          ? owner === "mastermind"
          : owner === nextProtagonist(state)
      );
    if (!ownerIsActive) {
      notice = misc("It is not this player's turn", "It is not this player's turn");
      render();
      return;
    }
    selectedHandCard = selectedHandCard?.owner === owner &&
        selectedHandCard.key === key
      ? undefined
      : { owner, card, key };
    operationSheetOpen = false;
    openCharacterModal = undefined;
    openLocationModal = undefined;
    notice = "";
    render();
    return;
  }

  if (action === "board-character") {
    const character = button.dataset.character;
    if (!character) return;
    if (selectedHandCard) {
      placeSelectedCard({ kind: "character", id: character });
      return;
    }
    openLocationModal = undefined;
    openCharacterModal = character;
    notice = "";
    render();
    return;
  }

  if (action === "board-location") {
    const location = button.dataset.location as Location | undefined;
    if (!location) return;
    if (!selectedHandCard) {
      openCharacterModal = undefined;
      openLocationModal = location;
      notice = "";
      render();
      return;
    }
    placeSelectedCard({ kind: "location", at: location });
    return;
  }

  if (action === "sacred-tree-leader-decline") {
    runLockedUiAction(button, () => {
      commit("sacred-tree-leader-decline", (state) => {
        resolveSacredTreeLeaderTransfer(state);
      });
    });
    return;
  }

  if (
    action === "sacred-tree-leader-transfer" ||
    action === "sacred-tree-mastermind-transfer"
  ) {
    const actor: SacredTreeActor = action === "sacred-tree-leader-transfer"
      ? "leader"
      : "mastermind";
    runLockedUiAction(button, () => {
      commit(`sacred-tree-${actor}-transfer`, (state) => {
        const selection = sacredTreeSelectionFromDraft(state, actor);
        if (actor === "leader") {
          resolveSacredTreeLeaderTransfer(state, selection);
        } else {
          resolveSacredTreeMastermindTransfer(state, selection);
        }
        uiInputDrafts.delete(sacredTreeDraftKey(actor, "counter"));
        uiInputDrafts.delete(sacredTreeDraftKey(actor, "target"));
      });
    });
    return;
  }

  if (action === "goodwill") {
    runLockedUiAction(button, () => resolveGoodwillFromButton(button));
    return;
  }

  if (action === "counter") {
    const character = button.dataset.character;
    const counter = button.dataset.counter as IncidentCounter | undefined;
    const delta = Number(button.dataset.delta);
    if (!character || !counter || !Number.isFinite(delta)) return;
    commit("character-counter", (state) => {
      const counters = state.loop.charCounters[character];
      counters[counter] = Math.max(0, counters[counter] + delta);
    });
    return;
  }

  if (action === "location-counter") {
    const location = button.dataset.location as Location | undefined;
    const delta = Number(button.dataset.delta);
    if (!location || !Number.isFinite(delta)) return;
    commit("location-counter", (state) => {
      state.loop.locIntrigue[location] = Math.max(
        0,
        state.loop.locIntrigue[location] + delta,
      );
    });
    return;
  }

  if (action === "toggle-spent") {
    const ownerValue = button.dataset.owner;
    const cardValue = button.dataset.card;
    if (cardValue === undefined || !isActionCard(cardValue)) {
      throw new Error(
        `toggle-spent has invalid action card "${cardValue ?? "undefined"}"`,
      );
    }
    const card = cardValue;
    if (!ownerValue) return;
    const owner = ownerValue === "mastermind"
      ? "mastermind"
      : Number(ownerValue) as 0 | 1 | 2;
    commit("spent-card", (state) => {
      const spent = owner === "mastermind"
        ? state.loop.spentOncePerLoop.mastermind
        : state.loop.spentOncePerLoop.protagonists[owner];
      const index = spent.indexOf(card);
      if (index >= 0) spent.splice(index, 1);
      else spent.push(card);
    });
  }
});

root.addEventListener("change", (event) => {
  const control = event.target as HTMLInputElement | HTMLSelectElement;
  const action = control.dataset.action;
  const draftKey = control.dataset.uiDraftKey;
  if (draftKey !== undefined) {
    uiInputDrafts.set(draftKey, control.value);
    if (draftKey === "new-game:scenario") {
      uiInputDrafts.delete("new-game:difficulty");
      render();
      return;
    }
    if (draftKey === "new-game:difficulty") {
      render();
      return;
    }
    if (draftKey.startsWith("sacred-tree:")) {
      render();
      return;
    }
    if (action === "goodwill-subplot-declaration") {
      syncGoodwillSubplotRevealOptions(control as HTMLSelectElement);
    }
    if (action === "goodwill-incident-selection") {
      const key = control.dataset.goodwillKey;
      if (key !== undefined) {
        for (const field of [
          "incident-target",
          "incident-other-target",
          "incident-location",
          "incident-counter",
        ] as const) {
          uiInputDrafts.delete(goodwillDraftKey(key, field));
        }
      }
      render();
      return;
    }
    if (action === "goodwill-incident-target") {
      const key = control.dataset.goodwillIncidentTarget;
      if (key !== undefined) {
        const otherKey = goodwillDraftKey(key, "incident-other-target");
        if (uiInputDrafts.get(otherKey) === control.value) {
          uiInputDrafts.delete(otherKey);
        }
      }
      render();
      return;
    }
    return;
  }
  if (action === "loop-start-trait-counter") {
    const character = control.dataset.character;
    const counterValue = control.value;
    if (!character) return;
    if (counterValue !== "" && !isIncidentCounterValue(counterValue)) {
      throw new Error(
        `loop-start trait choice has invalid counter "${counterValue}"`,
      );
    }
    commit("loop-start-trait-counter", (state) => {
      setLoopStartTraitCounterChoice(
        state,
        character,
        counterValue === "" ? undefined : counterValue,
      );
    });
    return;
  }
  if (action === "servant-movement-choice") {
    const value = control.value;
    commit("servant-movement-choice", (state) => {
      setServantMovementChoice(
        state,
        value === "" ? undefined : value,
      );
    });
    return;
  }
  if (action === "loop-start-trait-location") {
    const character = control.dataset.character;
    const locationValue = control.value;
    if (!character) return;
    if (locationValue !== "" && !isLocationValue(locationValue)) {
      throw new Error(
        `loop-start trait choice has invalid location "${locationValue}"`,
      );
    }
    commit("loop-start-trait-location", (state) => {
      setLoopStartTraitLocationChoice(
        state,
        character,
        locationValue === "" ? undefined : locationValue,
      );
    });
    return;
  }
  if (action === "optional-hook") {
    const key = control.dataset.hookKey;
    if (!key) return;
    const current = optionalHookSelections.get(key) ?? { selected: false };
    current.selected = (control as HTMLInputElement).checked;
    optionalHookSelections.set(key, current);
    notice = "";
    render();
    return;
  }

  if (action === "optional-hook-target") {
    const key = control.dataset.hookKey;
    if (!key) return;
    const current = optionalHookSelections.get(key) ?? { selected: false };
    current.target = control.value || undefined;
    optionalHookSelections.set(key, current);
    notice = "";
    render();
    return;
  }

  if (action === "optional-loss") {
    const key = control.dataset.lossKey;
    if (!key) return;
    const entry = activeScenarioEntry();
    const game = tracker.games[entry.id];
    const transaction = captureUiTransaction(game);
    try {
      setOptionalLossActivation(
        game.state,
        key,
        (control as HTMLInputElement).checked,
      );
      saveState(entry.id, game.state, "optional-loss-activation");
      render();
    } catch (error) {
      rollbackUiTransaction(
        entry.id,
        transaction,
        "optional-loss-activation",
        error,
      );
    }
    return;
  }

  if (action === "scenario") {
    const entry = scenarioEntries.find(({ id }) => id === control.value);
    if (!entry) return;
    tracker.activeScenarioId = entry.id;
    selectedHandCard = undefined;
    resolutionReceipt = undefined;
    openCharacterModal = undefined;
    openLocationModal = undefined;
    finalGuessConfirmationOpen = false;
    operationSheetOpen = false;
    optionalHookSelections.clear();
    if (!tracker.games[entry.id]) {
      saveState(entry.id, createGame(entry), "scenario-start");
    } else {
      try {
        persistTrackerPreferences(window.localStorage, tracker);
      } catch (error) {
        notice = errorMessage(error);
      }
    }
    render();
    return;
  }

  if (action === "overlay") {
    tracker.mastermindOverlay = (control as HTMLInputElement).checked;
    try {
      persistTrackerPreferences(window.localStorage, tracker);
      notice = "";
    } catch (error) {
      notice = errorMessage(error);
    }
    render();
    return;
  }

  if (action === "move-character") {
    const character = control.dataset.character;
    const location = control.value as Location;
    if (!character || !LOCATIONS.includes(location)) return;
    commit("character-location", (state) => {
      state.loop.board[character] = withCharacterLocation(
        state.loop.board[character],
        location,
        character,
      );
    });
  }
});

render();

window.setInterval(() => {
  if (tracker.activeScenarioId === "") return;
  const state = currentState();
  if (state.gamePhase === "LOOP_TIME_GAP" && state.timeGapTimer?.endsAt) {
    updateTimeGapTimerText(state);
  }
}, 1000);
