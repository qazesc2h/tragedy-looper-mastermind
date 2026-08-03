import scriptsJson from "../../data/basic-tragedy-scripts.json";
import { adaptBasicTragedyScript, characterDataOf } from "../data";
import { resolveGoodwillAbility } from "../engine/goodwill";
import { incidentFires } from "../engine/incident";
import { validatePlacement } from "../engine/legal";
import { distanceToLoss } from "../engine/loss";
import { advance, collectHooks, resolveHooks } from "../engine/phases";
import {
  MASTERMIND_ONCE_PER_LOOP,
  PROTAGONIST_ONCE_PER_LOOP,
} from "../engine/resolve";
import { initLoop } from "../engine/setup";
import { INCIDENT_IMPL } from "../impl/incidents";
import {
  effectiveRole,
  isActionCard,
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
} from "../types";
import {
  collectNoEffectCards,
  collectResolutionChanges,
  handCardIsPlaced,
  MASTERMIND_HAND,
  nextProtagonist,
  placementsForOwner,
  PROTAGONIST_HAND,
  protagonistOrder,
  type CardOwner,
  type HandCard,
  type ResolutionChange,
  type ResolutionNoEffect,
} from "./action-cards";
import {
  goodwillAbilityViews,
  type GoodwillAbilityView,
  type GoodwillDisabledReason,
} from "./goodwill-abilities";
import {
  emptyTrackerStore,
  loadTrackerStore,
  persistGameState,
  persistTrackerPreferences,
  type TrackerStore,
} from "./storage";
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
  changes: ResolutionChange[];
  noEffects: ResolutionNoEffect[];
}

