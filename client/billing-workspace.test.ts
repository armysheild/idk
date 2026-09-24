import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const resourceWorkspace = fs.readFileSync(path.resolve(process.cwd(), "client/src/components/workspaces/ResourceWorkspace.tsx"), "utf8");
const router = fs.readFileSync(path.resolve(process.cwd(), "backend/app/routes.py"), "utf8");

describe("Billing workspace contract", () => {
  it("connects the live plan, usage, overage, and invoice queries", () => {
    expect(resourceWorkspace).toContain("trpc.billing.status.useQuery");
    expect(resourceWorkspace).toContain("trpc.billing.invoices.useQuery");
    expect(resourceWorkspace).toContain("trpc.billing.plans.useQuery");
    expect(resourceWorkspace).toContain("estimatedSubtotalPaise");
    expect(resourceWorkspace).toContain("overageVehicles");
    expect(resourceWorkspace).toContain("Invoice history");
  });

  it("keeps billing payment execution explicitly disabled", () => {
    expect(router).toContain('@router.get("/subscription"');
    expect(router).toContain('@router.get("/subscription/plans"');
    expect(router).toContain('@router.get("/billing/invoices"');
  });
});
