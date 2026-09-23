import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

describe("ResourceWorkspace hook ordering", () => {
  it("does not declare hooks after section-specific early returns", () => {
    const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "ResourceWorkspace.tsx");
    const source = readFileSync(sourcePath, "utf8");
    const firstSectionReturn = source.indexOf('if (section === "Notifications") return');
    expect(firstSectionReturn).toBeGreaterThan(0);
    expect(source.slice(firstSectionReturn)).not.toMatch(/\buse(?:Effect|Memo|State|Query|Mutation)\s*\(/);
  });
});
