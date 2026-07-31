import manualExamples from "./fixtures/manual-examples.json";

export function loadManualExamples() {
  return manualExamples;
}

export type ManualExamples = ReturnType<typeof loadManualExamples>;
export type ManualExampleCase = ManualExamples["cases"][number];
