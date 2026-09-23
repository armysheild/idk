import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const app = fs.readFileSync(path.resolve(import.meta.dirname, "src/App.tsx"), "utf8");
const home = fs.readFileSync(path.resolve(import.meta.dirname, "src/pages/Home.tsx"), "utf8");

describe("dashboard auth query gating", () => {
  it("bounds guarded route summary refetches", () => {
    expect(app).toContain("refetchOnWindowFocus: false");
    expect(app).toContain("refetchOnReconnect: false");
    expect(app).toContain("retry: false");
  });

  it("bounds Home summary refetches", () => {
    expect(home).toContain("refetchOnWindowFocus: false");
    expect(home).toContain("refetchOnReconnect: false");
  });

  it("recovers transient first-login authorization errors without logging out the fresh session", () => {
    expect(home).toContain('summaryQueryError?.data?.code === "UNAUTHORIZED"');
    expect(home).toContain("staleSessionRecoveryAttempted");
    expect(home).toContain("void refreshSession().then");
    expect(home).toContain("void refetchSummary()");
    expect(home).not.toContain("void signOut()");
    expect(home).not.toContain("window.location.reload()}>Retry workspace load");
  });

  it("completes organization onboarding through SPA refresh", () => {
    expect(home).toContain('window.localStorage.setItem("fleetops.openTeam", "1"); await refetchSummary();');
    expect(home).not.toContain("window.location.reload();");
  });
});
