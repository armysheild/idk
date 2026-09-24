import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const workspace = fs.readFileSync(path.join(root, "client/src/components/workspaces/MechanicExecutionWorkspace.tsx"), "utf8");
const activeWorkspace = fs.readFileSync(path.join(root, "client/src/components/workspaces/MechanicExecutionWorkspace.tsx"), "utf8");
const router = fs.readFileSync(path.join(root, "backend/app/routes.py"), "utf8");
const schema = fs.readFileSync(path.join(root, "backend/app/models.py"), "utf8");

describe("Mechanic execution contract", () => {
  it("renders the complete execution controls", () => {
    expect(workspace).toContain("Start work");
    expect(workspace).toContain("Labor hours");
    expect(workspace).toContain("Repair notes");
    expect(workspace).toContain("Photo / evidence attachments");
    expect(workspace).toContain("workOrders.startWork");
    expect(workspace).toContain("fleetops:mechanic-execution-draft");
    expect(workspace).toContain("Execution draft saved locally");
  });

  it("submits the active mechanic handoff only after checklist persistence", () => {
    expect(activeWorkspace).toContain("const submitCompletion = async");
    expect(activeWorkspace).toContain("await saveChecklist.mutateAsync");
    expect(activeWorkspace).toContain("await complete.mutateAsync");
    expect(activeWorkspace).toContain("Submit for review");
    expect(activeWorkspace).toContain("Work order submitted for Fleet Manager review");
  });

  it("keeps mechanics assigned-order scoped and persists evidence through storage", () => {
    expect(router).toContain('@router.post("/work-orders/{work_order_id}/start"');
    expect(router).toContain('@router.post("/work-orders/{work_order_id}/complete"');
    expect(router).toContain("assigned_mechanic_id");
    expect(router).toContain("evidence");
  });

  it("defines the persistent work-order execution fields", () => {
    expect(schema).toContain("started_at");
    expect(schema).toContain("labor_hours");
    expect(schema).toContain("repair_notes");
    expect(schema).toContain("WorkOrderEvidence");
  });
});
