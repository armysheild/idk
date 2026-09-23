import { Check } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { WorkspaceState as State } from "@/components/workspaces/WorkspaceState";

export function BillingWorkspace() {
  const utils = trpc.useUtils(); 
  const billing = trpc.billing.status.useQuery(undefined, { retry: false }); 
  const invoices = trpc.billing.invoices.useQuery(undefined, { retry: false }); 
  const plans = trpc.billing.plans.useQuery(undefined, { retry: false }); 
  const activateStarter = trpc.billingTest.activateStarter.useMutation({ onSuccess: (result) => { toast.success(result.alreadyActive ? "Starter plan already active" : "Starter test plan activated", { description: result.alreadyActive ? `${result.maxVehicles} vehicle capacity remains available.` : `Razorpay Test Mode activated ${result.maxVehicles} vehicle capacity for this tenant.` }); void utils.billing.status.invalidate(); void utils.dashboard.summary.invalidate(); void utils.vehicles.list.invalidate(); }, onError: (error) => toast.error("Starter test activation failed", { description: error.message }) });
  
  const data = billing.data; 
  const activeVehicles = data?.activeVehicles ?? 0;
  const showTestActivation = data?.isTrial === true && data?.tier === "TRIAL_FREE"; 
  const capacity = data?.maxVehicles ? Math.min(100, (activeVehicles / data.maxVehicles) * 100) : 0;
  
  // Determine recommended plan based on vehicle count
  const getRecommendedPlan = (vehicles: number) => {
    if (vehicles >= 100) return "ENTERPRISE";
    if (vehicles >= 50) return "SCALE";
    if (vehicles >= 11) return "GROWTH";
    return "STARTER";
  };
  
  // Check if plan is eligible
  const isPlanEligible = (plan: { id: string; minVehicles?: number; maxVehicles?: number }) => {
    if (!plan.minVehicles || !plan.maxVehicles) return true;
    return activeVehicles >= plan.minVehicles && activeVehicles <= plan.maxVehicles;
  };
  
  // Get eligibility message
  const getEligibilityMessage = (plan: { id: string; minVehicles?: number; maxVehicles?: number }) => {
    if (!plan.minVehicles || !plan.maxVehicles) return null;
    if (activeVehicles < plan.minVehicles) {
      return `Add ${plan.minVehicles - activeVehicles} more vehicle${plan.minVehicles - activeVehicles !== 1 ? "s" : ""} to unlock this tier`;
    }
    if (activeVehicles > plan.maxVehicles) {
      return `Remove ${activeVehicles - plan.maxVehicles} vehicle${activeVehicles - plan.maxVehicles !== 1 ? "s" : ""} or upgrade to next tier`;
    }
    return "Perfect fit for your fleet size";
  };
  
  const recommendedPlan = getRecommendedPlan(activeVehicles);
  
  return <main className="replacement-billing"><header className="replacement-billing-hero"><div><span>Subscription governance · organization owner</span><h1>Keep capacity and operating access explicit<em>.</em></h1><p>Plan, lifecycle, vehicle utilization, invoice history, and the approved Test Mode activation stay visible without exposing payment controls to operational roles.</p></div><div className="replacement-billing-hero-chip"><Check size={20} /><strong>{activeVehicles}</strong><small>active vehicles</small></div></header><State loading={billing.isLoading} error={billing.isError} empty={!data}><section className="replacement-billing-signals"><article><span>Current plan</span><strong>{data?.planName ?? data?.tier?.replaceAll("_", " ")}</strong><small>{data?.writeLocked ? "Writes locked" : "Live status"}</small></article><article><span>Lifecycle</span><strong>{data?.lifecycle?.replaceAll("_", " ") ?? "—"}</strong><small>organization subscription</small></article><article><span>Vehicle capacity</span><strong>{activeVehicles} / {data?.maxVehicles ?? "—"}</strong><small>{data?.overageVehicles ? `${data.overageVehicles} overage vehicles` : "within included capacity"}</small></article><article><span>Monthly subtotal</span><strong>₹{data?.estimatedSubtotalPaise ? (data.estimatedSubtotalPaise / 100).toLocaleString("en-IN") : "—"}</strong><small>estimated operating total</small></article></section><section className="replacement-billing-capacity"><header><div><span>01 · capacity control</span><h2>Vehicle utilization</h2></div><b>{Math.round(capacity)}% of included capacity</b></header><div className="replacement-billing-track"><span style={{ width: `${capacity}%` }} /></div><p>{data?.writeLocked ? "The account is suspended. Historical data and export access remain available; operational writes are restricted by the API." : showTestActivation ? "This tenant is in its trial period. Select and activate a plan to start your subscription." : `The ${data?.planName ?? "selected"} plan is active and capacity is enforced by the organization subscription record.`}</p>{showTestActivation && <div><button type="button" className="replacement-billing-primary" onClick={() => activateStarter.mutate()} disabled={activateStarter.isPending}>{activateStarter.isPending ? "Activating test plan…" : "Activate Starter test plan"}</button><small>Razorpay Test Mode only · no real payment</small></div>}</section></State><section className="replacement-billing-plans"><header><div><span>02 · plan reference</span><h2>Capacity catalog</h2></div><b>Based on {activeVehicles} active vehicle{activeVehicles !== 1 ? "s" : ""}</b></header><div className="billing-plans-grid">{(plans.data ?? []).map((plan) => { const eligible = isPlanEligible(plan); const isRecommended = plan.id === recommendedPlan; const eligibilityMsg = getEligibilityMessage(plan); return <article key={plan.id} className={`${plan.id === data?.tier ? "is-selected" : ""} ${isRecommended ? "is-recommended" : ""} ${!eligible ? "is-disabled" : ""}`}><div className="plan-header"><strong>{plan.name}</strong>{isRecommended && <span className="recommended-badge">⭐ Recommended</span>}</div><b>₹{plan.platformFeeInr.toLocaleString("en-IN")}/month</b><span className="plan-detail">Includes {plan.includedVehicles} vehicles · ₹{plan.overageVehicleFeeInr.toLocaleString("en-IN")} per overage</span>{plan.minVehicles && <span className="plan-range">{plan.minVehicles}-{plan.maxVehicles === 999999 ? "∞" : plan.maxVehicles} vehicles</span>}<div className={`plan-status ${eligible ? "eligible" : "ineligible"}`}>{eligible ? "✅ Eligible" : "❌ Not eligible"}</div>{eligibilityMsg && <small className="eligibility-message">{eligibilityMsg}</small>}</article>; })}</div></section><section className="replacement-billing-invoices"><header><div><span>03 · invoice history</span><h2>Organization billing record</h2></div><b>{invoices.data?.length ?? 0} entries</b></header><State loading={invoices.isLoading} error={invoices.isError} empty={!invoices.isLoading && !(invoices.data ?? []).length}><div>{(invoices.data ?? []).map((invoice: { id: string; plan: string; billingPeriodStart?: string | Date | null; billableVehicles: number; status: string; totalPaise?: number; subtotalPaise?: number }) => <article key={invoice.id}><div><strong>{invoice.plan} · {invoice.billingPeriodStart ? new Date(invoice.billingPeriodStart).toLocaleDateString("en-IN") : "Draft"}</strong><p>{invoice.billableVehicles} active vehicles · {invoice.status}</p></div><b>₹{(Number(invoice.totalPaise ?? invoice.subtotalPaise ?? 0) / 100).toLocaleString("en-IN")}</b></article>)}</div></State></section></main>;
}
