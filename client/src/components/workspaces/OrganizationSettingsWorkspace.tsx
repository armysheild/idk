import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { WorkspaceState as State } from "@/components/workspaces/WorkspaceState";
import { Plug, CheckCircle, AlertCircle } from "lucide-react";

export function OrganizationSettingsWorkspace() {
  const utils = trpc.useUtils();
  const settings = trpc.organizationSettings.get.useQuery(undefined, { retry: false });
  const [form, setForm] = useState({ timezone: "Asia/Kolkata", odometerMaxDailyKm: "1000", laborRatePerHour: "0", safetyContactName: "", safetyContactPhone: "" });
  const [activeTab, setActiveTab] = useState<"general" | "integrations">("general");
  const integrations = trpc.organizationSettings.integrations.useQuery(undefined, { retry: false });
  
  useEffect(() => { if (settings.data) setForm({ timezone: settings.data.timezone ?? "Asia/Kolkata", odometerMaxDailyKm: String(settings.data.odometerMaxDailyKm ?? 1000), laborRatePerHour: String(settings.data.laborRatePerHour ?? 0), safetyContactName: settings.data.safetyContactName ?? "", safetyContactPhone: settings.data.safetyContactPhone ?? "" }); }, [settings.data]);
  const update = trpc.organizationSettings.update.useMutation({ onSuccess: () => { toast.success("Organization settings saved"); void utils.organizationSettings.get.invalidate(); }, onError: (error) => toast.error("Settings update failed", { description: error.message }) });
  
  return (
    <section className="panel workspace-form">
      <div>
        <div className="panel-kicker">Super Admin / Owner governance</div>
        <h2>Organization settings</h2>
        <p>Configure operating controls and the internal INR labor rate used when approved work orders are posted to the ledger.</p>
      </div>
      <div className="settings-tabs">
        <button className={activeTab === "general" ? "active" : ""} onClick={() => setActiveTab("general")}>
          General
        </button>
        <button className={activeTab === "integrations" ? "active" : ""} onClick={() => setActiveTab("integrations")}>
          Integrations
        </button>
      </div>
      <State loading={settings.isLoading} error={settings.isError}>
        {activeTab === "general" ? (
          <form
            className="invite-form"
            onSubmit={(event) => {
              event.preventDefault();
              update.mutate({
                timezone: form.timezone,
                odometerMaxDailyKm: Number(form.odometerMaxDailyKm),
                laborRatePerHour: Number(form.laborRatePerHour),
                safetyContactName: form.safetyContactName || undefined,
                safetyContactPhone: form.safetyContactPhone || undefined,
              });
            }}
          >
            <label>
              Operating timezone
              <input
                required
                value={form.timezone}
                onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                placeholder="Asia/Kolkata"
              />
            </label>
            <label>
              Maximum odometer increase per day (km)
              <input
                required
                type="number"
                min="100"
                max="5000"
                value={form.odometerMaxDailyKm}
                onChange={(event) => setForm({ ...form, odometerMaxDailyKm: event.target.value })}
              />
            </label>
            <label>
              Internal labor rate (₹ / hour)
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={form.laborRatePerHour}
                onChange={(event) => setForm({ ...form, laborRatePerHour: event.target.value })}
              />
              <small>Set to 0 to leave labor cost attribution disabled.</small>
            </label>
            <label>
              Safety escalation contact
              <input
                value={form.safetyContactName}
                onChange={(event) => setForm({ ...form, safetyContactName: event.target.value })}
                placeholder="Operations control room"
              />
            </label>
            <label>
              Safety contact phone
              <input
                value={form.safetyContactPhone}
                onChange={(event) => setForm({ ...form, safetyContactPhone: event.target.value })}
                placeholder="+91 …"
              />
            </label>
            <button className="primary-button" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save organization settings"}
            </button>
          </form>
        ) : (
          <div className="integrations-grid">
            <div className="form-note" style={{ gridColumn: "1 / -1" }}>
              Telematics provider setup and vehicle-device mapping are managed by the Fleet Manager in the dedicated Telematics workspace.
            </div>
            {(integrations.data ?? []).map((integration: { provider: string; endpoint?: string; accountIdentifier?: string; active: boolean; status: string; lastCheckedAt?: string }) => (
              <IntegrationCard key={integration.provider} integration={integration} />
            ))}
          </div>
        )}
      </State>
    </section>
  );
}

function IntegrationCard({ integration }: { integration: { provider: string; endpoint?: string; accountIdentifier?: string; active: boolean; status: string; lastCheckedAt?: string } }) {
  const utils = trpc.useUtils();
  const [endpoint, setEndpoint] = useState(integration.endpoint ?? "");
  const [accountIdentifier, setAccountIdentifier] = useState(integration.accountIdentifier ?? "");
  const update = trpc.organizationSettings.updateIntegration.useMutation({
    onSuccess: () => {
      toast.success(`${integration.provider} integration saved`);
      void utils.organizationSettings.integrations.invalidate();
    },
    onError: (error) => toast.error("Integration update failed", { description: error.message }),
  });
  const name = integration.provider === "tax" ? "Tax & GST" : integration.provider.charAt(0).toUpperCase() + integration.provider.slice(1);
  const descriptions: Record<string, string> = {
    government: "Store the government verification endpoint and account used for RC and permit checks.",
    insurance: "Store the insurer endpoint and policy account used for coverage checks.",
    tax: "Store the GST service endpoint and filing account used for tax workflows.",
    fuel: "Store the fuel vendor endpoint and fleet account used for reconciliation.",
    bank: "Store the banking endpoint and account used for payment matching.",
  };
  return (
    <article className="integration-card">
      <header>
        <Plug size={20} />
        <h3>{name}</h3>
      </header>
      <p>{descriptions[integration.provider]}</p>
      <div className="integration-status">
        {integration.active ? (
          <>
            <CheckCircle size={16} />
            <span>Configured</span>
          </>
        ) : (
          <><AlertCircle size={16} /><span>Not configured</span></>
        )}
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ provider: integration.provider, endpoint: endpoint || undefined, accountIdentifier: accountIdentifier || undefined, active: true });
      }}>
        <label>Service endpoint<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://provider.example/api" /></label>
        <label>Account identifier<input value={accountIdentifier} onChange={(event) => setAccountIdentifier(event.target.value)} placeholder="Fleet or account ID" /></label>
        <div className="integration-actions">
          <button type="submit" disabled={update.isPending}>{update.isPending ? "Saving…" : "Save connection"}</button>
          {integration.active ? <button type="button" disabled={update.isPending} onClick={() => update.mutate({ provider: integration.provider, endpoint: endpoint || undefined, accountIdentifier: accountIdentifier || undefined, active: false })}>Disconnect</button> : null}
        </div>
      </form>
    </article>
  );
}
