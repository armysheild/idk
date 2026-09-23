import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./src/components/workspaces/OrganizationSettingsWorkspace.tsx", import.meta.url), "utf8");

describe("organization labor-rate settings", () => {
  it("loads the persisted labor rate into the settings form", () => {
    expect(source).toContain('laborRatePerHour: "0"');
    expect(source).toContain("settings.data.laborRatePerHour ?? 0");
  });

  it("persists a non-negative INR hourly rate through the settings mutation", () => {
    expect(source).toContain('Internal labor rate (₹ / hour)');
    expect(source).toContain('type="number" min="0" step="0.01"');
    expect(source).toContain("laborRatePerHour: Number(form.laborRatePerHour)");
  });
});
