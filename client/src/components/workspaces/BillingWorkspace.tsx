import { Check, IndianRupee, Lock } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { WorkspaceState as State } from "@/components/workspaces/WorkspaceState";

const PER_VEHICLE_FEE_INR = 300;
const CUSTOM_MIN_VEHICLES = 50;
const TRIAL_DAYS = 14;

type BillingStatus = {
  planName?: string;
  tier?: string;
  lifecycle?: string;
  status?: string;
  isTrial?: boolean;
  writeLocked?: boolean;
  billingBlocked?: boolean;
  activeVehicles?: number;
  vehicleCount?: number;
  vehicleCap?: number | null;
  peakVehicles?: number;
  maxVehicles?: number;
  trialEndsOn?: string;
  renewsOn?: string;
  estimatedSubtotalPaise?: number;
  perVehicleFeePaise?: number;
};

type CheckoutResult = { short_url?: string; shortUrl?: string; subscription_id?: string };

function daysUntil(value?: string): number | null {
  if (!value) return null;
  const end = new Date(value);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - Date.now()) / 86400000);
}

export function BillingWorkspace() {
  const utils = trpc.useUtils();
  const billing = trpc.billing.status.useQuery(undefined, { retry: false });
  const invoices = trpc.billing.invoices.useQuery(undefined, { retry: false });
  const checkout = trpc.billing.checkout.useMutation({
    onSuccess: (result: CheckoutResult) => {
      const url = result.short_url ?? result.shortUrl;
      if (url) {
        toast.success("Opening Razorpay checkout");
        window.location.href = url;
      } else {
        toast.success("Subscription created — Razorpay will contact you to complete authorization");
      }
      void utils.billing.status.invalidate();
    },
    onError: (error: Error) => toast.error("Checkout failed", { description: error.message }),
  });

  const data = (billing.data ?? {}) as BillingStatus;
  const vehicles = data.activeVehicles ?? data.vehicleCount ?? 0;
  const cap = data.vehicleCap ?? null;
  const peak = data.peakVehicles ?? vehicles;
  const monthlyTotal = vehicles * PER_VEHICLE_FEE_INR;
  const trialDaysLeft = daysUntil(data.trialEndsOn);
  const inTrial = data.isTrial === true || data.status === "trialing";
  const trialExpired = inTrial && trialDaysLeft !== null && trialDaysLeft < 0;
  const blocked = data.billingBlocked === true || data.writeLocked === true;
  const capacityPct = cap ? Math.min(100, (vehicles / cap) * 100) : 0;
  const canCustom = vehicles >= CUSTOM_MIN_VEHICLES;

  return <main className="replacement-billing">
    <header className="replacement-billing-hero">
      <div>
        <span>Billing · Owner</span>
        <h1>₹300 per vehicle. Nothing else<em>.</em></h1>
        <p>One flat monthly rate at every fleet size. You pay for the largest fleet you operate in a billing period — deleted vehicles still count until the period renews.</p>
      </div>
      <div className="replacement-billing-hero-chip"><IndianRupee size={20} /><strong>{vehicles}</strong><small>vehicles billed</small></div>
    </header>

    <State loading={billing.isLoading} error={billing.isError} empty={!billing.data}>
      {inTrial && !trialExpired && (
        <section className="replacement-billing-trial">
          <strong>{trialDaysLeft ?? TRIAL_DAYS} days left in your free trial</strong>
          <p>Full access to every workspace until {data.trialEndsOn ?? "trial end"}. Subscribe before it ends — billing only starts after the trial, and your peak vehicle count sets the first invoice.</p>
        </section>
      )}
      {(trialExpired || blocked) && (
        <section className="replacement-billing-trial is-expired">
          <strong>Your free trial has ended</strong>
          <p>Operational writes are paused for every member of this organization. Reactivate below — your fleet, work orders, and records are intact.</p>
        </section>
      )}

      <section className="replacement-billing-signals">
        <article><span>Plan</span><strong>{data.planName ?? "VahanSync Fleet"}</strong><small>{data.status === "active" ? "Active subscription" : data.lifecycle?.replaceAll("_", " ") ?? "trialing"}</small></article>
        <article><span>Rate</span><strong>₹{PER_VEHICLE_FEE_INR} / vehicle / month</strong><small>prepaid monthly, flat at every size</small></article>
        <article><span>Vehicle capacity</span><strong>{cap ? `${vehicles} / ${cap}` : `${vehicles} (uncapped)`}</strong><small>{cap ? `${Math.max(0, cap - vehicles)} slots remaining` : "no cap during trial"}</small></article>
        <article><span>{inTrial ? "First invoice (at trial end)" : "Monthly total"}</span><strong>₹{(cap ? Math.max(peak, vehicles) : vehicles) * PER_VEHICLE_FEE_INR /* preview */}</strong><small>{peak > vehicles ? `peak of ${peak} vehicles this period` : "based on current fleet"}</small></article>
      </section>

      <section className="replacement-billing-capacity">
        <header><div><span>01 · your plan</span><h2>Monthly — pay as you operate</h2></div><b>₹{monthlyTotal.toLocaleString("en-IN")} this month at current fleet</b></header>
        <div className="replacement-billing-track"><span style={{ width: `${cap ? capacityPct : 60}%` }} /></div>
        <p>{cap
          ? `Your paid capacity is ${cap} vehicles — every vehicle created counts toward the bill for this period, even if deleted before invoicing. Paying for ${cap}, currently operating ${vehicles}.`
          : `${vehicles} vehicles × ₹${PER_VEHICLE_FEE_INR} = ₹${monthlyTotal.toLocaleString("en-IN")} per month. All workspaces, all roles, no per-feature pricing.`}</p>
        <div className="replacement-billing-rate-card">
          <ul>
            <li><Check size={14} /> ₹300 × your largest fleet size in the period</li>
            <li><Check size={14} /> Every workspace included — fleet, maintenance, inventory, compliance, finance</li>
            <li><Check size={14} /> Deleted vehicles still count until the period renews</li>
          </ul>
          {data.status === "active" && data.renewsOn
            ? <small>Renews {data.renewsOn} · Razorpay subscription {data.tier ?? "flat"}</small>
            : <button type="button" className="replacement-billing-primary" onClick={() => checkout.mutate({ plan_code: "flat" })} disabled={checkout.isPending}>
                {checkout.isPending ? "Opening Razorpay…" : `Pay ₹${monthlyTotal.toLocaleString("en-IN")} with Razorpay`}
              </button>}
        </div>
      </section>

      <section className="replacement-billing-capacity">
        <header><div><span>02 · annual</span><h2>Custom — pay 10 months, get 12</h2></div><b>{canCustom ? `${CUSTOM_MIN_VEHICLES}+ fleets` : `needs ${CUSTOM_MIN_VEHICLES}+ vehicles`}</b></header>
        <p>₹3,000 per vehicle per year for committed fleets — two months free against the monthly rate. Arranged offline with our team, invoiced annually.</p>
        <div className="replacement-billing-rate-card">
          <ul>
            <li><Check size={14} /> ₹3,000 × vehicles per year — same product, billed annually</li>
            <li><Check size={14} /> {canCustom ? `Your ${vehicles} vehicles ≈ ₹${(vehicles * 3000).toLocaleString("en-IN")}/year` : `Available once your fleet reaches ${CUSTOM_MIN_VEHICLES} vehicles`}</li>
            <li><Check size={14} /> Dedicated onboarding and priority support</li>
          </ul>
          {canCustom
            ? <a className="replacement-billing-primary" href="mailto:sales@vahansync.in?subject=Custom%20annual%20plan"><Lock size={12} /> Contact sales for annual pricing</a>
            : <small><Lock size={11} /> Locked — annual pricing unlocks at {CUSTOM_MIN_VEHICLES} vehicles so smaller fleets can't take the discount meant for large operators.</small>}
        </div>
      </section>
    </State>

    <section className="replacement-billing-invoices">
      <header><div><span>03 · invoice history</span><h2>Billing record</h2></div><b>{invoices.data?.length ?? 0} entries</b></header>
      <State loading={invoices.isLoading} error={invoices.isError} empty={!invoices.isLoading && !(invoices.data ?? []).length}>
        <div>{(invoices.data ?? []).map((invoice: { id: string; plan: string; periodStart?: string; billingPeriodStart?: string; billableVehicles?: number; status: string; totalPaise?: number }) =>
          <article key={invoice.id}>
            <div>
              <strong>{invoice.plan} · {(invoice.periodStart ?? invoice.billingPeriodStart) ? new Date(invoice.periodStart ?? invoice.billingPeriodStart!).toLocaleDateString("en-IN") : "Draft"}</strong>
              <p>{invoice.billableVehicles ?? 0} billed vehicles · {invoice.status}</p>
            </div>
            <b>₹{(Number(invoice.totalPaise ?? 0) / 100).toLocaleString("en-IN")}</b>
          </article>)}
        </div>
      </State>
    </section>
  </main>;
}
