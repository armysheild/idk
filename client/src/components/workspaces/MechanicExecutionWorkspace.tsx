import { useEffect, useRef, useState } from "react";
import { Activity, Check, ClipboardCheck, Package, Wrench } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { WorkspaceState as State } from "@/components/workspaces/WorkspaceState";
import type {
  InventoryPart,
  NotificationRow,
  ServiceComponent,
  WorkOrderRow,
} from "@/types/fleet";

const createChecklist = () => [
  {
    id: "safety",
    title: "Safety isolation and vehicle secured",
    completed: false,
  },
  {
    id: "diagnosis",
    title: "Diagnosis and affected component confirmed",
    completed: false,
  },
  {
    id: "quality",
    title: "Repair quality and handoff evidence checked",
    completed: false,
  },
];

export function MechanicExecutionWorkspace({
  organizationName,
  role = "MECHANIC",
}: {
  organizationName: string;
  role?: "MECHANIC" | "TECHNICIAN";
}) {
  const utils = trpc.useUtils();
  const orders = trpc.workOrders.list.useQuery(undefined, { retry: false });
  const components = trpc.components.list.useQuery(undefined, { retry: false });
  const inventory = trpc.inventory.references.useQuery(undefined, {
    retry: false,
  });
  const notifications = trpc.notifications.list.useQuery(undefined, {
    retry: false,
  });
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [laborHours, setLaborHours] = useState("0");
  const [repairNotes, setRepairNotes] = useState("");
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftStatus, setDraftStatus] = useState<"saved" | "offline">("saved");
  const [evidence, setEvidence] = useState<
    {
      fileData: string;
      contentType: string;
      fileName: string;
      caption?: string;
    }[]
  >([]);
  const [reservationPartId, setReservationPartId] = useState("");
  const [reservationQuantity, setReservationQuantity] = useState("1");
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState(createChecklist);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("fleetops:mechanic-execution-draft");
      if (raw) {
        const draft = JSON.parse(raw);
        setSelectedOrder(draft.selectedOrder ?? null);
        setLaborHours(draft.laborHours ?? "0");
        setRepairNotes(draft.repairNotes ?? "");
        setEvidence(draft.evidence ?? []);
        setChecklist(
          Array.isArray(draft.checklist) && draft.checklist.length
            ? draft.checklist
            : createChecklist(),
        );
      }
    } catch {
      /* ignore malformed local drafts */
    } finally {
      setDraftHydrated(true);
    }
  }, []);
  const previousOrderRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      selectedOrder &&
      previousOrderRef.current &&
      previousOrderRef.current !== selectedOrder
    )
      setChecklist(createChecklist());
    previousOrderRef.current = selectedOrder;
  }, [selectedOrder]);
  useEffect(() => {
    if (!draftHydrated) return;
    const hasDraft = Boolean(
      selectedOrder ||
      repairNotes.trim() ||
      laborHours !== "0" ||
      evidence.length ||
      checklist.some((item) => item.completed),
    );
    if (!hasDraft) {
      localStorage.removeItem("fleetops:mechanic-execution-draft");
      return;
    }
    localStorage.setItem(
      "fleetops:mechanic-execution-draft",
      JSON.stringify({
        selectedOrder,
        laborHours,
        repairNotes,
        evidence,
        checklist,
      }),
    );
    setDraftStatus(navigator.onLine ? "saved" : "offline");
  }, [
    draftHydrated,
    selectedOrder,
    laborHours,
    repairNotes,
    evidence,
    checklist,
  ]);
  const start = trpc.workOrders.startWork.useMutation({
    onSuccess: () => {
      toast.success("Work started");
      void utils.workOrders.list.invalidate();
    },
    onError: (error) =>
      toast.error("Could not start work", { description: error.message }),
  });
  const transition = trpc.workOrders.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Work-order state updated");
      void utils.workOrders.list.invalidate();
      void utils.workOrders.board.invalidate();
    },
    onError: (error) =>
      toast.error("State update failed", { description: error.message }),
  });
  const reservePart = trpc.workOrders.reservePart.useMutation({
    onSuccess: () => {
      setReservationId(`${reservationPartId}:${reservationQuantity}`);
      toast.success("Part reserved for this work order");
    },
    onError: (error) =>
      toast.error("Part reservation failed", { description: error.message }),
  });
  const returnPart = trpc.workOrders.returnReservedPart.useMutation({
    onSuccess: () => {
      setReservationId(null);
      toast.success("Reserved part returned");
    },
    onError: (error) =>
      toast.error("Part return failed", { description: error.message }),
  });
  const saveChecklist = trpc.workOrders.updateChecklist.useMutation({
    onSuccess: () => toast.success("Execution checklist saved"),
    onError: (error) =>
      toast.error("Checklist save failed", { description: error.message }),
  });
  const complete = trpc.workOrders.complete.useMutation({
    onSuccess: () => {
      toast.success("Work order submitted for Fleet Manager review", {
        description:
          "Inventory and accounting close after the handoff is approved.",
      });
      setSelectedOrder(null);
      setLaborHours("0");
      setRepairNotes("");
      setEvidence([]);
      setChecklist(createChecklist());
      localStorage.removeItem("fleetops:mechanic-execution-draft");
      setDraftStatus("saved");
      void utils.workOrders.list.invalidate();
      void utils.workOrders.board.invalidate();
      void utils.notifications.list.invalidate();
      void utils.inventory.list.invalidate();
      void utils.inventory.movements.invalidate();
    },
    onError: (error) =>
      toast.error("Completion failed", { description: error.message }),
  });
  const submitCompletion = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    if (!checklist.length || checklist.some((item) => !item.completed)) {
      toast.error("Complete every execution checklist item before submitting.");
      return;
    }
    try {
      await saveChecklist.mutateAsync({
        workOrderId: selected.id,
        items: checklist,
      });
      await complete.mutateAsync({
        workOrderId: selected.id,
        expectedUpdatedAt: selected.updatedAt,
        laborHours: Number(laborHours),
        repairNotes,
        evidence,
      });
    } catch {
      /* mutation handlers show the actionable error */
    }
  };
  const open =
    orders.data?.filter((item: WorkOrderRow) => item.status !== "COMPLETED") ??
    [];
  const activeRepairs = open.filter(
    (item: WorkOrderRow) =>
      item.status === "IN_PROGRESS" || item.status === "REWORK",
  ).length;
  const waitingForParts = open.filter(
    (item: WorkOrderRow) => item.status === "WAITING_FOR_PARTS",
  ).length;
  const readyForReview = open.filter(
    (item: WorkOrderRow) => item.status === "READY_FOR_REVIEW",
  ).length;
  const selected = orders.data?.find(
    (item: WorkOrderRow) => item.id === selectedOrder,
  );
  const handleEvidence = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, 8);
    void Promise.all(
      files.map(
        (file) =>
          new Promise<{
            fileData: string;
            contentType: string;
            fileName: string;
          }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                fileData: String(reader.result),
                contentType: file.type,
                fileName: file.name,
              });
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          }),
      ),
    )
      .then((items) => setEvidence(items))
      .catch(() => toast.error("Evidence file could not be read"));
  };
  const label = role === "TECHNICIAN" ? "Technician" : "Mechanic";
  const actionFor = (item: WorkOrderRow) =>
    item.status === "COMPLETED" ? (
      <b className="is-safe">Completed</b>
    ) : item.status === "CANCELLED" ? (
      <b className="is-alert">Cancelled</b>
    ) : (
      <aside>
        {item.status === "OPEN" && (
          <button
            className="replacement-mechanic-secondary"
            disabled={start.isPending}
            onClick={() => start.mutate({ workOrderId: item.id })}
          >
            Start work
          </button>
        )}
        {item.status === "IN_PROGRESS" && (
          <>
            <button
              className="replacement-mechanic-secondary"
              disabled={transition.isPending}
              onClick={() =>
                transition.mutate({
                  workOrderId: item.id,
                  status: "WAITING_FOR_PARTS",
                  expectedUpdatedAt: item.updatedAt,
                })
              }
            >
              Parts hold
            </button>
            <button
              className="replacement-mechanic-secondary"
              type="button"
              onClick={() => setSelectedOrder(item.id)}
            >
              Open completion
            </button>
          </>
        )}
        {item.status === "WAITING_FOR_PARTS" && (
          <button
            className="replacement-mechanic-secondary"
            disabled={transition.isPending}
            onClick={() =>
              transition.mutate({
                workOrderId: item.id,
                status: "IN_PROGRESS",
                expectedUpdatedAt: item.updatedAt,
              })
            }
          >
            Resume work
          </button>
        )}
        {item.status === "READY_FOR_REVIEW" && (
          <button
            className="replacement-mechanic-secondary"
            disabled={transition.isPending}
            onClick={() =>
              transition.mutate({ workOrderId: item.id, status: "REWORK" })
            }
          >
            Request rework
          </button>
        )}
        {item.status === "REWORK" && (
          <button
            className="replacement-mechanic-secondary"
            disabled={transition.isPending}
            onClick={() =>
              transition.mutate({
                workOrderId: item.id,
                status: "IN_PROGRESS",
                expectedUpdatedAt: item.updatedAt,
              })
            }
          >
            Resume rework
          </button>
        )}
        {["IN_PROGRESS", "REWORK"].includes(item.status) && (
          <button
            className="replacement-mechanic-primary"
            onClick={() => setSelectedOrder(item.id)}
          >
            <Check size={14} />
            Complete
          </button>
        )}
      </aside>
    );

  return (
    <main className="replacement-mechanic-execution">
      <header className="replacement-mechanic-hero">
        <div>
          <span>{label} workspace · repair handoff</span>
          <h1>
            Make every repair a traceable return to service<em>.</em>
          </h1>
          <p>
            {organizationName} work stays limited to the orders assigned to you.
            Capture the repair evidence, parts, labor, and checklist before it
            moves to Fleet Manager review.
          </p>
        </div>
        <div className="replacement-mechanic-hero-chip">
          <Wrench size={20} />
          <strong>{open.length}</strong>
          <small>assigned repair orders</small>
        </div>
      </header>
      <section
        className="replacement-mechanic-signals"
        aria-label={`${label} execution summary`}
      >
        <article>
          <ClipboardCheck size={17} />
          <span>Assigned queue</span>
          <strong>{open.length}</strong>
          <small>tenant-scoped work orders</small>
        </article>
        <article>
          <Activity size={17} />
          <span>Active repair</span>
          <strong>{activeRepairs}</strong>
          <small>in progress or rework</small>
        </article>
        <article className={waitingForParts ? "is-alert" : "is-safe"}>
          <Package size={17} />
          <span>Parts hold</span>
          <strong>{waitingForParts}</strong>
          <small>waiting for inventory</small>
        </article>
        <article className={readyForReview ? "is-alert" : "is-safe"}>
          <Check size={17} />
          <span>Review handoff</span>
          <strong>{readyForReview}</strong>
          <small>ready for Fleet Manager</small>
        </article>
      </section>
      <section className="replacement-mechanic-layout">
        <article className="replacement-mechanic-queue">
          <header>
            <div>
              <span>01 · assigned work</span>
              <h2>Repair queue</h2>
            </div>
            <b>{components.data?.length ?? 0} components in context</b>
          </header>
          <State
            loading={orders.isLoading}
            error={orders.isError}
            empty={!orders.isLoading && !orders.isError && !orders.data?.length}
          >
            <div>
              {orders.data?.map((item: WorkOrderRow) => (
                <article key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <p>
                      {item.vehicle?.licensePlate ?? item.vehicleId} ·{" "}
                      {item.priority} · {item.status}
                      {item.laborHours
                        ? ` · ${item.laborHours} labor hours`
                        : ""}
                    </p>
                  </div>
                  {actionFor(item)}
                </article>
              ))}
            </div>
          </State>
        </article>
        <article className="replacement-mechanic-record">
          <header>
            <div>
              <span>02 · execution record</span>
              <h2>
                {selected ? `Complete: ${selected.title}` : "Select a repair"}
              </h2>
            </div>
            <b>
              {draftStatus === "offline" ? "Offline draft" : "Draft synced"}
            </b>
          </header>
          {selected ? (
            <form onSubmit={submitCompletion}>
              <label>
                Labor hours
                <input
                  required
                  type="number"
                  min="0"
                  max="1000"
                  step="0.25"
                  value={laborHours}
                  onChange={(event) => setLaborHours(event.target.value)}
                />
              </label>
              <label>
                Repair notes
                <textarea
                  required
                  minLength={3}
                  maxLength={5000}
                  value={repairNotes}
                  onChange={(event) => setRepairNotes(event.target.value)}
                  placeholder="Describe diagnosis, repair performed, and handoff notes"
                />
              </label>
              <small className="workspace-draft-status">
                {draftStatus === "offline"
                  ? "Offline draft saved locally; sync when connectivity returns."
                  : "Execution draft saved locally while you work."}
              </small>
              <fieldset>
                <legend>Execution checklist</legend>
                {checklist.map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={(event) =>
                        setChecklist((current) =>
                          current.map((entry) =>
                            entry.id === item.id
                              ? { ...entry, completed: event.target.checked }
                              : entry,
                          ),
                        )
                      }
                    />{" "}
                    {item.title}
                  </label>
                ))}
                <button
                  type="button"
                  className="replacement-mechanic-secondary"
                  disabled={saveChecklist.isPending}
                  onClick={() =>
                    saveChecklist.mutate({
                      workOrderId: selected.id,
                      items: checklist,
                    })
                  }
                >
                  Save checklist
                </button>
              </fieldset>
              <fieldset>
                <legend>Part reservation</legend>
                <label>
                  Inventory part
                  <select
                    value={reservationPartId}
                    onChange={(event) =>
                      setReservationPartId(event.target.value)
                    }
                  >
                    <option value="">Select inventory part</option>
                    {inventory.data?.map(
                      (part: Pick<InventoryPart, "id" | "sku" | "name">) => (
                        <option key={part.id} value={part.id}>
                          {part.sku} · {part.name}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <div>
                  <input
                    type="number"
                    min="1"
                    value={reservationQuantity}
                    onChange={(event) =>
                      setReservationQuantity(event.target.value)
                    }
                    aria-label="Reservation quantity"
                  />
                  <button
                    type="button"
                    className="replacement-mechanic-secondary"
                    disabled={!reservationPartId || reservePart.isPending}
                    onClick={() =>
                      reservePart.mutate({
                        workOrderId: selected.id,
                        partId: reservationPartId,
                        quantity: Number(reservationQuantity),
                      })
                    }
                  >
                    Reserve part
                  </button>
                  {reservationId && (
                    <button
                      type="button"
                      className="replacement-mechanic-secondary"
                      disabled={returnPart.isPending}
                      onClick={() =>
                        returnPart.mutate({
                          workOrderId: selected.id,
                          partId: reservationPartId,
                          quantity: Number(reservationQuantity),
                        })
                      }
                    >
                      Return reserved
                    </button>
                  )}
                </div>
              </fieldset>
              <label>
                Photo / evidence attachments
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleEvidence}
                />
                <small>
                  {evidence.length
                    ? `${evidence.length} image${evidence.length === 1 ? "" : "s"} ready to upload`
                    : "Attach up to 8 images from the repair bay."}
                </small>
              </label>
              <div className="replacement-mechanic-record-actions">
                <button
                  className="replacement-mechanic-primary"
                  disabled={
                    complete.isPending ||
                    saveChecklist.isPending ||
                    !repairNotes.trim()
                  }
                >
                  <Check size={15} />
                  Submit for review
                </button>
                <button
                  type="button"
                  className="replacement-mechanic-secondary"
                  onClick={() => setSelectedOrder(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="replacement-mechanic-empty">
              Choose <b>Complete</b> on an assigned work order to record labor,
              notes, checklist, evidence, and the parts handoff.
            </div>
          )}
        </article>
      </section>
      <section className="replacement-mechanic-context">
        <header>
          <span>03 · execution context</span>
          <h2>Service components</h2>
        </header>
        <div>
          {components.data?.slice(0, 8).map((item: ServiceComponent) => (
            <article key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <p>
                  {item.vehicleId} · service every{" "}
                  {Number(item.expectedLifeKm).toLocaleString("en-IN")} km
                </p>
              </div>
              <b>Ready</b>
            </article>
          )) ?? (
            <div className="replacement-mechanic-empty">
              No component context available.
            </div>
          )}
        </div>
        <small>
          {notifications.data?.filter((item: NotificationRow) => !item.isRead)
            .length ?? 0}{" "}
          unread recipient-scoped alerts
        </small>
      </section>
    </main>
  );
}
