import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./src/components/workspaces/NotificationWorkspace.tsx", import.meta.url), "utf8");

describe("notification workspace actions", () => {
  it("uses the persisted notification lifecycle procedures", () => {
    expect(source).toContain("trpc.notifications.markRead.useMutation");
    expect(source).toContain("trpc.notifications.escalate.useMutation");
    expect(source).toContain("trpc.notifications.resolve.useMutation");
  });

  it("exposes tenant-safe notification filter controls", () => {
    expect(source).toContain("Filter notifications by severity");
    expect(source).toContain("Filter notifications by source type");
    expect(source).toContain("Filter notifications by status");
    expect(source).toContain("Filter notifications by vehicle ID");
    expect(source).toContain("trpc.notifications.list.useQuery({ severity: filters.severity");
  });

  it("opens tenant-scoped linked source records", () => {
    expect(source).toContain("trpc.notifications.sourceDetail.useQuery");
    expect(source).toContain("Open record");
    expect(source).toContain("Source record unavailable in your organization scope.");
  });

  it("gates escalation and resolution to management roles", () => {
    expect(source).toContain('me.data?.role === "SUPERADMIN" || me.data?.role === "FLEET_MANAGER"');
    expect(source).toContain("note.trim().length < 3");
    expect(source).toContain("resolvedAt");
  });
});
