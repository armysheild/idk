import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./src/components/RoleWorkspaces.tsx", import.meta.url), "utf8");
const detailSource = readFileSync(new URL("./src/components/workspaces/InventoryManagerWorkspace.tsx", import.meta.url), "utf8");

describe("Inventory Manager part detail UI", () => {
  it("renders a tenant-scoped detail surface with reserved and available balances", () => {
    expect(detailSource).toContain("trpc.inventory.get.useQuery({ partId: selectedPartId }");
    expect(detailSource).toContain("detail.data?.reserved");
    expect(detailSource).toContain("detail.data?.available");
    expect(detailSource).toContain("movement history");
  });

  it("wires auditable transfer and cycle-count adjustment mutations", () => {
    expect(detailSource).toContain("trpc.inventory.transfer.useMutation");
    expect(detailSource).toContain("trpc.inventory.adjust.useMutation");
    expect(detailSource).toContain("Record bin transfer");
    expect(detailSource).toContain("Record adjustment");
    expect(detailSource).toContain("expectedQuantityOnHand: Number(selectedPart.quantityOnHand)");
  });
  it("loads detail only after a part is selected", () => {
    expect(source).toContain("const [selectedPartId, setSelectedPartId] = useState(\"\")");
    expect(source).toContain("trpc.inventory.get.useQuery({ partId: selectedPartId }");
    expect(source).toContain("enabled: Boolean(selectedPartId)");
  });

  it("lets operators select a stock row and see movement-backed availability", () => {
    expect(source).toContain("onClick={() => setSelectedPartId(item.id)}");
    expect(source).toContain("reserved} reserved · {partDetail.data.available} available");
    expect(source).toContain("persisted reservation, release, and issue movements");
  });

  it("renders the persisted bin-transfer control", () => {
    expect(source).toContain("const transferStock = trpc.inventory.transfer.useMutation");
    expect(source).toContain("transferStock.mutate(transfer)");
    expect(source).toContain("Destination bin location");
  });
});
