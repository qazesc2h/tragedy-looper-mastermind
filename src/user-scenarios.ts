import { validateScenario, type ScenarioDiagnostic } from "./engine/validate";
import {
  finalizeScenarioDraft,
  scenarioToDraft,
  validateScenarioDraft,
  type ScenarioDraft,
} from "./scenario-draft";
import type { Scenario } from "./types";

export const USER_SCENARIOS_KEY = "tragedy-looper-mastermind:scenarios";
export const USER_DRAFTS_KEY = "tragedy-looper-mastermind:drafts";
export const USER_SCENARIO_FORMAT = "tragedy-looper-mastermind:scenario";
export const USER_SCENARIO_VERSION = 1;
/** localStorage의 일반적인 5 MiB 할당량 아래에 게임 진행 기록의 여유를 둔다. */
export const USER_DOCUMENT_LIMIT_BYTES = 256 * 1024;
export const USER_BUCKET_LIMIT_BYTES = 1024 * 1024;

export interface UserScenarioDocument {
  schemaVersion: 1;
  id: `user:${string}`;
  source: "user";
  title: string;
  creator?: string;
  mastermindHints?: string;
  scenario: Scenario;
  createdAt: string;
  updatedAt: string;
}

export interface UserDraftDocument {
  schemaVersion: 1;
  id: `draft:${string}`;
  title: string;
  sourceScenarioId?: `user:${string}`;
  draft: ScenarioDraft;
  createdAt: string;
  updatedAt: string;
}

export type UserDocument = UserScenarioDocument | UserDraftDocument;

export interface ScenarioStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type DocumentResult<T> =
  | { ok: true; value: T; diagnostics: ScenarioDiagnostic[] }
  | { ok: false; diagnostics: ScenarioDiagnostic[]; value?: T };

function problem(path: string, code: ScenarioDiagnostic["code"], message: string): ScenarioDiagnostic {
  return { path, code, severity: "error", message };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown): value is string {
  return typeof value === "string";
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(string);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function serializedBytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value));
}

function validScenarioShape(value: unknown): value is Scenario {
  if (!record(value) || !string(value.tragedySet) ||
    !string(value.mainPlot) || !stringArray(value.subPlots) ||
    !record(value.cast) || !Object.values(value.cast).every(string) ||
    !Array.isArray(value.incidents) ||
    !value.incidents.every((incident: unknown) =>
      record(incident) && finiteNumber(incident.day) &&
      string(incident.incident) && string(incident.culprit)) ||
    !finiteNumber(value.loops) || !finiteNumber(value.daysPerLoop)) return false;
  return (value.difficulty === undefined || finiteNumber(value.difficulty)) &&
    (value.difficultyIndex === undefined || finiteNumber(value.difficultyIndex)) &&
    (value.difficultySets === undefined || (Array.isArray(value.difficultySets) &&
      value.difficultySets.length > 0 && value.difficultySets.every((row: unknown) =>
        record(row) && finiteNumber(row.numberOfLoops) && finiteNumber(row.difficulty)))) &&
    (value.specialRules === undefined || stringArray(value.specialRules)) &&
    (value.specialRuleIds === undefined || stringArray(value.specialRuleIds)) &&
    (value.scriptSpecified === undefined || record(value.scriptSpecified));
}

