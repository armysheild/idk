import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatVehicleIdentity } from "@/lib/vehicleIdentity";
import type { FleetVehicle } from "@/types/fleet";

type Template = {
  id: number;
  name: string;
  description: string | null;
  vehicleType: string;
  intervalKm: number | null;
  intervalDays: number | null;
  tasks: string[];
};

const emptyDraft = { name: "", description: "", vehicleType: "All", intervalKm: "", intervalDays: "", tasks: "" };

export function MaintenanceTemplatesWorkspace({ vehicles }: { vehicles: FleetVehicle[] }) {
  const utils = trpc.useUtils();
  const templates = trpc.maintenanceTemplates.list.useQuery(undefined, { retry: false });
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const refresh = () => { void templates.refetch(); setDraft(emptyDraft); setEditingId(null); };
  const error = (value: Error) => toast.error("Maintenance template failed", { description: value.message });
  const create = trpc.maintenanceTemplates.create.useMutation({ onSuccess: refresh, onError: error });
  const update = trpc.maintenanceTemplates.update.useMutation({ onSuccess: refresh, onError: error });
  const remove = trpc.maintenanceTemplates.remove.useMutation({ onSuccess: refresh, onError: error });
  const apply = trpc.maintenanceTemplates.applyTemplate.useMutation({
    onSuccess: (result: { added: number }) => {
      toast.success(result.added ? "Service schedule created" : "Existing service schedule retained");
      void utils.planning.maintenance.invalidate();
    },
    onError: error,
  });
  const rows = (templates.data ?? []) as Template[];
  return (
    <section className="panel workspace-form">
      <h2>Maintenance templates</h2>
      <p>Save service tasks and intervals, then apply them to a vehicle.</p>
      <form className="compact-form" onSubmit={(event) => {
        event.preventDefault();
        const payload = {
          name: draft.name, description: draft.description || null, vehicleType: draft.vehicleType,
          intervalKm: draft.intervalKm ? Number(draft.intervalKm) : null,
          intervalDays: draft.intervalDays ? Number(draft.intervalDays) : null,
          tasks: draft.tasks.split("\n").map((task) => task.trim()).filter(Boolean),
        };
        if (!payload.intervalKm && !payload.intervalDays) { toast.error("Enter a distance or day interval"); return; }
        if (!payload.tasks.length) { toast.error("Enter at least one task"); return; }
        if (editingId) update.mutate({ ...payload, id: editingId });
        else create.mutate(payload);
      }}>
        <label>Name<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <label>Vehicle type<select value={draft.vehicleType} onChange={(event) => setDraft({ ...draft, vehicleType: event.target.value })}>
          {["All", "BUS", "MINIBUS", "TRUCK", "VAN", "CAR", "OTHER"].map((type) => <option key={type}>{type}</option>)}
        </select></label>
        <label>Interval (km)<input type="number" min="1" value={draft.intervalKm} onChange={(event) => setDraft({ ...draft, intervalKm: event.target.value })} /></label>
        <label>Interval (days)<input type="number" min="1" value={draft.intervalDays} onChange={(event) => setDraft({ ...draft, intervalDays: event.target.value })} /></label>
        <label>Tasks (one per line)<textarea required value={draft.tasks} onChange={(event) => setDraft({ ...draft, tasks: event.target.value })} /></label>
        <button className="primary-button" disabled={create.isPending || update.isPending}>{editingId ? "Save template" : "Create template"}</button>
        {editingId && <button type="button" onClick={() => { setEditingId(null); setDraft(emptyDraft); }}>Cancel edit</button>}
      </form>
      <label>Apply to vehicle<select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
        <option value="">Select vehicle</option>
        {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{formatVehicleIdentity(vehicle)}</option>)}
      </select></label>
      {templates.isLoading && <p>Loading templates…</p>}
      {templates.isError && <p role="alert">Could not load templates.</p>}
      {!templates.isLoading && !templates.isError && !rows.length && <p>No saved templates.</p>}
      {rows.map((template) => <article key={template.id} className="scope-list">
        <h3>{template.name}</h3>
        {template.description && <p>{template.description}</p>}
        <p>{template.vehicleType} · {template.intervalKm ? `${template.intervalKm} km` : ""} {template.intervalDays ? `${template.intervalDays} days` : ""}</p>
        <ul>{template.tasks.map((task, index) => <li key={index}>{task}</li>)}</ul>
        <button type="button" disabled={!vehicleId || apply.isPending} onClick={() => apply.mutate({ templateId: template.id, vehicleId })}>Apply schedule</button>
        <button type="button" onClick={() => {
          setEditingId(template.id);
          setDraft({ name: template.name, description: template.description ?? "", vehicleType: template.vehicleType, intervalKm: String(template.intervalKm ?? ""), intervalDays: String(template.intervalDays ?? ""), tasks: template.tasks.join("\n") });
        }}>Edit</button>
        <button type="button" disabled={remove.isPending} onClick={() => remove.mutate({ id: template.id })}>Delete</button>
      </article>)}
    </section>
  );
}
