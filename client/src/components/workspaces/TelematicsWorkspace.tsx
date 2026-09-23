import { useMemo, useState } from "react";
import { Gauge, Link2, Plus, Radio, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { FleetVehicle } from "@/types/fleet";

type Integration = {
  id: number;
  provider: string;
  baseUrl: string;
  syncPath: string;
  active: boolean;
  syncIntervalMinutes: number;
  lastSyncedAt?: string | null;
  lastSyncStatus?: string | null;
};

type Device = {
  id: number;
  vehicleId: number;
  provider: string;
  deviceIdentifier: string;
  active: boolean;
  lastSeenAt?: string | null;
  latestOdometerKm?: number | null;
  latestRecordedAt?: string | null;
};

export function TelematicsWorkspace() {
  const utils = trpc.useUtils();
  const vehicles = trpc.vehicles.list.useQuery(undefined, { retry: false });
  const overview = trpc.telematics.overview.useQuery(undefined, { retry: false });
  const health = trpc.telematics.health.useQuery(undefined, { retry: false });
  const [integration, setIntegration] = useState({ provider: "", baseUrl: "", syncPath: "/readings", apiToken: "" });
  const [device, setDevice] = useState({ vehicleId: "", provider: "", deviceIdentifier: "" });
  const integrations = (overview.data?.integrations ?? []) as Integration[];
  const devices = (overview.data?.devices ?? []) as Device[];
  const activeProviders = useMemo(() => integrations.filter((item) => item.active), [integrations]);
  const createIntegration = trpc.telematics.createIntegration.useMutation({
    onSuccess: () => {
      setIntegration({ provider: "", baseUrl: "", syncPath: "/readings", apiToken: "" });
      toast.success("Telemetry provider connected");
      void utils.telematics.overview.invalidate();
      void utils.telematics.health.invalidate();
    },
    onError: (error) => toast.error("Provider setup failed", { description: error.message }),
  });
  const createDevice = trpc.telematics.createDevice.useMutation({
    onSuccess: () => {
      setDevice({ vehicleId: "", provider: "", deviceIdentifier: "" });
      toast.success("Device mapped to vehicle");
      void utils.telematics.overview.invalidate();
    },
    onError: (error) => toast.error("Device mapping failed", { description: error.message }),
  });
  const updateDevice = trpc.telematics.updateDevice.useMutation({
    onSuccess: () => {
      toast.success("Device status updated");
      void utils.telematics.overview.invalidate();
    },
    onError: (error) => toast.error("Device update failed", { description: error.message }),
  });
  const sync = trpc.telematics.syncIntegration.useMutation({
    onSuccess: () => {
      toast.success("Telemetry sync completed");
      void utils.telematics.overview.invalidate();
      void utils.telematics.health.invalidate();
      void utils.vehicles.list.invalidate();
    },
    onError: (error) => toast.error("Telemetry sync failed", { description: error.message }),
  });
  const vehicleRows = (vehicles.data ?? []) as FleetVehicle[];
  const vehicleName = (vehicleId: number) => {
    const vehicle = vehicleRows.find((item) => Number(item.id) === vehicleId);
    return vehicle ? `${vehicle.licensePlate} · ${vehicle.make ?? ""} ${vehicle.model ?? ""}` : `Vehicle #${vehicleId}`;
  };

  return (
    <section className="panel workspace-form">
      <header className="panel-heading">
        <div>
          <div className="panel-kicker">Fleet Manager · Telemetry control</div>
          <h2>Connect the devices that move your fleet</h2>
          <p>Configure one API connection per provider, then map each provider device number to its vehicle. Odometer is the first normalized signal.</p>
        </div>
        <span className="signal-chip good"><ShieldCheck size={13} /> Tenant scoped</span>
      </header>
      <div className="workspace-kpi-grid compact-summary">
        <article className="replacement-role-kpi is-blue"><div><span>Providers</span><i /></div><strong>{health.data?.activeIntegrations ?? 0}</strong><small>active API connections</small></article>
        <article className="replacement-role-kpi is-green"><div><span>Mapped devices</span><i /></div><strong>{health.data?.activeDevices ?? 0}</strong><small>vehicle device links</small></article>
        <article className="replacement-role-kpi is-orange"><div><span>Readings</span><i /></div><strong>{health.data?.readingsLast24h ?? 0}</strong><small>last 24 hours</small></article>
        <article className="replacement-role-kpi is-red"><div><span>Stale</span><i /></div><strong>{health.data?.staleDevices ?? 0}</strong><small>devices need attention</small></article>
      </div>
      <div className="role-grid two-col">
        <section className="replacement-role-panel">
          <header><div><span>01 · Provider connections</span><h2>Add a brand API</h2></div><Radio size={18} /></header>
          <div className="replacement-role-panel-content">
            <form className="compact-form" onSubmit={(event) => { event.preventDefault(); createIntegration.mutate(integration); }}>
              <label>Brand / provider<input required placeholder="Intangles, Samsara, IVFleet…" value={integration.provider} onChange={(event) => setIntegration({ ...integration, provider: event.target.value })} /></label>
              <label>API base URL<input required type="url" placeholder="https://api.provider.in" value={integration.baseUrl} onChange={(event) => setIntegration({ ...integration, baseUrl: event.target.value })} /></label>
              <label>Readings path<input required value={integration.syncPath} onChange={(event) => setIntegration({ ...integration, syncPath: event.target.value })} /></label>
              <label>API token<input required type="password" placeholder="Stored encrypted; never displayed" value={integration.apiToken} onChange={(event) => setIntegration({ ...integration, apiToken: event.target.value })} /></label>
              <button className="primary-button" disabled={createIntegration.isPending}><Plus size={15} />{createIntegration.isPending ? "Connecting…" : "Save provider connection"}</button>
            </form>
            <div className="resource-list">
              {integrations.map((item) => <div className="resource-row" key={item.id}><div><strong>{item.provider}</strong><span>{item.baseUrl}{item.syncPath} · {item.lastSyncedAt ? `last sync ${new Date(item.lastSyncedAt).toLocaleString("en-IN")}` : "never synced"}</span></div><button className="compact-button" disabled={sync.isPending || !item.active} onClick={() => sync.mutate({ integrationId: item.id })}><RefreshCw size={14} /> Sync</button></div>)}
              {!integrations.length && <div className="workspace-state">No provider connections configured yet.</div>}
            </div>
          </div>
        </section>
        <section className="replacement-role-panel">
          <header><div><span>02 · Vehicle mapping</span><h2>Map a device number</h2></div><Link2 size={18} /></header>
          <div className="replacement-role-panel-content">
            <form className="compact-form" onSubmit={(event) => { event.preventDefault(); createDevice.mutate(device); }}>
              <label>Provider<select required value={device.provider} onChange={(event) => setDevice({ ...device, provider: event.target.value })}><option value="">Select provider</option>{activeProviders.map((item) => <option key={item.id} value={item.provider}>{item.provider}</option>)}</select></label>
              <label>Vehicle<select required value={device.vehicleId} onChange={(event) => setDevice({ ...device, vehicleId: event.target.value })}><option value="">Select vehicle</option>{vehicleRows.map((item) => <option key={item.id} value={item.id}>{item.licensePlate}</option>)}</select></label>
              <label>Device number / IMEI<input required placeholder="Vendor device identifier" value={device.deviceIdentifier} onChange={(event) => setDevice({ ...device, deviceIdentifier: event.target.value })} /></label>
              <button className="primary-button" disabled={createDevice.isPending || !activeProviders.length}><Gauge size={15} />{createDevice.isPending ? "Mapping…" : "Map device to vehicle"}</button>
            </form>
            <div className="resource-list">
              {devices.map((item) => <div className="resource-row" key={item.id}><div><strong>{vehicleName(item.vehicleId)}</strong><span>{item.provider} · {item.deviceIdentifier} · {item.latestOdometerKm != null ? `${item.latestOdometerKm.toLocaleString("en-IN")} km` : "no odometer yet"}</span></div><div className="resource-row-actions"><span className={`status-label ${item.active && item.lastSeenAt ? "accepted" : "warn"}`}>{!item.active ? "Inactive" : item.lastSeenAt ? "Live signal" : "Awaiting signal"}</span><button className="compact-button" disabled={updateDevice.isPending} onClick={() => updateDevice.mutate({ id: item.id, active: !item.active })}>{item.active ? "Deactivate" : "Activate"}</button></div></div>)}
              {!devices.length && <div className="workspace-state">No vehicle devices mapped yet.</div>}
            </div>
          </div>
        </section>
      </div>
      <div className="form-note"><Gauge size={14} /> Provider-specific breakdown events are intentionally not enabled yet. This foundation normalizes odometer readings first, with source timestamps and stale-device visibility.</div>
    </section>
  );
}
