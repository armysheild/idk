import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const authHook = fs.readFileSync(path.join(root, "client/src/hooks/useFleetOpsAuth.ts"), "utf8");
const transport = fs.readFileSync(path.join(root, "client/src/main.tsx"), "utf8");
const home = fs.readFileSync(path.join(root, "client/src/pages/Home.tsx"), "utf8");
const invitationJoin = fs.readFileSync(path.join(root, "client/src/pages/JoinOrganization.tsx"), "utf8");
const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");

describe("Supabase session recovery", () => {
  it("clears local auth state when the initial session or refresh is invalid", () => {
    expect(authHook).toContain('supabase.auth.signOut({ scope: "local" })');
    expect(authHook).toContain('event === "SIGNED_OUT"');
    expect(authHook).toContain("result.error || !result.data.session");
  });

  it("clears a stale browser-local session before password login and retains the fresh password-grant session", () => {
    expect(authHook).toContain("const signInWithEmail = async");
    expect(authHook).toContain('await supabase.auth.signOut({ scope: "local" })');
    expect(authHook).toContain("before a fresh password");
    expect(authHook).toContain('email: email.trim()');
    expect(authHook).toContain("signInWithPassword");
    expect(authHook).toContain("setSession(result.data.session)");
    expect(authHook).toContain("setUser(result.data.session.user)");
    expect(authHook).toContain("Awaiting local sign-out");
  });

  it("serializes local session cleanup before the Supabase password grant", () => {
    const signInStart = authHook.indexOf("const signInWithEmail = async");
    const signInEnd = authHook.indexOf("const signOut =", signInStart);
    const signInBlock = authHook.slice(signInStart, signInEnd);
    expect(signInBlock.indexOf('await supabase.auth.signOut({ scope: "local" })')).toBeGreaterThanOrEqual(0);
    expect(signInBlock.indexOf('await supabase.auth.signOut({ scope: "local" })')).toBeLessThan(signInBlock.indexOf("signInWithPassword"));
    expect(signInBlock).not.toContain("refreshSession()");
  });

  it("does not retry protected tRPC traffic with a stale token after refresh failure", () => {
    expect(transport).toContain('window.dispatchEvent(new CustomEvent("fleetops-session-expired"))');
    expect(transport).toContain('throw new Error("FleetOps session expired. Please sign in again.")');
    expect(transport).toContain("if (response.status === 401 && data.session)");
  });

  it("resets the selected route and protected client caches when a different authenticated user signs in", () => {
    expect(home).toContain("const sessionUserId = session?.user.id ?? \"\"");
    expect(home).toContain("setActiveNav(initialSection)");
    expect(home).toContain("trpcUtils.dashboard.summary.reset()");
    expect(home).toContain("trpcUtils.inventory.list.reset()");
    expect(home).toContain("Securing your role workspace.");
  });

  it("keeps the invited member inside the application while the fresh password-grant session settles", () => {
    const submitStart = invitationJoin.indexOf("const submit = async");
    const submitEnd = invitationJoin.indexOf("if (authLoading", submitStart);
    const submitBlock = invitationJoin.slice(submitStart, submitEnd);
    expect(submitBlock).toContain("setSubmitted(true)");
    expect(submitBlock).toContain("await signInWithEmail");
    expect(submitBlock).toContain("setLocation(routeForRole(details.data.role))");
    expect(submitBlock).not.toContain("refreshSession()");
    expect(submitBlock).not.toContain("window.location.href");
  });

  it("keeps a guarded role route in an explicit recovery state when the first summary query sees a transient fresh-session authorization error", () => {
    expect(app).toContain("const summaryUnauthorized");
    expect(app).toContain("await summary.refetch()");
    expect(app).toContain("recoveringSession");
    expect(app).toContain("Workspace connection needs attention.");
    expect(app).toContain("<Home publicMode=\"signin\" />");
  });
});
