import { describe, expect, it } from "vitest";

import { INCIDENT_IMPL } from "../src/impl/incidents";
import { PLOT_IMPL } from "../src/impl/plots";
import { ROLE_IMPL } from "../src/impl/roles";

function sourceTimings(
  owner: { hooks: Array<{ source: { timing: string } }> },
): string[] {
  return owner.hooks.map(({ source }) => source.timing);
}

describe("public loss timing contracts", () => {
  it("keeps every loss-related role aligned with its source timing", () => {
    expect(sourceTimings(ROLE_IMPL.keyPerson)).toEqual(["Always"]);
    expect(sourceTimings(ROLE_IMPL.killer)).toEqual(["Day End", "Day End"]);
    expect(sourceTimings(ROLE_IMPL.timeTraveler)).toEqual([
      "Card resolve",
      "Day End, Last Day",
    ]);
    expect(sourceTimings(ROLE_IMPL.friend)).toEqual([
      "Loop End",
      "Loop Start",
    ]);
    expect(sourceTimings(ROLE_IMPL.lovedOne)).toEqual([
      "Always",
      "Day End",
    ]);
    expect(sourceTimings(ROLE_IMPL.serialKiller)).toEqual(["Day End"]);
  });

  it("keeps every plot loss at loop end", () => {
    const lossTimings = Object.values(PLOT_IMPL).flatMap(({ hooks }) =>
      hooks.flatMap((hook) =>
        hook.kind === "lossTragedy" ? [hook.source.timing] : []
      )
    );

    expect(lossTimings.length).toBeGreaterThan(0);
    expect(new Set(lossTimings)).toEqual(new Set(["Loop End"]));
  });

  it("keeps incident effects behind the incident resolver boundary", () => {
    const incidentHooks = Object.values(INCIDENT_IMPL).flatMap(({ hooks }) =>
      hooks
    );

    expect(incidentHooks.length).toBeGreaterThan(0);
    expect(new Set(incidentHooks.map(({ phase }) => phase))).toEqual(
      new Set(["ALWAYS"]),
    );
    expect(new Set(incidentHooks.map(({ source }) => source.timing))).toEqual(
      new Set(["Always"]),
    );
  });
});
