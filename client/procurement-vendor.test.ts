import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./src/components/workspaces/ProcurementWorkspace.tsx", import.meta.url), "utf8");

describe("procurement workspace", () => {
  it("renders tenant-resolved vendor context and INR totals", () => {
    expect(source).toContain("order.vendor?.name ?? \"Vendor pending\"");
    expect(source).toContain("Number(order.totalCost).toLocaleString(\"en-IN\")");
    expect(source).toContain("purchaseOrders.list.useQuery");
  });

  it("shows receipt-backed vendor pricing history after vendor selection", () => {
    expect(source).toContain("trpc.vendors.pricingHistory.useQuery({ vendorId: selectedVendorId }");
    expect(source).toContain("Pricing history");
    expect(source).toContain("averageUnitCost");
    expect(source).toContain("setSelectedVendorId(event.target.value)");
  });

  it("keeps receipt controls connected to persisted purchase-order procedures", () => {
    expect(source).toContain("purchaseOrders.receivePartial.useMutation");
    expect(source).toContain("purchaseOrders.updateStatus.useMutation");
    expect(source).toContain("Receive into inventory");
    expect(source).toContain("Supplier invoice");
  });
});
