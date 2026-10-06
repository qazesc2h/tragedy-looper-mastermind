import type { IncidentId, Location } from "../types";

export type IncidentTriggerPolicy =
  | {
    kind: "characterParanoia";
    requiresAlive: true;
    paranoiaLimitAdjustment: number;
  }
  | {
    kind: "characterIntrigue";
    requiresAlive: true;
    required: number | "paranoiaLimit";
  }
  | { kind: "deadCharacter" }
  | { kind: "locationIntrigue"; required: number }
  | { kind: "locationCorpseCount"; required: number };

export type IncidentChoiceSchemaEntry =
  | { kind: "character"; key: "target" | "otherTarget" }
  | { kind: "location"; key: "location" }
  | { kind: "counter"; key: "counter" }
  | { kind: "destination"; key: "destination" }
  | { kind: "incident"; key: "incident"; incidents: readonly IncidentId[] }
  | { kind: "role"; key: "roleClaim" }
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
  serialMurder: {
    allowsRepeatedCulprit: true,
    choiceSchema: [CHARACTER("target")],
  },
  conspiracies: {
    triggerPolicy: {
      kind: "characterIntrigue",
      requiresAlive: true,
      required: "paranoiaLimit",
    },
    choiceSchema: [
      { kind: "incident", key: "incident", incidents: ["serialMurder", "missingPerson"] },
      CHARACTER("target"),
      { kind: "location", key: "location" },
    ],
  },
  breakthrough: {
    choiceSchema: [CHARACTER("target"), { kind: "location", key: "location" }],
  },
  confession: { choiceSchema: [{ kind: "role", key: "roleClaim" }] },
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
