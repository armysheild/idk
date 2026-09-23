import { describe, expect, it } from "vitest";
import { describeAuthError } from "@/lib/authErrors";

describe("describeAuthError", () => {
  it("maps Supabase invalid-credential 400 responses", () => {
    expect(describeAuthError(new Error("Invalid login credentials"))).toBe("Email or password is incorrect. Check your credentials and try again.");
  });

  it("maps unconfirmed-email responses", () => {
    expect(describeAuthError(new Error("Email not confirmed"))).toContain("Confirm your email address");
  });

  it("maps rate-limit responses", () => {
    expect(describeAuthError(new Error("Too many requests"))).toContain("Too many authentication attempts");
  });

  it("maps network failures", () => {
    expect(describeAuthError(new Error("Failed to fetch"))).toContain("could not reach Supabase Auth");
  });

  it("keeps a safe generic message for unknown sign-in failures", () => {
    expect(describeAuthError(new Error("unexpected"))).toContain("could not sign you in");
  });
});
