import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canAccessWorkspace, dedicatedWorkspaceByRole, getAllowedWorkspace, roleNavAccess } from "./src/workspaceAccess";

describe("role workspace boundaries", () => {
  it("routes every supported role to one dedicated workspace", () => {
    expect(dedicatedWorkspaceByRole).toEqual({
      SUPERADMIN: "Command center",
      FLEET_MANAGER: "Fleet manager workspace",
      INVENTORY_MANAGER: "Inventory manager workspace",
      MECHANIC: "Mechanic workspace",
      TECHNICIAN: "Technician workspace",
      DRIVER: "Driver portal",
      ACCOUNTANT: "Accountant ledger",
    });
  });

  it("keeps specialist and operational-only workspaces unavailable to Superadmin navigation", () => {
    expect(canAccessWorkspace("SUPERADMIN", "Command center")).toBe(true);
    expect(canAccessWorkspace("SUPERADMIN", "Work orders")).toBe(false);
    expect(canAccessWorkspace("SUPERADMIN", "Notifications")).toBe(true);
    expect(canAccessWorkspace("SUPERADMIN", "Billing")).toBe(true);
    expect(canAccessWorkspace("SUPERADMIN", "Team")).toBe(true);
    for (const section of ["Fleet manager workspace", "Inventory manager workspace", "Driver portal", "Accountant ledger", "Vehicles", "Components", "Inventory", "Vendors", "Purchase orders"]) {
      expect(canAccessWorkspace("SUPERADMIN", section)).toBe(false);
    }
  });

  it("keeps each member within their role-specific workspace surface", () => {
    expect(roleNavAccess.FLEET_MANAGER).toEqual(["Fleet manager workspace", "Vehicles", "Components", "Work orders", "Notifications", "Profile"]);
    expect(roleNavAccess.INVENTORY_MANAGER).toEqual(["Inventory manager workspace", "Inventory", "Vendors", "Purchase orders", "Notifications", "Profile"]);
    for (const role of ["MECHANIC", "TECHNICIAN", "DRIVER", "ACCOUNTANT"]) {
      const workspace = dedicatedWorkspaceByRole[role];
      expect(roleNavAccess[role]).toEqual([workspace, "Notifications", "Profile"]);
      expect(getAllowedWorkspace(role, "Command center")).toBe(workspace);
      expect(getAllowedWorkspace(role, "Billing")).toBe(workspace);
    }
    expect(getAllowedWorkspace("FLEET_MANAGER", "Inventory")).toBe("Fleet manager workspace");
    expect(getAllowedWorkspace("INVENTORY_MANAGER", "Work orders")).toBe("Inventory manager workspace");
  });

  it("keeps Inventory Manager dashboard, parts, vendors, and purchase orders as distinct functional surfaces", () => {
    const routerSource = readFileSync(resolve(process.cwd(), "client/src/components/FunctionalWorkspace.tsx"), "utf8");
    const resourceSource = readFileSync(resolve(process.cwd(), "client/src/components/workspaces/ResourceWorkspace.tsx"), "utf8");
    expect(routerSource).toContain('section === "Inventory manager workspace" ? <InventoryControlWorkspace />');
    expect(routerSource).toContain('section === "Inventory" ? <ResourceWorkspace section="Inventory"');
    expect(routerSource).toContain('section === "Vendors" ? <ResourceWorkspace section="Vendors"');
    expect(routerSource).toContain('section === "Purchase orders" ? <ProcurementWorkspace />');
    expect(routerSource).not.toContain('(section === "Vendors" || section === "Purchase orders") ? <ProcurementWorkspace />');
    expect(resourceSource).toContain('trpc.inventory.create.useMutation');
    expect(resourceSource).toContain('Add part to inventory');
    expect(resourceSource).toContain('trpc.vendors.create.useMutation');
    expect(resourceSource).not.toContain('if (section === "Inventory") return <InventoryManagerWorkspace />');
  });

  it("gives every role-permitted navigation label an explicit authenticated workspace route", () => {
    const routerSource = readFileSync(resolve(process.cwd(), "client/src/components/FunctionalWorkspace.tsx"), "utf8");
    const routes = [
      'section === "Command center" ? <ExecutiveOverviewWorkspace',
      'section === "Fleet manager workspace" ? <FleetManagerOverviewWorkspace',
      'section === "Inventory manager workspace" ? <InventoryControlWorkspace',
      'section === "Mechanic workspace" || section === "Mechanic / Technician workspace"',
      'section === "Technician workspace" ? <MechanicExecutionWorkspace',
      'section === "Driver portal" ? <DriverWorkspace',
      'section === "Accountant ledger" || section === "P&L analytics"',
      'section === "Inventory" ? <ResourceWorkspace',
      'section === "Vendors" ? <ResourceWorkspace',
      'section === "Purchase orders" ? <ProcurementWorkspace',
      'section === "Compliance vault" ? <ComplianceWorkspace',
      'section === "Billing" ? <BillingWorkspace',
      'section === "Team" ? <TeamWorkspace',
      'section === "Notifications" ? <NotificationWorkspace',
      'section === "Profile" ? <ProfileWorkspace',
    ];
    routes.forEach((route) => expect(routerSource).toContain(route));
  });

  it("makes Profile and sign out available as universal member controls", () => {
    const workspaceSource = readFileSync(resolve(process.cwd(), "client/src/components/FunctionalWorkspace.tsx"), "utf8");
    const profileSource = readFileSync(resolve(process.cwd(), "client/src/components/workspaces/ProfileWorkspace.tsx"), "utf8");
    const frameSource = readFileSync(resolve(process.cwd(), "client/src/components/operations/OperationsFrame.tsx"), "utf8");
    for (const role of Object.keys(dedicatedWorkspaceByRole)) expect(canAccessWorkspace(role, "Profile")).toBe(true);
    expect(workspaceSource).toContain('section === "Profile"');
    expect(profileSource).toContain("Sign out of VahanSync");
    expect(profileSource).toContain("smsAlertsEnabled");
    expect(profileSource).toContain("whatsappAlertsEnabled");
    expect(frameSource).toContain("operations-profile-trigger");
    expect(frameSource).toContain("Profile &amp; preferences");
    expect(frameSource).toContain("Sign out of VahanSync");
  });

  it("removes static tenant labels and unauthorized owner actions from the authenticated shell", () => {
    const homeSource = readFileSync(resolve(process.cwd(), "client/src/pages/Home.tsx"), "utf8");
    const teamSource = readFileSync(resolve(process.cwd(), "client/src/components/workspaces/TeamWorkspace.tsx"), "utf8");
    expect(homeSource).not.toContain("Avani Transit");
    expect(homeSource).not.toContain('onClick={() => setActiveNav("Work orders")}>New work order');
    expect(teamSource).toContain('team.members.useQuery(undefined, { enabled, retry: false })');
    expect(teamSource).toContain('team.invitations.useQuery(undefined, { enabled, retry: false })');
  });

  it("exposes the persisted Fleet register, component, inventory, vendor, and procurement flows", () => {
    const resourceSource = readFileSync(resolve(process.cwd(), "client/src/components/workspaces/ResourceWorkspace.tsx"), "utf8");
    const routerSource = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");
    const procurementSource = readFileSync(resolve(process.cwd(), "client/src/components/workspaces/ProcurementWorkspace.tsx"), "utf8");
    expect(resourceSource).toContain("trpc.vehicles.create.useMutation");
    expect(resourceSource).toContain("Maintenance template");
    expect(resourceSource).toContain("utils.vehicles.list.invalidate()");
    expect(resourceSource).toContain("trpc.components.create.useMutation");
    expect(resourceSource).toContain("Installation odometer");
    expect(resourceSource).toContain("trpc.inventory.create.useMutation");
    expect(resourceSource).toContain("trpc.vendors.create.useMutation");
    expect(procurementSource).toContain("Create purchase order");
    expect(routerSource).toContain("create: fleetOpsProcedure.input(z.object({ vin:");
    expect(routerSource).toContain('requireRole(ctx.fleetopsUser.role, ["SUPERADMIN", "FLEET_MANAGER"])');
    expect(routerSource).toContain("vendors: router({");
    expect(routerSource).toContain("VENDOR_CREATED");
  });

  it("allows only the matching named specialist route", () => {
    expect(canAccessWorkspace("FLEET_MANAGER", "Fleet manager workspace")).toBe(true);
    expect(canAccessWorkspace("INVENTORY_MANAGER", "Inventory manager workspace")).toBe(true);
    expect(canAccessWorkspace("MECHANIC", "Mechanic workspace")).toBe(true);
    expect(canAccessWorkspace("TECHNICIAN", "Technician workspace")).toBe(true);
    expect(canAccessWorkspace("DRIVER", "Driver portal")).toBe(true);
    expect(canAccessWorkspace("ACCOUNTANT", "Accountant ledger")).toBe(true);
    expect(canAccessWorkspace("DRIVER", "Fleet manager workspace")).toBe(false);
    expect(canAccessWorkspace("ACCOUNTANT", "Inventory manager workspace")).toBe(false);
  });
});
