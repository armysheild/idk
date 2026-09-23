import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const driverUi = fs.readFileSync(path.join(root, "client/src/components/workspaces/DriverWorkspace.tsx"), "utf8");
const router = fs.readFileSync(path.join(root, "server/routers.ts"), "utf8");
const schema = fs.readFileSync(path.join(root, "drizzle/fleetops-schema.ts"), "utf8");

describe("Driver vehicle issue workflow", () => {
  it("renders issue reporting controls and issue history", () => {
    expect(driverUi).toContain("Report vehicle issue");
    expect(driverUi).toContain("Send issue report");
    expect(driverUi).toContain("Urgency");
    expect(driverUi).toContain("Photo evidence");
    expect(driverUi).toContain("vehicleIssues.create");
    expect(driverUi).toContain("Reported vehicle issues");
    expect(driverUi).toContain("fleetops:driver-issue-draft");
    expect(driverUi).toContain("Draft saved locally");
  });

  it("shows Fleet Manager response state in the Driver issue timeline", () => {
    expect(driverUi).toContain("trpc.notifications.list");
    expect(driverUi).toContain("Acknowledged");
    expect(driverUi).toContain("Escalation");
    expect(driverUi).toContain("Resolved");
    expect(driverUi).toContain("Awaiting Fleet Manager response");
    expect(router).toContain("recipientId: ctx.fleetopsUser.id");
  });

  it("enforces assigned-driver scope and notifies Fleet Managers", () => {
    expect(router).toContain('requireRole(ctx.fleetopsUser.role, ["DRIVER"]); assertWritable');
    expect(router).toContain("await assertDriverVehicle(ctx, input.vehicleId)");
    expect(router).toContain("fleetops/vehicle-issues/");
    expect(router).toContain('role: "FLEET_MANAGER"');
    expect(router).toContain('type: "VEHICLE_ISSUE"');
    expect(router).toContain('status: "OPEN"');
  });

  it("defines Fleet Manager triage and tenant-scoped persistence", () => {
    expect(router).toContain("vehicleIssues: router");
    expect(router).toContain('requireRole(ctx.fleetopsUser.role, ["SUPERADMIN", "FLEET_MANAGER", "DRIVER"])');
    expect(router).toContain('status: z.enum(["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "CLOSED"])');
    expect(schema).toContain("vehicleIssues");
    expect(schema).toContain('photoUrl: text("photoUrl")');
  });
});
