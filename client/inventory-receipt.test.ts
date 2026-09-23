import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const workspaceSource = readFileSync(new URL("./src/components/workspaces/ResourceWorkspace.tsx", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("../server/routers.ts", import.meta.url), "utf8");

describe("Inventory receipt workspace contract", () => {
  it("renders a persisted receipt form with INR cost and reason validation", () => {
    expect(workspaceSource).toContain("Inventory receiving");
    expect(workspaceSource).toContain("trpc.inventory.receive.useMutation");
    expect(workspaceSource).toContain("unitCost: receipt.unitCost ? Number(receipt.unitCost) : undefined");
    expect(workspaceSource).toContain("minLength={3}");
    expect(workspaceSource).toContain("₹");
    expect(workspaceSource).toContain("utils.inventory.list.invalidate()");
  });

  it("keeps receipt mutations role- and tenant-scoped", () => {
    expect(routerSource).toContain("receive: fleetOpsProcedure");
    expect(routerSource).toContain('requireRole(ctx.fleetopsUser.role, ["SUPERADMIN", "INVENTORY_MANAGER"])');
    expect(routerSource).toContain("orgId: ctx.fleetopsUser.orgId");
    expect(routerSource).toContain('movementType: "RECEIPT"');
  });
});

