import { describe, expect, it } from "vitest";
import { camelize, financeResponse, mutationMethod, mutationPath, queryPath, serializeInput } from "./trpc";

describe("audited workspace transport", () => {
  it("sends an Accountant entry using a local date and integer paise", () => {
    expect(serializeInput("financials.create", {
      vehicleId: "42",
      type: "EXPENSE",
      category: "FUEL",
      amount: 123.45,
      transactionDate: new Date(2026, 0, 5),
      taxAmount: 10.50,
      tdsAmount: 1.20,
      invoiceNumber: "INV-42",
    })).toMatchObject({
      vehicle_id: "42",
      category: "FUEL",
      amount_paise: 12345,
      incurred_on: "2026-01-05",
      gst_amount_paise: 1050,
      tds_amount_paise: 120,
      invoice_number: "INV-42",
    });
  });

  it("adapts persisted ledger rows and approval queues without invalid amounts or dates", () => {
    const row = {
      id: 1, vehicle_id: 42, category: "FUEL", amount_paise: 12345,
      incurred_on: "2026-01-05", created_at: "2026-02-01T00:00:00Z",
      gst_amount_paise: 1050, tds_amount_paise: 120, status: "Pending",
    };
    const expected = {
      id: "1", vehicleId: "42", amount: 123.45, transactionDate: "2026-01-05",
      type: "EXPENSE", taxAmount: 10.50, tdsAmount: 1.20, approvalStatus: "Pending",
    };
    expect(financeResponse(camelize([row]))).toEqual([expect.objectContaining(expected)]);
    expect(financeResponse(camelize({ items: [row], total: 21 }))).toEqual({
      items: [expect.objectContaining(expected)], total: 21,
    });
    expect(financeResponse(camelize({ ...row, category: "FARE_REVENUE" }))).toMatchObject({ type: "REVENUE" });
  });

  it("uses the same selected filters for ledger, metrics, and complete exports", () => {
    const filters = {
      vehicleId: "42", type: "EXPENSE", category: "FUEL",
      from: "2026-01-01", to: "2026-01-31",
    };
    for (const path of ["financials.list", "financials.metrics", "financials.exportCsv", "financials.exportPdf"]) {
      const url = new URL(queryPath(path, filters), "https://example.test");
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        vehicle_id: "42", transaction_type: "EXPENSE", category: "FUEL",
        start_date: "2026-01-01", end_date: "2026-01-31",
      });
    }
    expect(queryPath("financials.list", { ...filters, skip: 20, limit: 20 })).toContain("skip=20&limit=20");
  });

  it("posts reconciliation evidence to the matching expense endpoint", () => {
    expect(mutationMethod("financials.reconcileRecord")).toBe("POST");
    expect(mutationPath("financials.reconcileRecord", { id: "42" })).toBe("/api/v1/expenses/42/reconcile");
    expect(serializeInput("financials.reconcileRecord", { id: "42", reconciliationRef: "BANK-42" }))
      .toEqual({ reconciliation_ref: "BANK-42" });
    expect(mutationPath("financials.reject", { id: "42" })).toBe("/api/v1/expenses/42/reject");
  });

  it("retains receipt price, invoice, and selected location", () => {
    expect(serializeInput("purchaseOrders.receivePartial", {
      purchaseOrderId: "3", partId: "4", quantity: 2, damagedQuantity: 1,
      backorderedQuantity: 3, unitCost: 123.45, invoiceNumber: "INV-3", location: "8",
    })).toMatchObject({
      items: [{
        part_id: "4", quantity: 2, damaged_quantity: 1,
        backordered_quantity: 3, unit_cost_paise: 12345,
        invoice_number: "INV-3", location_id: "8",
      }],
    });
  });

  it("uses persisted template IDs and task definitions", () => {
    expect(mutationPath("maintenanceTemplates.applyTemplate", { templateId: 42 }))
      .toBe("/api/v1/maintenance/templates/42/apply");
    expect(serializeInput("maintenanceTemplates.applyTemplate", { templateId: 42, vehicleId: "8" }))
      .toEqual({ vehicle_id: "8" });
    expect(serializeInput("maintenanceTemplates.create", {
      name: "Inspection", vehicleType: "All", intervalKm: 1000, tasks: ["Check tires"],
    })).toMatchObject({
      name: "Inspection", vehicle_type: "All", interval_km: 1000, tasks: ["Check tires"],
    });
  });
});
