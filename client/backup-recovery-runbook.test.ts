import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const runbook = fs.readFileSync(path.join(root, "backup-recovery-runbook.md"), "utf8");

describe("Backup and recovery runbook", () => {
  it("covers database, storage, auth, migration, and restore verification", () => {
    expect(runbook).toContain("PostgreSQL");
    expect(runbook).toContain("Storage evidence");
    expect(runbook).toContain("Auth");
    expect(runbook).toContain("Migrations");
    expect(runbook).toContain("Restore verification checklist");
    expect(runbook).toContain("tenant-scoped");
    expect(runbook).toContain("SHA-256");
    expect(runbook).toContain("inventory adjustments reject stale expected quantities");
    expect(runbook).toContain("financial corrections require reasoned reversals");
  });

  it("prohibits unsafe credential and destructive-operation handling", () => {
    expect(runbook).toContain("Never commit database exports, Auth exports, storage credentials, or signed URLs");
    expect(runbook).toContain("Do not overwrite the production project");
    expect(runbook).toContain("Organization deletion is a controlled, destructive operation");
  });
});