function validDraftShape(value: unknown): value is ScenarioDraft {
  if (!record(value)) return false;
  for (const field of ["title", "creator", "mastermindHints", "tragedySet", "mainPlot"] as const) {
    if (value[field] !== undefined && !string(value[field])) return false;
  }
  for (const field of ["loops", "daysPerLoop", "difficulty", "difficultyIndex"] as const) {
    if (value[field] !== undefined && !finiteNumber(value[field])) return false;
  }
  if (value.difficultySets !== undefined && (!Array.isArray(value.difficultySets) ||
    !value.difficultySets.every((row: unknown) => record(row) && string(row.rowId) &&
      (row.numberOfLoops === undefined || finiteNumber(row.numberOfLoops)) &&
      (row.difficulty === undefined || finiteNumber(row.difficulty))))) return false;
  if (value.specialRules !== undefined && !stringArray(value.specialRules)) return false;
  if (value.specialRuleIds !== undefined && !stringArray(value.specialRuleIds)) return false;
  for (const field of ["subPlots", "cast", "incidents"] as const) {
    if (value[field] !== undefined && !Array.isArray(value[field])) return false;
  }
  if (value.subPlots !== undefined && !(value.subPlots as unknown[]).every((row) =>
    record(row) && string(row.rowId) && (row.plot === undefined || string(row.plot)))) return false;
  if (value.cast !== undefined && !(value.cast as unknown[]).every((row) =>
    record(row) && string(row.rowId) &&
    (row.character === undefined || string(row.character)) &&
    (row.role === undefined || string(row.role)))) return false;
  if (value.incidents !== undefined && !(value.incidents as unknown[]).every((row) =>
    record(row) && string(row.rowId) &&
    (row.day === undefined || finiteNumber(row.day)) &&
    (row.incident === undefined || string(row.incident)) &&
    (row.culprit === undefined || string(row.culprit)))) return false;
  if (value.metadata !== undefined) {
    if (!record(value.metadata)) return false;
    for (const field of ["startLocations", "turfLocations", "entryLoops", "entryDays"] as const) {
      const entries = value.metadata[field];
      if (entries === undefined) continue;
      if (!record(entries) || !Object.values(entries).every((entry) =>
        record(entry) && (entry.source === "automatic" || entry.source === "user") &&
        (field === "entryLoops" || field === "entryDays"
          ? finiteNumber(entry.value) : string(entry.value)))) return false;
    }
    if (value.metadata.extraScriptSpecified !== undefined &&
      !record(value.metadata.extraScriptSpecified)) return false;
  }
  return true;
}

function validHeader(value: Record<string, unknown>, kind: "user" | "draft"): boolean {
  return value.schemaVersion === USER_SCENARIO_VERSION &&
    string(value.id) && value.id.startsWith(`${kind}:`) && value.id.length > kind.length + 1 &&
    string(value.title) && value.title.trim().length > 0 &&
    string(value.createdAt) && string(value.updatedAt) &&
    (value.creator === undefined || string(value.creator)) &&
    (value.mastermindHints === undefined || string(value.mastermindHints)) &&
    (value.sourceScenarioId === undefined ||
      (string(value.sourceScenarioId) && value.sourceScenarioId.startsWith("user:")));
}

function validateDocument(value: unknown, kind: "user" | "draft"): DocumentResult<UserDocument> {
  if (!record(value)) return { ok: false, diagnostics: [problem("document", "IMPORT_DOCUMENT_INVALID", "문서 형식이 올바르지 않습니다.")] };
  if (value.schemaVersion !== USER_SCENARIO_VERSION) return {
    ok: false, diagnostics: [problem("schemaVersion", "STORAGE_VERSION_UNSUPPORTED", "지원하지 않는 문서 버전입니다.")],
  };
  if (!validHeader(value, kind)) return {
    ok: false, diagnostics: [problem("document", "IMPORT_DOCUMENT_INVALID", "문서의 식별자·제목·날짜 형식이 올바르지 않습니다.")],
  };
  if (kind === "user") {
    if (value.source !== "user" || !validScenarioShape(value.scenario)) return {
      ok: false, diagnostics: [problem("scenario", "IMPORT_DOCUMENT_INVALID", "완성 시나리오 구조가 올바르지 않습니다.")],
    };
    const validation = validateScenario(value.scenario);
    if (!validation.ok) return { ok: false, diagnostics: validation.diagnostics };
    if (value.scenario.difficultySets !== undefined) {
      const [first] = value.scenario.difficultySets;
      if (first.numberOfLoops !== value.scenario.loops ||
        first.difficulty !== value.scenario.difficulty) return {
        ok: false, diagnostics: [problem("scenario.difficultySets", "IMPORT_DOCUMENT_INVALID",
          "기본 변형과 시나리오의 루프 수·난이도가 다릅니다.")],
      };
      for (const [index, item] of value.scenario.difficultySets.entries()) {
        const checked = validateScenario({ ...value.scenario, loops: item.numberOfLoops });
        if (!checked.ok) return { ok: false, diagnostics: checked.diagnostics.map((entry) => ({
          ...entry, path: `scenario.difficultySets[${index}].${entry.path}`,
        })) };
      }
    }
    const finalized = finalizeScenarioDraft(scenarioToDraft(value.scenario));
    if (!finalized.ok) return { ok: false, diagnostics: finalized.diagnostics };
    return { ok: true, value: value as unknown as UserScenarioDocument, diagnostics: [] };
  }
  if (!validDraftShape(value.draft)) return {
    ok: false, diagnostics: [problem("draft", "IMPORT_DOCUMENT_INVALID", "초안 구조가 올바르지 않습니다.")],
  };
  const validation = validateScenarioDraft(value.draft);
  return { ok: true, value: value as unknown as UserDraftDocument, diagnostics: validation.diagnostics };
}

