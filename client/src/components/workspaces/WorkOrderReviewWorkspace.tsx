import { Check, ClipboardCheck, PackageCheck, ShieldCheck, Wrench } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ResourceWorkspace } from "@/components/workspaces/ResourceWorkspace";
import { formatVehicleIdentity } from "@/lib/vehicleIdentity";
import type { WorkOrderRow } from "@/types/fleet";

export function WorkOrderReviewWorkspace({ organizationName }: { organizationName?: string }) {
  const utils = trpc.useUtils();
  const orders = trpc.workOrders.list.useQuery(undefined, { retry: false });
  const approve = trpc.workOrders.approve.useMutation({
    onSuccess: () => {
      toast.success("Work order approved", { description: "Component service, inventory issue, and financial entries are now reflected." });
      void utils.workOrders.list.invalidate();
      void utils.workOrders.board.invalidate();
      void utils.components.list.invalidate();
      void utils.vehicles.list.invalidate();
      void utils.dashboard.summary.invalidate();
      void utils.inventory.list.invalidate();
      void utils.inventory.movements.invalidate();
      void utils.financials.list.invalidate();
      void utils.financials.metrics.invalidate();
      void utils.notifications.list.invalidate();
    },
    onError: (error) => toast.error("Work order approval failed", { description: error.message }),
  });
  const reviewOrders = (orders.data ?? []).filter((order: WorkOrderRow) => order.status === "READY_FOR_REVIEW");

  return <div className="replacement-dispatch">
    <header className="replacement-page-hero"><div><span>03 · Maintenance dispatch</span><h1>Move every repair through a visible handoff<em>.</em></h1><p>Dispatch stays connected to the VIN, mechanic, reserved part, lifecycle baseline, proof, and financial close.</p></div><div className="replacement-hero-stat"><ClipboardCheck size={20} /><strong>{reviewOrders.length}</strong><small>awaiting review</small></div></header>
    {reviewOrders.length > 0 ? <section className="replacement-review-deck" aria-label="Work order review queue"><div className="replacement-board-head"><div><span>Approval decision</span><h2>Ready for manager review</h2></div><div><ShieldCheck size={15} /> Audit retained</div></div><div className="replacement-review-list">{reviewOrders.map((order: WorkOrderRow) => <article key={order.id}><header><span><ClipboardCheck size={18} /></span><div><small>Mechanic submitted · decision required</small><h3>{order.title}</h3><p>{order.vehicle ? formatVehicleIdentity(order.vehicle) : order.vehicleId} · {order.priority} priority</p></div><b>READY FOR REVIEW</b></header><div className="replacement-review-checkpoints"><div><Wrench size={15} /><span>Execution</span><strong>{Number(order.laborHours ?? 0).toLocaleString("en-IN")} labor hours</strong></div><div><ClipboardCheck size={15} /><span>Assignee</span><strong>{order.assignedMechanic?.fullName ?? "Mechanic record"}</strong></div><div><PackageCheck size={15} /><span>Inventory</span><strong>Reserved part issues on approval</strong></div><div><ShieldCheck size={15} /><span>Lifecycle</span><strong>Baseline updates when applicable</strong></div></div><footer><p>Approval records the inventory issue, component reset where applicable, and maintenance cost record from this submitted handoff.</p><button type="button" className="replacement-primary" disabled={approve.isPending} onClick={() => approve.mutate({ workOrderId: order.id })}><Check size={15} />{approve.isPending ? "Approving…" : "Approve handoff"}</button></footer></article>)}</div></section> : null}
    <section className="replacement-dispatch-board"><div className="replacement-board-head"><div><span>Dispatch board</span><h2>Schedule and route maintenance work</h2></div><div><Wrench size={15} /> Live organization queue</div></div><ResourceWorkspace section="Work orders" organizationName={organizationName} /></section>
  </div>;
}
