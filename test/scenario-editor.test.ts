import { describe, expect, it } from "vitest";
import { loadScenarioCatalog } from "../src/scenario-catalog";
import {
  finalizeScenarioDraft,
  scenarioToDraft,
  validateScenarioDraft,
} from "../src/scenario-draft";
import { UserScenarioRepository } from "../src/user-scenarios";
import {
  applyScenarioEditorAction,
  renderScenarioEditor,
  updateScenarioEditorField,
  type ScenarioEditorSession,
} from "../src/ui/scenario-editor";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const naughty = loadScenarioCatalog().find(({ id }) => id === "community:naughty-cat");
if (!naughty) throw new Error("missing naughty-cat");

function set(session: ScenarioEditorSession, field: string, value: string, rowId?: string, checked?: boolean): void {
  updateScenarioEditorField(session, field, value, rowId, checked);
}

describe("scenario editor", () => {
  it("keeps ordered difficulty variants and the shared day count", () => {
    const source = loadScenarioCatalog().find(({ rawTitle }) => rawTitle === "Prevailing Secrecy");
    if (!source) throw new Error("missing scenario");
    const session: ScenarioEditorSession = { draft: scenarioToDraft(source.scenario), step: 1 };
    applyScenarioEditorAction(session, "add-difficulty");
    const rows = session.draft.difficultySets!;
    set(session, "difficultyLoops", "4", rows[0].rowId);
    set(session, "difficultyValue", "1", rows[0].rowId);
    set(session, "difficultyLoops", "3", rows[1].rowId);
    set(session, "difficultyValue", "3", rows[1].rowId);
    expect(renderScenarioEditor(session, "")).toContain("변형 1 · 기본값");
    const completed = finalizeScenarioDraft(session.draft);
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.scenario.difficultySets).toEqual([
      { numberOfLoops: 4, difficulty: 1 }, { numberOfLoops: 3, difficulty: 3 },
    ]);
    expect(completed.scenario.daysPerLoop).toBe(source.scenario.daysPerLoop);
    const storage = new MemoryStorage();
    const saved = new UserScenarioRepository(storage).saveScenario(completed.scenario, "변형 확인");
    expect(saved.ok).toBe(true);
    expect(new UserScenarioRepository(storage).listScenarios()[0].scenario.difficultySets).toEqual(completed.scenario.difficultySets);
    set(session, "difficultyValue", "0", rows[1].rowId);
    expect(renderScenarioEditor(session, "")).toContain("난이도 0은 미확인을 뜻합니다.");
    expect(finalizeScenarioDraft(session.draft)).toMatchObject({ ok: true,
      scenario: { difficultySets: [{ difficulty: 1 }, { difficulty: 0 }] } });
    applyScenarioEditorAction(session, "remove-difficulty", rows[0].rowId);
    expect(session.draft.difficultySets?.[0]?.difficulty).toBe(0);
  });

  it("checks the godly being entry against every variant loop count", () => {
    const source = loadScenarioCatalog().find(({ rawTitle }) => rawTitle === "The Future of the Gods");
    if (!source) throw new Error("missing scenario");
    const draft = scenarioToDraft(source.scenario);
    draft.difficultySets = [
      { rowId: "easy", numberOfLoops: 4, difficulty: 4 },
      { rowId: "short", numberOfLoops: 2, difficulty: 5 },
    ];
    expect(validateScenarioDraft(draft, "finalize").diagnostics).toContainEqual(expect.objectContaining({
      path: "difficultySets.short.numberOfLoops", code: "ENTRY_TIMING_OUT_OF_RANGE", severity: "error",
    }));
  });
  it("starts blank, points warnings to fields, and preserves invalid downstream choices", () => {
    const session: ScenarioEditorSession = { draft: {}, step: 0 };
    expect(renderScenarioEditor(session, "")).toContain("참극 세트를 선택하지 않았습니다.");
    expect(renderScenarioEditor(session, "")).toContain('data-editor-action="complete" disabled');
    set(session, "tragedySet", "basicTragedy");
    set(session, "mainPlot", "changeOfFuture");
    applyScenarioEditorAction(session, "add-subplot");
    const rowId = session.draft.subPlots?.[0]?.rowId;
    if (!rowId) throw new Error("missing row");
    set(session, "subPlot", "paranoiaVirus", rowId);
    session.step = 6;
    set(session, "tragedySet", "firstSteps");
    expect(session.draft.subPlots?.[0]?.plot).toBe("paranoiaVirus");
    expect(session.upstreamNotice).toContain("기존 배정은 지우지 않았으니");
    expect(validateScenarioDraft(session.draft).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: `subPlots.${rowId}.plot`, code: "SUBPLOT_NOT_IN_TRAGEDY_SET" }),
    ]));
  });

  it("warns when returning to an earlier stage without deleting later assignments", () => {
    const session: ScenarioEditorSession = {
      draft: scenarioToDraft(naughty.scenario), step: 2, furthestStep: 8,
    };
    const castBefore = structuredClone(session.draft.cast);
    set(session, "mainPlot", "murderPlan");
    expect(session.upstreamNotice).toContain("뒤 단계의 진단");
    expect(session.draft.cast).toEqual(castBefore);
    expect(validateScenarioDraft(session.draft).diagnostics.some(({ severity }) => severity === "error")).toBe(true);
  });

  it("renders constrained choices disabled with reasons", () => {
    const draft = scenarioToDraft(naughty.scenario);
    const session: ScenarioEditorSession = { draft, step: 5 };
    const html = renderScenarioEditor(session, "");
    expect(html).toContain("역할 배정 현황");
    expect(html).toContain("1/1");
    const outsider = draft.cast?.find(({ character }) => character === "mysteryBoy");
    if (!outsider) throw new Error("missing outsider");
    expect(html).toContain('data-editor-field="castRole"');
    expect(html).toContain("아웃사이더: 엑스트라 역할을 배정할 수 없습니다.");
    expect(html).toMatch(/아웃사이더: 엑스트라 역할을 배정할 수 없습니다\.[^<]*<\/option>/);
  });

  it("shows AI, little sister, copycat, and full-capacity restrictions in role controls", () => {
    const base = {
      tragedySet: "basicTragedy", loops: 3, daysPerLoop: 5,
      mainPlot: "murderPlan",
      subPlots: [{ rowId: "x1", plot: "loveAffair" }, { rowId: "x2", plot: "unsettlingRumor" }],
      incidents: [],
    };
    const ai = renderScenarioEditor({ draft: {
      ...base, cast: [{ rowId: "ai", character: "ai" }],
    }, step: 5 }, "");
    expect(ai).toContain("엑스트라 — AI: AI 캐릭터에는 엑스트라 역할을 배정할 수 없습니다.");
    const sister = renderScenarioEditor({ draft: {
      ...base, cast: [{ rowId: "sister", character: "littleSister" }],
    }, step: 5 }, "");
    expect(sister).toContain("여동생:");
    const copycat = renderScenarioEditor({ draft: {
      ...base, cast: [
        { rowId: "killer", character: "journalist", role: "killer" },
        { rowId: "copycat", character: "copycat" },
      ],
    }, step: 5 }, "");
    expect(copycat).toContain("모방자: 시나리오에 등장하는 다른 캐릭터와 같은 역할");
    const full = renderScenarioEditor({ draft: {
      ...base, cast: [
        { rowId: "killer", character: "journalist", role: "killer" },
        { rowId: "candidate", character: "informer" },
      ],
    }, step: 5 }, "");
    expect(full).toContain("살인 청부업자 역할은 선택된 룰에서 최대 1명까지");
  });

  it("builds 못된 고양이 from an empty draft, autosaves, resumes, and finalizes losslessly", () => {
    const session: ScenarioEditorSession = { draft: {}, step: 0 };
    const source = naughty.scenario;
    set(session, "title", naughty.rawTitle);
    set(session, "creator", naughty.creator ?? "");
    set(session, "tragedySet", "basicTragedy");
    set(session, "loops", String(source.loops));
    set(session, "daysPerLoop", String(source.daysPerLoop));
    set(session, "difficulty", String(source.difficulty));
    set(session, "mainPlot", source.mainPlot);
    for (const plot of source.subPlots) {
      applyScenarioEditorAction(session, "add-subplot");
      set(session, "subPlot", plot, session.draft.subPlots?.at(-1)?.rowId);
    }
    for (const [character, role] of Object.entries(source.cast)) {
      applyScenarioEditorAction(session, "add-cast");
      const rowId = session.draft.cast?.at(-1)?.rowId;
      set(session, "castCharacter", character, rowId);
      set(session, "castRole", role, rowId);
      if (character === "servant") set(session, "startLocation", "School", rowId);
    }
    for (const incident of source.incidents) {
      applyScenarioEditorAction(session, "add-incident");
      const rowId = session.draft.incidents?.at(-1)?.rowId;
      set(session, "incidentDay", String(incident.day), rowId);
      set(session, "incidentType", incident.incident, rowId);
      set(session, "incidentCulprit", incident.culprit, rowId);
    }
    set(session, "specialRules", source.specialRules?.join("\n") ?? "");
    set(session, "specialRuleId", "mastermindCannotUseForbidGoodwill", undefined, true);
    set(session, "mastermindHints", naughty.mastermindHints ?? "");
    expect(validateScenarioDraft(session.draft, "finalize").diagnostics).toEqual([]);
    const storage = new MemoryStorage();
    const repository = new UserScenarioRepository(storage);
    const savedDraft = repository.saveDraft(session.draft, session.draft.title ?? "");
    expect(savedDraft.ok).toBe(true);
    if (!savedDraft.ok) return;
    const resumed = new UserScenarioRepository(storage).resumeDraft(savedDraft.value.id);
    if (!resumed) throw new Error("missing resumed draft");
    const finalized = finalizeScenarioDraft(resumed);
    expect(finalized.ok).toBe(true);
    if (!finalized.ok) return;
    expect(JSON.parse(JSON.stringify(finalized.scenario))).toEqual(JSON.parse(JSON.stringify(source)));
    const saved = repository.saveScenario(finalized.scenario, resumed.title ?? "", resumed.creator, resumed.mastermindHints);
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.value.mastermindHints).toBe(naughty.mastermindHints);
      expect(new UserScenarioRepository(storage).listScenarios()[0]?.scenario).toEqual(saved.value.scenario);
    }
  });
});
