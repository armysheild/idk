import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
  Bell,
  Check,
  ChevronRight,
  Command,
  LogOut,
  Menu,
  MoreHorizontal,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";

import { BrandMark } from "@/components/BrandMark";

export type OperationNavItem = { label: string; icon: LucideIcon };

export type CommandVehicle = {
  id: string;
  identity: string;
  name: string;
  status: string;
  odo: string;
  service: string;
  tone: "good" | "warn" | "critical";
};

export type CommandOrder = {
  id: string;
  sourceId: string;
  title: string;
  vehicle: string;
  owner: string;
  priority: string;
  due: string;
  status: string;
};

export type CommandResult = { type: string; id: string; title: string; detail: string };

const commandLabels = new Set([
  "Command center",
  "Fleet manager workspace",
  "Inventory manager workspace",
  "Mechanic workspace",
  "Technician workspace",
  "Driver portal",
  "Accountant ledger",
]);

const controlLabels = new Set(["Notifications", "P&L analytics", "Billing", "Team", "Profile"]);

function AppNavigation({
  items,
  activeNav,
  onSelect,
}: {
  items: OperationNavItem[];
  activeNav: string;
  onSelect: (label: string) => void;
}) {
  const groups = [
    { label: "Workspace", items: items.filter((item) => commandLabels.has(item.label)) },
    { label: "Operations", items: items.filter((item) => !commandLabels.has(item.label) && !controlLabels.has(item.label)) },
    { label: "Control", items: items.filter((item) => controlLabels.has(item.label)) },
  ];

  return (
    <nav className="ops-nav" aria-label="VahanSync workspace navigation">
      {groups.map((group) => group.items.length ? (
        <section className="ops-nav-group" key={group.label}>
          <span className="ops-nav-label">{group.label}</span>
          {group.items.map((item) => {
            const Icon = item.icon;
            const isActive = item.label === activeNav;
            return (
              <button
                className={`ops-nav-link ${isActive ? "is-active" : ""}`}
                key={item.label}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSelect(item.label)}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
                {isActive ? <i aria-hidden="true" /> : null}
              </button>
            );
          })}
        </section>
      ) : null)}
    </nav>
  );
}

