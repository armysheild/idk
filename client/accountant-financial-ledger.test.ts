import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const ui = fs.readFileSync(path.join(root, "client/src/components/workspaces/AccountantWorkspace.tsx"), "utf8");
const router = fs.readFileSync(path.join(root, "server/routers.ts"), "utf8");

describe("Accountant financial ledger", () => {
  it("renders a complete INR financial-entry form and transaction ledger", () => {
    expect(ui).toContain("Add financial record");
    expect(ui).toContain("Record type");
    expect(ui).toContain("Category");
    expect(ui).toContain("Amount (₹)");
    expect(ui).toContain("Transaction date");
    expect(ui).toContain("Financial ledger");
    expect(ui).toContain("trpc.financials.create");
    expect(ui).toContain("trpc.financials.list");
    expect(ui).toContain("Tenant-scoped records");
    expect(ui).toContain("trpc.financials.exportCsv");
    expect(ui).toContain("Export CSV");
    expect(ui).toContain("trpc.financials.exportPdf");
    expect(ui).toContain("Export PDF");
  });

  it("renders tenant-scoped ledger filters and a clear-filter action", () => {
    expect(ui).toContain("Filter ledger vehicle");
    expect(ui).toContain("Filter ledger type");
    expect(ui).toContain("Filter ledger category");
    expect(ui).toContain("Ledger date from");
    expect(ui).toContain("Clear filters");
    expect(ui).toContain("filteredRecords");
  });

  it("keeps financial procedures restricted to Accountant and Superadmin", () => {
    expect(router).toContain("financials: router({");
    expect(router).toContain('requireRole(ctx.fleetopsUser.role, ["SUPERADMIN", "ACCOUNTANT"])');
    expect(router).toContain('type: z.enum(["REVENUE", "EXPENSE"])');
    expect(router).toContain("transactionDate: z.coerce.date()");
    expect(router).toContain("orgId: ctx.fleetopsUser.orgId");
    expect(router).toContain("FINANCIAL_EXPORT_CSV");
    expect(router).toContain("amountInr");
    expect(router).toContain("FINANCIAL_EXPORT_PDF");
    expect(router).toContain("simplePdf");
  });

  it("keeps the Superadmin-only approval queue out of the Accountant workspace request path", () => {
    const functionalWorkspace = fs.readFileSync(path.join(root, "client/src/components/FunctionalWorkspace.tsx"), "utf8");
    expect(ui).toContain("showApprovalQueue = false");
    expect(ui).toContain("enabled: showApprovalQueue");
    expect(ui).toContain("showApprovalQueue && <article>");
    expect(functionalWorkspace).toContain('<AccountantWorkspace showApprovalQueue={section === "P&L analytics"} />');
    expect(router).toContain('requireRole(ctx.fleetopsUser.role, ["SUPERADMIN"])');
  });
});
