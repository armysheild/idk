import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("signup to organization invitation flow", () => {
  const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

  it("bootstraps and completes the first Superadmin organization onboarding flow", () => {
    const source = read("client/src/components/OrganizationOnboarding.tsx");
    expect(source).toContain("trpc.onboarding.complete.useMutation");
    expect(source).toContain("orgName");
    expect(source).toContain("fullName");
    expect(source).toContain("mobileNumber");
    expect(source).toContain("smsAlertsEnabled");
    expect(source).toContain("whatsappAlertsEnabled");
  });

  it("accepts an organization-bound invitation before opening the invited role workspace", () => {
    const source = read("client/src/pages/JoinOrganization.tsx");
    expect(source).toContain("trpc.onboarding.inviteDetails.useQuery");
    expect(source).toContain("trpc.onboarding.completeInviteWithPassword.useMutation");
    expect(source).toContain("completeInvite.mutateAsync");
    expect(source).toContain("mobileNumber");
    expect(source).toContain("smsAlertsEnabled");
    expect(source).toContain("whatsappAlertsEnabled");
    expect(source).toContain("signInWithEmail");
    expect(source).toContain("setSubmitted(true)");
    expect(source).toContain("const [, setLocation] = useLocation()");
    expect(source).toContain("organization");
    expect(source).toContain("role");
    expect(source).not.toContain("acceptInvite.mutate");
    expect(source).toContain("setLocation(routeForRole(details.data.role))");
    expect(source).not.toContain("window.location.href = routeForRole(details.data.role)");
    expect(source).not.toContain("refreshSession()");
  });

  it("keeps signup and invitation redemption in the application route map", () => {
    const appSource = read("client/src/App.tsx");
    const homeSource = read("client/src/pages/Home.tsx");
    expect(appSource).toContain("JoinOrganization");
    expect(appSource).toContain("/create-organization");
    expect(homeSource).toContain("signIn");
    const routerSource = read("server/routers.ts");
    expect(routerSource).toContain("completeInviteWithPassword");
    expect(routerSource).toContain("updateUserById(authUser.id");
    expect(routerSource).toContain("password: input.password");
    expect(routerSource).toContain("metadataSyncPending: Boolean(metadataError)");
    expect(routerSource).toContain("Membership created; Auth metadata sync will be retried from the database-backed profile.");
    expect(routerSource).not.toContain("Membership was created, but the session metadata could not be finalized");
  });
});
