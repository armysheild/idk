import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const marketing = readFileSync(resolve(root, "client/src/pages/MarketingPages.tsx"), "utf8");
const landing = readFileSync(resolve(root, "client/src/pages/LandingPage.tsx"), "utf8");
const app = readFileSync(resolve(root, "client/src/App.tsx"), "utf8");

describe("public FleetOps marketing experience", () => {
  it("exposes professional public navigation and supporting pages", () => {
    expect(marketing).toContain('href="/pricing"');
    expect(marketing).toContain('href="/about"');
    expect(marketing).toContain('href="/security"');
    expect(app).toContain('path="/pricing"');
    expect(app).toContain('path="/about"');
    expect(app).toContain('path="/security"');
  });

  it("uses the approved INR pricing catalog without fabricated testimonials", () => {
    expect(marketing).toContain("₹2,999");
    expect(marketing).toContain("₹9,999");
    expect(marketing).toContain("₹24,999");
    expect(marketing.toLowerCase()).not.toContain("testimonial");
    expect(marketing.toLowerCase()).not.toContain("customer review");
  });

  it("keeps landing CTAs connected to real onboarding and sign-in routes", () => {
    expect(landing).toContain('href="/create-organization"');
    expect(marketing).toContain('href="/login"');
    expect(app).toContain('path="/login"');
    expect(app).toContain('path="/create-organization"');
  });
});
