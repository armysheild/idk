import { Check, Download, PackageCheck, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { WorkspaceState as State } from "@/components/workspaces/WorkspaceState";
import { trpc } from "@/lib/trpc";
import { statusKey } from "@/lib/status";
import type { InventoryPart, ProcurementOrderRow } from "@/types/fleet";

function downloadPdf(filename: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

type OrderEditDraft = {
  id: string;
  vendorId: string;
  expectedOn: string;
  notes: string;
  lines: Array<{ partId: string; quantity: string; unitCost: string }>;
};

type VendorRow = {
  id: string;
  name: string;
  vendorType?: string;
  vendor_type?: string;
  phone?: string;
  email?: string;
  active?: boolean;
};

type StockLocationRow = { id: string; name: string; code: string; active: boolean };

export function ProcurementWorkspace() {
  const utils = trpc.useUtils();
  const orders = trpc.purchaseOrders.list.useQuery(undefined, { retry: false });
  const parts = trpc.inventory.list.useQuery(undefined, { retry: false });
  const vendors = trpc.vendors.list.useQuery(undefined, { retry: false });
  const locations = trpc.inventory.locations.useQuery(undefined, { retry: false });
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
  const [newOrder, setNewOrder] = useState<{
    vendorId: string;
    expectedOn: string;
    lines: Array<{ partId: string; quantity: string; unitCost: string }>;
  }>({ vendorId: "", expectedOn: "", lines: [{ partId: "", quantity: "1", unitCost: "" }] });
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [editingOrder, setEditingOrder] = useState<OrderEditDraft | null>(null);
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
      void utils.inventory.movements.invalidate();
    },
    onError: (error) =>
      toast.error("Receipt failed", { description: error.message }),
  });
  const createPurchaseOrder = trpc.purchaseOrders.create.useMutation({
    onSuccess: () => {
      setNewOrder({ vendorId: "", expectedOn: "", lines: [{ partId: "", quantity: "1", unitCost: "" }] });
      toast.success("Draft purchase order created");
      void utils.purchaseOrders.list.invalidate();
    },
    onError: (error) =>
      toast.error("Purchase order creation failed", {
        description: error.message,
      }),
  });
  const updateOrder = trpc.purchaseOrders.update.useMutation({
    onSuccess: () => {
      setEditingOrder(null);
      toast.success("Purchase order updated");
      void utils.purchaseOrders.list.invalidate();
    },
    onError: (error) => toast.error("Purchase order update failed", { description: error.message }),
  });
  const downloadOrder = trpc.purchaseOrders.download.useMutation({
    onSuccess: (data: { filename: string; content: string }) => {
      downloadPdf(data.filename, data.content);
      toast.success("Purchase order document downloaded", { description: "Share the PDF with the vendor." });
    },
    onError: (error) => toast.error("Purchase order download failed", { description: error.message }),
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
        !["RECEIVED", "CLOSED", "CANCELLED"].includes(statusKey(row.status)),
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
            const lines = newOrder.lines
              .filter((line) => line.partId)
              .map((line) => ({
                partId: Number(line.partId),
                quantity: Math.max(1, Number(line.quantity) || 1),
                unitCost: line.unitCost === "" ? 0 : Number(line.unitCost),
              }));
            if (!newOrder.vendorId || !lines.length) return;
            createPurchaseOrder.mutate({
              vendorId: newOrder.vendorId,
              expectedOn: newOrder.expectedOn || undefined,
              lines,
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
            Expected on
            <input
              type="date"
              value={newOrder.expectedOn}
              onChange={(event) =>
                setNewOrder((current) => ({
                  ...current,
                  expectedOn: event.target.value,
                }))
              }
            />
          </label>
          {newOrder.lines.map((line, index) => (
            <div key={index} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", gridColumn: "1 / -1" }}>
              <label style={{ flex: 2 }}>
                Part
                <select
                  required
                  value={line.partId}
                  onChange={(event) =>
                    setNewOrder((current) => ({
                      ...current,
                      lines: current.lines.map((item, i) =>
                        i === index ? { ...item, partId: event.target.value } : item,
                      ),
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
              <label style={{ flex: 1 }}>
                Quantity
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={line.quantity}
                  onChange={(event) =>
                    setNewOrder((current) => ({
                      ...current,
                      lines: current.lines.map((item, i) =>
                        i === index ? { ...item, quantity: event.target.value } : item,
                      ),
                    }))
                  }
                />
              </label>
              <label style={{ flex: 1 }}>
                Unit cost (₹, optional)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="TBD"
                  value={line.unitCost}
                  onChange={(event) =>
                    setNewOrder((current) => ({
                      ...current,
                      lines: current.lines.map((item, i) =>
                        i === index ? { ...item, unitCost: event.target.value } : item,
                      ),
                    }))
                  }
                />
              </label>
              {newOrder.lines.length > 1 && (
                <button
                  type="button"
                  className="secondary-button compact-button"
                  aria-label={`Remove line ${index + 1}`}
                  onClick={() =>
                    setNewOrder((current) => ({
                      ...current,
                      lines: current.lines.filter((_, i) => i !== index),
                    }))
                  }
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() =>
              setNewOrder((current) => ({
                ...current,
                lines: [...current.lines, { partId: "", quantity: "1", unitCost: "" }],
              }))
            }
          >
            <Plus size={14} /> Add part
          </button>
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
                {pricingHistory.data?.vendor?.name ??
                  pricingHistory.data?.vendorName ??
                  "Selected vendor"}
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
                        {String(row.purchaseOrderId).slice(0, 8).toUpperCase()}
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
              const orderStatus = statusKey(order.status);
              const orderedPartIds = new Set((order.lines ?? []).map((line) => String(line.partId)));
              const selectedPart = (parts.data ?? []).find(
                (part: InventoryPart) => part.id === draft.partId,
              );
              return (
                <article key={order.id}>
                  <header>
                    <div>
                      <strong>PO-{String(order.id).slice(0, 8).toUpperCase()}</strong>
                      <p>
                        {order.vendor?.name ?? "Vendor pending"} ·{" "}
                        {Number(order.totalCost) > 0
                          ? `₹${Number(order.totalCost).toLocaleString("en-IN")}`
                          : "Price TBD"}
                      </p>
                    </div>
                    <select
                      aria-label={`Update purchase order ${order.id}`}
                      value={orderStatus}
                      disabled={
                        updateStatus.isPending ||
                        ["RECEIVED", "CLOSED", "CANCELLED"].includes(
                          orderStatus,
                        )
                      }
                      onChange={(event) =>
                        updateStatus.mutate({
                          id: order.id,
                          status: event.target.value as
                            | "DRAFT"
                            | "SUBMITTED"
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
                      <option value="SUBMITTED">Submitted</option>
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
                    <div>
                      {["DRAFT", "SUBMITTED"].includes(orderStatus) && (
                        <button
                          type="button"
                          className="secondary-button compact-button"
                          aria-label={`Edit purchase order ${order.id}`}
                          onClick={() =>
                            setEditingOrder({
                              id: order.id,
                              vendorId: String((order as ProcurementOrderRow & { vendorId?: string | number }).vendorId ?? ""),
                              expectedOn: String((order as ProcurementOrderRow & { expectedOn?: string }).expectedOn ?? ""),
                              notes: String((order as ProcurementOrderRow & { notes?: string }).notes ?? ""),
                              lines: (order.lines ?? []).map((line) => ({
                                partId: String(line.partId),
                                quantity: String(line.quantity),
                                unitCost: String(line.unitCost ?? ""),
                              })),
                            })
                          }
                        >
                          <Pencil size={14} /> Edit
                        </button>
                      )}
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        aria-label={`Download purchase order ${order.id}`}
                        disabled={downloadOrder.isPending}
                        onClick={() => downloadOrder.mutate({ purchaseOrderId: order.id })}
                      >
                        <Download size={14} /> PDF
                      </button>
                    </div>
                  </header>
                  {editingOrder?.id === order.id && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!editingOrder.vendorId || !editingOrder.lines.length) return;
                        updateOrder.mutate({
                          id: editingOrder.id,
                          vendorId: editingOrder.vendorId,
                          expectedOn: editingOrder.expectedOn || undefined,
                          notes: editingOrder.notes || undefined,
                          lines: editingOrder.lines.map((line) => ({
                            partId: Number(line.partId),
                            quantity: Number(line.quantity),
                            unitCost: line.unitCost === "" ? 0 : Number(line.unitCost),
                          })),
                        });
                      }}
                    >
                      <label>
                        Vendor
                        <select
                          required
                          value={editingOrder.vendorId}
                          onChange={(event) => setEditingOrder((current) => current ? { ...current, vendorId: event.target.value } : current)}
                        >
                          <option value="">Select vendor</option>
                          {(vendors.data ?? []).filter((vendor: VendorRow) => vendor.active !== false).map((vendor: VendorRow) => (
                            <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Expected on
                        <input
                          type="date"
                          value={editingOrder.expectedOn}
                          onChange={(event) => setEditingOrder((current) => current ? { ...current, expectedOn: event.target.value } : current)}
                        />
                      </label>
                      <label>
                        Notes
                        <input
                          value={editingOrder.notes}
                          onChange={(event) => setEditingOrder((current) => current ? { ...current, notes: event.target.value } : current)}
                          placeholder="Delivery or payment notes for the vendor"
                        />
                      </label>
                      {editingOrder.lines.map((line, index) => (
                        <div key={index}>
                          <label>
                            Part
                            <select
                              required
                              value={line.partId}
                              onChange={(event) => setEditingOrder((current) => current ? { ...current, lines: current.lines.map((item, i) => i === index ? { ...item, partId: event.target.value } : item) } : current)}
                            >
                              <option value="">Select part</option>
                              {(parts.data ?? []).map((part: InventoryPart) => (
                                <option key={part.id} value={part.id}>{part.sku} · {part.name}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Qty
                            <input
                              required
                              type="number"
                              min="1"
                              step="1"
                              value={line.quantity}
                              onChange={(event) => setEditingOrder((current) => current ? { ...current, lines: current.lines.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item) } : current)}
                            />
                          </label>
                          <label>
                            Unit cost (₹, optional)
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="TBD"
                              value={line.unitCost}
                              onChange={(event) => setEditingOrder((current) => current ? { ...current, lines: current.lines.map((item, i) => i === index ? { ...item, unitCost: event.target.value } : item) } : current)}
                            />
                          </label>
                          <button
                            type="button"
                            className="secondary-button compact-button"
                            aria-label={`Remove line ${index + 1}`}
                            disabled={editingOrder.lines.length < 2}
                            onClick={() => setEditingOrder((current) => current ? { ...current, lines: current.lines.filter((_, i) => i !== index) } : current)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => setEditingOrder((current) => current ? { ...current, lines: [...current.lines, { partId: "", quantity: "1", unitCost: "" }] } : current)}
                      >
                        <Plus size={14} /> Add line
                      </button>
                      <button className="primary-button" disabled={updateOrder.isPending}>
                        {updateOrder.isPending ? "Saving…" : "Save changes"} <Check size={14} />
                      </button>
                      <button type="button" className="secondary-button compact-button" onClick={() => setEditingOrder(null)}>Cancel</button>
                    </form>
                  )}
                  {["SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED"].includes(orderStatus) && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (
                          !selectedPart ||
                          !draft.unitCost ||
                          !draft.invoiceNumber.trim() ||
                          !draft.location ||
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
                          locationId: draft.location,
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
                          {(parts.data ?? []).filter((part: InventoryPart) => orderedPartIds.has(String(part.id))).map((part: InventoryPart) => (
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
                          required
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
                        <select
                          required
                          value={draft.location}
                          onChange={(event) =>
                            setDraft(order.id, { location: event.target.value })
                          }
                        >
                          <option value="">Select receiving location</option>
                          {(locations.data ?? []).filter((location: StockLocationRow) => location.active).map((location: StockLocationRow) => (
                            <option key={location.id} value={location.id}>{location.code} · {location.name}</option>
                          ))}
                        </select>
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
                          !draft.invoiceNumber.trim() ||
                          !draft.location ||
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
