export interface InferenceTraceReason {
  type: string;
  at: string;
  fact: string;
  detail?: string;
}

export interface InferenceTrace {
  conclusion: string;
  condition?: string;
  reason: InferenceTraceReason;
}

export interface InferenceTraceFactGroup {
  fact: string;
  occurrences: string[];
}

export interface InferenceTraceReasonTypeGroup {
  type: string;
  facts: InferenceTraceFactGroup[];
}

export interface InferenceTraceGroup {
  conclusion: string;
  condition?: string;
  reasons: InferenceTraceReason[];
  reasonTypes: InferenceTraceReasonTypeGroup[];
}

function conclusionKey(trace: InferenceTrace): string {
  return JSON.stringify([trace.conclusion, trace.condition ?? ""]);
}

function reasonKey(reason: InferenceTraceReason): string {
  return JSON.stringify([
    reason.type,
    reason.at,
    reason.fact,
    reason.detail ?? "",
  ]);
}

function groupReasonTypes(
  reasons: readonly InferenceTraceReason[],
): InferenceTraceReasonTypeGroup[] {
  const types = new Map<string, Map<string, string[]>>();
  for (const reason of reasons) {
    const facts = types.get(reason.type) ?? new Map<string, string[]>();
    const occurrences = facts.get(reason.fact) ?? [];
    if (reason.at !== "" && !occurrences.includes(reason.at)) {
      occurrences.push(reason.at);
    }
    facts.set(reason.fact, occurrences);
    types.set(reason.type, facts);
  }
  return [...types].map(([type, facts]) => ({
    type,
    facts: [...facts].map(([fact, occurrences]) => ({ fact, occurrences })),
  }));
}

/** 같은 결론과 같은 조건의 추론을 하나로 묶고 근거 원문은 모두 보존한다. */
export function groupInferenceTraces(
  traces: readonly InferenceTrace[],
): InferenceTraceGroup[] {
  const groups = new Map<string, {
    conclusion: string;
    condition?: string;
    reasons: InferenceTraceReason[];
    reasonKeys: Set<string>;
  }>();

  for (const trace of traces) {
    const key = conclusionKey(trace);
    const group = groups.get(key) ?? {
      conclusion: trace.conclusion,
      ...(trace.condition === undefined ? {} : { condition: trace.condition }),
      reasons: [],
      reasonKeys: new Set<string>(),
    };
    const keyForReason = reasonKey(trace.reason);
    if (!group.reasonKeys.has(keyForReason)) {
      group.reasons.push(trace.reason);
      group.reasonKeys.add(keyForReason);
    }
    groups.set(key, group);
  }

  return [...groups.values()].map(({ reasonKeys: _reasonKeys, ...group }) => ({
    ...group,
    reasonTypes: groupReasonTypes(group.reasons),
  }));
}
