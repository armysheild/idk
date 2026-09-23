import { Check, PackageCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { WorkspaceState as State } from "@/components/workspaces/WorkspaceState";
import { trpc } from "@/lib/trpc";
import type { InventoryPart, ProcurementOrderRow } from "@/types/fleet";

type VendorRow = {
  id: string;
  name: string;
  vendorType?: string;
  vendor_type?: string;
  phone?: string;
  email?: string;
  active?: boolean;
};

export function ProcurementWorkspace() {
  const utils = trpc.useUtils();
  const orders = trpc.purchaseOrders.list.useQuery(undefined, { retry: false });
  const parts = trpc.inventory.list.useQuery(undefined, { retry: false });
  const vendors = trpc.vendors.list.useQuery(undefined, { retry: false });
  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        partId: string;
        quantity: string;
        damagedQuantity: string;
        backorderedQuantity: string;
        varianceReason: string;
        unitCost: string;
        invoiceNumber: string;
        location: string;
        complete: boolean;
      }
    >
  >({});
  const [newOrder, setNewOrder] = useState({
    vendorId: "",
    partId: "",
    totalCost: "",
  });
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [vendorDraft, setVendorDraft] = useState({ name: "", vendorType: "Parts supplier", phone: "", email: "" });
  const pricingHistory = trpc.vendors.pricingHistory.useQuery(
    { vendorId: selectedVendorId },
    { enabled: Boolean(selectedVendorId), retry: false },
  );
  const updateStatus = trpc.purchaseOrders.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Purchase order status updated");
      void utils.purchaseOrders.list.invalidate();
    },
    onError: (error) =>
      toast.error("Purchase order update failed", {
        description: error.message,
      }),
  });
  const receivePartial = trpc.purchaseOrders.receivePartial.useMutation({
    onSuccess: (result) => {
      toast.success(`Received ${result.receipt.quantity} units into inventory`);
      void utils.purchaseOrders.list.invalidate();
      void utils.inventory.list.invalidate();
    },
    onError: (error) =>
      toast.error("Receipt failed", { description: error.message }),
  });
  const createPurchaseOrder = trpc.purchaseOrders.create.useMutation({
    onSuccess: () => {
      setNewOrder({ vendorId: "", partId: "", totalCost: "" });
      toast.success("Draft purchase order created");
      void utils.purchaseOrders.list.invalidate();
    },
    onError: (error) =>
      toast.error("Purchase order creation failed", {
        description: error.message,
      }),
  });
  const createVendor = trpc.vendors.create.useMutation({
    onSuccess: () => {
      setVendorDraft({ name: "", vendorType: "Parts supplier", phone: "", email: "" });
      toast.success("Vendor created");
      void utils.vendors.list.invalidate();
    },
    onError: (error) => toast.error("Vendor creation failed", { description: error.message }),
  });
  const updateVendor = trpc.vendors.update.useMutation({
    onSuccess: () => {
      toast.success("Vendor status updated");
      void utils.vendors.list.invalidate();
    },
    onError: (error) => toast.error("Vendor update failed", { description: error.message }),
  });
  const getDraft = (id: string) =>
    drafts[id] ?? {
      partId: "",
      quantity: "1",
      damagedQuantity: "0",
      backorderedQuantity: "0",
      varianceReason: "",
      unitCost: "",
      invoiceNumber: "",
      location: "",
      complete: false,
    };
  const setDraft = (id: string, patch: Partial<ReturnType<typeof getDraft>>) =>
    setDrafts((current) => ({
      ...current,
      [id]: { ...getDraft(id), ...patch },
    }));
  const supplierInvoiceLabel = "Supplier invoice";
  const openCount =
    orders.data?.filter(
      (row: ProcurementOrderRow) =>
        !["RECEIVED", "CLOSED", "CANCELLED"].includes(String(row.status)),
    ).length ?? 0;
  return (
    <main className="replacement-procurement">
      <header className="replacement-procurement-hero">
        <div>
          <span>Supplier control · purchase receiving</span>
          <h1>
            Keep the parts pipeline visible before a repair waits<em>.</em>
          </h1>
          <p>
            Create supplier-backed purchase orders, track their lifecycle, and
            receive material into the same tenant-scoped inventory ledger.
          </p>
        </div>
        <div className="replacement-procurement-hero-chip">
          <PackageCheck size={20} />
          <strong>{openCount}</strong>
          <small>open purchase orders</small>
        </div>
      </header>
      <section className="replacement-procurement-create">
        <div>
          <span>01 · procurement planning</span>
          <h2>Create purchase order</h2>
          <p>
            Create a draft PO from an active vendor, then progress it through
            sent, partial receipt, received, and closed states.
          </p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!newOrder.vendorId || !newOrder.partId || !newOrder.totalCost)
              return;
            createPurchaseOrder.mutate({
              vendorId: newOrder.vendorId,
              partId: newOrder.partId,
              totalCost: Number(newOrder.totalCost),
            });
          }}
        >
          <label>
            Vendor
            <select
              required
              value={newOrder.vendorId}
              onChange={(event) => {
                setNewOrder((current) => ({
                  ...current,
                  vendorId: event.target.value,
                }));
                setSelectedVendorId(event.target.value);
              }}
            >
              <option value="">Select vendor</option>
              {(vendors.data ?? []).map(
                (vendor: { id: string; name: string; phone?: string }) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name} · {vendor.phone}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Part
            <select
              required
              value={newOrder.partId}
              onChange={(event) =>
                setNewOrder((current) => ({
                  ...current,
                  partId: event.target.value,
                }))
              }
            >
              <option value="">Select part</option>
              {(parts.data ?? []).map((part: InventoryPart) => (
                <option key={part.id} value={part.id}>
                  {part.sku} · {part.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Estimated total (₹)
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={newOrder.totalCost}
              onChange={(event) =>
                setNewOrder((current) => ({
                  ...current,
                  totalCost: event.target.value,
                }))
              }
              placeholder="0.00"
            />
          </label>
          <button
            className="replacement-procurement-primary"
            disabled={
              createPurchaseOrder.isPending ||
              vendors.isLoading ||
              parts.isLoading
            }
          >
            {createPurchaseOrder.isPending ? "Creating…" : "Create draft PO"}
          </button>
        </form>
      </section>
      <section className="replacement-procurement-create">
        <div>
          <span>02 · supplier register</span>
          <h2>Manage vendors</h2>
          <p>
            Keep the supplier register current. Archived vendors remain in the
            audit trail but cannot be selected for new purchase orders.
          </p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!vendorDraft.name.trim()) return;
            createVendor.mutate(vendorDraft);
          }}
        >
          <label>
            Vendor name
            <input
              required
              value={vendorDraft.name}
              onChange={(event) => setVendorDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label>
            Type
            <input
              value={vendorDraft.vendorType}
              onChange={(event) => setVendorDraft((current) => ({ ...current, vendorType: event.target.value }))}
            />
          </label>
          <label>
            Phone
            <input
              value={vendorDraft.phone}
              onChange={(event) => setVendorDraft((current) => ({ ...current, phone: event.target.value }))}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={vendorDraft.email}
              onChange={(event) => setVendorDraft((current) => ({ ...current, email: event.target.value }))}
            />
          </label>
          <button className="replacement-procurement-primary" disabled={createVendor.isPending}>
            {createVendor.isPending ? "Saving…" : "Add vendor"}
          </button>
        </form>
        <div className="replacement-procurement-list">
          {(vendors.data ?? []).map((vendor: VendorRow) => (
            <div key={vendor.id} className="replacement-procurement-list-row">
              <span>
                <strong>{vendor.name}</strong>
                <small>{vendor.vendorType ?? vendor.vendor_type ?? "Supplier"} · {vendor.phone ?? "No phone"}</small>
              </span>
              <button
                type="button"
                onClick={() =>
                  updateVendor.mutate({
                    id: vendor.id,
                    active: vendor.active === false,
                  })
                }
              >
                {vendor.active === false ? "Reactivate" : "Archive"}
              </button>
            </div>
          ))}
        </div>
      </section>
      {selectedVendorId && (
        <section className="replacement-procurement-pricing">
          <header>
            <div>
              <span>Vendor intelligence</span>
              <h2>
                Pricing history ·{" "}
                {pricingHistory.data?.vendor.name ?? "Selected vendor"}
              </h2>
            </div>
            <b>
              {pricingHistory.data?.averageUnitCost == null
                ? "No receipts yet"
                : `Avg ₹${Number(pricingHistory.data.averageUnitCost).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
            </b>
          </header>
          <p>
            {pricingHistory.data?.suppliedParts?.length ?? 0} supplied parts ·{" "}
            {pricingHistory.data?.purchaseHistory?.length ?? 0} purchase orders
          </p>
          <State
            loading={pricingHistory.isLoading}
            error={pricingHistory.isError}
            empty={
              !pricingHistory.isLoading &&
              !pricingHistory.isError &&
              !pricingHistory.data?.rows.length
            }
          >
            <div>
              {(pricingHistory.data?.rows ?? []).map(
                (row: {
                  id: string;
                  part?: { name?: string; sku?: string };
                  partId: string;
                  purchaseOrderId: string;
                  unitCost: number;
                  quantity: number;
                }) => (
                  <article key={row.id}>
                    <div>
                      <strong>{row.part?.name ?? "Inventory part"}</strong>
                      <span>
                        {row.part?.sku ?? row.partId} · PO-
                        {row.purchaseOrderId.slice(0, 8).toUpperCase()}
                      </span>
                    </div>
                    <b>
                      ₹
                      {Number(row.unitCost).toLocaleString("en-IN", {
                        maximumFractionDigits: 2,
                      })}{" "}
                      · {row.quantity} units
                    </b>
                  </article>
                ),
              )}
            </div>
          </State>
        </section>
      )}
      <section className="replacement-procurement-ledger">
        <header>
          <div>
            <span>02 · inventory automation</span>
            <h2>Purchase orders</h2>
          </div>
          <b>
            <Check size={14} />
            Drafts synced
          </b>
        </header>
        <State
          loading={orders.isLoading || parts.isLoading}
          error={orders.isError || parts.isError}
          empty={!orders.isLoading && !orders.isError && !orders.data?.length}
        >
          <div>
            {(orders.data ?? []).map((order: ProcurementOrderRow) => {
              const draft = getDraft(order.id);
              const selectedPart = (parts.data ?? []).find(
                (part: InventoryPart) => part.id === draft.partId,
              );
              return (
                <article key={order.id}>
                  <header>
                    <div>
                      <strong>PO-{order.id.slice(0, 8).toUpperCase()}</strong>
                      <p>
                        {order.vendor?.name ?? "Vendor pending"} · ₹
                        {Number(order.totalCost).toLocaleString("en-IN")}
                      </p>
                    </div>
                    <select
                      aria-label={`Update purchase order ${order.id}`}
                      value={String(order.status)}
                      disabled={
                        updateStatus.isPending ||
                        ["RECEIVED", "CLOSED", "CANCELLED"].includes(
                          String(order.status),
                        )
                      }
                      onChange={(event) =>
                        updateStatus.mutate({
                          id: order.id,
                          status: event.target.value as
                            | "DRAFT"
                            | "SENT"
                            | "APPROVED"
                            | "ORDERED"
                            | "PARTIALLY_RECEIVED"
                            | "RECEIVED"
                            | "CANCELLED"
                            | "CLOSED",
                          expectedUpdatedAt: order.updatedAt,
                        })
                      }
                    >
                      <option value="DRAFT">Draft</option>
                      <option value="SENT">Sent</option>
                      <option value="APPROVED" disabled>
                        Approved · Super Admin / Owner
                      </option>
                      <option value="ORDERED">Ordered</option>
                      <option value="PARTIALLY_RECEIVED">
                        Partially received
                      </option>
                      <option value="RECEIVED">Received</option>
                      <option value="CANCELLED">Cancelled</option>
                      <option value="CLOSED">Closed</option>
                    </select>
                  </header>
                  {!["CANCELLED", "CLOSED"].includes(String(order.status)) && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (
                          !selectedPart ||
                          !draft.unitCost ||
                          Number(draft.quantity) < 1
                        )
                          return;
                        receivePartial.mutate({
                          purchaseOrderId: order.id,
                          partId: draft.partId,
                          quantity: Number(draft.quantity),
                          damagedQuantity: Number(draft.damagedQuantity),
                          backorderedQuantity: Number(
                            draft.backorderedQuantity,
                          ),
                          varianceReason: draft.varianceReason || undefined,
                          expectedQuantityOnHand: Number(
                            selectedPart.quantityOnHand ?? 0,
                          ),
                          unitCost: Number(draft.unitCost),
                          invoiceNumber: draft.invoiceNumber || undefined,
                          location: draft.location || undefined,
                          complete: draft.complete,
                        });
                      }}
                    >
                      <label>
                        Receipt part
                        <select
                          required
                          value={draft.partId}
                          onChange={(event) =>
                            setDraft(order.id, { partId: event.target.value })
                          }
                        >
                          <option value="">Select inventory part</option>
                          {(parts.data ?? []).map((part: InventoryPart) => (
                            <option key={part.id} value={part.id}>
                              {part.sku} · {part.name} · {part.quantityOnHand}{" "}
                              on hand
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Quantity
                        <input
                          required
                          type="number"
                          min="1"
                          step="1"
                          value={draft.quantity}
                          onChange={(event) =>
                            setDraft(order.id, { quantity: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Damaged
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={draft.damagedQuantity}
                          onChange={(event) =>
                            setDraft(order.id, {
                              damagedQuantity: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Back-order
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={draft.backorderedQuantity}
                          onChange={(event) =>
                            setDraft(order.id, {
                              backorderedQuantity: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Variance reason
                        <input
                          value={draft.varianceReason}
                          onChange={(event) =>
                            setDraft(order.id, {
                              varianceReason: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Unit cost (₹)
                        <input
                          required
                          type="number"
                          min="0"
                          step="0.01"
                          value={draft.unitCost}
                          onChange={(event) =>
                            setDraft(order.id, { unitCost: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Invoice number
                        <input
                          value={draft.invoiceNumber}
                          onChange={(event) =>
                            setDraft(order.id, {
                              invoiceNumber: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Bin / location
                        <input
                          value={draft.location}
                          onChange={(event) =>
                            setDraft(order.id, { location: event.target.value })
                          }
                        />
                      </label>
                      <label className="replacement-procurement-check">
                        <input
                          type="checkbox"
                          checked={draft.complete}
                          onChange={(event) =>
                            setDraft(order.id, {
                              complete: event.target.checked,
                            })
                          }
                        />{" "}
                        Final receipt
                      </label>
                      <button
                        className="replacement-procurement-secondary"
                        disabled={
                          receivePartial.isPending ||
                          !selectedPart ||
                          !draft.unitCost ||
                          Number(draft.quantity) < 1
                        }
                      >
                        <PackageCheck size={15} />
                        Receive into inventory
                      </button>
                    </form>
                  )}
                </article>
              );
            })}
          </div>
        </State>
      </section>
    </main>
  );
}
