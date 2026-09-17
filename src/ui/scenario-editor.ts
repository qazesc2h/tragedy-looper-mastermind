import { CHARACTERS, characterDataOf } from "../data";
import {
  autoCompleteScenarioDraft,
  candidateCharactersForScenarioDraftRole,
  candidateRolesForScenarioDraftCharacter,
  scenarioDraftOptions,
  scenarioDraftRoleAvailability,
  validateScenarioDraft,
  type ScenarioDraft,
  type ScenarioDraftCastRow,
  type ScenarioDraftDifficultyRow,
  type ScenarioDraftIncidentRow,
  type ScenarioDraftSubPlotRow,
  type ScenarioDraftValue,
} from "../scenario-draft";
import { TRAGEDY_SETS } from "../tragedy-sets";
import { LOCATIONS, SCENARIO_SPECIAL_RULE_IDS, type Location, type ScenarioSpecialRuleId } from "../types";
import { term } from "./terms";

export const EDITOR_STEPS = [
  "참극 세트", "루프·날짜", "룰 Y", "룰 X", "캐스트", "역할 배정",
  "사건 배치", "특수 규칙", "각본가 지침",
] as const;

export interface ScenarioEditorSession {
  draft: ScenarioDraft;
  draftId?: string;
  sourceScenarioId?: string;
  step: number;
  furthestStep?: number;
  upstreamNotice?: string;
  saveWarning?: string;
  lastSavedAt?: string;
  unsavedChanges?: boolean;
}

export function furthestPopulatedEditorStep(draft: ScenarioDraft): number {
  if (draft.mastermindHints) return 8;
  if (draft.specialRules?.length || draft.specialRuleIds?.length) return 7;
  if (draft.incidents?.length) return 6;
  if (draft.cast?.some(({ role }) => role !== undefined)) return 5;
  if (draft.cast?.length) return 4;
  if (draft.subPlots?.length) return 3;
  if (draft.mainPlot) return 2;
  if (draft.loops !== undefined || draft.difficultySets?.length || draft.daysPerLoop !== undefined) return 1;
  return 0;
}

const SUPPORTED_SETS = ["firstSteps", "basicTragedy"] as const;

