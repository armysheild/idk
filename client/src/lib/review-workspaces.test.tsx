import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { camelize, financeResponse } from "./trpc";
import Home from "@/pages/Home";
import { ProcurementWorkspace } from "@/components/workspaces/ProcurementWorkspace";

const state = vi.hoisted(() => ({
  ledger: { items: [] as unknown[], total: 23, skip: 0, limit: 20 },
  orderStatus: "Received",
}));

vi.mock("@/hooks/useFleetOpsAuth", () => ({
  useFleetOpsAuth: () => ({
    loading: false,
    session: { user: { id: "test-owner", email: "owner@example.test", user_metadata: {} } },
  }),
}));
vi.mock("@/hooks/useFleetOpsRealtime", () => ({ useFleetOpsRealtime: () => undefined }));
vi.mock("@/components/FunctionalWorkspace", () => ({ default: () => null }));
vi.mock("@/pages/LandingPage", () => ({ default: () => null }));
vi.mock("@/lib/trpc", async (importOriginal) => {
  const original = await importOriginal<typeof import("./trpc")>();
  const list = { useQuery: () => ({ data: [], isLoading: false, isError: false }) };
  const mutation = { useMutation: () => ({ isPending: false }) };
  return {
    ...original,
    trpc: {
      useUtils: () => ({}),
      dashboard: { summary: { useQuery: () => ({}) } },
      vehicles: { list },
      workOrders: { list, complete: mutation },
      inventory: { list, locations: list },
      notifications: { list },
      activity: { recent: list },
      billing: { status: { useQuery: () => ({}) } },
      financials: {
        list: { useQuery: () => ({ data: state.ledger }) },
        metrics: { useQuery: () => ({ data: { totals: { expenses: 2400 } } }) },
      },
      purchaseOrders: {
        list: { useQuery: () => ({ data: [{ id: "1", status: state.orderStatus, totalCost: 100, lines: [] }] }) },
        updateStatus: mutation, receivePartial: mutation, create: mutation,
      },
      vendors: { list, pricingHistory: list, create: mutation, update: mutation },
    },
  };
});

describe("reviewed workspace contracts", () => {
  it.each(["SUPERADMIN", "ACCOUNTANT"])("renders %s with a paginated finance response", (role) => {
    const mapped = financeResponse(camelize({
      items: [{ id: 1, category: "FUEL", amount_paise: 10000, incurred_on: "2026-01-05", status: "Pending" }],
      total: 23, skip: 0, limit: 20,
    })) as typeof state.ledger;
    state.ledger = mapped;
    const html = renderToStaticMarkup(<Home initialSummary={{ role, org: { name: "Test fleet" } }} />);
    expect(html).toContain("₹2,400");
    expect(html).not.toContain("₹100</");
  });

  it.each(["Received", "Closed", "Cancelled"])("disables the %s purchase-order status selector", (status) => {
    state.orderStatus = status;
    const html = renderToStaticMarkup(<ProcurementWorkspace />);
    const selector = html.match(/<select aria-label="Update purchase order 1"[^>]*>/)?.[0];
    expect(selector).toContain("disabled");
  });

  it("allows an active purchase-order status selector", () => {
    state.orderStatus = "Submitted";
    const html = renderToStaticMarkup(<ProcurementWorkspace />);
    const selector = html.match(/<select aria-label="Update purchase order 1"[^>]*>/)?.[0];
    expect(selector).toBeDefined();
    expect(selector).not.toContain("disabled");
  });
});
