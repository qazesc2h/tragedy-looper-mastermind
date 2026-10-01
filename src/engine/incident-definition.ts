import type { IncidentId, Location } from "../types";

export type IncidentTriggerPolicy =
  | {
    kind: "characterParanoia";
    requiresAlive: true;
    paranoiaLimitAdjustment: number;
  }
  | { kind: "characterIntrigue"; requiresAlive: true; required: number }
  | { kind: "deadCharacter" }
  | { kind: "locationIntrigue"; required: number }
  | { kind: "locationCorpseCount"; required: number };

export type IncidentChoiceSchemaEntry =
  | { kind: "character"; key: "target" | "otherTarget" }
  | { kind: "location"; key: "location" }
  | { kind: "counter"; key: "counter" }
  | { kind: "destination"; key: "destination" }
  | {
    kind: "subIncident";
    key: "secondResolution";
    schema: readonly IncidentChoiceSchemaEntry[];
  };

export interface IncidentDefinition {
  triggerPolicy: IncidentTriggerPolicy;
  allowsRepeatedCulprit: boolean;
  culpritKind: "character" | "location";
  choiceSchema: readonly IncidentChoiceSchemaEntry[];
}

const DEFAULT_DEFINITION: IncidentDefinition = {
  triggerPolicy: {
    kind: "characterParanoia",
    requiresAlive: true,
    paranoiaLimitAdjustment: 0,
  },
  allowsRepeatedCulprit: false,
  culpritKind: "character",
  choiceSchema: [],
};

const CHARACTER = (key: "target" | "otherTarget"): IncidentChoiceSchemaEntry => ({
  kind: "character",
  key,
});

const INCIDENT_DEFINITION_OVERRIDES: Readonly<
  Record<string, Partial<IncidentDefinition>>
> = {
  butterflyEffect: {
    choiceSchema: [CHARACTER("target"), { kind: "counter", key: "counter" }],
  },
  farawayMurder: { choiceSchema: [CHARACTER("target")] },
  increasingUnease: {
    choiceSchema: [CHARACTER("target"), CHARACTER("otherTarget")],
  },
  missingPerson: { choiceSchema: [{ kind: "location", key: "location" }] },
  murder: { choiceSchema: [CHARACTER("target")] },
  spreading: {
    choiceSchema: [CHARACTER("target"), CHARACTER("otherTarget")],
  },
};

/**
 * 미지원 세트의 사건은 해당 세트 구현 때 이 레지스트리에 명시한다.
 * serialMurder도 아직 등록하지 않아 반복 범인 허용은 현재 모두 false다.
 */
export function incidentDefinition(incident: IncidentId): IncidentDefinition {
  const override = INCIDENT_DEFINITION_OVERRIDES[incident];
  return {
    ...DEFAULT_DEFINITION,
    ...override,
    triggerPolicy: override?.triggerPolicy === undefined
      ? { ...DEFAULT_DEFINITION.triggerPolicy }
      : structuredClone(override.triggerPolicy),
    choiceSchema: override?.choiceSchema ?? [],
  };
}

export function incidentCulpritLocations(
  definition: IncidentDefinition,
): readonly Location[] {
  return definition.culpritKind === "location"
    ? ["Hospital", "Shrine", "City", "School"]
    : [];
}