function parseBucket(raw: string | null, kind: "user" | "draft"): DocumentResult<UserDocument[]> {
  if (raw === null) return { ok: true, value: [], diagnostics: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    return { ok: false, diagnostics: [problem("$", "STORAGE_FORMAT_INVALID", "저장된 목록 JSON을 읽을 수 없습니다.")] };
  }
  if (!record(parsed) || parsed.schemaVersion !== USER_SCENARIO_VERSION) return {
    ok: false, diagnostics: [problem("schemaVersion", "STORAGE_VERSION_UNSUPPORTED", "지원하지 않는 저장 목록 버전입니다.")],
  };
  if (!Array.isArray(parsed.documents)) return {
    ok: false, diagnostics: [problem("documents", "STORAGE_FORMAT_INVALID", "저장된 문서 목록이 올바르지 않습니다.")],
  };
  const documents: UserDocument[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < parsed.documents.length; index += 1) {
    const result = validateDocument(parsed.documents[index], kind);
    if (!result.ok) return { ok: false, diagnostics: result.diagnostics.map((entry) => ({ ...entry, path: `documents[${index}].${entry.path}` })) };
    if (ids.has(result.value.id)) return {
      ok: false, diagnostics: [problem(`documents[${index}].id`, "STORAGE_FORMAT_INVALID", "저장된 문서 식별자가 중복됩니다.")],
    };
    ids.add(result.value.id);
    documents.push(result.value);
  }
  return { ok: true, value: documents, diagnostics: [] };
}

