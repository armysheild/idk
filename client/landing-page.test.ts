import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const landing = fs.readFileSync(path.join(root, "client/src/pages/LandingPage.tsx"), "utf8");
const marketing = fs.readFileSync(path.join(root, "client/src/pages/MarketingPages.tsx"), "utf8");
const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
const home = fs.readFileSync(path.join(root, "client/src/pages/Home.tsx"), "utf8");
const authSurface = fs.readFileSync(path.join(root, "client/src/components/public/PublicAuthSurface.tsx"), "utf8");

describe("public VahanSync landing page", () => {
  it("exposes distinct public calls to action", () => {
    expect(marketing).toContain("Sign in");
    expect(marketing).toContain("/login");
    expect(landing).toContain("Create your organization");
    expect(landing).toContain("/create-organization");
    expect(landing).toContain("Keep the fleet moving");
    expect(landing).toContain("vahansync-master-readiness-logo.png");
    expect(landing).toContain("public-master-brand-panel");
  });

  it("shows the approved Hindi Supabase-hosted full workflow video with native controls", () => {
    expect(landing).toContain("vahansync-media/marketing/workflow/v3");
    expect(landing).toContain("vahansync-real-workflow-demo-hindi-no-subtitles.mp4");
    expect(landing).toContain('controls preload="metadata" playsInline');
    expect(landing).toContain("Watch the complete connected operating workflow");
    expect(landing).toContain("Hindi narration. No on-screen subtitles.");
    expect(landing).not.toContain("vahansync-workflow-01-narrated.mp4");
    expect(landing).not.toContain("vahansync-workflow-02-vin-signal-narrated.mp4");
  });

  it("routes public auth paths without replacing invitation or workspace routes", () => {
    expect(app).toContain('path="/login"');
    expect(app).toContain('path="/create-organization"');
    expect(app).toContain('path="/join/:token"');
    expect(app).toContain('path="/workspace/:section"');
    expect(home).toContain('publicMode === "landing"');
    expect(home).toContain('publicMode === "signup"');
  });

  it("uses the replacement authentication composition without changing Supabase-backed auth handlers", () => {
    expect(home).toContain("PublicAuthSurface");
    expect(home).toContain("signInWithEmail");
    expect(home).toContain("signUpWithEmail");
    expect(home).toContain("requestPasswordReset");
    expect(home).toContain("updatePassword");
    expect(authSurface).toContain("Secure organization access");
    expect(authSurface).toContain('"current-password"');
  });
});
