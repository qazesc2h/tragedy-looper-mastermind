import scriptsJson from "../../data/basic-tragedy-scripts.json";
import { adaptBasicTragedyScript, characterDataOf } from "../data";
import { resolveGoodwillAbility } from "../engine/goodwill";
import { withDeathBatch } from "../engine/death";
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
  submitFinalGuess,
} from "../engine/game";
import {
  incidentFailureReasons,
  incidentFires,
} from "../engine/incident";
import { validatePlacement } from "../engine/legal";
import { distanceToLoss, setOptionalLossActivation } from "../engine/loss";
import { intrigueForbidActive } from "../engine/movement";
import { collectHooks } from "../engine/phases";
import {
  MASTERMIND_ONCE_PER_LOOP,
  PROTAGONIST_ONCE_PER_LOOP,
} from "../engine/resolve";
import { INCIDENT_IMPL } from "../impl/incidents";
import { ROLE_IMPL } from "../impl/roles";
import {
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
  type IncidentChoice,
  type IncidentCounter,
  type Location,
  type Phase,
  type PlacedCard,
  type Scenario,
  type Target,
  withCharacterLife,
  withCharacterLocation,
} from "../types";
import {
  collectResolutionReport,
  cardPanelShouldReopenAfterPlacement,
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
  decodeIncidentSelection,
  encodeIncidentSelection,
  goodwillAbilityViews,
  subplotRevealOptions,
  type GoodwillAbilityView,
  type GoodwillDisabledReason,
} from "./goodwill-abilities";
import { characterLocationInformation } from "./character-locations";
import {
  incidentDayLabelsForCharacter,
  incidentDaysForCharacter,
  incidentScheduleSummary,
  incidentScheduleRows,
  incidentScheduleRowsForCharacter,
  lossDistanceSummary,
  spentCardsSummary,
  type IncidentScheduleRow,
} from "./mastermind-panel";
import { phaseLogGroupIsOpen, phaseLogGroups } from "./phase-log";
import {
  clearAppStorage,
  emptyTrackerStore,
  loadTrackerStore,
  persistGameState,
  persistTrackerPreferences,
  prepareNewGame,
  type StoredGame,
  type TrackerStore,
} from "./storage";
import { serializeCurrentStateDump } from "./state-dump";
import {
  actionCardTerm,
  gameText,
  incidentRuleText,
  misc,
  term,
} from "./terms";
import "./styles.css";

interface RawScript {
  title?: unknown;
}

interface ScenarioEntry {
  id: string;
  title: string;
  scenario: Scenario;
}

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

const scenarioEntries: ScenarioEntry[] = (scriptsJson as unknown[]).map(
  (raw, index) => {
    const rawTitle = (raw as RawScript).title;
    const title = typeof rawTitle === "string"
      ? gameText(rawTitle)
      : `Script ${index + 1}`;
    return {
      id: `basicTragedy:${index + 1}`,
      title,
      scenario: adaptBasicTragedyScript(raw),
    };
  },
);

function requireUiRoot(): HTMLElement {
  const element = document.getElementById("app");
  if (!element) throw new Error("UI root element not found");
  return element;
}

const root = requireUiRoot();

let notice = "";
let selectedHandCard: SelectedHandCard | undefined;
let resolutionReceipt: ResolutionReceipt | undefined;
let openCharacterModal: CharacterId | undefined;
let openLocationModal: Location | undefined;
let operationSheetOpen = false;
const optionalHookSelections = new Map<string, OptionalHookSelection>();
const uiInputDrafts = new Map<string, string>();
let uiInputDraftScope = "";
let noticeDismissTimer: number | undefined;
const NOTICE_DURATION_MS = 5_000;

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

function createGame(entry: ScenarioEntry): GameState {
  const scenario = structuredClone(entry.scenario);
  return createGameState(scenario);
}

