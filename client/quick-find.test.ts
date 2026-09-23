import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const homeSource = readFileSync(resolve(process.cwd(), "client/src/pages/Home.tsx"), "utf8");

describe("Quick Find operational search", () => {
  it("searches inventory and financial records from live role-permitted data", () => {
    expect(homeSource).toContain('type: "Inventory"');
    expect(homeSource).toContain('type: "Financial record"');
    expect(homeSource).toContain("liveInventory");
    expect(homeSource).toContain("liveFinancials");
  });

  it("routes search results to their corresponding workspaces", () => {
    expect(homeSource).toContain('result.type === "Inventory" ? "Inventory"');
    expect(homeSource).toContain('result.type === "Financial record" ? "Accountant ledger"');
    expect(homeSource).toContain('result.type === "Vehicle" ? "Vehicles"');
  });
});