function newId(kind: "user" | "draft"): `user:${string}` | `draft:${string}` {
  const unique = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${kind}:${unique}`;
}

/** 쓰기 실패 후에도 변경된 문서는 메모리에 남고 JSON 백업이 가능하다. */
export class UserScenarioRepository {
  private scenarios: UserScenarioDocument[] = [];
  private drafts: UserDraftDocument[] = [];
  private readonly locked = new Set<"user" | "draft">();
  private readonly dirty = new Set<"user" | "draft">();
  readonly loadDiagnostics: ScenarioDiagnostic[] = [];

  constructor(private readonly storage: ScenarioStorage) {
    for (const [kind, key] of [["user", USER_SCENARIOS_KEY], ["draft", USER_DRAFTS_KEY]] as const) {
      let raw: string | null;
      try { raw = storage.getItem(key); } catch {
        this.locked.add(kind);
        this.loadDiagnostics.push(problem(key, "STORAGE_FORMAT_INVALID", "저장소를 읽을 수 없습니다. 기존 데이터를 덮어쓰지 않습니다."));
        continue;
      }
      const result = parseBucket(raw, kind);
      if (!result.ok) {
        this.locked.add(kind);
        const bucketPath = kind === "user" ? "scenarios" : "drafts";
        this.loadDiagnostics.push(...result.diagnostics.map((entry) => ({
          ...entry,
          path: `${bucketPath}.${entry.path}`,
        })));
      } else if (kind === "user") this.scenarios = result.value as UserScenarioDocument[];
      else this.drafts = result.value as UserDraftDocument[];
    }
  }

  listScenarios(): UserScenarioDocument[] { return structuredClone(this.scenarios); }
  listDrafts(): UserDraftDocument[] { return structuredClone(this.drafts); }
  isDirty(kind: "user" | "draft"): boolean { return this.dirty.has(kind); }
  resumeDraft(id: string): ScenarioDraft | undefined {
    const document = this.drafts.find((item) => item.id === id);
    return document === undefined ? undefined : structuredClone(document.draft);
  }

  private write<T extends UserDocument>(kind: "user" | "draft", document: T, next: T[]): DocumentResult<T> {
    const key = kind === "user" ? USER_SCENARIOS_KEY : USER_DRAFTS_KEY;
    const serialized = JSON.stringify({ schemaVersion: USER_SCENARIO_VERSION, documents: next });
    if (kind === "user") this.scenarios = next as UserScenarioDocument[];
    else this.drafts = next as UserDraftDocument[];
    if (this.locked.has(kind)) {
      this.dirty.add(kind);
      return {
        ok: false, value: structuredClone(document),
        diagnostics: [problem("storage", "STORAGE_FORMAT_INVALID", "기존 저장 데이터가 손상되어 덮어쓸 수 없습니다. 새 문서는 JSON으로 백업하세요.")],
      };
    }
    if (utf8Bytes(JSON.stringify(document)) > USER_DOCUMENT_LIMIT_BYTES ||
      utf8Bytes(serialized) > USER_BUCKET_LIMIT_BYTES) {
      this.dirty.add(kind);
      return {
        ok: false, value: structuredClone(document),
        diagnostics: [problem("storage", "STORAGE_SIZE_EXCEEDED", "저장 용량 상한을 넘었습니다. 현재 탭에 보존했으니 JSON으로 내보내 백업하세요.")],
      };
    }
    try {
      this.storage.setItem(key, serialized);
      this.dirty.delete(kind);
      return { ok: true, value: structuredClone(document), diagnostics: [] };
    } catch {
      this.dirty.add(kind);
      return {
        ok: false, value: structuredClone(document),
        diagnostics: [problem("storage", "STORAGE_WRITE_FAILED", "저장에 실패했습니다. 현재 탭에는 남아 있지만 새로고침 전에 JSON으로 내보내세요.")],
      };
    }
  }

  saveScenario(scenario: Scenario, title: string, creator?: string, mastermindHints?: string): DocumentResult<UserScenarioDocument> {
    const now = new Date().toISOString();
    const document: UserScenarioDocument = {
      schemaVersion: 1, id: newId("user") as `user:${string}`, source: "user",
      title: title.trim(), ...(creator === undefined ? {} : { creator }),
      ...(mastermindHints === undefined ? {} : { mastermindHints }),
      scenario: JSON.parse(JSON.stringify(scenario)) as Scenario,
      createdAt: now, updatedAt: now,
    };
    const checked = validateDocument(document, "user");
    if (!checked.ok) return { ok: false, value: document, diagnostics: checked.diagnostics };
    return this.write("user", document, [...this.scenarios, document]);
  }

  updateScenario(
    id: string,
    scenario: Scenario,
    title: string,
    creator?: string,
    mastermindHints?: string,
  ): DocumentResult<UserScenarioDocument> {
    const previous = this.scenarios.find((item) => item.id === id);
    if (previous === undefined) return {
      ok: false,
      diagnostics: [problem("id", "IMPORT_DOCUMENT_INVALID", "수정할 사용자 시나리오를 찾을 수 없습니다.")],
    };
    const document: UserScenarioDocument = {
      ...previous,
      title: title.trim(),
      creator,
      mastermindHints,
      scenario: JSON.parse(JSON.stringify(scenario)) as Scenario,
      updatedAt: new Date().toISOString(),
    };
    const checked = validateDocument(document, "user");
    if (!checked.ok) return { ok: false, value: document, diagnostics: checked.diagnostics };
    return this.write("user", document, this.scenarios.map((item) => item.id === id ? document : item));
  }

  saveDraft(draft: ScenarioDraft, title: string, id?: string, sourceScenarioId?: string): DocumentResult<UserDraftDocument> {
    const previous = this.drafts.find((item) => item.id === id);
    const now = new Date().toISOString();
    const document: UserDraftDocument = {
      schemaVersion: 1, id: previous?.id ?? newId("draft") as `draft:${string}`,
      title: title.trim(), draft: structuredClone(draft),
      sourceScenarioId: (sourceScenarioId ?? previous?.sourceScenarioId) as `user:${string}` | undefined,
      createdAt: previous?.createdAt ?? now, updatedAt: now,
    };
    const checked = validateDocument(document, "draft");
    if (!checked.ok) return { ok: false, value: document, diagnostics: checked.diagnostics };
    return this.write("draft", document, [...this.drafts.filter((item) => item.id !== document.id), document]);
  }

  rename(id: string, title: string): DocumentResult<UserDocument> {
    const kind = id.startsWith("user:") ? "user" : "draft";
    const documents = kind === "user" ? this.scenarios : this.drafts;
    const previous = documents.find((item) => item.id === id);
    if (!previous || !title.trim()) return { ok: false, diagnostics: [problem("title", "IMPORT_DOCUMENT_INVALID", "문서와 비어 있지 않은 제목이 필요합니다.")] };
    const renamed = { ...previous, title: title.trim(), updatedAt: new Date().toISOString() };
    return this.write(kind, renamed, documents.map((item) => item.id === id ? renamed : item));
  }

  duplicate(id: string): DocumentResult<UserDocument> {
    const source = this.scenarios.find((item) => item.id === id) ?? this.drafts.find((item) => item.id === id);
    if (!source) return { ok: false, diagnostics: [problem("id", "IMPORT_DOCUMENT_INVALID", "복제할 문서를 찾을 수 없습니다.")] };
    const now = new Date().toISOString();
    if (source.id.startsWith("user:")) {
      const document = { ...structuredClone(source as UserScenarioDocument), id: newId("user") as `user:${string}`, title: `${source.title} 복사본`, createdAt: now, updatedAt: now };
      return this.write("user", document, [...this.scenarios, document]);
    }
    const document = { ...structuredClone(source as UserDraftDocument), id: newId("draft") as `draft:${string}`, title: `${source.title} 복사본`, sourceScenarioId: undefined, createdAt: now, updatedAt: now };
    return this.write("draft", document, [...this.drafts, document]);
  }

  delete(id: string): DocumentResult<undefined> {
    const kind = id.startsWith("user:") ? "user" : "draft";
    const documents = kind === "user" ? this.scenarios : this.drafts;
    const previous = documents.find((item) => item.id === id);
    if (!previous) return { ok: false, diagnostics: [problem("id", "IMPORT_DOCUMENT_INVALID", "삭제할 문서를 찾을 수 없습니다.")] };
    const wasDirty = this.dirty.has(kind);
    const result = this.write(kind, previous, documents.filter((item) => item.id !== id));
    if (result.ok) return { ok: true, value: undefined, diagnostics: [] };
    // 삭제는 저장 실패 때 복구 가능해야 하므로 메모리에서도 되돌린다.
    if (kind === "user") this.scenarios = documents as UserScenarioDocument[];
    else this.drafts = documents as UserDraftDocument[];
    if (!wasDirty) this.dirty.delete(kind);
    return { ok: false, diagnostics: result.diagnostics };
  }

  exportDocument(id: string): string | undefined {
    const document = this.scenarios.find((item) => item.id === id) ?? this.drafts.find((item) => item.id === id);
    return document === undefined ? undefined : JSON.stringify({ format: USER_SCENARIO_FORMAT, schemaVersion: USER_SCENARIO_VERSION, document }, null, 2);
  }

  importJson(json: string): DocumentResult<UserDocument> {
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch {
      return { ok: false, diagnostics: [problem("$", "IMPORT_JSON_INVALID", "JSON 파일을 읽을 수 없습니다.")] };
    }
    if (!record(parsed) || parsed.format !== USER_SCENARIO_FORMAT) return {
      ok: false, diagnostics: [problem("format", "IMPORT_DOCUMENT_INVALID", "이 앱의 시나리오 파일이 아닙니다.")],
    };
    if (parsed.schemaVersion !== USER_SCENARIO_VERSION) return {
      ok: false, diagnostics: [problem("schemaVersion", "STORAGE_VERSION_UNSUPPORTED", "지원하지 않는 파일 버전입니다.")],
    };
    const raw = parsed.document;
    const kind = record(raw) && string(raw.id) && raw.id.startsWith("draft:") ? "draft" : "user";
    const checked = validateDocument(raw, kind);
    if (!checked.ok) return checked;
    const now = new Date().toISOString();
    if (kind === "user") {
      const document = { ...structuredClone(checked.value as UserScenarioDocument), id: newId("user") as `user:${string}`, createdAt: now, updatedAt: now };
      return this.write("user", document, [...this.scenarios, document]);
    }
    const document = { ...structuredClone(checked.value as UserDraftDocument), id: newId("draft") as `draft:${string}`, sourceScenarioId: undefined, createdAt: now, updatedAt: now };
    return this.write("draft", document, [...this.drafts, document]);
  }
}