function saveState(
  scenarioId: string,
  state: GameState,
  reason: string,
): void {
  try {
    persistGameState(
      window.localStorage,
      tracker,
      scenarioId,
      state,
      reason,
    );
  } catch (error) {
    notice = errorMessage(error);
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
  operationSheetOpen = false;
  optionalHookSelections.clear();
  uiInputDrafts.clear();
  uiInputDraftScope = "";
}

function startFreshScenario(entry: ScenarioEntry): void {
  delete tracker.games[entry.id];
  tracker.activeScenarioId = entry.id;
  resetTransientUi();
  notice = "";
  saveState(entry.id, createGame(entry), "scenario-start");
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
    resetTransientUi();
    notice = "";
  } catch (error) {
    notice = errorMessage(error);
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
    .map(({ placement, placementIndex }) => ({
      placement,
      placementIndex,
      showName: placedCardShowsName(
        state.loop.phase,
        placement.owner,
        resolved,
      ),
      recallable: !resolved && selectedHandCard === undefined &&
        placedCardCanBeRecalled(state.loop.phase, placement),
      fullName: actionCardName(placement.card),
    }));
  if (matching.length === 0) return "";
  let recallablePlacementIndex: number | undefined;
  for (const item of matching) {
    if (item.recallable) recallablePlacementIndex = item.placementIndex;
  }

  return `
    <div class="placed-card-stack ${
      matching.every(({ showName }) => showName) ? "is-revealed" : "is-facedown"
    }">
      ${matching.map(({ placement, placementIndex, showName, fullName }) => {
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
            ? `<strong>${escapeHtml(fullName)}</strong>`
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
        aria-label="${escapeHtml(`${characterName(character)} — ${roleName(role)} — ${aliveLabel}`)}">
        <span class="character-chip-heading">
          <strong>${escapeHtml(characterName(character))}</strong>
          <span class="life-state" aria-label="${escapeHtml(aliveLabel)}"
            title="${escapeHtml(aliveLabel)}">
            <i aria-hidden="true"></i><span class="visually-hidden">${escapeHtml(aliveLabel)}</span>
          </span>
        </span>
        <span class="character-chip-meta">
          <span class="character-chip-role">${escapeHtml(roleName(role))}</span>
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
        <div class="location-modal-counter">
          <span>${escapeHtml(misc("Intrigue"))}</span>
          <button type="button" data-action="location-counter" data-location="${location}"
            data-delta="-1" aria-label="${escapeHtml(`${misc("Intrigue")} -1`)}">−</button>
          <strong>${state.loop.locIntrigue[location]}</strong>
          <button type="button" data-action="location-counter" data-location="${location}"
            data-delta="1" aria-label="${escapeHtml(`${misc("Intrigue")} +1`)}">+</button>
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
  const groups = phaseLogGroups(state);
  if (groups.length === 0) return "";

  const line = (entry: (typeof groups)[number]["entries"][number]): string => {
    if (entry.kind === "notApplicable") {
      return "해당 없음";
    }
    if (entry.kind === "leaderPassed") {
      return `${ownerLabel(entry.from)} → ${ownerLabel(entry.to)}`;
    }
    const result = entry.fired
      ? entry.effectApplied ? "발생 · 효과 적용" : "발생 · 효과 없음"
      : `발생하지 않음 (${entry.failureReasons.map(incidentFailureLabel).join(" · ")})`;
    return `${incidentName(entry.incident)} · ${result}`;
  };
  const entryCount = groups.reduce(
    (sum, group) => sum + group.entries.length,
    0,
  );

  return `
    <section class="phase-log" aria-label="진행 기록">
      <header class="phase-log-header">
        <strong>진행 기록</strong>
        <span>${entryCount}건</span>
      </header>
      <div class="phase-log-groups">
        ${groups.map((group) => `
          <details class="phase-log-group" ${phaseLogGroupIsOpen(state, group) ? "open" : ""}>
            <summary>
              <span>루프 ${group.loop} · ${group.day}일</span>
              <strong>${escapeHtml(phaseName(group.phase))}</strong>
              <small>${group.entries.length}건</small>
            </summary>
            <ol>${group.entries.map((entry) => `
              <li>${escapeHtml(line(entry))}</li>`).join("")}</ol>
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
        const once = owner === "mastermind"
          ? MASTERMIND_ONCE_PER_LOOP.has(entry.card)
          : PROTAGONIST_ONCE_PER_LOOP.has(entry.card);
        return `
          <button type="button"
            class="hand-card owner-${owner} ${placed ? "is-placed" : ""} ${selected ? "is-selected" : ""} ${spent ? "is-spent" : ""}"
            data-action="select-hand-card" data-owner="${owner}"
            data-card="${entry.card}" data-card-key="${entry.key}"
            ${!enabled || placed ? "disabled" : ""}
            aria-pressed="${selected}">
            <span>${escapeHtml(actionCardName(entry.card))}</span>
            ${once ? `<small>${escapeHtml(misc("Once per {type}").replace("{type}", misc("Loop")))}</small>` : ""}
            ${spent ? `<b>${escapeHtml(misc("Spent", "Spent"))}</b>` : ""}
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
    <section class="operation-panel card-placement-panel">
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
    <section class="operation-panel card-placement-panel">
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

function publicResolutionLine(item: Extract<
  ResolutionReportItem,
  { audience: "protagonists" }
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

function privateResolutionLine(item: Extract<
  ResolutionReportItem,
  { audience: "mastermind" }
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
  const publicItems = receipt.items.filter(
    (item): item is Extract<ResolutionReportItem, { audience: "protagonists" }> =>
      item.audience === "protagonists",
  );
  const privateItems = receipt.items.filter(
    (item): item is Extract<ResolutionReportItem, { audience: "mastermind" }> =>
      item.audience === "mastermind",
  );
  return `
    <section class="resolution-receipt" aria-live="polite">
      <div>
        <span class="eyebrow">${escapeHtml(misc("Resolving Cards"))}</span>
        <h2>${escapeHtml(misc("Result summary", "Result summary"))}</h2>
      </div>
      <div class="resolution-audiences">
        <section class="resolution-public">
          <h3>주인공에게 전달 · 변동 사항만</h3>
          <ul>
            ${(publicItems.length > 0
              ? publicItems.map((item) => ({
                category: item.category === "movement" ? "이동" : "카운터",
                line: publicResolutionLine(item),
              }))
              : [{ category: "변동", line: misc("No effect", "No effect") }])
              .map(({ category, line }) => `<li><b>[${escapeHtml(category)}]</b> ${escapeHtml(line)}</li>`)
              .join("")}
          </ul>
        </section>
        ${privateItems.length > 0
          ? `<section class="resolution-private">
              <h3>각본가 전용 · 전달 금지</h3>
              <ul>${privateItems.map((item) =>
                `<li><b>[무효]</b> ${escapeHtml(privateResolutionLine(item))}</li>`
              ).join("")}</ul>
            </section>`
          : ""}
      </div>
    </section>`;
}

function hookKey(phase: Phase, self: string, index: number): string {
  return `${phase}:${self || "plot"}:${index}`;
}

function hookTargetOptions(state: GameState, self: CharacterId, text: string): Target[] {
  if (text.includes("any location")) {
    return LOCATIONS.map((at) => ({ kind: "location", at }));
  }
  if (!self || !text.includes("this location")) return [];

  const location = characterLocation(state.loop.board[self], self);
  const targets: Target[] = [];
  if (text.includes("this location or")) {
    targets.push({ kind: "location", at: location });
  }
  for (const [character, position] of Object.entries(state.loop.board)) {
    if (
      isCharacterAlive(position) &&
      characterLocation(position, character) === location
    ) {
      targets.push({ kind: "character", id: character });
    }
  }
  return targets;
}

function encodeTarget(target: Target): string {
  return target.kind === "character"
    ? `character:${target.id}`
    : `location:${target.at}`;
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
    const targets = hookTargetOptions(state, self, text);
    return `
      <article class="hook-card ${selection?.selected ? "is-selected" : ""}">
        <div>
          <span>${escapeHtml(self ? characterName(self) : misc("Extra Rules"))}</span>
          <strong>${escapeHtml(gameText(text || hook.source.timing))}</strong>
        </div>
        <small>${escapeHtml(hook.kind === "mandatory" ? misc("Mandatory") : misc("Optional"))}</small>
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
      return `${view.schema.minLoop}번째 루프부터 사용 가능`;
    case "notImplemented":
      return "아직 구현되지 않은 능력";
    case "spent":
      return "이번 루프에 사용함";
    case "restrictedLocation":
      return `${misc("Only at", "Only at")}: ${
        view.schema.restrictedToLocation?.map(locationName).join(" / ") ?? ""
      }`;
    case "noTarget":
      if (view.schema.target.tags.includes("student")) {
        return "같은 장소에 다른 학생이 없습니다";
      }
      return misc("No eligible target", "No eligible target");
    case "noSpentCard":
      return misc("No spent card to recover", "No spent card to recover");
    case "noChoice":
      return "선택 가능한 항목이 없습니다";
    case "unsupportedTurf":
      return misc(
        "Turf target cannot be determined from the current state",
        "Turf target cannot be determined from the current state",
      );
    case "multipleTargets":
      return misc(
        "This ability requires multiple targets",
        "This ability requires multiple targets",
      );
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
  disabled: boolean,
): string {
  if (view.schema.effect.operation !== "resolveIncidentAsSelfWithoutTrigger") {
    return "";
  }
  const characters = Object.entries(state.loop.board)
    .filter(([, position]) => isCharacterAlive(position))
    .map(([character]) => character);
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
        data-ui-draft-key="${escapeHtml(draftKey)}"
        ${disabled ? "disabled" : ""}>
        <option value="">${escapeHtml(misc("Select", "Select"))}</option>
        ${characters.map((character) => `
          <option value="${escapeHtml(character)}"
            ${selectedDraftOption(draftKey, character)}>${escapeHtml(characterName(character))}</option>`).join("")}
      </select>
    </label>`;
  };
  const locationDraftKey = goodwillDraftKey(view.key, "incident-location");
  const counterDraftKey = goodwillDraftKey(view.key, "incident-counter");
  return `
    ${selectCharacter("target", misc("Target", "Target"))}
    ${selectCharacter("otherTarget", misc("Other target", "Other target"))}
    <label class="goodwill-choice-field">
      <span>${escapeHtml(misc("Location", "Location"))}</span>
      <select data-goodwill-incident-location="${escapeHtml(view.key)}"
        data-ui-draft-key="${escapeHtml(locationDraftKey)}"
        ${disabled ? "disabled" : ""}>
        <option value="">${escapeHtml(misc("Select", "Select"))}</option>
        ${LOCATIONS.map((location) => `
          <option value="${location}" ${selectedDraftOption(locationDraftKey, location)}>${escapeHtml(locationName(location))}</option>`).join("")}
      </select>
    </label>
    <label class="goodwill-choice-field">
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
      return `
        <select data-goodwill-choice="${escapeHtml(key)}"
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
          ? renderAiIncidentChoiceFields(state, view, disabled)
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
  if (abilities.length === 0) {
    return `<p class="empty-overlay">${escapeHtml(misc("No available ability", "No available ability"))}</p>`;
  }
  return `<div class="goodwill-list">${abilities.map((view) => {
    const {
      character,
      abilityIndex,
      key,
      schema,
      disabledReason,
      disabledDiagnostic,
    } = view;
    const disabled = disabledReason !== undefined;
    const reason = disabledReason === undefined
      ? ""
      : goodwillDisabledMessage(view, disabledReason);
    return `
    <article class="goodwill-card ${disabled ? "is-disabled" : ""}">
      <div class="goodwill-copy">
        <span>${escapeHtml(characterName(character))} · ${escapeHtml(misc("Goodwill"))} ${schema.rank}</span>
        <strong>${escapeHtml(gameText(schema._source, schema.ko))}</strong>
        ${reason ? `<small class="goodwill-disabled-reason">${escapeHtml(reason)}</small>` : ""}
        ${disabledDiagnostic
          ? `<small class="goodwill-disabled-diagnostic">(${escapeHtml(disabledDiagnostic)})</small>`
          : ""}
      </div>
      <div class="goodwill-inputs">
        ${renderGoodwillTarget(view, disabled)}
        ${renderGoodwillChoice(state, view, disabled)}
      </div>
      <div class="goodwill-actions">
        <button type="button" data-action="goodwill" data-response="resolve"
          data-character="${escapeHtml(character)}" data-rank="${schema.rank}"
          data-ability-index="${abilityIndex}" data-goodwill-key="${escapeHtml(key)}"
          ${disabled ? "disabled" : ""}>
          ${escapeHtml(misc("Resolve", "Resolve"))}
        </button>
        <button type="button" data-action="goodwill" data-response="refuse"
          data-character="${escapeHtml(character)}" data-rank="${schema.rank}"
          data-ability-index="${abilityIndex}" data-goodwill-key="${escapeHtml(key)}"
          ${disabled || schema.immuneToGoodwillRefusel ? "disabled" : ""}
          ${schema.immuneToGoodwillRefusel ? `title="${escapeHtml(misc("Cannot be refused", "Cannot be refused"))}"` : ""}>
          ${escapeHtml(misc("Refuse", "Refuse"))}
        </button>
      </div>
    </article>`;
  }).join("")}</div>`;
}

function renderPhaseControls(state: GameState): string {
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
      return `<section class="operation-panel">
        <div class="resolve-control-copy">
          ${heading(4, phaseName(state.loop.phase))}
          ${renderPlacementSummary(state)}
          ${renderHookList(state, state.loop.phase, true)}
        </div>
        <div class="operation-footer">
          <span>6장 배치 확정</span>
          ${renderAdvanceButton(misc("Resolving Cards"), state.loop.placed.length !== 6, "reveal-cards")}
        </div>
      </section>`;
    case "P5_MASTERMIND_ABILITY":
      return `<section class="operation-panel">
          ${heading(5, phaseName(state.loop.phase))}
          ${renderHookList(state, state.loop.phase, true)}
          <div class="operation-footer">${renderAdvanceButton()}</div>
        </section>`;
    case "P6_GOODWILL":
      return `<section class="operation-panel">
        ${heading(6, phaseName(state.loop.phase))}
        ${renderGoodwillAbilities(state)}
        <div class="operation-footer">${renderAdvanceButton()}</div>
      </section>`;
    case "P7_INCIDENT":
      return `<section class="operation-panel">
        ${heading(7, phaseName(state.loop.phase))}
        <div class="phase-incident-list">${renderTodayIncidents(state, true)}</div>
        <div class="operation-footer">${renderAdvanceButton(misc("Incident trigger"))}</div>
      </section>`;
    case "P8_LEADER_PASS":
      return `<section class="operation-panel compact-operation">
        ${heading(8, phaseName(state.loop.phase))}
        <p>${escapeHtml(`${ownerLabel(state.loop.leader)} → ${ownerLabel(((state.loop.leader + 1) % 3) as 0 | 1 | 2)}`)}</p>
        ${renderAdvanceButton()}
      </section>`;
    case "P9_ROUND_END":
      return `<section class="operation-panel">
        ${heading(9, phaseName(state.loop.phase))}
        <div class="round-end-grid">
          <div>${renderHookList(
            state,
            state.loop.phase,
            Boolean(state.loop.roundEndMandatoryResolved),
          )}</div>
          <div class="loss-list">${renderLossDistance(state)}</div>
        </div>
        <div class="operation-footer">${renderAdvanceButton(
          !state.loop.roundEndMandatoryResolved
            ? "강제 효과 해결"
            : state.loop.day === state.scenario.daysPerLoop
            ? "루프 종료·승패 판정"
            : misc("Next phase", "Next phase"),
        )}</div>
      </section>`;
  }
}

interface DockPrimaryAction {
  action: "advance" | "reveal-cards";
  label: string;
  disabled: boolean;
}

function dockPrimaryAction(state: GameState): DockPrimaryAction {
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
      return {
        action: "reveal-cards",
        label: "카드 공개",
        disabled: state.loop.placed.length !== 6,
      };
    case "P7_INCIDENT":
      return { action: "advance", label: "사건 판정", disabled: false };
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
          ${fires
            ? "판정 결과 · 발생"
            : `판정 결과 · 발생하지 않음 (${failureReasons.map(incidentFailureLabel).join(" · ")})`}
        </p>
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

function renderLossDistance(state: GameState): string {
  const conditions = distanceToLoss(state);
  if (conditions.length === 0) {
    return `<p class="empty-overlay">${escapeHtml(misc("No loss condition", "No loss condition"))}</p>`;
  }
  return conditions.map((condition) => {
    const ratio = condition.needed === 0
      ? 0
      : Math.min(100, Math.round((condition.current / condition.needed) * 100));
    return `
      <article class="loss-card ${condition.met ? "is-met" : ""} ${condition.blockedBy ? "is-blocked" : ""}">
        <div class="loss-title">
          ${mark(condition.met)}
          <div><strong>${escapeHtml(condition.ko)}</strong>
          <span>${escapeHtml(condition.when)} · ${escapeHtml(condition.activation === "optional" ? misc("Optional", "Optional") : misc("Mandatory", "Mandatory"))}</span></div>
        </div>
        <p>${escapeHtml(condition.label)}</p>
        <div class="loss-meter"><i style="width:${ratio}%"></i></div>
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
      </article>`;
  }).join("");
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

function renderScenarioInformation(state: GameState): string {
  const plots = [
    { label: "룰 Y", id: state.scenario.mainPlot },
    ...state.scenario.subPlots.map((id, index) => ({
      label: `룰 X${index + 1}`,
      id,
    })),
  ];

  return `<section class="scenario-information-panel">
    <div class="overlay-heading">
      <span class="eyebrow">${escapeHtml(misc("Script"))}</span>
      <h2>룰과 역할</h2>
    </div>
    <dl class="scenario-rule-list">
      ${plots.map(({ label, id }) => `
        <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(
          id ? plotName(id) : misc("None", "None"),
        )}</dd></div>`).join("")}
    </dl>
    <ul class="scenario-cast-list">
      ${Object.keys(state.scenario.cast).map((character) => {
        const culpritDays = incidentDaysForCharacter(state, character);
        return `<li>
          <span>${escapeHtml(characterName(character))}</span>
          <b>${escapeHtml(roleName(effectiveRole(state, character)))}</b>
          ${culpritDays.length === 0
            ? ""
            : `<em>범인 · ${culpritDays.map((day) => `${day}일`).join(" · ")}</em>`}
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

function renderIncidentSchedule(state: GameState): string {
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
              <td><strong>${row.day}일</strong><span>${timingLabel}</span></td>
              <td>${escapeHtml(incidentName(row.incident))}</td>
              <td>${escapeHtml(characterName(row.culprit))}${
                row.culpritEntryLabel
                  ? `<span>${escapeHtml(row.culpritEntryLabel)}</span>`
                  : ""
              }</td>
              <td>${row.timing === "past"
                ? ""
                : `<strong>불안 ${row.paranoia}/${row.paranoiaLimit}</strong>`}<span>${escapeHtml(status)}</span></td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>`}
  </section>`;
}

function renderMastermindOverlay(state: GameState): string {
  if (!tracker.mastermindOverlay) return "";
  return `
    <aside class="mastermind-overlay" aria-label="각본가 정보">
      ${renderLoopStartInformation(state)}
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
        <div class="info-accordion-body">${renderScenarioInformation(state)}</div>
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

function renderPublicInformation(state: GameState): string {
  const roleItems = (state.loop.revealedRoleCharacters ?? []).map(
    (character) =>
      `${characterName(character)}의 역할: ${roleName(effectiveRole(state, character))}`,
  );
  const informationItems = (state.loop.publicInformationThisLoop ?? []).map(
    (information) => {
      switch (information.kind) {
        case "incidentCulprit":
          return `${characterName(information.source)}: ${misc("Day")} ${information.day} · ` +
            `${incidentName(information.incident)}의 범인은 ${characterName(information.culprit)}`;
        case "subplot":
          return `리더 선언: ${plotName(information.declaredSubplot)} / ` +
            `각본가 공개: ${plotName(information.revealedSubplot)}`;
        case "incidentEffect":
          return `${misc("Day")} ${information.day} · ${incidentName(information.incident)}를 ` +
            `${characterName(information.culprit)}이(가) 범인인 것으로 효과 해결` +
            (information.effectApplied ? "" : " (적용된 효과 없음)");
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
        <strong>${outcome.loop}루프 · ${outcome.day}일</strong>
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
  return `<main class="game-flow-screen">
    ${renderProgressSteps([
      "시간의 틈",
      "캐릭터 배치",
      "카운터 제거 및 배치",
      "카드 분배",
    ], 0, 0)}
    <section class="flow-card time-gap-card">
      <span class="eyebrow">${state.loop.loop}루프 시작</span>
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
        <button type="button" class="danger-action" data-action="skip-final-guess">최후의 싸움으로 이동</button>
      </div>
      <p class="flow-warning">⚠ 남은 루프를 진행하지 않으므로 주인공 측이 더 불리해집니다.</p>
    </section>
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
          ${Object.keys(ROLE_IMPL).map((role) => `<option value="${escapeHtml(role)}" ${selectedDraftOption(roleDraftKey, role)}>${escapeHtml(roleName(role))}</option>`).join("")}
        </select></label>
        <button type="button" class="next-phase" data-action="submit-final-guess" ${remaining.length === 0 ? "disabled" : ""}>정오 판정</button>
      </div>
      ${renderFinalGuessAttempts(state)}
    </section>
  </main>`;
}

function renderLoopJudgment(state: GameState): string {
  const outcome = state.loopOutcomes.at(-1);
  if (!outcome) return "";
  const finalLoop = state.loop.loop >= state.scenario.loops;
  return `<main class="game-flow-screen">
    <section class="flow-card">
      <span class="eyebrow">${escapeHtml(misc("Loop Judgment"))}</span>
      <h1>${state.loop.loop}루프 — 주인공 패배</h1>
      <p>승패 판정을 완료했고 루프 종료 스냅샷을 기록했습니다.</p>
      ${renderLoopOutcomes(state)}
      <div class="flow-actions primary-actions">
        <button type="button" class="next-phase" data-action="continue-after-judgment">
          ${finalLoop ? "최후의 싸움 →" : "다음 루프 준비 →"}
        </button>
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
      <div class="outcome-summary">
        <h2>루프별 결과</h2>
        ${renderLoopOutcomes(state)}
      </div>
      <div class="flow-actions primary-actions">
        <button type="button" class="next-phase" data-action="new-game">새 게임</button>
      </div>
    </section>
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
  const selectedScenario = draftValue(scenarioDraftKey) ||
    scenarioEntries[0]?.id || "";
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
                <option value="${entry.id}" ${selectedScenario === entry.id ? "selected" : ""}>${escapeHtml(entry.title)}</option>`).join("")}
            </select>
          </label>
          <div class="flow-actions primary-actions">
            <button type="button" class="next-phase" data-action="start-selected-scenario">게임 시작</button>
          </div>
        </section>
      </main>
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

function render(): void {
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
                <option value="${candidate.id}" ${candidate.id === entry.id ? "selected" : ""}>
                  ${escapeHtml(candidate.title)}
                </option>`).join("")}
            </select>
          </label>
          <div class="round-status">
            <span>${escapeHtml(tragedySet)}</span>
            <strong>${escapeHtml(misc("Loop"))} ${state.loop.loop}/${state.scenario.loops}</strong>
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

    const targetOptions = hookTargetOptions(
      state,
      self,
      hook.source.description ?? hook.source.prerequisite ?? "",
    );
    const target = decodeTarget(selection.target);
    if (targetOptions.length > 0 && target === undefined) {
      throw new Error(misc("Select a target", "Select a target"));
    }
    // 선택 훅은 선택한 하나마다 사망 배치를 닫고 종료 판정을 한다.
    withDeathBatch(state, () => hook.effect(state, self, target));
    settleGameFlow(state);
    if (state.gamePhase !== "ROUND") return;
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
  if (state.loop.phase !== "P4_RESOLVE" || state.loop.placed.length !== 6) {
    notice = misc("6 cards required", "6 cards required");
    render();
    return;
  }

  const rollback = structuredClone(state);
  const cards = structuredClone(state.loop.placed);
  try {
    applySelectedOptionalHooks(state);
    const before = structuredClone(state);
    advanceGame(state);
    resolutionReceipt = {
      scenarioId: entry.id,
      loop: state.loop.loop,
      day: state.loop.day,
      cards,
      items: collectResolutionReport(before, state, cards),
    };
    selectedHandCard = undefined;
    operationSheetOpen = false;
    optionalHookSelections.clear();
    notice = "";
    saveState(entry.id, state, "cards-resolved");
  } catch (error) {
    game.state = rollback;
    notice = errorMessage(error);
  }
  render();
}

function resolveGoodwillFromButton(button: HTMLButtonElement): void {
  const entry = activeScenarioEntry();
  const game = tracker.games[entry.id];
  const before = structuredClone(game.state);
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
    settleGameFlow(game.state);
    notice = "";
    saveState(entry.id, game.state, `goodwill-${response}`);
    clearGoodwillDraft(key);
  } catch (error) {
    game.state = before;
    notice = errorMessage(error);
  }
  render();
}

function advanceCurrentPhase(): void {
  const entry = activeScenarioEntry();
  const game = tracker.games[entry.id];
  const before = structuredClone(game.state);
  const state = game.state;
  if (state.gamePhase !== "ROUND") return;
  const phaseBefore = state.loop.phase;

  try {
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
      advanceGame(state, incidentChoiceFromDraft());
    }
    selectedHandCard = undefined;
    operationSheetOpen = false;
    if (phaseBefore !== "P5_MASTERMIND_ABILITY") {
      resolutionReceipt = undefined;
    }
    optionalHookSelections.clear();
    notice = "";
    saveState(entry.id, state, "phase-advance");
  } catch (error) {
    game.state = before;
    notice = errorMessage(error);
  }
  render();
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
    if (entry !== undefined) startFreshScenario(entry);
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
    advanceCurrentPhase();
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

  if (action === "skip-final-guess") {
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
    revealActionCards();
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

  if (action === "goodwill") {
    resolveGoodwillFromButton(button);
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
    if (action === "goodwill-subplot-declaration") {
      syncGoodwillSubplotRevealOptions(control as HTMLSelectElement);
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
    commit("optional-loss-activation", (state) => {
      setOptionalLossActivation(
        state,
        key,
        (control as HTMLInputElement).checked,
      );
    });
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
