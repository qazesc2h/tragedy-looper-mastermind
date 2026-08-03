import koTranslationsJson from "../data/ko-translations.json";
import { INCIDENT_IMPL } from "../src/impl/incidents";
import { PLOT_IMPL } from "../src/impl/plots";
import { ROLE_IMPL } from "../src/impl/roles";
import { describe, expect, it } from "vitest";

const translations = koTranslationsJson as unknown as Record<string, string>;

describe("root Korean translation dictionary", () => {
  it("preserves all source keys and their filled/empty state", () => {
    expect(Object.keys(translations)).toHaveLength(1098);
    expect(Object.values(translations).filter(Boolean)).toHaveLength(917);
  });

  it("translates every base role, incident and plot effect description", () => {
    const implementations = [ROLE_IMPL, INCIDENT_IMPL, PLOT_IMPL];
    const descriptions = implementations.flatMap((records) =>
      Object.values(records).flatMap(({ hooks }) =>
        hooks.flatMap(({ source }) => source.description ?? [])
      )
    );

    expect(descriptions.length).toBeGreaterThan(0);
    for (const description of descriptions) {
      expect(translations[description], description).toBeTruthy();
    }
  });

  it("reports the one untranslated base hook prerequisite", () => {
    const prerequisites = [ROLE_IMPL, INCIDENT_IMPL, PLOT_IMPL].flatMap(
      (records) => Object.values(records).flatMap(({ hooks }) =>
        hooks.flatMap(({ source }) => source.prerequisite ?? [])
      ),
    );
    expect(prerequisites.filter((source) => !translations[source])).toEqual([
      "This role has been revealed",
    ]);
  });
});
