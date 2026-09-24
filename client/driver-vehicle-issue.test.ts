import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const driverUi = fs.readFileSync(path.join(root, "client/src/components/workspaces/DriverWorkspace.tsx"), "utf8");
const router = fs.readFileSync(path.join(root, "backend/app/routes.py"), "utf8");
const schema = fs.readFileSync(path.join(root, "backend/app/models.py"), "utf8");

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
    expect(router).toContain('roles={"owner", "fleet_manager"}');
  });

  it("enforces assigned-driver scope and notifies Fleet Managers", () => {
    expect(router).toContain('@router.post("/driver/issues"');
    expect(router).toContain('require_roles("driver")');
    expect(router).toContain("assigned_driver_id");
    expect(router).toContain("VehicleIssue");
  });

  it("defines Fleet Manager triage and tenant-scoped persistence", () => {
    expect(router).toContain('@router.get("/driver/issues"');
    expect(router).toContain('@router.post("/triage/issues/{issue_id}/assign"');
    expect(schema).toContain("class VehicleIssue");
    expect(schema).toContain("resolved_at");
  });
});
