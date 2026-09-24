import { useMemo, useState } from "react";
import { Bus, Check, Gauge, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatVehicleIdentity } from "@/lib/vehicleIdentity";
import type {
  DocumentRow,
  DriverHandoffRow,
  FleetMaintenanceSignal,
  FleetVehicle,
  MaintenancePlanItem,
  NotificationRow,
  ServiceComponent,
  WorkOrderRow,
} from "@/types/fleet";
import { WorkspaceState as State } from "@/components/workspaces/WorkspaceState";

export function FleetManagerOverviewWorkspace({
  organizationName,
}: {
  organizationName?: string;
}) {
  const vehicles = trpc.vehicles.list.useQuery(undefined, { retry: false });
  const components = trpc.components.list.useQuery(undefined, { retry: false });
  const orders = trpc.workOrders.list.useQuery(undefined, { retry: false });
  const documents = trpc.documents.list.useQuery(undefined, { retry: false });
  const notifications = trpc.notifications.list.useQuery(undefined, {
    retry: false,
  });
  const driverHandoffs = trpc.team.driverHandoffs.useQuery(undefined, {
    retry: false,
  });
  const maintenancePerformance = trpc.reports.maintenancePerformance.useQuery(
    undefined,
    { retry: false },
  );
  const [planningDays, setPlanningDays] = useState("90");
  const maintenancePlanningInput = useMemo(
    () => ({ to: new Date(Date.now() + Number(planningDays) * 86400000) }),
    [planningDays],
  );
  const maintenancePlanning = trpc.planning.maintenance.useQuery(
    maintenancePlanningInput,
    { retry: false },
  );
  const planningItems = Array.isArray(maintenancePlanning.data)
    ? maintenancePlanning.data
    : (maintenancePlanning.data?.items ?? []);
  const active =
    vehicles.data?.filter((item: FleetVehicle) => item.status === "ACTIVE")
      .length ?? 0;
  const dueDocs =
    documents.data?.filter(
      (item: DocumentRow) =>
        new Date(item.expiryDate).getTime() < Date.now() + 30 * 86400000,
    ).length ?? 0;
  const maintenanceSignals = (components.data ?? [])
    .map((item: ServiceComponent) => {
      const vehicle = vehicles.data?.find(
        (row: FleetVehicle) => row.id === item.vehicleId,
      );
      const currentOdometer = Number(
        vehicle?.latestOdometerReading ?? vehicle?.currentOdometer ?? 0,
      );
      const installationOdometer = Number(
        item.installationOdometer ?? item.lastServicedOdometer ?? 0,
      );
      const expectedLifeKm = Number(item.expectedLifeKm ?? 0);
      const alertThresholdKm = Number(item.alertThresholdKm ?? 0);
      const wear = Math.max(0, currentOdometer - installationOdometer);
      const remainingLifeKm = Math.max(
        0,
        installationOdometer + expectedLifeKm - currentOdometer,
      );
      const overdue = remainingLifeKm === 0 && expectedLifeKm > 0;
      const critical = /brake|tyre|tire|steering|wheel|engine/i.test(item.name);
      const severity =
        overdue && critical
          ? "CRITICAL"
          : overdue || critical
            ? "HIGH"
            : "MEDIUM";
      return {
        ...item,
        vehicleLabel: vehicle ? formatVehicleIdentity(vehicle) : item.vehicleId,
        currentOdometer,
        installationOdometer,
        expectedLifeKm,
        alertThresholdKm,
        remainingLifeKm,
        overdue,
        severity,
        due: wear >= alertThresholdKm,
      };
    })
    .filter((item: FleetMaintenanceSignal) => item.due)
    .sort(
      (a: FleetMaintenanceSignal, b: FleetMaintenanceSignal) =>
        (a.severity === "CRITICAL" ? 0 : a.severity === "HIGH" ? 1 : 2) -
        (b.severity === "CRITICAL" ? 0 : b.severity === "HIGH" ? 1 : 2),
    );
  return (
    <main className="replacement-fleet-overview">
      <header className="replacement-fleet-overview-hero">
        <div>
          <span>Fleet manager · readiness control</span>
          <h1>
            Make the next fleet decision before it becomes a breakdown<em>.</em>
          </h1>
          <p>
            {organizationName ?? "Your organization"} keeps vehicle
            registration, component lifecycle, work-order dispatch, and
            operational exceptions in their dedicated left-panel surfaces. This
            command view only prioritizes what needs attention now.
          </p>
        </div>
        <div className="replacement-fleet-overview-hero-chip">
          <Bus size={20} />
          <strong>{active}</strong>
          <small>active assets</small>
        </div>
      </header>
      <section className="replacement-fleet-overview-signals">
        <article>
          <Bus size={16} />
          <span>Active assets</span>
          <strong>
            {active} / {vehicles.data?.length ?? 0}
          </strong>
          <small>organization fleet</small>
        </article>
        <article>
          <Wrench size={16} />
          <span>Open work</span>
          <strong>
            {orders.data?.filter(
              (item: WorkOrderRow) => item.status !== "COMPLETED",
            ).length ?? 0}
          </strong>
          <small>dispatch queue</small>
        </article>
        <article className={maintenanceSignals.length ? "is-alert" : "is-safe"}>
          <Gauge size={16} />
          <span>Maintenance due</span>
          <strong>{maintenanceSignals.length}</strong>
          <small>wear threshold signals</small>
        </article>
        <article className={dueDocs ? "is-alert" : "is-safe"}>
          <Check size={16} />
          <span>Compliance due</span>
          <strong>{dueDocs}</strong>
          <small>next 30 days</small>
        </article>
      </section>
      <section className="replacement-fleet-overview-grid">
        <article className="replacement-fleet-overview-panel">
          <header>
            <div>
              <span>01 · predictive maintenance</span>
              <h2>Wear threshold signals</h2>
            </div>
            <b>{maintenanceSignals.length} live signals</b>
          </header>
          <State
            loading={components.isLoading}
            error={components.isError}
            empty={
              !components.isLoading &&
              !components.isError &&
              !maintenanceSignals.length
            }
          >
            <div>
              {maintenanceSignals
                .slice(0, 6)
                .map((item: FleetMaintenanceSignal) => (
                  <article key={item.id}>
                    <div>
                      <strong>
                        {item.vehicleLabel} · {item.name}
                      </strong>
                      <p>
                        Current {item.currentOdometer.toLocaleString("en-IN")}{" "}
                        km · life {item.expectedLifeKm.toLocaleString("en-IN")}{" "}
                        km · {item.remainingLifeKm.toLocaleString("en-IN")} km
                        remaining
                      </p>
                    </div>
                    <b
                      className={
                        item.severity === "CRITICAL" ? "is-alert" : "is-pending"
                      }
                    >
                      {item.severity}
                      {item.overdue ? " · overdue" : " · due"}
                    </b>
                  </article>
                ))}
            </div>
          </State>
        </article>
        <article className="replacement-fleet-overview-panel">
          <header>
            <div>
              <span>02 · service performance</span>
              <h2>90-day service signal</h2>
            </div>
            <b>Read only</b>
          </header>
          <div className="replacement-fleet-overview-performance">
            <article>
              <span>Turnaround</span>
              <strong>
                {maintenancePerformance.data?.turnaroundHours ?? 0}h
              </strong>
              <small>average completed order</small>
            </article>
            <article>
              <span>Downtime</span>
              <strong>
                {maintenancePerformance.data?.downtimeHours ?? 0}h
              </strong>
              <small>open-order aging</small>
            </article>
            <article>
              <span>Repeat repairs</span>
              <strong>
                {maintenancePerformance.data?.repeatRepairs?.length ?? 0}
              </strong>
              <small>repeated work titles</small>
            </article>
          </div>
          {maintenancePerformance.data?.failurePatterns?.length ? (
            <div className="replacement-fleet-overview-patterns">
              {maintenancePerformance.data.failurePatterns
                .slice(0, 4)
                .map((item: { title: string; count: number }) => (
                  <article key={item.title}>
                    <strong>{item.title}</strong>
                    <b>{item.count} occurrences</b>
                  </article>
                ))}
            </div>
          ) : (
            <p className="replacement-fleet-overview-safe">
              <Check size={14} />
              No repeated repair pattern detected in the selected period.
            </p>
          )}
        </article>
      </section>
      <section className="replacement-fleet-overview-panel">
        <header>
          <div>
            <span>03 · planning horizon</span>
            <h2>Due-date control view</h2>
          </div>
          <select
            aria-label="Maintenance planning horizon"
            value={planningDays}
            onChange={(event) => setPlanningDays(event.target.value)}
          >
            <option value="30">Next 30 days</option>
            <option value="60">Next 60 days</option>
            <option value="90">Next 90 days</option>
            <option value="180">Next 180 days</option>
          </select>
        </header>
        <State
          loading={maintenancePlanning.isLoading}
          error={maintenancePlanning.isError}
          empty={
            !maintenancePlanning.isLoading &&
            !maintenancePlanning.isError &&
            !planningItems.length
          }
        >
          <div className="replacement-fleet-overview-planning">
            {planningItems.slice(0, 10).map((item: MaintenancePlanItem) => (
              <article key={`${item.kind}-${item.id}`}>
                <div>
                  <strong>
                    {item.vehicleLabel} · {item.title}
                  </strong>
                  <p>
                    {item.detail} · due{" "}
                    {new Date(item.dueDate).toLocaleDateString("en-IN")}
                  </p>
                </div>
                <b>{String(item.kind ?? "signal").replaceAll("_", " ")}</b>
              </article>
            ))}
          </div>
        </State>
      </section>
      <section className="replacement-fleet-overview-grid">
        <article className="replacement-fleet-overview-panel">
          <header>
            <div>
              <span>04 · driver handoff visibility</span>
              <h2>Safety and acknowledgement state</h2>
            </div>
            <b>{driverHandoffs.data?.length ?? 0} assignments</b>
          </header>
          <State
            loading={driverHandoffs.isLoading}
            error={driverHandoffs.isError}
            empty={
              !driverHandoffs.isLoading &&
              !driverHandoffs.isError &&
              !driverHandoffs.data?.length
            }
          >
            <div>
              {driverHandoffs.data
                ?.slice(0, 6)
                .map((item: DriverHandoffRow) => (
                  <article key={item.assignmentId}>
                    <div>
                      <strong>
                        {item.driverName} · {item.vehicleLabel}
                      </strong>
                      <p>
                        {item.latestIssue
                          ? `${item.latestIssue.title} · ${item.latestIssue.status}`
                          : "No reported issue"}
                        {item.acknowledgedAt
                          ? ` · acknowledged ${new Date(item.acknowledgedAt).toLocaleString("en-IN")}`
                          : " · awaiting acknowledgement"}
                      </p>
                    </div>
                    <b
                      className={
                        item.safety === "UNSAFE"
                          ? "is-alert"
                          : item.safety === "ACTIVE"
                            ? "is-safe"
                            : "is-pending"
                      }
                    >
                      {item.safety}
                    </b>
                  </article>
                ))}
            </div>
          </State>
        </article>
        <article className="replacement-fleet-overview-panel">
          <header>
            <div>
              <span>05 · operational alerts</span>
              <h2>Recent organization signals</h2>
            </div>
            <b>
              {notifications.data?.filter(
                (item: NotificationRow) => !item.isRead,
              ).length ?? 0}{" "}
              unread
            </b>
          </header>
          <State
            loading={notifications.isLoading}
            error={notifications.isError}
            empty={
              !notifications.isLoading &&
              !notifications.isError &&
              !notifications.data?.length
            }
          >
            <div>
              {notifications.data?.slice(0, 6).map((item: NotificationRow) => (
                <article key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.message}</p>
                  </div>
                  <b className={item.isRead ? "is-safe" : "is-alert"}>
                    {item.isRead ? "Read" : "Review"}
                  </b>
                </article>
              ))}
            </div>
          </State>
        </article>
      </section>
    </main>
  );
}
