import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");
const workspace = readFileSync(resolve(process.cwd(), "client/src/components/workspaces/ResourceWorkspace.tsx"), "utf8");
const accountant = readFileSync(resolve(process.cwd(), "client/src/components/workspaces/AccountantWorkspace.tsx"), "utf8");
const workspaceState = readFileSync(resolve(process.cwd(), "client/src/components/workspaces/WorkspaceState.tsx"), "utf8");

describe("shared workspace table and form primitives", () => {
  it("provides shared table/list and form styling", () => {
    expect(css).toContain(".workspace-table");
    expect(css).toContain(".resource-list");
    expect(css).toContain(".invite-form");
  });

  it("uses shared responsive primitives in resource workspaces", () => {
    expect(workspace).toContain("workspace-table");
    expect(workspace).toContain("resource-list");
    expect(accountant).toContain("audit-filter-grid");
  });

  it("announces shared data states accessibly and labels retry", () => {
    expect(workspaceState).toContain('role="status"');
    expect(workspaceState).toContain('aria-live="polite"');
    expect(workspaceState).toContain('role="alert"');
    expect(workspaceState).toContain('aria-label="Retry loading this workspace"');
  });
});
