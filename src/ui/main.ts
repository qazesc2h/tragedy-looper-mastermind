import scriptsJson from "../../data/basic-tragedy-scripts.json";
import { adaptBasicTragedyScript, characterDataOf } from "../data";
import { incidentFires } from "../engine/incident";
import { distanceToLoss } from "../engine/loss";
import { advance, resolveHooks } from "../engine/phases";
import {
  MASTERMIND_ONCE_PER_LOOP,
  PROTAGONIST_ONCE_PER_LOOP,
} from "../engine/resolve";
import { initLoop } from "../engine/setup";
import {
  effectiveRole,
  LOCATIONS,
  PHASE_ORDER,
  type ActionCard,
  type CharacterId,
  type GameState,
  type IncidentChoice,
  type IncidentCounter,
  type Location,
  type Phase,
  type Scenario,
} from "../types";
import {
  emptyTrackerStore,
  loadTrackerStore,
  persistGameState,
  persistTrackerPreferences,
  type TrackerStore,
} from "./storage";
import { misc, term } from "./terms";
import "./styles.css";

interface RawScript {
  title?: unknown;
}

interface ScenarioEntry {
  id: string;
  title: string;
  scenario: Scenario;
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
  moveDiagonal: "Diagonal Move",
  intriguePlus2: "Intrigue +2",
  goodwillPlus2: "Goodwill +2",
  paranoiaMinus1: "Paranoia -1",
  forbidMove: "Forbid Movement",
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
      ? rawTitle
      : `Script ${index + 1}`;
    return {
      id: `basicTragedy:${index + 1}`,
      title,
      scenario: adaptBasicTragedyScript(raw),
    };
  },
);

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("#app is required");

let notice = "";
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

function phaseName(phase: Phase): string {
  return PHASE_TERM[phase]();
}

function actionCardName(card: ActionCard): string {
  const english = ACTION_CARD_EN[card] ?? card;
  if (card === "intriguePlus2") return `${misc("Intrigue")} +2`;
  if (card === "goodwillPlus2") return `${misc("Goodwill")} +2`;
  if (card === "paranoiaMinus1") return `${misc("Paranoia")} -1`;
  return misc(english, english);
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
        <button type="button" class="identity-card" data-action="toggle-alive"
          data-character="${escapeHtml(character)}"
          aria-label="${escapeHtml(`${characterName(character)} — ${aliveLabel}`)}">
          <span class="card-corner">TL</span>
          <strong>${escapeHtml(characterName(character))}</strong>
          ${roleBadge}
          <span class="life-state">${escapeHtml(aliveLabel)}</span>
        </button>
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
        <div>
          <span class="eyebrow">${escapeHtml(misc("Location", "Location"))}</span>
          <h2>${escapeHtml(locationName(location))}</h2>
        </div>
        <div class="location-intrigue">
          <span>${escapeHtml(misc("Intrigue"))}</span>
          <button type="button" data-action="location-counter" data-location="${location}"
            data-delta="-1" aria-label="${escapeHtml(`${misc("Intrigue")} -1`)}">−</button>
          <strong>${state.loop.locIntrigue[location]}</strong>
          <button type="button" data-action="location-counter" data-location="${location}"
            data-delta="1" aria-label="${escapeHtml(`${misc("Intrigue")} +1`)}">+</button>
        </div>
      </header>
      <div class="character-grid">
        ${characters.map((character) => renderCharacter(state, character)).join("") ||
          `<p class="empty-location">${escapeHtml(misc("No character", "No character"))}</p>`}
      </div>
    </section>`;
}

function renderPhases(state: GameState): string {
  const complete = isScenarioComplete(state);
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
      <button type="button" class="next-phase" data-action="advance"
        ${complete ? "disabled" : ""}>
        ${escapeHtml(complete ? misc("Final Guess") : misc("Next phase", "Next phase"))}
        <span aria-hidden="true">→</span>
      </button>
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
    return `
      <article class="incident-card">
        <div class="incident-title">
          ${mark(fires)}
          <div><strong>${escapeHtml(incidentName(incident))}</strong>
          <span>${escapeHtml(misc("Culprit"))} · ${escapeHtml(characterName(culprit))}</span></div>
        </div>
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
          <section class="game-board" aria-label="${escapeHtml(misc("Location", "Location"))}">
            ${LOCATIONS.map((location) => renderLocation(state, location)).join("")}
            <div class="board-axis axis-x"></div>
            <div class="board-axis axis-y"></div>
            <div class="board-center">TL</div>
          </section>
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

  if (action === "toggle-alive") {
    const character = button.dataset.character;
    if (!character) return;
    commit("character-life", (state) => {
      state.loop.board[character].alive = !state.loop.board[character].alive;
    });
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
    const card = button.dataset.card as ActionCard | undefined;
    if (!ownerValue || !card) return;
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
  if (action === "scenario") {
    const entry = scenarioEntries.find(({ id }) => id === control.value);
    if (!entry) return;
    tracker.activeScenarioId = entry.id;
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