function escape(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function selected(value: unknown, current: unknown): string {
  return value === current ? "selected" : "";
}

function option(value: string, label: string, current: string | undefined, disabled = false): string {
  return `<option value="${escape(value)}" ${selected(value, current)} ${disabled ? "disabled" : ""}>${escape(label)}</option>`;
}

function newRowId(): string {
  return `row-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function fieldDiagnostics(draft: ScenarioDraft, path: string): string {
  const diagnostics = validateScenarioDraft(draft).diagnostics.filter((entry) => entry.path === path);
  return diagnostics.length === 0 ? "" : `<ul class="editor-field-diagnostics">${diagnostics.map((entry) =>
    `<li class="${entry.severity}" data-diagnostic-path="${escape(entry.path)}">${escape(entry.message)}</li>`
  ).join("")}</ul>`;
}

function stageOf(path: string): number {
  if (path.startsWith("tragedySet")) return 0;
  if (path.startsWith("loops") || path.startsWith("difficultySets") || path.startsWith("daysPerLoop")) return 1;
  if (path.startsWith("mainPlot")) return 2;
  if (path.startsWith("subPlots")) return 3;
  if (path.startsWith("incidents")) return 6;
  if (path.startsWith("metadata") || path.startsWith("scriptSpecified")) return 4;
  if (path.startsWith("cast")) return path.includes(".role") || path === "cast" ? 5 : 4;
  return 8;
}

function roleReason(draft: ScenarioDraft, row: ScenarioDraftCastRow, role: string): string {
  const cast = (draft.cast ?? []).map((item) => item.rowId === row.rowId ? { ...item, role } : item);
  const diagnostics = validateScenarioDraft({ ...draft, cast }, "finalize").diagnostics;
  return diagnostics.find((entry) => entry.path === `cast.${row.rowId}.role` && entry.severity === "error")?.message ??
    diagnostics.find((entry) => entry.code === "ROLE_COUNT_EXCEEDED")?.message ??
    "선택한 룰·캐릭터 제약 또는 역할 정원 때문에 배정할 수 없습니다.";
}

function characterReason(draft: ScenarioDraft, row: ScenarioDraftCastRow, character: string): string {
  if ((draft.cast ?? []).some((item) => item.rowId !== row.rowId && item.character === character)) {
    return "이미 캐스트에 배정된 캐릭터입니다.";
  }
  const cast = (draft.cast ?? []).map((item) => item.rowId === row.rowId ? { ...item, character } : item);
  return validateScenarioDraft({ ...draft, cast }, "finalize").diagnostics.find((entry) =>
    entry.path === `cast.${row.rowId}.role` && entry.severity === "error")?.message ??
    "선택한 역할을 이 캐릭터에 배정할 수 없습니다.";
}

function renderMetadata(draft: ScenarioDraft, row: ScenarioDraftCastRow): string {
  const character = row.character;
  if (character === undefined) return "";
  const rows: string[] = [];
  const meta = draft.metadata;
  if (character === "servant") {
    const path = `metadata.startLocations.${row.rowId}`;
    rows.push(`<label>메이드 시작 장소
      <select data-editor-field="startLocation" data-row-id="${escape(row.rowId)}">
        <option value="">선택</option>
        ${characterDataOf(character).startLocation.map((location) =>
          option(location, term("misc", location, location), meta?.startLocations?.[row.rowId]?.value)).join("")}
      </select></label>${fieldDiagnostics(draft, path)}`);
  }
  if (character === "boss") {
    const path = `metadata.turfLocations.${row.rowId}`;
    rows.push(`<label>거물 세력권
      <select data-editor-field="turfLocation" data-row-id="${escape(row.rowId)}">
        <option value="">선택</option>
        ${LOCATIONS.map((location) => option(location, term("misc", location, location), meta?.turfLocations?.[row.rowId]?.value)).join("")}
      </select></label>${fieldDiagnostics(draft, path)}`);
  }
  for (const [target, label, key] of [
    ["godlyBeing", "신 등장 루프", "entryLoop"],
    ["transferStudent", "전학생 등장 날짜", "entryDay"],
  ]) {
    if (character !== target) continue;
    const path = `metadata.${key === "entryLoop" ? "entryLoops" : "entryDays"}.${row.rowId}`;
    const value = key === "entryLoop" ? meta?.entryLoops?.[row.rowId]?.value : meta?.entryDays?.[row.rowId]?.value;
    rows.push(`<label>${label}<input type="number" min="1" data-editor-field="${key}" data-row-id="${escape(row.rowId)}" value="${value ?? ""}" /></label>${fieldDiagnostics(draft, path)}`);
  }
  return rows.length === 0 ? "" : `<div class="editor-metadata">${rows.join("")}</div>`;
}

function renderSetStep(draft: ScenarioDraft): string {
  return `<label>시나리오 제목<input data-editor-field="title" value="${escape(draft.title ?? "")}" placeholder="제목을 입력하세요" /></label>
    <label>제작자<input data-editor-field="creator" value="${escape(draft.creator ?? "")}" /></label>
    <label>참극 세트<select data-editor-field="tragedySet">
      <option value="">선택</option>
      ${SUPPORTED_SETS.map((id) => option(id, term("tragedySets", id, TRAGEDY_SETS[id].name), draft.tragedySet)).join("")}
      ${draft.tragedySet && !SUPPORTED_SETS.includes(draft.tragedySet as typeof SUPPORTED_SETS[number])
        ? option(draft.tragedySet, `${draft.tragedySet} · 편집 범위 밖`, draft.tragedySet, true) : ""}
    </select></label>${fieldDiagnostics(draft, "tragedySet")}`;
}

function renderTimingStep(draft: ScenarioDraft): string {
  const rows = draft.difficultySets ?? [{ rowId: "difficulty-1", numberOfLoops: draft.loops,
    difficulty: draft.difficulty }];
  return `<p>첫 변형이 기본값입니다. 루프당 날짜 수는 모든 변형에 공통입니다.</p>
    ${rows.map((row, index) => `<div class="editor-row editor-difficulty-row">
      <strong>변형 ${index + 1}${index === 0 ? " · 기본값" : ""}</strong>
      <label>루프 수<input type="number" min="1" data-editor-field="difficultyLoops" data-row-id="${escape(row.rowId)}" value="${row.numberOfLoops ?? ""}" /></label>${fieldDiagnostics(draft, `difficultySets.${row.rowId}.numberOfLoops`)}
      <label>난이도<input type="number" min="0" data-editor-field="difficultyValue" data-row-id="${escape(row.rowId)}" value="${row.difficulty ?? ""}" /></label>${fieldDiagnostics(draft, `difficultySets.${row.rowId}.difficulty`)}
      ${rows.length > 1 ? `<button type="button" data-editor-action="remove-difficulty" data-row-id="${escape(row.rowId)}">변형 삭제</button>` : ""}
    </div>`).join("")}
    ${fieldDiagnostics(draft, "difficultySets")}${fieldDiagnostics(draft, "loops")}
    <button type="button" data-editor-action="add-difficulty">변형 추가</button>
    <label>루프당 날짜 수<input type="number" min="1" data-editor-field="daysPerLoop" value="${draft.daysPerLoop ?? ""}" /></label>${fieldDiagnostics(draft, "daysPerLoop")}
    <p>난이도 0은 미확인을 뜻합니다. 난이도가 확인된 변형은 1 이상을 입력하세요.</p>`;
}

function renderMainPlotStep(draft: ScenarioDraft): string {
  const options = scenarioDraftOptions(draft);
  return `<label>룰 Y<select data-editor-field="mainPlot" ${options ? "" : "disabled"}>
    <option value="">선택</option>
    ${(options?.mainPlots ?? []).map((plot) => option(plot, term("plots", plot, plot), draft.mainPlot)).join("")}
    ${draft.mainPlot && !options?.mainPlots.includes(draft.mainPlot) ? option(draft.mainPlot, `${term("plots", draft.mainPlot)} · 현재 세트에서 불가`, draft.mainPlot, true) : ""}
  </select></label>${fieldDiagnostics(draft, "mainPlot")}`;
}

function renderSubPlotStep(draft: ScenarioDraft): string {
  const options = scenarioDraftOptions(draft);
  const required = draft.tragedySet === undefined ? 0 : TRAGEDY_SETS[draft.tragedySet]?.numberOfSubPlots ?? 0;
  const rows = draft.subPlots ?? [];
  return `<p>선택한 참극 세트의 룰 X는 ${required}개입니다. 기존 선택은 세트를 바꿔도 보존됩니다.</p>
    ${rows.map((row, index) => `<div class="editor-row">
      <label>룰 X${index + 1}<select data-editor-field="subPlot" data-row-id="${escape(row.rowId)}">
        <option value="">선택</option>
        ${(options?.subPlots ?? []).map((plot) => option(plot, term("plots", plot, plot), row.plot)).join("")}
        ${row.plot && !options?.subPlots.includes(row.plot) ? option(row.plot, `${term("plots", row.plot)} · 현재 세트에서 불가`, row.plot, true) : ""}
      </select></label>
      <button type="button" data-editor-action="remove-subplot" data-row-id="${escape(row.rowId)}">삭제</button>
      ${fieldDiagnostics(draft, `subPlots.${row.rowId}.plot`)}
    </div>`).join("")}
    ${fieldDiagnostics(draft, "subPlots")}
    <button type="button" data-editor-action="add-subplot">룰 X 추가</button>`;
}

function renderCastStep(draft: ScenarioDraft): string {
  const used = new Set((draft.cast ?? []).map(({ character }) => character));
  return `<p>등장 캐릭터를 고릅니다. 역할 배정은 다음 단계입니다.</p>
    ${(draft.cast ?? []).map((row, index) => `<div class="editor-row">
      <label>캐릭터 ${index + 1}<select data-editor-field="castCharacter" data-row-id="${escape(row.rowId)}">
        <option value="">선택</option>
        ${Object.keys(CHARACTERS).map((character) => option(character, term("characters", character, CHARACTERS[character].ko), row.character, used.has(character) && row.character !== character)).join("")}
      </select></label>
      <button type="button" data-editor-action="remove-cast" data-row-id="${escape(row.rowId)}">삭제</button>
      ${fieldDiagnostics(draft, `cast.${row.rowId}.character`)}
      ${renderMetadata(draft, row)}
    </div>`).join("")}
    ${fieldDiagnostics(draft, "cast")}
    <button type="button" data-editor-action="add-cast">캐릭터 추가</button>`;
}

function renderRoleStep(draft: ScenarioDraft): string {
  const options = scenarioDraftOptions(draft);
  const availability = scenarioDraftRoleAvailability(draft).filter(({ role, minimum, maximum }) =>
    role !== "person" && (minimum > 0 || maximum > 0));
  return `<section class="editor-role-capacity" aria-label="역할 잔여 정원"><h3>역할 배정 현황</h3>
    ${availability.length === 0 ? "<p>룰 Y와 룰 X를 먼저 선택하세요.</p>" : `<ul>${availability.map(({ role, assigned, minimum, maximum, remainingRequired }) =>
      `<li>${escape(term("roles", role, role))} <strong>${assigned}/${maximum}</strong> ${remainingRequired > 0 ? `· ${remainingRequired}명 더 필요` : assigned < maximum ? `· ${maximum - assigned}명 추가 가능` : "· 배정 완료"}${minimum !== maximum ? ` (최소 ${minimum}명)` : ""}</li>`).join("")}</ul>`}
  </section>
  ${(draft.cast ?? []).map((row, index) => {
    const roleCandidates = row.character === undefined ? [] : candidateRolesForScenarioDraftCharacter(draft, row.rowId);
    const characterCandidates = row.role === undefined ? [] : candidateCharactersForScenarioDraftRole(draft, row.role, row.rowId);
    return `<div class="editor-row">
      <strong>배정 ${index + 1}</strong>
      <label>캐릭터<select data-editor-field="castCharacter" data-row-id="${escape(row.rowId)}">
        <option value="">선택</option>
        ${Object.keys(CHARACTERS).map((character) => {
          const unavailable = row.role !== undefined && !characterCandidates.includes(character);
          return option(character, `${term("characters", character, CHARACTERS[character].ko)}${unavailable ? ` — ${characterReason(draft, row, character)}` : ""}`, row.character, unavailable);
        }).join("")}
      </select></label>${fieldDiagnostics(draft, `cast.${row.rowId}.character`)}
      <label>역할<select data-editor-field="castRole" data-row-id="${escape(row.rowId)}" ${options ? "" : "disabled"}>
        <option value="">선택</option>
        ${(options?.roles ?? []).map((role) => {
          const unavailable = row.character !== undefined && !roleCandidates.includes(role);
          return option(role, `${term("roles", role, role)}${unavailable ? ` — ${roleReason(draft, row, role)}` : ""}`, row.role, unavailable);
        }).join("")}
        ${row.role && !options?.roles.includes(row.role) ? option(row.role, `${term("roles", row.role)} · 현재 세트에서 불가`, row.role, true) : ""}
      </select></label>${fieldDiagnostics(draft, `cast.${row.rowId}.role`)}
    </div>`;
  }).join("")}
  ${fieldDiagnostics(draft, "cast")}`;
}

function renderIncidentStep(draft: ScenarioDraft): string {
  const options = scenarioDraftOptions(draft);
  const cast = [...new Set((draft.cast ?? []).flatMap(({ character }) => character === undefined ? [] : [character]))];
  return `<p>날짜별 사건을 정합니다. 사건이 없으면 비워둘 수 있습니다.</p>
    ${(draft.incidents ?? []).map((row, index) => `<div class="editor-row editor-incident-row">
      <div class="editor-row-heading"><strong>${row.day ? `${row.day}일차` : `사건 ${index + 1}`}</strong>
        <button type="button" data-editor-action="remove-incident" data-row-id="${escape(row.rowId)}">삭제</button></div>
      <label>날짜<input type="number" min="1" data-editor-field="incidentDay" data-row-id="${escape(row.rowId)}" value="${row.day ?? ""}" /></label>${fieldDiagnostics(draft, `incidents.${row.rowId}.day`)}
      <label>사건<select data-editor-field="incidentType" data-row-id="${escape(row.rowId)}"><option value="">선택</option>
        ${(options?.incidents ?? []).map((incident) => option(incident, term("incidents", incident, incident), row.incident)).join("")}
        ${row.incident && !options?.incidents.includes(row.incident) ? option(row.incident, `${term("incidents", row.incident)} · 현재 세트에서 불가`, row.incident, true) : ""}
      </select></label>${fieldDiagnostics(draft, `incidents.${row.rowId}.incident`)}
      <label>범인<select data-editor-field="incidentCulprit" data-row-id="${escape(row.rowId)}"><option value="">선택</option>
        ${cast.map((character) => option(character, term("characters", character, characterDataOf(character).ko), row.culprit)).join("")}
        ${row.culprit && !cast.includes(row.culprit) ? option(row.culprit, `${term("characters", row.culprit)} · 캐스트에서 빠짐`, row.culprit, true) : ""}
      </select></label>${fieldDiagnostics(draft, `incidents.${row.rowId}.culprit`)}
    </div>`).join("")}
    <button type="button" data-editor-action="add-incident">사건 추가</button>`;
}

function renderSpecialRulesStep(draft: ScenarioDraft): string {
  return `<label>특수 규칙 · 한 줄에 하나씩<textarea rows="5" data-editor-field="specialRules">${escape((draft.specialRules ?? []).join("\n"))}</textarea></label>
    ${SCENARIO_SPECIAL_RULE_IDS.map((id) => `<label class="editor-checkbox"><input type="checkbox" data-editor-field="specialRuleId" value="${escape(id)}" ${draft.specialRuleIds?.includes(id) ? "checked" : ""} />${id === "mastermindCannotUseForbidGoodwill" ? "각본가는 '우호 금지' 카드를 사용할 수 없다." : escape(id)}</label>`).join("")}`;
}

function renderHintsStep(draft: ScenarioDraft, guidanceHtml: string): string {
  return `<p>직접 지침은 선택 사항입니다. 아래 자동 생성 지침 A~E는 완성 가능한 각본에서 펼칠 때 계산되며, 직접 지침과 함께 볼 수 있습니다.</p>
    <label>직접 쓴 각본가 지침<textarea rows="8" data-editor-field="mastermindHints" placeholder="선택 사항">${escape(draft.mastermindHints ?? "")}</textarea></label>
    ${guidanceHtml}`;
}

export function renderScenarioEditor(session: ScenarioEditorSession, guidanceHtml: string): string {
  const { draft, step } = session;
  const editing = validateScenarioDraft(draft);
  const complete = validateScenarioDraft(draft, "finalize");
  const canSave = complete.ok && Boolean(draft.title?.trim()) &&
    SUPPORTED_SETS.includes(draft.tragedySet as typeof SUPPORTED_SETS[number]);
  const contents = [
    renderSetStep, renderTimingStep, renderMainPlotStep, renderSubPlotStep,
    renderCastStep, renderRoleStep, renderIncidentStep, renderSpecialRulesStep,
    (value: ScenarioDraft) => renderHintsStep(value, guidanceHtml),
  ];
  const currentDiagnostics = editing.diagnostics.filter((entry) => stageOf(entry.path) === step);
  return `<main class="game-flow-screen scenario-editor-screen" aria-label="시나리오 편집기">
    <section class="flow-card scenario-editor-card">
      <div class="editor-heading"><div><span class="eyebrow">사용자 시나리오 편집</span><h1>${escape(draft.title?.trim() || "제목 없는 초안")}</h1></div>
        <button type="button" data-editor-action="close">목록으로</button></div>
      <p class="editor-progress">${step + 1} / ${EDITOR_STEPS.length} · ${EDITOR_STEPS[step]}</p>
      <nav class="editor-steps" aria-label="편집 단계">${EDITOR_STEPS.map((name, index) => {
        const count = editing.diagnostics.filter((entry) => stageOf(entry.path) === index && entry.severity === "error").length;
        return `<button type="button" data-editor-action="step" data-step="${index}" ${index === step ? 'aria-current="step"' : ""}>${index + 1}. ${name}${count ? ` · 오류 ${count}` : ""}</button>`;
      }).join("")}</nav>
      ${session.upstreamNotice ? `<p class="editor-upstream-warning" role="status">${escape(session.upstreamNotice)}</p>` : ""}
      <p class="editor-save-warning" role="alert" ${session.saveWarning ? "" : "hidden"}>${escape(session.saveWarning ?? "")}</p>
      <div class="editor-save-controls"><button type="button" data-editor-action="save-draft">초안 저장</button>
        <span class="editor-save-status" role="status">${session.unsavedChanges ? "저장되지 않은 변경 있음" : session.lastSavedAt ? `마지막 저장 ${escape(new Date(session.lastSavedAt).toLocaleString("ko-KR"))}` : "저장 전"}</span></div>
      <section class="editor-stage" aria-label="${escape(EDITOR_STEPS[step])}">
        <h2>${step + 1}. ${EDITOR_STEPS[step]}</h2>
        ${contents[step](draft)}
        ${currentDiagnostics.length === 0 ? "" : `<details class="editor-stage-diagnostics"><summary>이 단계 진단 ${currentDiagnostics.length}건</summary><ul>${currentDiagnostics.map((entry) =>
          `<li class="${entry.severity}">${escape(entry.message)}</li>`).join("")}</ul></details>`}
      </section>
      <div class="editor-navigation">
        <button type="button" data-editor-action="previous" ${step === 0 ? "disabled" : ""}>이전</button>
        <button type="button" data-editor-action="next" ${step === EDITOR_STEPS.length - 1 ? "disabled" : ""}>다음</button>
      </div>
      <div class="editor-complete">
        <button type="button" class="next-phase" data-editor-action="complete" ${canSave ? "" : "disabled"}>완성 저장</button>
        ${canSave ? "<p>완성 가능한 시나리오입니다.</p>" : `<p>완성 저장 불가: ${escape(!draft.title?.trim() ? "제목을 입력하세요." : complete.diagnostics.filter((entry) => entry.severity === "error").slice(0, 3).map(({ message }) => message).join(" ") || "지원 범위 밖 참극 세트입니다.")}</p>`}
      </div>
    </section>
  </main>`;
}

function updatedMetadata<T extends Location | number>(
  draft: ScenarioDraft,
  key: "startLocations" | "turfLocations" | "entryLoops" | "entryDays",
  rowId: string,
  value: T | undefined,
): ScenarioDraft {
  const metadata = { ...draft.metadata };
  const entries = { ...(metadata[key] ?? {}) } as Record<string, ScenarioDraftValue<T>>;
  if (value === undefined) delete entries[rowId];
  else entries[rowId] = { value, source: "user" };
  metadata[key] = entries as never;
  return { ...draft, metadata };
}

export function updateScenarioEditorField(
  session: ScenarioEditorSession,
  field: string,
  value: string,
  rowId?: string,
  checked?: boolean,
): void {
  let draft: ScenarioDraft = structuredClone(session.draft);
  const furthestStep = session.furthestStep ?? session.step;
  const rowRequired = () => {
    if (rowId === undefined) throw new Error(`${field} requires rowId`);
    return rowId;
  };
  const number = value === "" ? undefined : Number(value);
  const difficultyRows = (): ScenarioDraftDifficultyRow[] => [...(draft.difficultySets ?? [{
    rowId: "difficulty-1", numberOfLoops: draft.loops, difficulty: draft.difficulty,
  }])];
  switch (field) {
    case "title": draft.title = value; break;
    case "creator": draft.creator = value; break;
    case "mastermindHints": draft.mastermindHints = value; break;
    case "tragedySet":
      draft.tragedySet = value || undefined;
      if (value && draft.difficultyIndex === undefined) draft.difficultyIndex = 0;
      break;
    case "loops": draft.loops = number; break;
    case "daysPerLoop": draft.daysPerLoop = number; break;
    case "difficulty": draft.difficulty = number; break;
    case "difficultyLoops": draft.difficultySets = difficultyRows().map((row) =>
      row.rowId === rowRequired() ? { ...row, numberOfLoops: number } : row); break;
    case "difficultyValue": draft.difficultySets = difficultyRows().map((row) =>
      row.rowId === rowRequired() ? { ...row, difficulty: number } : row); break;
    case "mainPlot": draft.mainPlot = value || undefined; break;
    case "subPlot": draft.subPlots = (draft.subPlots ?? []).map((row) => row.rowId === rowRequired() ? { ...row, plot: value || undefined } : row); break;
    case "castCharacter": draft.cast = (draft.cast ?? []).map((row) => row.rowId === rowRequired() ? { ...row, character: value || undefined } : row); break;
    case "castRole": draft.cast = (draft.cast ?? []).map((row) => row.rowId === rowRequired() ? { ...row, role: value || undefined } : row); break;
    case "incidentDay": draft.incidents = (draft.incidents ?? []).map((row) => row.rowId === rowRequired() ? { ...row, day: number } : row); break;
    case "incidentType": draft.incidents = (draft.incidents ?? []).map((row) => row.rowId === rowRequired() ? { ...row, incident: value || undefined } : row); break;
    case "incidentCulprit": draft.incidents = (draft.incidents ?? []).map((row) => row.rowId === rowRequired() ? { ...row, culprit: value || undefined } : row); break;
    case "startLocation": draft = updatedMetadata(draft, "startLocations", rowRequired(), value ? value as Location : undefined); break;
    case "turfLocation": draft = updatedMetadata(draft, "turfLocations", rowRequired(), value ? value as Location : undefined); break;
    case "entryLoop": draft = updatedMetadata(draft, "entryLoops", rowRequired(), number); break;
    case "entryDay": draft = updatedMetadata(draft, "entryDays", rowRequired(), number); break;
    case "specialRules": draft.specialRules = value.split("\n").map((line) => line.trim()).filter(Boolean); break;
    case "specialRuleId": {
      const ids = new Set(draft.specialRuleIds ?? []);
      if (checked) ids.add(value as ScenarioSpecialRuleId);
      else ids.delete(value as ScenarioSpecialRuleId);
      draft.specialRuleIds = [...ids];
      break;
    }
    default: throw new Error(`unknown editor field ${field}`);
  }
  session.draft = autoCompleteScenarioDraft(draft);
  const fieldStep: Partial<Record<string, number>> = {
    tragedySet: 0,
    loops: 1,
    difficultyLoops: 1,
    difficultyValue: 1,
    daysPerLoop: 1,
    mainPlot: 2,
    subPlot: 3,
    castCharacter: 4,
    castRole: 5,
  };
  if (fieldStep[field] !== undefined && fieldStep[field] < furthestStep) {
    session.upstreamNotice = "앞 단계가 바뀌었습니다. 기존 배정은 지우지 않았으니 뒤 단계의 진단을 확인하세요.";
  }
}

export function applyScenarioEditorAction(session: ScenarioEditorSession, action: string, rowId?: string): void {
  const draft = structuredClone(session.draft);
  switch (action) {
    case "add-difficulty": draft.difficultySets = [...(draft.difficultySets ?? [{ rowId: "difficulty-1",
      numberOfLoops: draft.loops, difficulty: draft.difficulty }]),
      { rowId: newRowId() } satisfies ScenarioDraftDifficultyRow]; break;
    case "remove-difficulty": draft.difficultySets = (draft.difficultySets ?? []).filter((row) => row.rowId !== rowId); break;
    case "add-subplot": draft.subPlots = [...(draft.subPlots ?? []), { rowId: newRowId() } satisfies ScenarioDraftSubPlotRow]; break;
    case "remove-subplot": draft.subPlots = (draft.subPlots ?? []).filter((row) => row.rowId !== rowId); break;
    case "add-cast": draft.cast = [...(draft.cast ?? []), { rowId: newRowId() } satisfies ScenarioDraftCastRow]; break;
    case "remove-cast": draft.cast = (draft.cast ?? []).filter((row) => row.rowId !== rowId); break;
    case "add-incident": draft.incidents = [...(draft.incidents ?? []), { rowId: newRowId() } satisfies ScenarioDraftIncidentRow]; break;
    case "remove-incident": draft.incidents = (draft.incidents ?? []).filter((row) => row.rowId !== rowId); break;
    default: throw new Error(`unknown editor action ${action}`);
  }
  session.draft = autoCompleteScenarioDraft(draft);
  const actionStep = action.includes("difficulty") ? 1 : action.includes("subplot") ? 3 : action.includes("cast") ? 4 : 6;
  if (actionStep < (session.furthestStep ?? session.step)) {
    session.upstreamNotice = "앞 단계가 바뀌었습니다. 기존 배정은 지우지 않았으니 뒤 단계의 진단을 확인하세요.";
  }
}
