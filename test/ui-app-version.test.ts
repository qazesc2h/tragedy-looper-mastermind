import { describe, expect, it } from "vitest";

import { APP_VERSION } from "../src/ui/app-version";

describe("app build version", () => {
  it("exposes the package version for the UI", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(?:[-+].+)?$/);
  });
});
