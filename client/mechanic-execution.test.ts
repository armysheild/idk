import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const workspace = fs.readFileSync(path.join(root, "client/src/components/RoleWorkspaces.tsx"), "utf8");
const activeWorkspace = fs.readFileSync(path.join(root, "client/src/components/workspaces/MechanicExecutionWorkspace.tsx"), "utf8");
const router = fs.readFileSync(path.join(root, "server/routers.ts"), "utf8");
const schema = fs.readFileSync(path.join(root, "drizzle/fleetops-schema.ts"), "utf8");

describe("Mechanic execution contract", () => {
  it("renders the complete execution controls", () => {
    expect(workspace).toContain("Start Work");
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
    expect(router).toContain("assignedMechanicId: ctx.fleetopsUser.id");
    expect(router).toContain("storagePut(`fleetops/work-orders/");
    expect(router).toContain("workOrderEvidence.create");
    expect(router).toContain("laborHours: input.laborHours");
    expect(router).toContain("repairNotes: input.repairNotes");
  });

  it("defines the persistent work-order execution fields", () => {
    expect(schema).toContain('startedAt: timestamp("startedAt"');
    expect(schema).toContain('laborHours: numeric("laborHours"');
    expect(schema).toContain('repairNotes: text("repairNotes"');
    expect(schema).toContain("workOrderEvidence");
  });
});