interface OptionalHookSelection {
  selected: boolean;
  target?: string;
}

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
const optionalHookSelections = new Map<string, OptionalHookSelection>();
let tracker: TrackerStore;
try {
  tracker = loadTrackerStore(window.localStorage);
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

function activeScenarioEntry(): ScenarioEntry {
  return scenarioEntries.find(({ id }) => id === tracker.activeScenarioId) ??
    scenarioEntries[0];
}

function createGame(entry: ScenarioEntry): GameState {
  const scenario = structuredClone(entry.scenario);
  const state: GameState = {
    scenario,
    loop: initLoop(scenario),
    history: [],
  };
  resolveHooks(state, "LOOP_START");
  return state;
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

function ensureActiveGame(): void {
  const entry = activeScenarioEntry();
  tracker.activeScenarioId = entry.id;
  if (!tracker.games[entry.id]) {
    saveState(entry.id, createGame(entry), "scenario-start");
  }
}

ensureActiveGame();

function currentState(): GameState {
  const entry = activeScenarioEntry();
  const saved = tracker.games[entry.id];
  if (!saved) throw new Error(`missing saved game for ${entry.id}`);
  return saved.state;
}

function commit(reason: string, mutate: (state: GameState) => void): void {
  const entry = activeScenarioEntry();
  const state = currentState();
  mutate(state);
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
  const revealed = receipt !== undefined;
  const cards = revealed ? receipt.cards : state.loop.placed;
  const matching = cards
    .filter((placement) => sameTarget(placement.target, target))
    .map((placement) => ({
      placement,
      showName: revealed || placement.owner === "mastermind",
      fullName: actionCardName(placement.card),
    }));
  if (matching.length === 0) return "";

  return `
    <div class="placed-card-stack ${revealed ? "is-revealed" : "is-facedown"}">
      ${matching.map(({ placement, showName, fullName }) => `
        <button type="button"
          class="placed-action-card owner-${placement.owner}"
          disabled
          ${showName ? `title="${escapeHtml(fullName)}"` : ""}
          aria-label="${escapeHtml(
            showName
              ? `${ownerLabel(placement.owner)} · ${fullName}`
              : ownerLabel(placement.owner),
          )}">
          <span>${escapeHtml(ownerLabel(placement.owner))}</span>
          ${showName
            ? `<strong>${escapeHtml(fullName)}</strong>`
            : `<b aria-hidden="true">TL</b>`}
        </button>`).join("")}
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
  const aliveLabel = position.alive
    ? misc("Alive", "Alive")
    : misc("Dead", "Dead");
  const roleBadge = tracker.mastermindOverlay
    ? `<span class="role-badge">${escapeHtml(roleName(role))}</span>`
    : "";

  return `
    <article class="character-unit ${position.alive ? "is-alive" : "is-dead"}">
      <div class="identity-frame">
        <button type="button" class="identity-card" data-action="board-character"
          data-character="${escapeHtml(character)}"
          aria-label="${escapeHtml(`${characterName(character)} — ${aliveLabel}`)}">
          <span class="card-corner">TL</span>
          <strong>${escapeHtml(characterName(character))}</strong>
          ${roleBadge}
          <span class="life-state">${escapeHtml(aliveLabel)}</span>
        </button>
        ${renderCardsOnTarget(state, { kind: "character", id: character })}
      </div>
      <div class="character-controls">
        ${renderCounter(character, "goodwill", counters.goodwill)}
        ${renderCounter(
          character,
          "paranoia",
          counters.paranoia,
          `/${data.paranoiaLimit}`,
        )}
        ${renderCounter(character, "intrigue", counters.intrigue)}
        <label class="location-select">
          <span>${escapeHtml(misc("Location", "Location"))}</span>
          <select data-action="move-character" data-character="${escapeHtml(character)}">
            ${LOCATIONS.map((location) => `
              <option value="${location}" ${position.at === location ? "selected" : ""}>
                ${escapeHtml(locationName(location))}
              </option>`).join("")}
          </select>
        </label>
      </div>
    </article>`;
}

function renderLocation(state: GameState, location: Location): string {
  const characters = Object.keys(state.loop.board).filter(
    (character) => state.loop.board[character].at === location,
  );
  return `
    <section class="board-location location-${location.toLowerCase()}">
      <header class="location-header">
        <button type="button" class="location-target" data-action="board-location"
          data-location="${location}">
          <span class="eyebrow">${escapeHtml(misc("Location", "Location"))}</span>
          <h2>${escapeHtml(locationName(location))}</h2>
        </button>
        <div class="location-intrigue">
          <span>${escapeHtml(misc("Intrigue"))}</span>
          <button type="button" data-action="location-counter" data-location="${location}"
            data-delta="-1" aria-label="${escapeHtml(`${misc("Intrigue")} -1`)}">−</button>
          <strong>${state.loop.locIntrigue[location]}</strong>
          <button type="button" data-action="location-counter" data-location="${location}"
            data-delta="1" aria-label="${escapeHtml(`${misc("Intrigue")} +1`)}">+</button>
        </div>
      </header>
      ${renderCardsOnTarget(state, { kind: "location", at: location })}
      <div class="character-grid">
        ${characters.map((character) => renderCharacter(state, character)).join("") ||
          `<p class="empty-location">${escapeHtml(misc("No character", "No character"))}</p>`}
      </div>
    </section>`;
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
        <h2>${escapeHtml(misc("Spent cards", "Spent cards"))}</h2>
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
  return `
    <div class="action-hand">
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

function renderMastermindAction(state: GameState): string {
  const placed = placementsForOwner(state, "mastermind").length;
  return `
    <section class="operation-panel card-placement-panel">
      <div class="operation-heading">
        <div>
          <span class="eyebrow">2 · ${escapeHtml(ownerLabel("mastermind"))}</span>
          <h2>${escapeHtml(phaseName("P2_MASTERMIND_ACTION"))}</h2>
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

function counterLabel(counter: IncidentCounter): string {
  const labels: Record<IncidentCounter, string> = {
    goodwill: misc("Goodwill"),
    paranoia: misc("Paranoia"),
    intrigue: misc("Intrigue"),
  };
  return labels[counter];
}

function targetLabel(target: Target): string {
  return target.kind === "character"
    ? characterName(target.id)
    : locationName(target.at);
}

function renderResolutionReceipt(state: GameState): string {
  const receipt = receiptFor(state);
  if (!receipt) return "";
  const lines = [
    ...receipt.changes.map((change) => {
      if (change.kind === "movement") {
        return `${characterName(change.character)} · ${locationName(change.before)} → ${locationName(change.after)}`;
      }
      if (change.kind === "locationIntrigue") {
        return `${locationName(change.location)} · ${misc("Intrigue")} ${change.before} → ${change.after}`;
      }
      return `${characterName(change.character)} · ${counterLabel(change.counter)} ${change.before} → ${change.after}`;
    }),
    ...receipt.noEffects.map(({ placement, blockedBy }) =>
      `${targetLabel(placement.target)} · ${actionCardName(placement.card)}: ${
        blockedBy ? actionCardName(blockedBy) : misc("No effect", "No effect")
      }`
    ),
  ];
  return `
    <section class="resolution-receipt" aria-live="polite">
      <div>
        <span class="eyebrow">${escapeHtml(misc("Resolving Cards"))}</span>
        <h2>${escapeHtml(misc("Result summary", "Result summary"))}</h2>
      </div>
      <ul>
        ${(lines.length > 0 ? lines : [misc("No effect", "No effect")])
          .map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
      </ul>
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

  const location = state.loop.board[self].at;
  const targets: Target[] = [];
  if (text.includes("this location or")) {
    targets.push({ kind: "location", at: location });
  }
  for (const [character, position] of Object.entries(state.loop.board)) {
    if (position.alive && position.at === location) {
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
    .filter(({ hook, self }) => hook.when(state, self));
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
  return `
    <select data-goodwill-target="${escapeHtml(view.key)}"
      aria-label="${escapeHtml(misc("Select a target", "Select a target"))}"
      ${disabled ? "disabled" : ""}>
      <option value="">${escapeHtml(misc("Select a target", "Select a target"))}</option>
      ${view.targets.map((target) => `
        <option value="${escapeHtml(encodeTarget(target))}">${escapeHtml(
          target.kind === "character"
            ? characterName(target.id)
            : locationName(target.at),
        )}</option>`).join("")}
    </select>`;
}

function renderGoodwillChoice(
  view: GoodwillAbilityView,
  disabled: boolean,
): string {
  const { choice, key } = view;
  switch (choice.kind) {
    case "none":
      return "";
    case "paranoiaDelta":
      return `
        <select data-goodwill-delta="${escapeHtml(key)}"
          aria-label="${escapeHtml(misc("Paranoia"))}"
          ${disabled ? "disabled" : ""}>
          <option value="">${escapeHtml(misc("Select", "Select"))}</option>
          ${choice.options.map((delta) => `
            <option value="${delta}">${escapeHtml(misc("Paranoia"))} ${delta > 0 ? "+" : ""}${delta}</option>`).join("")}
        </select>`;
    case "spentCard":
      return `
        <select data-goodwill-card="${escapeHtml(key)}"
          ${disabled ? "disabled" : ""}>
          <option value="">${escapeHtml(misc("Select a card", "Select a card"))}</option>
          ${choice.options.map((card) => `
            <option value="${card}">${escapeHtml(actionCardName(card))}</option>`).join("")}
        </select>`;
    case "incident":
    case "pastIncident":
      return `
        <select data-goodwill-choice="${escapeHtml(key)}"
          ${disabled ? "disabled" : ""}>
          <option value="">${escapeHtml(misc("Select", "Select"))}</option>
          ${choice.options.map((incident) => `
            <option value="${escapeHtml(incident)}">${escapeHtml(incidentName(incident))}</option>`).join("")}
        </select>`;
    case "subplot":
      return `
        <select data-goodwill-choice="${escapeHtml(key)}"
          ${disabled ? "disabled" : ""}>
          <option value="">${escapeHtml(misc("Select", "Select"))}</option>
          ${choice.options.map((plot) => `
            <option value="${escapeHtml(plot)}">${escapeHtml(plotName(plot))}</option>`).join("")}
        </select>`;
    case "counter":
      return `
        <select data-goodwill-choice="${escapeHtml(key)}"
          ${disabled ? "disabled" : ""}>
          <option value="">${escapeHtml(misc("Select", "Select"))}</option>
          ${choice.options.map((counter) => `
            <option value="${escapeHtml(counter)}">${escapeHtml(
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

function renderGoodwillAbilities(state: GameState): string {
  const abilities = goodwillAbilityViews(state);
  if (abilities.length === 0) {
    return `<p class="empty-overlay">${escapeHtml(misc("No available ability", "No available ability"))}</p>`;
  }
  return `<div class="goodwill-list">${abilities.map((view) => {
    const { character, abilityIndex, key, schema, disabledReason } = view;
    const disabled = disabledReason !== undefined;
    const reason = disabledReason === undefined
      ? ""
      : goodwillDisabledMessage(view, disabledReason);
    return `
    <article class="goodwill-card ${disabled ? "is-disabled" : ""}">
      <div class="goodwill-copy">
        <span>${escapeHtml(characterName(character))} · ${escapeHtml(misc("Goodwill"))} ${schema.rank}</span>
        <strong>${escapeHtml(gameText(schema.ko ?? schema._source))}</strong>
        ${reason ? `<small class="goodwill-disabled-reason">${escapeHtml(reason)}</small>` : ""}
      </div>
      <div class="goodwill-inputs">
        ${renderGoodwillTarget(view, disabled)}
        ${renderGoodwillChoice(view, disabled)}
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
          ${disabled || schema.cannotBeRefused ? "disabled" : ""}
          ${schema.cannotBeRefused ? `title="${escapeHtml(misc("Cannot be refused", "Cannot be refused"))}"` : ""}>
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
      return renderProtagonistAction(state);
    case "P4_RESOLVE":
      return `<section class="operation-panel compact-operation">
        <div class="resolve-control-copy">
          ${heading(4, phaseName(state.loop.phase))}
          ${renderHookList(state, state.loop.phase, true)}
        </div>
        ${renderAdvanceButton(misc("Resolving Cards"), state.loop.placed.length !== 6, "reveal-cards")}
      </section>`;
    case "P5_MASTERMIND_ABILITY":
      return `${renderResolutionReceipt(state)}
        <section class="operation-panel">
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
        <div class="phase-incident-list">${renderTodayIncidents(state)}</div>
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
          <div>${renderHookList(state, state.loop.phase, false)}</div>
          <div class="loss-list">${renderLossDistance(state)}</div>
        </div>
        <div class="operation-footer">${renderAdvanceButton(
          isScenarioComplete(state) ? misc("Final Guess") : misc("Next phase", "Next phase"),
          isScenarioComplete(state),
        )}</div>
      </section>`;
  }
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
    .filter(([, position]) => position.alive)
    .map(([character]) => character);
  const characterSelect = (field: string, label: string) => `
    <label>
      <span>${escapeHtml(label)}</span>
      <select data-incident-field="${field}">
        <option value="">${escapeHtml(misc("Select", "Select"))}</option>
        ${living.map((character) => `
          <option value="${escapeHtml(character)}">${escapeHtml(characterName(character))}</option>`).join("")}
      </select>
    </label>`;

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
            <select data-incident-field="location">
              <option value="">${escapeHtml(misc("Select", "Select"))}</option>
              ${LOCATIONS.map((location) => `<option value="${location}">${escapeHtml(locationName(location))}</option>`).join("")}
            </select></label>`
        : ""}
      ${fields.includes("counter")
        ? `<label><span>${escapeHtml(misc("Counter", "Counter"))}</span>
            <select data-incident-field="counter">
              <option value="">${escapeHtml(misc("Select", "Select"))}</option>
              <option value="goodwill">${escapeHtml(misc("Goodwill"))}</option>
              <option value="paranoia">${escapeHtml(misc("Paranoia"))}</option>
              <option value="intrigue">${escapeHtml(misc("Intrigue"))}</option>
            </select></label>`
        : ""}
    </div>`;
}

function renderTodayIncidents(state: GameState): string {
  const scheduled = state.scenario.incidents.filter(
    ({ day }) => day === state.loop.day,
  );
  if (scheduled.length === 0) {
    return `<p class="empty-overlay">${escapeHtml(misc("No incident"))}</p>`;
  }

  return scheduled.map(({ incident, culprit }) => {
    const fires = incidentFires(state, culprit);
    const alive = state.loop.board[culprit].alive;
    const paranoia = state.loop.charCounters[culprit].paranoia;
    const limit = characterDataOf(culprit).paranoiaLimit;
    const effectSources = INCIDENT_IMPL[incident]?.hooks
      .map(({ source }) => source.description)
      .filter((description): description is string => Boolean(description)) ??
      [];
    const effectText = incidentRuleText(incident, effectSources);
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
        <div class="incident-conditions">
          <span>${mark(alive)} ${escapeHtml(misc("Alive", "Alive"))}</span>
          <span>${mark(paranoia >= limit)} ${escapeHtml(misc("Paranoia"))} ${paranoia}/${limit}</span>
        </div>
        ${renderIncidentChoice(state, incident, fires)}
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
      <article class="loss-card ${condition.met ? "is-met" : ""}">
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
      </article>`;
  }).join("");
}

function renderMastermindOverlay(state: GameState): string {
  if (!tracker.mastermindOverlay) return "";
  return `
    <aside class="mastermind-overlay">
      <section>
        <div class="overlay-heading">
          <span class="eyebrow">${escapeHtml(misc("Day"))} ${state.loop.day}</span>
          <h2>${escapeHtml(misc("Incident trigger"))}</h2>
        </div>
        ${renderTodayIncidents(state)}
      </section>
      <section>
        <div class="overlay-heading">
          <span class="eyebrow">distanceToLoss()</span>
          <h2>${escapeHtml(misc("Victory Conditions"))}</h2>
        </div>
        <div class="loss-list">${renderLossDistance(state)}</div>
      </section>
    </aside>`;
}

function isScenarioComplete(state: GameState): boolean {
  return state.loop.loop === state.scenario.loops &&
    state.loop.day === state.scenario.daysPerLoop &&
    state.loop.phase === "P9_ROUND_END" &&
    state.history.some(({ loop }) => loop === state.loop.loop);
}

function observationCount(): number {
  const entry = activeScenarioEntry();
  const observations = tracker.games[entry.id]?.observationsByLoop ?? {};
  return Object.values(observations).reduce(
    (sum, loopObservations) => sum + loopObservations.length,
    0,
  );
}

function render(): void {
  const entry = activeScenarioEntry();
  const state = currentState();
  const tragedySet = term(
    "tragedySets",
    state.scenario.tragedySet,
    state.scenario.tragedySet,
  );

  root.innerHTML = `
    <div class="app-shell">
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
          <label class="overlay-toggle">
            <input type="checkbox" data-action="overlay" ${tracker.mastermindOverlay ? "checked" : ""} />
            <span>${escapeHtml(misc("Mastermind Aid"))}</span>
          </label>
        </div>
      </header>

      ${notice ? `<div class="notice" role="alert">${escapeHtml(notice)}</div>` : ""}
      ${renderPhases(state)}

      <main class="workspace ${tracker.mastermindOverlay ? "with-overlay" : ""}">
        <div class="primary-column">
          <section class="game-board ${selectedHandCard ? "is-targeting" : ""}"
            aria-label="${escapeHtml(misc("Location", "Location"))}">
            ${LOCATIONS.map((location) => renderLocation(state, location)).join("")}
            <div class="board-axis axis-x"></div>
            <div class="board-axis axis-y"></div>
            <div class="board-center">TL</div>
          </section>
          ${renderPhaseControls(state)}
          ${renderSpentCards(state)}
        </div>
        ${renderMastermindOverlay(state)}
      </main>
    </div>`;
}

function incidentChoiceFromUi(): IncidentChoice | undefined {
  const field = (name: string): string | undefined => {
    const select = root.querySelector<HTMLSelectElement>(
      `[data-incident-field="${name}"]`,
    );
    return select?.value || undefined;
  };
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
  if (phase !== "P4_RESOLVE" && phase !== "P5_MASTERMIND_ABILITY") return;
  const hooks = collectHooks(state, phase);
  hooks.forEach(({ hook, self }, index) => {
    const selection = optionalHookSelections.get(hookKey(phase, self, index));
    if (!selection?.selected || hook.kind !== "optional") return;
    if (!hook.when(state, self)) return;

    const targetOptions = hookTargetOptions(
      state,
      self,
      hook.source.description ?? hook.source.prerequisite ?? "",
    );
    const target = decodeTarget(selection.target);
    if (targetOptions.length > 0 && target === undefined) {
      throw new Error(misc("Select a target", "Select a target"));
    }
    hook.effect(state, self, target);
  });
}

function placeSelectedCard(target: Target): void {
  const selected = selectedHandCard;
  if (!selected) {
    notice = misc("Select a card first", "Select a card first");
    render();
    return;
  }
  const state = currentState();
  if (
    (state.loop.phase === "P2_MASTERMIND_ACTION" && selected.owner !== "mastermind") ||
    (state.loop.phase === "P3_PROTAGONIST_ACTION" && selected.owner !== nextProtagonist(state))
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
    advance(state);
    resolutionReceipt = {
      scenarioId: entry.id,
      loop: state.loop.loop,
      day: state.loop.day,
      cards,
      changes: collectResolutionChanges(before, state),
      noEffects: collectNoEffectCards(before, state, cards),
    };
    selectedHandCard = undefined;
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

  const target = decodeTarget(
    root.querySelector<HTMLSelectElement>(`[data-goodwill-target="${CSS.escape(key)}"]`)?.value,
  );
  const deltaValue = root.querySelector<HTMLSelectElement>(
    `[data-goodwill-delta="${CSS.escape(key)}"]`,
  )?.value;
  const cardValue = root.querySelector<HTMLSelectElement>(
    `[data-goodwill-card="${CSS.escape(key)}"]`,
  )?.value;

  try {
    let card: ActionCard | undefined;
    if (cardValue !== undefined && cardValue !== "") {
      if (!isActionCard(cardValue)) {
        throw new Error(
          `goodwill card choice has invalid action card "${cardValue}"`,
        );
      }
      card = cardValue;
    }
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
      },
      response,
    );
    notice = "";
    saveState(entry.id, game.state, `goodwill-${response}`);
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
  if (isScenarioComplete(state)) return;
  const endingLoop = state.loop.phase === "P9_ROUND_END" &&
    state.loop.day === state.scenario.daysPerLoop;
  const endingLoopNumber = state.loop.loop;

  try {
    if (
      state.loop.phase === "P2_MASTERMIND_ACTION" &&
      placementsForOwner(state, "mastermind").length !== 3
    ) {
      throw new Error(misc("3 cards required", "3 cards required"));
    }
    if (
      state.loop.phase === "P3_PROTAGONIST_ACTION" &&
      nextProtagonist(state) !== undefined
    ) {
      throw new Error(misc("3 cards required", "3 cards required"));
    }
    applySelectedOptionalHooks(state);
    advance(state, incidentChoiceFromUi());
    if (endingLoop) {
      saveState(entry.id, state, "loop-end");
      if (endingLoopNumber < state.scenario.loops) {
        const nextLoop = initLoop(state.scenario);
        nextLoop.loop = endingLoopNumber + 1;
        state.loop = nextLoop;
        resolveHooks(state, "LOOP_START");
      }
    }
    selectedHandCard = undefined;
    resolutionReceipt = undefined;
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

  if (action === "advance") {
    advanceCurrentPhase();
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
    const ownerIsActive = state.loop.phase === "P2_MASTERMIND_ACTION"
      ? owner === "mastermind"
      : state.loop.phase === "P3_PROTAGONIST_ACTION" &&
        owner === nextProtagonist(state);
    if (!ownerIsActive) {
      notice = misc("It is not this player's turn", "It is not this player's turn");
      render();
      return;
    }
    selectedHandCard = selectedHandCard?.owner === owner &&
        selectedHandCard.key === key
      ? undefined
      : { owner, card, key };
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
    if (["P2_MASTERMIND_ACTION", "P3_PROTAGONIST_ACTION"].includes(currentState().loop.phase)) {
      notice = misc("Select a card first", "Select a card first");
      render();
      return;
    }
    commit("character-life", (state) => {
      state.loop.board[character].alive = !state.loop.board[character].alive;
    });
    return;
  }

  if (action === "board-location") {
    const location = button.dataset.location as Location | undefined;
    if (!location || !selectedHandCard) {
      notice = misc("Select a card first", "Select a card first");
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

  if (action === "scenario") {
    const entry = scenarioEntries.find(({ id }) => id === control.value);
    if (!entry) return;
    tracker.activeScenarioId = entry.id;
    selectedHandCard = undefined;
    resolutionReceipt = undefined;
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
      state.loop.board[character].at = location;
    });
  }
});

render();
