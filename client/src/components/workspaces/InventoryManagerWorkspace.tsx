import { useState } from "react";
import { AlertTriangle, ArrowRightLeft, Boxes, Check, ClipboardCheck, Download, PackageMinus, PackageSearch, Upload } from "lucide-react";
import { toast } from "sonner";
import { WorkspaceState as State } from "@/components/workspaces/WorkspaceState";
import { trpc } from "@/lib/trpc";
import type { InventoryPart } from "@/types/fleet";

const money = (value: unknown) => Number(value ?? 0).toLocaleString("en-IN", { style: "currency", currency: "INR" });

export function InventoryManagerWorkspace() {
  const utils = trpc.useUtils();
  const parts = trpc.inventory.list.useQuery(undefined, { retry: false });
  const inventoryExport = trpc.inventory.exportCsv.useQuery(undefined, { enabled: false, retry: false });
  const [importCsv, setImportCsv] = useState("");
  const importPreview = trpc.inventory.previewImport.useQuery({ csv: importCsv }, { enabled: Boolean(importCsv), retry: false });
  const [selectedPartId, setSelectedPartId] = useState("");
  const selectedPart = (parts.data ?? []).find((part: InventoryPart) => part.id === selectedPartId);
  const detail = trpc.inventory.get.useQuery({ partId: selectedPartId }, { enabled: Boolean(selectedPartId), retry: false });
  const [transfer, setTransfer] = useState({ toBinLocation: "", reason: "" });
  const [adjustment, setAdjustment] = useState({ delta: "0", reason: "" });
  const [issue, setIssue] = useState({ quantity: "1", reason: "" });
  const partRows = parts.data ?? [];
  const movementRows = detail.data?.movements ?? [];
  const lowStockCount = partRows.filter((part: InventoryPart) => Number(part.quantityOnHand) <= Number(part.minReorderLevel)).length;
  const totalOnHand = partRows.reduce((total: number, part: InventoryPart) => total + Number(part.quantityOnHand ?? 0), 0);
  const transferPart = trpc.inventory.transfer.useMutation({
    onSuccess: () => { toast.success("Bin transfer recorded"); setTransfer({ toBinLocation: "", reason: "" }); void utils.inventory.list.invalidate(); void detail.refetch(); void utils.inventory.movements.invalidate(); },
    onError: (error) => toast.error("Bin transfer failed", { description: error.message }),
  });
  const issuePart = trpc.inventory.issue.useMutation({
    onSuccess: () => { toast.success("Stock-out movement recorded"); setIssue({ quantity: "1", reason: "" }); void utils.inventory.list.invalidate(); void detail.refetch(); void utils.inventory.movements.invalidate(); },
    onError: (error) => toast.error("Stock-out failed", { description: error.message }),
  });
  const adjustPart = trpc.inventory.adjust.useMutation({
    onSuccess: () => { toast.success("Cycle-count adjustment recorded"); setAdjustment({ delta: "0", reason: "" }); void utils.inventory.list.invalidate(); void detail.refetch(); void utils.inventory.movements.invalidate(); },
    onError: (error) => toast.error("Adjustment failed", { description: error.message }),
  });
  const importInventory = trpc.inventory.importCsv.useMutation({
    onSuccess: (result) => { toast.success(`Imported ${result.importedCount} inventory parts`); setImportCsv(""); void utils.inventory.list.invalidate(); },
    onError: (error) => toast.error("Inventory import failed", { description: error.message }),
  });
  const downloadExport = () => {
    void inventoryExport.refetch().then(({ data }) => {
      if (!data) return;
      const url = URL.createObjectURL(new Blob([data.content], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = data.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  };

  return <main className="replacement-inventory-control">
    <header className="replacement-stock-hero">
      <div><span>Inventory control · tenant stock</span><h1>Keep every repair supplied before dispatch<em>.</em></h1><p>Inspect availability, protect reserved parts, record controlled movements, and keep every balance traceable.</p></div>
      <div className="replacement-stock-hero-chip"><Boxes size={20} /><strong>{partRows.length}</strong><small>active stock records</small></div>
    </header>

    <section className="replacement-stock-signals" aria-label="Inventory signals">
      <article><Boxes size={17} /><span>Catalog</span><strong>{partRows.length}</strong><small>{totalOnHand.toLocaleString("en-IN")} units on hand</small></article>
      <article className={lowStockCount ? "is-alert" : "is-safe"}><AlertTriangle size={17} /><span>Reorder watch</span><strong>{lowStockCount}</strong><small>{lowStockCount ? "items need replenishment" : "all parts within threshold"}</small></article>
      <article><PackageSearch size={17} /><span>Selected balance</span><strong>{selectedPart ? `${detail.data?.available ?? selectedPart.quantityOnHand}` : "—"}</strong><small>{selectedPart?.sku ?? "select a part"}</small></article>
      <article><ClipboardCheck size={17} /><span>Movement evidence</span><strong>{movementRows.length}</strong><small>{selectedPart ? "loaded audit events" : "part history on selection"}</small></article>
    </section>

    <section className="replacement-stock-selector">
      <div><span>01 · Inspect a part</span><h2>Open a controlled stock record</h2><p>Available stock, reservations, actions, and immutable movements stay connected to one tenant-scoped SKU.</p></div>
      <div className="replacement-stock-selector-controls"><label>Inventory part<select aria-label="Select inventory part" value={selectedPartId} onChange={(event) => setSelectedPartId(event.target.value)}><option value="">Select a part</option>{partRows.map((part: InventoryPart) => <option key={part.id} value={part.id}>{part.sku} · {part.name}</option>)}</select></label><div><button type="button" className="replacement-secondary" disabled={inventoryExport.isFetching} onClick={downloadExport}><Download size={15} />{inventoryExport.isFetching ? "Preparing…" : "Export CSV"}</button><label className="replacement-secondary"><Upload size={15} />Import CSV<input hidden type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setImportCsv); }} /></label></div></div>
      {importCsv && <aside className="replacement-import-note">Import preview: {importPreview.data?.validCount ?? 0}/{importPreview.data?.rowCount ?? 0} valid rows{importPreview.data?.errors?.length ? ` · ${importPreview.data.errors.length} errors` : ""}<button type="button" className="replacement-secondary" disabled={importInventory.isPending || !importPreview.data || Boolean(importPreview.data.errors.length)} onClick={() => importInventory.mutate({ csv: importCsv })}>{importInventory.isPending ? "Importing…" : "Apply validated import"}</button></aside>}
    </section>

    <State loading={parts.isLoading} error={parts.isError} empty={!parts.isLoading && !parts.isError && !partRows.length}>
      {selectedPart ? <>
        <section className="replacement-stock-metrics"><article><span>On hand</span><strong>{selectedPart.quantityOnHand}</strong><small>{selectedPart.binLocation ?? "No bin assigned"}</small></article><article><span>Reserved</span><strong>{detail.isLoading ? "…" : detail.data?.reserved ?? 0}</strong><small>open work-order demand</small></article><article><span>Available</span><strong>{detail.isLoading ? "…" : detail.data?.available ?? 0}</strong><small>safe to issue</small></article><article><span>Unit cost</span><strong>{money(selectedPart.unitCost)}</strong><small>reorder at {selectedPart.minReorderLevel}</small></article></section>
        <section className="replacement-stock-actions">
          <form onSubmit={(event) => { event.preventDefault(); if (transfer.toBinLocation.trim() && transfer.reason.trim()) transferPart.mutate({ partId: selectedPart.id, toBinLocation: transfer.toBinLocation.trim(), reason: transfer.reason.trim() }); }}><header><ArrowRightLeft size={18} /><div><span>Movement · transfer</span><h3>Move between bins</h3></div></header><p>Location changes retain the stock balance and write the actor and reason to the audit trail.</p><label>Destination bin<input required value={transfer.toBinLocation} onChange={(event) => setTransfer((current) => ({ ...current, toBinLocation: event.target.value }))} placeholder="Rack B · Shelf 2" /></label><label>Reason<input required minLength={3} maxLength={300} value={transfer.reason} onChange={(event) => setTransfer((current) => ({ ...current, reason: event.target.value }))} placeholder="Cycle reorganization" /></label><button className="replacement-secondary" disabled={transferPart.isPending}>{transferPart.isPending ? "Recording…" : "Record bin transfer"}</button></form>
          <form onSubmit={(event) => { event.preventDefault(); const quantity = Number(issue.quantity); if (issue.reason.trim() && Number.isInteger(quantity) && quantity >= 1 && quantity <= Number(selectedPart.quantityOnHand)) issuePart.mutate({ partId: selectedPart.id, quantity, reason: issue.reason.trim() }); }}><header><PackageMinus size={18} /><div><span>Movement · stock out</span><h3>Issue inventory</h3></div></header><p>Controlled issue records the quantity, reason, actor, and negative movement without losing traceability.</p><label>Quantity<input required type="number" min="1" max={selectedPart.quantityOnHand} step="1" value={issue.quantity} onChange={(event) => setIssue((current) => ({ ...current, quantity: event.target.value }))} /></label><label>Reason<input required minLength={3} maxLength={300} value={issue.reason} onChange={(event) => setIssue((current) => ({ ...current, reason: event.target.value }))} placeholder="Issued for workshop use" /></label><button className="replacement-primary" disabled={issuePart.isPending}>{issuePart.isPending ? "Recording…" : "Record stock out"}</button></form>
          <form onSubmit={(event) => { event.preventDefault(); const delta = Number(adjustment.delta); if (adjustment.reason.trim() && Number.isInteger(delta) && delta !== 0) adjustPart.mutate({ partId: selectedPart.id, expectedQuantityOnHand: Number(selectedPart.quantityOnHand), delta, reason: adjustment.reason.trim() }); }}><header><ClipboardCheck size={18} /><div><span>Movement · adjustment</span><h3>Post cycle-count variance</h3></div></header><p>Use a signed delta against the displayed balance to avoid silently overwriting newer stock counts.</p><label>Quantity delta<input required type="number" step="1" value={adjustment.delta} onChange={(event) => setAdjustment((current) => ({ ...current, delta: event.target.value }))} placeholder="+2 or -1" /></label><label>Reason<input required minLength={3} maxLength={300} value={adjustment.reason} onChange={(event) => setAdjustment((current) => ({ ...current, reason: event.target.value }))} placeholder="Physical count variance" /></label><button className="replacement-secondary" disabled={adjustPart.isPending}>{adjustPart.isPending ? "Recording…" : "Record adjustment"}</button></form>
        </section>
        <section className="replacement-stock-ledger"><header><div><span>{selectedPart.sku} · movement history</span><h2>{selectedPart.name}</h2></div><b><Check size={14} />Tenant scoped</b></header><State loading={detail.isLoading} error={detail.isError} empty={!detail.isLoading && !detail.isError && !movementRows.length}><div>{movementRows.map((movement: any) => <article key={movement.id}><div><strong>{movement.movementType}</strong><p>{movement.reason} · {new Date(movement.createdAt).toLocaleString("en-IN")}</p><small>{movement.workOrderId ? `Work order ${movement.workOrderId.slice(0, 8).toUpperCase()}` : "Organization stock movement"}</small></div><b className={Number(movement.quantity) < 0 ? "is-negative" : "is-positive"}>{Number(movement.quantity) > 0 ? "+" : ""}{movement.quantity} units</b></article>)}</div></State></section>
      </> : <section className="replacement-stock-empty"><PackageSearch size={22} /><div><span>Part inspector</span><h2>Select a stock record to continue</h2><p>Every available action is scoped to the SKU you choose. No inventory operation runs against an unselected part.</p></div></section>}
    </State>
  </main>;
}
