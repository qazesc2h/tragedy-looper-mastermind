import { describe, expect, it } from "vitest";
import { loadScenarioCatalog } from "../src/scenario-catalog";
import { scenarioToDraft } from "../src/scenario-draft";
import {
  serializedBytes,
  USER_BUCKET_LIMIT_BYTES,
  USER_DOCUMENT_LIMIT_BYTES,
  USER_DRAFTS_KEY,
  USER_SCENARIOS_KEY,
  UserScenarioRepository,
} from "../src/user-scenarios";
import { TRACKER_STORAGE_KEY } from "../src/ui/storage";

class MemoryStorage {
  values = new Map<string, string>();
  failWrite = false;
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (this.failWrite) throw new Error("quota exceeded");
    this.values.set(key, value);
  }
}

const bundled = loadScenarioCatalog();
const valid = bundled.flatMap((entry) => entry.difficulties)
  .find(({ validation }) => validation.ok);
if (!valid) throw new Error("missing valid bundle");

describe("user scenario repository", () => {
  it("measures all bundled scenarios and draft envelopes below explicit caps", () => {
    const sizes = bundled.flatMap((entry) => entry.difficulties.map(({ scenario }) => ({
      scenario: serializedBytes(scenario),
      draft: serializedBytes(scenarioToDraft(scenario)),
    })));
    expect(sizes).toHaveLength(48);
    const maximumScenario = Math.max(...sizes.map(({ scenario }) => scenario));
    const maximumDraft = Math.max(...sizes.map(({ draft }) => draft));
    const envelope = {
      schemaVersion: 1,
      id: "user:00000000-0000-0000-0000-000000000000",
      source: "user",
      title: "시나리오 복사본",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const maximumScenarioDocument = Math.max(...bundled.flatMap((entry) =>
      entry.difficulties.map(({ scenario }) => serializedBytes({ ...envelope, scenario }))));
    const maximumDraftDocument = Math.max(...bundled.flatMap((entry) =>
      entry.difficulties.map(({ scenario }) => serializedBytes({ ...envelope, draft: scenarioToDraft(scenario) }))));
    console.info("user-scenario serialized UTF-8 bytes", { maximumScenario, maximumDraft,
      maximumScenarioDocument, maximumDraftDocument,
      perDocumentLimit: USER_DOCUMENT_LIMIT_BYTES, perBucketLimit: USER_BUCKET_LIMIT_BYTES });
    expect(maximumScenario).toBeLessThan(USER_DOCUMENT_LIMIT_BYTES);
    expect(maximumDraft).toBeLessThan(USER_DOCUMENT_LIMIT_BYTES);
    expect(maximumScenarioDocument).toBeLessThan(USER_DOCUMENT_LIMIT_BYTES);
    expect(maximumDraftDocument).toBeLessThan(USER_DOCUMENT_LIMIT_BYTES);
  });

  it("persists a cloned bundle through repository recreation without changing bundle or tracker", () => {
    const storage = new MemoryStorage();
    storage.values.set(TRACKER_STORAGE_KEY, "tracker sentinel");
    storage.values.set("tragedy-looper-ko:tracker:v1", "other-domain sentinel");
    const source = structuredClone(valid.scenario);
    const repository = new UserScenarioRepository(storage);
    const saved = repository.saveScenario(source, "복제");
    expect(saved.ok).toBe(true);
    expect(storage.values.has(USER_SCENARIOS_KEY)).toBe(true);
    expect(storage.values.has(USER_DRAFTS_KEY)).toBe(false);
    expect(storage.values.get(TRACKER_STORAGE_KEY)).toBe("tracker sentinel");
    expect(storage.values.get("tragedy-looper-ko:tracker:v1")).toBe("other-domain sentinel");
    expect(new UserScenarioRepository(storage).listScenarios()[0]?.scenario).toEqual(JSON.parse(JSON.stringify(source)));
    expect(valid.scenario).toEqual(source);
  });

  it("round-trips JSON as an independent scenario and rejects damaged or future formats", () => {
    const storage = new MemoryStorage();
    const repository = new UserScenarioRepository(storage);
    const saved = repository.saveScenario(valid.scenario, "원본");
    if (!saved.ok) throw new Error("save failed");
    const json = repository.exportDocument(saved.value.id);
    if (!json) throw new Error("export failed");
    const imported = repository.importJson(json);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.value.id).not.toBe(saved.value.id);
      expect(imported.value).toMatchObject({ title: saved.value.title, scenario: saved.value.scenario });
    }
    expect(repository.importJson("{" )).toMatchObject({ ok: false, diagnostics: [{ code: "IMPORT_JSON_INVALID" }] });
    expect(repository.importJson(json.replace('"schemaVersion": 1', '"schemaVersion": 2'))).toMatchObject({
      ok: false, diagnostics: [{ path: "schemaVersion", code: "STORAGE_VERSION_UNSUPPORTED" }],
    });
    const malformed = JSON.parse(json) as { document: { scenario: { cast: unknown } } };
    malformed.document.scenario.cast = [];
    expect(repository.importJson(JSON.stringify(malformed))).toMatchObject({
      ok: false, diagnostics: [{ path: "scenario", code: "IMPORT_DOCUMENT_INVALID" }],
    });
    const trouble = bundled.find(({ rawTitle }) => rawTitle === "Trouble in Paradise");
    if (!trouble) throw new Error("missing trouble");
    const invalid = JSON.parse(json) as { document: { scenario: unknown } };
    invalid.document.scenario = trouble.scenario;
    expect(repository.importJson(JSON.stringify(invalid))).toMatchObject({
      ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "MYSTERY_BOY_ROLE_IS_PERSON" })]),
    });
    expect(repository.listScenarios()).toHaveLength(2);
  });

  it("stores and resumes incomplete drafts separately", () => {
    const storage = new MemoryStorage();
    const repository = new UserScenarioRepository(storage);
    const saved = repository.saveDraft({ cast: [{ rowId: "first", character: "boy" }] }, "미완성");
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(storage.values.has(USER_DRAFTS_KEY)).toBe(true);
    expect(storage.values.has(USER_SCENARIOS_KEY)).toBe(false);
    expect(new UserScenarioRepository(storage).resumeDraft(saved.value.id)).toEqual(saved.value.draft);
  });

  it("renames, duplicates, and deletes only user documents", () => {
    const repository = new UserScenarioRepository(new MemoryStorage());
    const saved = repository.saveScenario(valid.scenario, "첫 이름");
    if (!saved.ok) throw new Error("save failed");
    expect(repository.rename(saved.value.id, "새 이름").ok).toBe(true);
    const duplicate = repository.duplicate(saved.value.id);
    expect(duplicate.ok).toBe(true);
    expect(repository.listScenarios()).toHaveLength(2);
    expect(repository.delete(saved.value.id).ok).toBe(true);
    expect(repository.listScenarios()).toHaveLength(1);
    expect(repository.delete("community:naughty-cat").ok).toBe(false);
  });

  it("retains unsaved work in memory and allows export after quota failure", () => {
    const storage = new MemoryStorage();
    storage.failWrite = true;
    const repository = new UserScenarioRepository(storage);
    const result = repository.saveScenario(valid.scenario, "백업 대상");
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "STORAGE_WRITE_FAILED" }] });
    expect(repository.isDirty("user")).toBe(true);
    expect(repository.listScenarios()).toHaveLength(1);
    expect(repository.exportDocument(repository.listScenarios()[0]!.id)).toContain("백업 대상");
    expect(storage.values.has(USER_SCENARIOS_KEY)).toBe(false);
    storage.failWrite = false;
    expect(repository.rename(repository.listScenarios()[0]!.id, "복구").ok).toBe(true);
    expect(new UserScenarioRepository(storage).listScenarios()[0]?.title).toBe("복구");
  });

  it("does not drop a document when delete cannot persist", () => {
    const storage = new MemoryStorage();
    const repository = new UserScenarioRepository(storage);
    const saved = repository.saveScenario(valid.scenario, "지킬 문서");
    if (!saved.ok) throw new Error("save failed");
    storage.failWrite = true;
    expect(repository.delete(saved.value.id).ok).toBe(false);
    expect(repository.listScenarios()).toHaveLength(1);
    expect(new UserScenarioRepository(storage).listScenarios()).toHaveLength(1);
  });

  it("isolates corrupt stored data without overwriting it", () => {
    const storage = new MemoryStorage();
    storage.values.set(USER_SCENARIOS_KEY, "not json");
    const repository = new UserScenarioRepository(storage);
    expect(repository.loadDiagnostics).toMatchObject([{ code: "STORAGE_FORMAT_INVALID" }]);
    expect(repository.saveScenario(valid.scenario, "불가").ok).toBe(false);
    expect(storage.values.get(USER_SCENARIOS_KEY)).toBe("not json");
  });

  it("rejects a document beyond the per-item limit", () => {
    const repository = new UserScenarioRepository(new MemoryStorage());
    const enormous = structuredClone(valid.scenario);
    enormous.specialRules = ["가".repeat(USER_DOCUMENT_LIMIT_BYTES)];
    expect(repository.saveScenario(enormous, "과대")).toMatchObject({
      ok: false, diagnostics: [{ code: "STORAGE_SIZE_EXCEEDED" }],
    });
    expect(repository.listScenarios()).toHaveLength(1);
    expect(repository.isDirty("user")).toBe(true);
    expect(repository.exportDocument(repository.listScenarios()[0]!.id)).toContain("과대");
  });
});
