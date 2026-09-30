import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const workspaceSource = readFileSync(
  new URL("./src/components/workspaces/ComponentLifecycleWorkspace.tsx", import.meta.url),
  "utf8",
);
const transportSource = readFileSync(
  new URL("./src/lib/trpc.ts", import.meta.url),
  "utf8",
);

describe("component lifecycle editing", () => {
  it("normalizes API identifiers before matching the edit selector", () => {
    expect(workspaceSource).toContain("id: String(component.id)");
    expect(workspaceSource).toContain("vehicleId: String(component.vehicleId)");
  });

  it("serializes the edited service odometer", () => {
    expect(transportSource).toContain(
      "last_service_km: value.lastServiceKm ?? value.lastServicedOdometer",
    );
  });
});
