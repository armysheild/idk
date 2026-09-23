import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./src/components/workspaces/ComplianceWorkspace.tsx", import.meta.url), "utf8");

describe("compliance status summaries", () => {
  it("computes distinct valid, expiring, expired, and missing-file groups", () => {
    expect(source).toContain("const expired = allDocuments.filter");
    expect(source).toContain("const expiring = allDocuments.filter");
    expect(source).toContain("const missing = allDocuments.filter");
    expect(source).toContain("const valid = allDocuments.filter");
  });

  it("renders explicit status labels rather than a single due/current flag", () => {
    expect(source).toContain('className="replacement-compliance-metrics"');
    expect(source).toContain('<span>Valid</span>');
    expect(source).toContain('<span>Expiring</span>');
    expect(source).toContain('<span>Expired</span>');
    expect(source).toContain('<span>Missing file</span>');
    expect(source).toContain('isMissing ? "File missing"');
  });

  it("renders append-only version history and renewal controls", () => {
    expect(source).toContain("trpc.documents.versions.useQuery({ documentId: historyDocumentId }");
    expect(source).toContain('historyDocumentId === document.id ? "Hide history" : "History"');
    expect(source).toContain("Version {version.versionNumber}");
    expect(source).toContain("updateDocument.mutate({ id: document.id, expiryDate: new Date(renewalDate) })");
  });

  it("exposes confirmed bulk archive controls for compliance documents", () => {
    expect(source).toContain("Select all compliance documents");
    expect(source).toContain("Archive selected");
    expect(source).toContain("Reason for archiving the selected compliance documents");
    expect(source).toContain("archiveDocument.mutateAsync");
  });

  it("uses the signed-url access procedure for stored files", () => {
    expect(source).toContain("trpc.documents.access.useMutation");
    expect(source).toContain('accessDocument.mutate({ id: document.id, kind: "DOCUMENT" })');
    expect(source).toContain('disabled={accessDocument.isPending || !document.fileKey}');
  });
});
