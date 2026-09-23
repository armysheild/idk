import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Fleet Manager work-order review surface", () => {
  it("renders an approve action only for review-ready orders and uses the authorized mutation", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/components/workspaces/WorkOrderReviewWorkspace.tsx"), "utf8");
    expect(source).toContain('order.status === "READY_FOR_REVIEW"');
    expect(source).toContain("trpc.workOrders.approve.useMutation");
    expect(source).toContain("Approve handoff");
  });
});
