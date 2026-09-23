import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./src/main.tsx", import.meta.url), "utf8");

describe("authenticated tRPC transport", () => {
  it("attaches the current Supabase access token at the batch-link layer and keeps refresh retry support", () => {
    expect(source).toContain("async headers()");
    expect(source).toContain("data.session?.access_token");
    expect(source).toContain("Authorization: `Bearer ${data.session.access_token}`");
    expect(source).toContain("refreshSession");
  });
});