export function OperationsFrame({
  activeNav,
  items,
  roleLabel,
  organizationLabel,
  organizationInitials,
  vehicleCount,
  operatorName,
  operatorInitials,
  unreadCount,
  showMobileNav,
  onToggleMobileNav,
  onCloseMobileNav,
  onSelect,
  onSignOut,
  onToggleCommand,
  children,
}: {
  activeNav: string;
  items: OperationNavItem[];
  roleLabel: string;
  organizationLabel: string;
  organizationInitials: string;
  vehicleCount: number;
  operatorName: string;
  operatorInitials: string;
  unreadCount: number;
  showMobileNav: boolean;
  onToggleMobileNav: () => void;
  onCloseMobileNav: () => void;
  onSelect: (label: string) => void;
  onSignOut: () => void;
  onToggleCommand: () => void;
  children: ReactNode;
}) {
  return (
    <div className="operations-frame">
      <aside className={`operations-rail ${showMobileNav ? "is-open" : ""}`}>
        <div className="operations-brand">
          <BrandMark decorative className="operations-mark" />
          <div><strong>VahanSync</strong><small>Fleet intelligence</small></div>
          <button type="button" className="operations-rail-close" aria-label="Close navigation" onClick={onCloseMobileNav}><X size={18} /></button>
        </div>
        <button type="button" className="operations-org-card" onClick={() => onSelect(items[0]?.label ?? "Command center")}>
          <span className="operations-org-avatar">{organizationInitials}</span>
          <span><strong>{organizationLabel}</strong><small>{vehicleCount} connected vehicles</small></span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <div className="operations-role-chip"><span />{roleLabel}</div>
        <AppNavigation items={items} activeNav={activeNav} onSelect={(label) => { onSelect(label); onCloseMobileNav(); }} />
        <div className="operations-rail-footer">
          <button type="button" className="operations-profile-trigger" onClick={() => { onSelect("Profile"); onCloseMobileNav(); }} aria-label="Open your VahanSync profile and alert preferences">
            <span className="operations-user"><span>{operatorInitials || "VS"}</span><span><strong>{operatorName || "Authenticated operator"}</strong><small>Profile &amp; preferences</small></span><UserRound size={16} aria-hidden="true" /></span>
            <ChevronRight size={15} aria-hidden="true" />
          </button>
          <button type="button" className="operations-signout" onClick={onSignOut}><LogOut size={15} aria-hidden="true" />Sign out of VahanSync</button>
        </div>
      </aside>
      {showMobileNav ? <button type="button" className="operations-backdrop" aria-label="Close navigation" onClick={onCloseMobileNav} /> : null}
      <main className="operations-main">
        <header className="operations-header">
          <button type="button" className="operations-menu-button" aria-label="Open navigation" onClick={onToggleMobileNav}><Menu size={20} /></button>
          <div className="operations-context"><span>{organizationLabel}</span><ChevronRight size={14} aria-hidden="true" /><strong>{activeNav}</strong></div>
          <div className="operations-header-actions">
            <button type="button" className="operations-command-button" onClick={onToggleCommand}><Command size={16} /><span>Search records</span><kbd>⌘ K</kbd></button>
            <button type="button" className="operations-notification" aria-label="Open notifications" onClick={() => onSelect("Notifications")}><Bell size={18} />{unreadCount ? <b>{unreadCount}</b> : null}</button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

export function CommandDeck({
  operatorName,
  activeVehicles,
  vehicleCount,
  unreadCount,
  lowStockCount,
  expenseTotal,
  orders,
  vehicles,
  commandOpen,
  query,
  commandResults,
  onQuery,
  onCloseCommand,
  onSelect,
  onCompleteOrder,
}: {
  operatorName: string;
  activeVehicles: number;
  vehicleCount: number;
  unreadCount: number;
  lowStockCount: number;
  expenseTotal: string;
  orders: CommandOrder[];
  vehicles: CommandVehicle[];
  commandOpen: boolean;
  query: string;
  commandResults: CommandResult[];
  onQuery: (value: string) => void;
  onCloseCommand: () => void;
  onSelect: (label: string) => void;
  onCompleteOrder: (id: string) => void;
}) {
  const exceptionCount = unreadCount + lowStockCount;
  return (
    <section className="command-deck">
      {commandOpen ? <div className="command-overlay" role="dialog" aria-modal="true" aria-label="Search VahanSync records">
        <div className="command-dialog">
          <div className="command-dialog-head"><div><span>Global record search</span><strong>Find a live fleet record</strong></div><button type="button" onClick={onCloseCommand} aria-label="Close search"><X size={18} /></button></div>
          <label className="command-input"><Search size={18} /><input autoFocus value={query} onChange={(event) => onQuery(event.target.value)} placeholder="VIN, registration, work order, part, or invoice" /></label>
          <div className="command-results">{query ? commandResults.length ? commandResults.map((result) => <button key={`${result.type}-${result.id}`} type="button" onClick={() => { onSelect(result.type === "Vehicle" ? "Vehicles" : result.type === "Inventory" ? "Inventory" : result.type === "Financial record" ? "Accountant ledger" : "Work orders"); onCloseCommand(); }}><span>{result.type}</span><div><strong>{result.title}</strong><small>{result.detail}</small></div><ArrowUpRight size={16} /></button>) : <p>No matching live records.</p> : <p>Start with a VIN, registration number, work-order title, part SKU, or financial reference.</p>}</div>
        </div>
      </div> : null}
      <div className="command-deck-intro">
        <div><span className="command-kicker">Connected operations</span><h1>Good morning, {operatorName || "operator"}<em>.</em></h1><p>Today’s fleet condition, maintenance handoffs, and supply exceptions in one operating view.</p></div>
        <div className="command-live-stamp"><span /><strong>Live tenant data</strong><small>Supabase connected</small></div>
      </div>
      <div className="command-stat-strip">
        <article><span>Fleet availability</span><strong>{activeVehicles}<small> / {vehicleCount}</small></strong><p>vehicles active now</p></article>
        <article className={exceptionCount ? "has-risk" : ""}><span>Action signals</span><strong>{exceptionCount}</strong><p>{exceptionCount ? "require review" : "all caught up"}</p></article>
        <article><span>Open handoffs</span><strong>{orders.filter((order) => order.status !== "Completed").length}</strong><p>work orders in motion</p></article>
        <article><span>Operating spend</span><strong>{expenseTotal}</strong><p>recorded ledger expense</p></article>
      </div>
      <div className="command-deck-grid">
        <section className="command-panel command-queue-panel">
          <div className="command-panel-head"><div><span>Decision queue</span><h2>Act on the live fleet</h2></div><button type="button" onClick={() => onSelect("Fleet manager workspace")}>Open readiness <ArrowUpRight size={15} /></button></div>
          <div className="command-exception-list">
            <button type="button" onClick={() => onSelect("Notifications")}><span className={`command-severity ${unreadCount ? "risk" : "good"}`} /><div><strong>{unreadCount ? `${unreadCount} unread fleet signals` : "No unread fleet signals"}</strong><small>{unreadCount ? "Review source records and close the handoff." : "Notifications are currently clear."}</small></div><ArrowUpRight size={16} /></button>
            <button type="button" onClick={() => onSelect("Inventory")}><span className={`command-severity ${lowStockCount ? "risk" : "good"}`} /><div><strong>{lowStockCount ? `${lowStockCount} parts at reorder point` : "Inventory levels are within policy"}</strong><small>{lowStockCount ? "Review stock availability before dispatching repairs." : "No replenishment decision is waiting."}</small></div><ArrowUpRight size={16} /></button>
          </div>
        </section>
        <section className="command-panel command-orders-panel">
          <div className="command-panel-head"><div><span>Maintenance flow</span><h2>Latest work orders</h2></div><button type="button" onClick={() => onSelect("Work orders")}>View all <ArrowUpRight size={15} /></button></div>
          <div className="command-order-list">{orders.slice(0, 4).map((order) => <article key={order.id}><div className="command-order-title"><span className={`command-priority ${order.priority.toLowerCase()}`} /><div><strong>{order.title}</strong><small>{order.vehicle} · {order.owner}</small></div><b>{order.status}</b></div><div className="command-order-meta"><span>{order.priority} priority</span><span>{order.due}</span>{order.status !== "Completed" ? <button type="button" onClick={() => onCompleteOrder(order.sourceId)}><Check size={14} /> Complete</button> : <span className="command-complete"><Check size={14} /> Verified</span>}</div></article>) || <p className="command-empty">No work orders are available for this role.</p>}</div>
        </section>
        <section className="command-panel command-fleet-panel">
          <div className="command-panel-head"><div><span>Fleet register</span><h2>Vehicle condition</h2></div><button type="button" onClick={() => onSelect("Vehicles")}>VIN register <ArrowUpRight size={15} /></button></div>
          <div className="command-fleet-list">{vehicles.slice(0, 5).map((vehicle) => <button key={vehicle.id} type="button" onClick={() => onSelect("Vehicles")}><span className={`command-vehicle-dot ${vehicle.tone}`} /><div><strong>{vehicle.identity}</strong><small>{vehicle.name}</small></div><div><b>{vehicle.status}</b><small>{vehicle.odo}</small></div><ChevronRight size={16} /></button>) || <p className="command-empty">No vehicles are visible for this role.</p>}</div>
        </section>
      </div>
      <div className="command-deck-footer"><Sparkles size={15} /><span>VIN-first data is connected across maintenance, inventory, and financial records.</span></div>
    </section>
  );
}
