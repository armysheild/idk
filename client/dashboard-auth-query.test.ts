import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const app = fs.readFileSync(path.resolve(import.meta.dirname, "src/App.tsx"), "utf8");
const home = fs.readFileSync(path.resolve(import.meta.dirname, "src/pages/Home.tsx"), "utf8");

describe("dashboard auth query gating", () => {
  it("bounds guarded route summary refetches", () => {
    expect(app).toContain("refetchOnWindowFocus: false");
    expect(app).toContain("refetchOnReconnect: false");
    expect(app).toContain("retry: 2");
    expect(app).toContain('summary.error?.data?.code === "UNAUTHORIZED"');
    expect(app).toContain("void signOut()");
  });

  it("bounds Home summary refetches", () => {
    expect(home).toContain("refetchOnWindowFocus: false");
    expect(home).toContain("refetchOnReconnect: false");
  });

  it("does not duplicate transport-level session recovery", () => {
    expect(home).not.toContain('summaryQueryError?.data?.code === "UNAUTHORIZED"');
    expect(home).not.toContain("staleSessionRecoveryAttempted");
    expect(home).not.toContain("void refreshSession().then");
    expect(home).toContain("void refetchSummary()");
    expect(home).not.toContain("void signOut()");
  });

  it("completes organization onboarding through SPA refresh", () => {
    expect(home).toContain('window.localStorage.setItem("fleetops.openTeam", "1"); await refetchSummary();');
    expect(home).not.toContain("window.location.reload();");
  });
});
