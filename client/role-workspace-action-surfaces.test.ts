import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("role workspace action-surface audit", () => {
  const router = source("client/src/components/FunctionalWorkspace.tsx");
  const executive = source("client/src/components/workspaces/ExecutiveOverviewWorkspace.tsx");
  const fleetManager = source("client/src/components/workspaces/FleetManagerOverviewWorkspace.tsx");
  const resource = source("client/src/components/workspaces/ResourceWorkspace.tsx");
  const procurement = source("client/src/components/workspaces/ProcurementWorkspace.tsx");
  const mechanic = source("client/src/components/workspaces/MechanicExecutionWorkspace.tsx");
  const driver = source("client/src/components/workspaces/DriverWorkspace.tsx");
  const accountant = source("client/src/components/workspaces/AccountantWorkspace.tsx");

  it("keeps Superadmin command, people, compliance, finance, billing, and profile surfaces distinct", () => {
    expect(router).toContain('section === "Command center" ? <ExecutiveOverviewWorkspace');
    expect(router).toContain('section === "Team" ? <TeamWorkspace');
    expect(router).toContain('section === "Compliance vault" ? <ComplianceWorkspace');
    expect(router).toContain('section === "P&L analytics"');
    expect(router).toContain('section === "Billing" ? <BillingWorkspace');
    expect(executive).toContain("trpc.dashboard.summary.useQuery");
    expect(executive).toContain("trpc.audit.list.useQuery");
  });

  it("keeps Fleet Manager fleet signals, vehicle register, components, and work-order dispatch reachable", () => {
    expect(router).toContain('section === "Fleet manager workspace" ? <FleetManagerOverviewWorkspace');
    expect(router).toContain('section === "Vehicles" ? <VehicleRegisterWorkspace');
    expect(router).toContain('section === "Components" ? <ComponentLifecycleWorkspace');
    expect(router).toContain('section === "Work orders" ? <WorkOrderReviewWorkspace');
    expect(fleetManager).toContain("trpc.vehicles.list.useQuery");
    expect(fleetManager).toContain("trpc.components.list.useQuery");
    expect(fleetManager).toContain("trpc.workOrders.list.useQuery");
  });

  it("keeps Inventory Manager parts, vendors, and purchase orders as separate persisted operations", () => {
    expect(router).toContain('section === "Inventory" ? <ResourceWorkspace section="Inventory"');
    expect(router).toContain('section === "Vendors" ? <ResourceWorkspace section="Vendors"');
    expect(router).toContain('section === "Purchase orders" ? <ProcurementWorkspace />');
    expect(resource).toContain("trpc.inventory.create.useMutation");
    expect(resource).toContain("trpc.vendors.create.useMutation");
    expect(procurement).toContain("trpc.purchaseOrders.create.useMutation");
    expect(procurement).toContain("trpc.purchaseOrders.receivePartial.useMutation");
  });

  it("keeps Mechanic and Technician execution roles on the assigned-work completion and parts-reservation surface", () => {
    expect(router).toContain('section === "Mechanic workspace" || section === "Mechanic / Technician workspace"');
    expect(router).toContain('section === "Technician workspace" ? <MechanicExecutionWorkspace');
    expect(router).toContain('role="TECHNICIAN"');
    expect(mechanic).toContain("trpc.workOrders.startWork.useMutation");
    expect(mechanic).toContain("trpc.workOrders.complete.useMutation");
    expect(mechanic).toContain("trpc.workOrders.reservePart.useMutation");
  });

  it("keeps Driver odometer, inspection, fuel, and issue-reporting actions available", () => {
    expect(router).toContain('section === "Driver portal" ? <DriverWorkspace');
    expect(driver).toContain("trpc.vehicles.updateOdometer.useMutation");
    expect(driver).toContain("trpc.driver.createInspection.useMutation");
    expect(driver).toContain("trpc.driver.createFuelLog.useMutation");
    expect(driver).toContain("trpc.vehicleIssues.create.useMutation");
  });

  it("keeps Accountant ledger, reconciliation, reversal, and export actions authorized without the Superadmin queue", () => {
    expect(router).toContain('section === "Accountant ledger" || section === "P&L analytics"');
    expect(router).toContain('<AccountantWorkspace showApprovalQueue={section === "P&L analytics"} />');
    expect(accountant).toContain("trpc.financials.create.useMutation");
    expect(accountant).toContain("trpc.financials.reconcileRecord.useMutation");
    expect(accountant).toContain("trpc.financials.reverse.useMutation");
    expect(accountant).toContain("trpc.financials.exportCsv.useQuery");
    expect(accountant).toContain("enabled: showApprovalQueue");
  });
});
