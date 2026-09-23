import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const roleWorkspaces = readFileSync("client/src/components/RoleWorkspaces.tsx", "utf8");
const functionalWorkspace = readFileSync("client/src/components/FunctionalWorkspace.tsx", "utf8");
const home = readFileSync("client/src/pages/Home.tsx", "utf8");
const marketing = readFileSync("client/src/pages/MarketingPages.tsx", "utf8");
const team = readFileSync("client/src/components/workspaces/TeamWorkspace.tsx", "utf8");
const driver = readFileSync("client/src/components/workspaces/DriverWorkspace.tsx", "utf8");
const accountant = readFileSync("client/src/components/workspaces/AccountantWorkspace.tsx", "utf8");
const mechanic = readFileSync("client/src/components/workspaces/MechanicExecutionWorkspace.tsx", "utf8");
const notifications = readFileSync("client/src/components/workspaces/NotificationWorkspace.tsx", "utf8");
const executive = readFileSync("client/src/components/workspaces/ExecutiveOverviewWorkspace.tsx", "utf8");
const procurement = readFileSync("client/src/components/workspaces/ProcurementWorkspace.tsx", "utf8");
const billing = readFileSync("client/src/components/workspaces/BillingWorkspace.tsx", "utf8");
const compliance = readFileSync("client/src/components/workspaces/ComplianceWorkspace.tsx", "utf8");
const fleetManagerOverview = readFileSync("client/src/components/workspaces/FleetManagerOverviewWorkspace.tsx", "utf8");
const styles = `${readFileSync("client/src/index.css", "utf8")}\n${readFileSync("client/src/frontend-replacement.css", "utf8")}\n${readFileSync("client/src/accountant-replacement.css", "utf8")}\n${readFileSync("client/src/driver-replacement.css", "utf8")}\n${readFileSync("client/src/mechanic-replacement.css", "utf8")}\n${readFileSync("client/src/team-replacement.css", "utf8")}\n${readFileSync("client/src/notification-replacement.css", "utf8")}\n${readFileSync("client/src/executive-replacement.css", "utf8")}\n${readFileSync("client/src/procurement-replacement.css", "utf8")}\n${readFileSync("client/src/billing-replacement.css", "utf8")}\n${readFileSync("client/src/compliance-replacement.css", "utf8")}\n${readFileSync("client/src/fleet-manager-overview-replacement.css", "utf8")}`;

describe("VahanSync 2026 workspace UI contract", () => {
  it("gives every role a distinct header and surface class", () => {
    expect(roleWorkspaces).toContain("role-${role.toLowerCase()}");
    for (const surface of ["role-superadmin-surface", "role-fleet-manager-surface", "role-inventory-manager-surface", "role-${role.toLowerCase()}-surface", "role-driver-surface", "role-accountant-surface"]) {
      expect(roleWorkspaces).toContain(surface);
    }
    expect(roleWorkspaces).toContain("replacement-role-kpi");
    expect(roleWorkspaces).toContain("replacement-role-hero");
  });

  it("creates a stable section class for every authenticated functional page", () => {
    expect(functionalWorkspace).toContain("sectionClass = section.toLowerCase().replace");
    for (const section of ["Vehicles", "Components", "Work orders", "Team"]) {
      expect(functionalWorkspace).toContain(`section === \"${section}\"`);
    }
    for (const snippet of ["Inventory:", "Vendors:", "\"Purchase orders\":", "Notifications:", "\"P&L analytics\":", "Billing:"]) {
      expect(functionalWorkspace).toContain(snippet);
    }
  });

  it("defines modern page-specific surfaces and accessible motion behavior", () => {
    for (const selector of [".replacement-role-hero", ".replacement-role-kpi", ".replacement-vehicle-grid", ".replacement-component-grid", ".functional-workspace.vehicles", ".functional-workspace.work-orders", ".functional-workspace.inventory", ".functional-workspace.billing", "prefers-reduced-motion", ".marketing-footer", ".workspace-nav", ".nav-group", ".brand-mark-route", ".workspace-header-foot", ".role-journey"]) {
      expect(styles).toContain(selector);
    }
  });

  it("keeps role-aware command surfaces and identity language singular", () => {
    expect(home).toContain("const navGroups");
    expect(home).toContain("roleDescriptor");
    expect(home).toContain("OperationsFrame");
    expect(home).toContain("brand-mark-route");
    expect(marketing).toContain("BrandMark");
    expect(marketing).toContain("marketing-brand-mark");
    expect(marketing).not.toContain("brand-mark-glyph");
  });

  it("gives governance, driver, and finance workspaces first-class operational signals", () => {
    expect(team).toContain("governance-signal-grid");
    expect(team).toContain("activeRoles");
    expect(driver).toContain("driver-signal-strip");
    expect(driver).toContain("issueDraftStatus");
    expect(accountant).toContain("replacement-finance-signals");
    expect(accountant).toContain("mismatchCount");
    expect(styles).toContain(".governance-signal-grid");
    expect(styles).toContain(".driver-signal-strip");
    expect(styles).toContain(".replacement-finance-signals");
  });

  it("routes active specialist pages through dedicated replacement compositions", () => {
    expect(functionalWorkspace).toContain("MechanicExecutionWorkspace");
    expect(functionalWorkspace).toContain("ExecutiveOverviewWorkspace");
    expect(functionalWorkspace).toContain("FleetManagerOverviewWorkspace");
    expect(functionalWorkspace).toContain("NotificationWorkspace");
    expect(functionalWorkspace).toContain("ProcurementWorkspace");
    expect(mechanic).toContain("replacement-mechanic-execution");
    expect(mechanic).toContain("workOrders.reservePart.useMutation");
    expect(team).toContain("replacement-team-governance");
    expect(notifications).toContain("replacement-notification-center");
    expect(executive).toContain("replacement-executive-overview");
    expect(executive).toContain("trpc.audit.list.useQuery");
    expect(procurement).toContain("replacement-procurement");
    expect(procurement).toContain("purchaseOrders.receivePartial.useMutation");
    expect(billing).toContain("replacement-billing");
    expect(billing).toContain("billingTest.activateStarter.useMutation");
    expect(compliance).toContain("replacement-compliance");
    expect(compliance).toContain("trpc.documents.versions.useQuery");
    expect(fleetManagerOverview).toContain("replacement-fleet-overview");
    expect(fleetManagerOverview).toContain("trpc.planning.maintenance.useQuery");
    for (const selector of [".replacement-mechanic-execution", ".replacement-team-governance", ".replacement-notification-center", ".replacement-executive-overview", ".replacement-procurement", ".replacement-billing", ".replacement-compliance", ".replacement-fleet-overview"]) {
      expect(styles).toContain(selector);
    }
  });
});
