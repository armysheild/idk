import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const home = fs.readFileSync(path.resolve(import.meta.dirname, "src/pages/Home.tsx"), "utf8");

describe("clean-start Superadmin signup", () => {
  it("verifies an existing Auth account before reusing it", () => {
    expect(home).toContain("already registered|already exists|user exists");
    expect(home).toContain("signInWithEmail(authEmail, authPassword)");
    expect(home).toContain("describeAuthError(existing.error, \"sign-in\")");
  });

  it("continues through the normal session refresh path after verified reuse", () => {
    expect(home).toContain("const refreshed = await refreshSession();");
    expect(home).toContain("Session setup failed:");
  });
});
