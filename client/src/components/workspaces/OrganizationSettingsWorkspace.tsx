import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { WorkspaceState as State } from "@/components/workspaces/WorkspaceState";
import { Plug, CheckCircle, AlertCircle, RefreshCw } from "lucide-react";

export function OrganizationSettingsWorkspace() {
  const utils = trpc.useUtils();
  const settings = trpc.organizationSettings.get.useQuery(undefined, { retry: false });
  const [form, setForm] = useState({ timezone: "Asia/Kolkata", odometerMaxDailyKm: "1000", laborRatePerHour: "0", safetyContactName: "", safetyContactPhone: "" });
  const [activeTab, setActiveTab] = useState<"general" | "integrations">("general");
  const [integrationStates, setIntegrationStates] = useState<Record<string, { connected: boolean; lastSync?: string; error?: string }>>({
    telematics: { connected: false },
    government: { connected: false },
    insurance: { connected: false },
    tax: { connected: false },
    fuel: { connected: false },
    bank: { connected: false },
  });
  
  useEffect(() => { if (settings.data) setForm({ timezone: settings.data.timezone ?? "Asia/Kolkata", odometerMaxDailyKm: String(settings.data.odometerMaxDailyKm ?? 1000), laborRatePerHour: String(settings.data.laborRatePerHour ?? 0), safetyContactName: settings.data.safetyContactName ?? "", safetyContactPhone: settings.data.safetyContactPhone ?? "" }); }, [settings.data]);
  const update = trpc.organizationSettings.update.useMutation({ onSuccess: () => { toast.success("Organization settings saved"); void utils.organizationSettings.get.invalidate(); }, onError: (error) => toast.error("Settings update failed", { description: error.message }) });
  
  const handleIntegrationConnect = (provider: string) => {
    toast.success(`${provider} integration initiated. Redirecting to auth...`);
    // Placeholder for actual auth flow
  };

  const handleIntegrationSync = (provider: string) => {
    toast.loading(`Syncing ${provider}...`);
    // Placeholder for actual sync
    setTimeout(() => {
      setIntegrationStates(prev => ({
        ...prev,
        [provider]: { ...prev[provider], lastSync: new Date().toLocaleString("en-IN") }
      }));
      toast.success(`${provider} synced successfully`);
    }, 1000);
  };

  return (
    <section className="panel workspace-form">
      <div>
        <div className="panel-kicker">Superadmin governance</div>
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
            <IntegrationCard
              name="Telematics"
              description="GPS tracking, fuel consumption, and odometer data"
              state={integrationStates.telematics}
              onConnect={() => handleIntegrationConnect("telematics")}
              onSync={() => handleIntegrationSync("telematics")}
              setState={(state) => setIntegrationStates(prev => ({ ...prev, telematics: state }))}
            />
            <IntegrationCard
              name="Government"
              description="Vehicle RC verification and permit validation"
              state={integrationStates.government}
              onConnect={() => handleIntegrationConnect("government")}
              onSync={() => handleIntegrationSync("government")}
              setState={(state) => setIntegrationStates(prev => ({ ...prev, government: state }))}
            />
            <IntegrationCard
              name="Insurance"
              description="Policy dates and coverage verification"
              state={integrationStates.insurance}
              onConnect={() => handleIntegrationConnect("insurance")}
              onSync={() => handleIntegrationSync("insurance")}
              setState={(state) => setIntegrationStates(prev => ({ ...prev, insurance: state }))}
            />
            <IntegrationCard
              name="Tax & GST"
              description="GST return generation and filing"
              state={integrationStates.tax}
              onConnect={() => handleIntegrationConnect("tax")}
              onSync={() => handleIntegrationSync("tax")}
              setState={(state) => setIntegrationStates(prev => ({ ...prev, tax: state }))}
            />
            <IntegrationCard
              name="Fuel"
              description="Fuel vendor API for auto-reconciliation"
              state={integrationStates.fuel}
              onConnect={() => handleIntegrationConnect("fuel")}
              onSync={() => handleIntegrationSync("fuel")}
              setState={(state) => setIntegrationStates(prev => ({ ...prev, fuel: state }))}
            />
            <IntegrationCard
              name="Bank"
              description="Payment reconciliation and transaction matching"
              state={integrationStates.bank}
              onConnect={() => handleIntegrationConnect("bank")}
              onSync={() => handleIntegrationSync("bank")}
              setState={(state) => setIntegrationStates(prev => ({ ...prev, bank: state }))}
            />
          </div>
        )}
      </State>
    </section>
  );
}

function IntegrationCard({
  name,
  description,
  state,
  onConnect,
  onSync,
  setState,
}: {
  name: string;
  description: string;
  state: { connected: boolean; lastSync?: string; error?: string };
  onConnect: () => void;
  onSync: () => void;
  setState: (state: { connected: boolean; lastSync?: string; error?: string }) => void;
}) {
  return (
    <article className="integration-card">
      <header>
        <Plug size={20} />
        <h3>{name}</h3>
      </header>
      <p>{description}</p>
      <div className="integration-status">
        {state.connected ? (
          <>
            <CheckCircle size={16} />
            <span>Connected</span>
          </>
        ) : (
          <>Not connected</>
        )}
      </div>
      {state.lastSync && <small>Last sync: {state.lastSync}</small>}
      <div className="integration-actions">
        <button onClick={onConnect} className="secondary-button">
          Connect
        </button>
        <button onClick={onSync} className="secondary-button" disabled={!state.connected}>
          <RefreshCw size={14} />
          Sync
        </button>
      </div>
    </article>
  );
}

