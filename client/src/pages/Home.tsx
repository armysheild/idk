/* VahanSync workspace: operational clarity, role-aware signals, and calm command surfaces. */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Bus,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  Command,
  Download,
  FileText,
  Fuel,
  Gauge,
  IndianRupee,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquareArrowOutUpRight,
  TrendingUp,
  RefreshCw,
  Route,
  Users,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { describeAuthError } from "@/lib/authErrors";
import { formatVehicleIdentity } from "@/lib/vehicleIdentity";
import { useFleetOpsAuth } from "@/hooks/useFleetOpsAuth";
import { useFleetOpsRealtime } from "@/hooks/useFleetOpsRealtime";
import FunctionalWorkspace from "@/components/FunctionalWorkspace";
import OrganizationOnboarding from "@/components/OrganizationOnboarding";
import { CommandDeck, OperationsFrame, type CommandVehicle } from "@/components/operations/OperationsFrame";
import { PublicAuthSurface } from "@/components/public/PublicAuthSurface";
import { roleNavAccess } from "@/workspaceAccess";
import LandingPage from "@/pages/LandingPage";

const roles = [
  { name: "Super Admin / Owner command center", short: "Super Admin / Owner", icon: LayoutDashboard },
  { name: "Fleet manager workspace", short: "Fleet manager", icon: Bus },
  { name: "Inventory manager workspace", short: "Inventory", icon: Package },
  { name: "Mechanic workspace", short: "Mechanic", icon: Wrench },
  { name: "Technician workspace", short: "Technician", icon: Wrench },
  { name: "Driver workspace", short: "Driver", icon: ClipboardCheck },
  { name: "Accountant workspace", short: "Accountant", icon: IndianRupee },
];

const navItems = [
  { label: "Command center", icon: LayoutDashboard },
  { label: "Fleet manager workspace", icon: Bus },
  { label: "Inventory manager workspace", icon: Package },
  { label: "Mechanic workspace", icon: Wrench },
  { label: "Technician workspace", icon: Wrench },
  { label: "Driver portal", icon: ClipboardCheck },
  { label: "Accountant ledger", icon: IndianRupee },
  { label: "Vehicles", icon: Bus },
  { label: "Components", icon: Wrench },
  { label: "Work orders", icon: Wrench },
  { label: "Inventory", icon: Package },
  { label: "Vendors", icon: Users },
  { label: "Purchase orders", icon: ClipboardCheck },
  { label: "Notifications", icon: Bell },
  { label: "Compliance vault", icon: FileText },
  { label: "P&L analytics", icon: TrendingUp },
  { label: "Billing", icon: IndianRupee },
  { label: "Team", icon: Users },
  { label: "Profile", icon: UserRound },
];

const navGroups = [
  { label: "Command", items: ["Command center", "Fleet manager workspace", "Inventory manager workspace", "Mechanic workspace", "Technician workspace", "Driver portal", "Accountant ledger"] },
  { label: "Operations", items: ["Vehicles", "Components", "Work orders", "Inventory", "Vendors", "Purchase orders", "Compliance vault"] },
  { label: "Control", items: ["Notifications", "P&L analytics", "Billing", "Team", "Profile"] },
];

const roleDescriptor: Record<string, string> = {
  SUPERADMIN: "Super Admin / Owner governance and oversight",
  FLEET_MANAGER: "Fleet readiness",
  INVENTORY_MANAGER: "Parts control",
  MECHANIC: "Physical repair execution",
  TECHNICIAN: "Diagnostics and technical evidence",
  DRIVER: "Route integrity",
  ACCOUNTANT: "INR finance",
};

function WorkspaceNav({ items, activeNav, onSelect, onClose }: { items: typeof navItems; activeNav: string; onSelect: (label: string) => void; onClose?: () => void }) {
  const itemMap = new Map(items.map((item) => [item.label, item]));
  return <nav className="workspace-nav" aria-label="Workspace navigation">{navGroups.map((group) => {
    const groupItems = group.items.map((label) => itemMap.get(label)).filter(Boolean) as typeof navItems;
    if (!groupItems.length) return null;
    return <div className="nav-group" key={group.label}><div className="nav-group-label">{group.label}</div>{groupItems.map((item) => <button key={item.label} type="button" className={`nav-item ${activeNav === item.label ? "active" : ""}`} aria-current={activeNav === item.label ? "page" : undefined} onClick={() => { onSelect(item.label); onClose?.(); }}><item.icon size={17} /><span>{item.label}</span></button>)}</div>;
  })}</nav>;
}

const formatInr = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

function Metric({ label, value, delta, detail, icon: Icon, accent = "orange" }: { label: string; value: string; delta: string; detail: string; icon: typeof Activity; accent?: "orange" | "blue" | "green" }) {
  return (
    <article className="metric-card">
      <div className="metric-top"><span className={`icon-badge ${accent}`}><Icon size={16} /></span><span className="metric-label">{label}</span><MoreHorizontal size={17} className="muted-icon" /></div>
      <div className="metric-value">{value}</div>
      <div className="metric-foot"><span className="delta-positive"><ArrowUpRight size={14} />{delta}</span><span>{detail}</span></div>
    </article>
  );
}

function HealthRing({ value }: { value: number }) {
  const radius = 25;
  const circumference = 2 * Math.PI * radius;
  return <div className="health-ring" style={{ "--ring-progress": `${(value / 100) * circumference}px` } as React.CSSProperties}><svg viewBox="0 0 64 64"><circle className="ring-track" cx="32" cy="32" r={radius} /><circle className="ring-value" cx="32" cy="32" r={radius} /></svg><strong>{value}</strong></div>;
}

export default function Home({ initialSection = "Command center", publicMode = "landing" }: { initialSection?: string; publicMode?: "landing" | "signin" | "signup" }) {
  const { session, loading: authLoading, signOut, signInWithEmail, signUpWithEmail, requestPasswordReset, updatePassword, refreshSession } = useFleetOpsAuth();
  useEffect(() => {
    const onExpired = () => toast.warning("Supabase session expired", { description: "Sign in again to resume live VahanSync data." });
    window.addEventListener("fleetops-session-expired", onExpired);
    return () => window.removeEventListener("fleetops-session-expired", onExpired);
  }, []);
  const { data: backendSummary, isLoading: summaryLoading, isError: summaryError, error: summaryQueryError, refetch: refetchSummary } = trpc.dashboard.summary.useQuery(undefined, { enabled: Boolean(session), retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const summaryUnauthorized = summaryQueryError?.data?.code === "UNAUTHORIZED" || /unauthorized|organization profile|session expired/i.test(summaryQueryError?.message ?? "");
  const [staleSessionRecoveryAttempted, setStaleSessionRecoveryAttempted] = useState(false);
  useEffect(() => {
    if (!session || backendSummary || !summaryError || staleSessionRecoveryAttempted || !summaryUnauthorized) return;
    setStaleSessionRecoveryAttempted(true);
    void refreshSession().then((result) => {
      if (!result.error && result.data.session) void refetchSummary();
    });
  }, [backendSummary, refetchSummary, refreshSession, staleSessionRecoveryAttempted, summaryError, summaryUnauthorized, session]);
  const metadataNeedsOnboarding = session?.user.user_metadata?.needsOnboarding === true || session?.user.user_metadata?.needsOnboarding === "true";
  const backendRole = String(backendSummary?.role ?? "");
  const organizationName = String(backendSummary?.org?.name ?? session?.user.user_metadata?.orgName ?? "").trim();
  const organizationLabel = organizationName || "Loading organization…";
  const organizationInitials = organizationName ? organizationName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() : "—";
  const operationalEnabled = Boolean(session && backendSummary && !metadataNeedsOnboarding && !backendSummary.needsOnboarding);
  const canReadVehicles = ["SUPERADMIN", "FLEET_MANAGER", "MECHANIC", "TECHNICIAN", "DRIVER"].includes(backendRole);
  const canReadWorkOrders = ["SUPERADMIN", "FLEET_MANAGER", "MECHANIC", "TECHNICIAN"].includes(backendRole);
  const canReadInventory = ["SUPERADMIN", "INVENTORY_MANAGER"].includes(backendRole);
  const canReadFinancials = ["SUPERADMIN", "ACCOUNTANT"].includes(backendRole);
  const canReadActivity = ["SUPERADMIN", "FLEET_MANAGER", "MECHANIC", "TECHNICIAN", "DRIVER"].includes(backendRole);
  const { data: liveVehicles, isLoading: vehiclesLoading, isError: vehiclesError } = trpc.vehicles.list.useQuery(undefined, { enabled: operationalEnabled && canReadVehicles, retry: false });
  const { data: liveOrders, isLoading: ordersLoading, isError: ordersError } = trpc.workOrders.list.useQuery(undefined, { enabled: operationalEnabled && canReadWorkOrders, retry: false });
  const { data: liveInventory, isLoading: inventoryLoading, isError: inventoryError } = trpc.inventory.list.useQuery(undefined, { enabled: operationalEnabled && canReadInventory, retry: false });
  const { data: liveNotifications, isLoading: notificationsLoading, isError: notificationsError } = trpc.notifications.list.useQuery(undefined, { enabled: operationalEnabled, retry: false });
  const { data: liveActivity, isLoading: activityLoading, isError: activityError } = trpc.activity.recent.useQuery(undefined, { enabled: operationalEnabled && canReadActivity, retry: false });
  const { data: liveFinancials } = trpc.financials.list.useQuery(undefined, { enabled: operationalEnabled && canReadFinancials, retry: false });
  const { data: billingStatus } = trpc.billing.status.useQuery(undefined, { enabled: operationalEnabled && backendRole === "SUPERADMIN", retry: false });
  const trpcUtils = trpc.useUtils();
  const completeWorkOrder = trpc.workOrders.complete.useMutation({ onSuccess: () => { toast.success("Work order completed", { description: "The order and inventory ledger were updated." }); void trpcUtils.workOrders.list.invalidate(); void trpcUtils.dashboard.summary.invalidate(); }, onError: (error) => toast.error("Completion failed", { description: error.message }) });
  useFleetOpsRealtime(backendSummary?.org?.id);
  const persistedVehicles = useMemo(() => liveVehicles?.map((vehicle: any) => ({ id: vehicle.id, identity: formatVehicleIdentity(vehicle), name: `${vehicle.make} ${vehicle.model} · ${vehicle.year}`, health: vehicle.status === "ACTIVE" ? 100 : 0, status: vehicle.status === "ACTIVE" ? "On route" : "At depot", odo: `${Number(vehicle.latestOdometerReading ?? vehicle.currentOdometer).toLocaleString("en-IN")} km`, service: vehicle.nextServiceAt ? `Next service ${new Date(vehicle.nextServiceAt).toLocaleDateString("en-IN")}` : "No service date recorded", tone: vehicle.status === "ACTIVE" ? "good" : "warn" })) ?? [], [liveVehicles]);
  const persistedOrders = useMemo(() => liveOrders?.filter((order: any) => order?.id).map((order: any) => ({ id: order.id.slice(0, 8).toUpperCase(), sourceId: order.id, title: order.title ?? "Untitled work order", vehicle: formatVehicleIdentity(order.vehicle), owner: order.assignedMechanic?.fullName ?? "Unassigned", priority: order.priority ? order.priority[0] + order.priority.slice(1).toLowerCase() : "Unspecified", due: order.status === "COMPLETED" ? "Completed" : order.dueDate ? new Date(order.dueDate).toLocaleDateString("en-IN") : "No due date", status: order.status === "COMPLETED" ? "Completed" : order.status ?? "OPEN" })) ?? [], [liveOrders]);
  const [activeNav, setActiveNav] = useState(initialSection);
  const sessionUserId = session?.user.id ?? "";
  const priorSessionUserId = useRef(sessionUserId);
  const [sessionTransition, setSessionTransition] = useState(false);
  const currentRole = backendRole || "SUPERADMIN";
  const [role, setRole] = useState(roles[0]);
  useEffect(() => {
    const matched = roles.find((item) => (currentRole === "SUPERADMIN" ? item.short === "Super Admin / Owner" : item.name.toUpperCase().startsWith(currentRole.replaceAll("_", " "))));
    if (matched) setRole(matched);
  }, [currentRole]);
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const [quickFindOpen, setQuickFindOpen] = useState(false);
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All fleet");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authFullName, setAuthFullName] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "recover">(publicMode === "signup" ? "signup" : "signin");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [isRecoveryFlow, setIsRecoveryFlow] = useState(() => typeof window !== "undefined" && window.location.hash.includes("type=recovery"));
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const allowedNavLabels = roleNavAccess[currentRole] ?? roleNavAccess.SUPERADMIN;
  const allowedNavItems = navItems.filter((item) => allowedNavLabels.includes(item.label));
  const roleMenuOptions = currentRole === "SUPERADMIN" ? roles.filter((item) => item.short === "Super Admin / Owner") : roles.filter((item) => item.short === role.short);
  useEffect(() => {
    if (priorSessionUserId.current === sessionUserId) return;
    priorSessionUserId.current = sessionUserId;
    setActiveNav(initialSection);
    setShowMobileNav(false);
    setQuickFindOpen(false);
    setQuery("");
    if (!sessionUserId) {
      setSessionTransition(false);
      return;
    }
    setSessionTransition(true);
    void trpcUtils.dashboard.summary.reset();
    void trpcUtils.vehicles.list.reset();
    void trpcUtils.workOrders.list.reset();
    void trpcUtils.inventory.list.reset();
    void trpcUtils.notifications.list.reset();
    void trpcUtils.activity.recent.reset();
    void trpcUtils.financials.list.reset();
    void trpcUtils.billing.status.reset();
  }, [initialSection, sessionUserId, trpcUtils]);
  useEffect(() => {
    if (sessionTransition && backendSummary) setSessionTransition(false);
  }, [backendSummary, sessionTransition]);
  useEffect(() => {
    if (session && !allowedNavLabels.includes(activeNav)) setActiveNav(allowedNavLabels[0] ?? "Command center");
    if (session && currentRole === "SUPERADMIN" && window.localStorage.getItem("fleetops.openTeam") === "1") { window.localStorage.removeItem("fleetops.openTeam"); setActiveNav("Team"); }
  }, [activeNav, allowedNavLabels, session]);

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError("");
    setAuthSubmitting(true);
    const { data, error } = await signInWithEmail(authEmail, authPassword);
    if (error) setAuthError(describeAuthError(error, "sign-in"));
    else if (!data.session) setAuthError("Supabase did not return an active session. Please try signing in again.");
    // The password grant already supplies the active session. A refresh is
    // only appropriate for an existing session recovery, not immediately after
    // sign-in where it can race storage/event propagation in the browser.
    setAuthSubmitting(false);
  };
  const handleRecoveryRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError("");
    setAuthSubmitting(true);
    const redirectTo = `${window.location.origin}/?recovery=1`;
    const { error } = await requestPasswordReset(authEmail, redirectTo);
    if (error) setAuthError(describeAuthError(error, "password recovery"));
    else toast.success("Recovery email requested", { description: "If this email belongs to a VahanSync account, Supabase will send a secure password-reset link." });
    setAuthSubmitting(false);
  };
  const handlePasswordUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError("");
    if (recoveryPassword.length < 8) { setAuthError("Your new password must be at least 8 characters."); return; }
    setAuthSubmitting(true);
    const { error } = await updatePassword(recoveryPassword);
    if (error) setAuthError(describeAuthError(error, "password update"));
    else { toast.success("Password updated", { description: "Your VahanSync password has been changed. You can continue to your workspace." }); window.history.replaceState({}, document.title, window.location.pathname); setIsRecoveryFlow(false); }
    setAuthSubmitting(false);
  };
  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError("");
    setAuthSubmitting(true);
    const { data, error } = await signUpWithEmail(authEmail, authPassword, authFullName);
    if (error && /already registered|already exists|user exists/i.test(error.message)) {
      const existing = await signInWithEmail(authEmail, authPassword);
      if (existing.error) {
        setAuthError(describeAuthError(existing.error, "sign-in"));
      } else if (!existing.data.session) {
        setAuthError("The existing account did not return an active session. Please use Sign In and try again.");
      } else {
        const refreshed = await refreshSession();
        if (refreshed.error) setAuthError(`Session setup failed: ${describeAuthError(refreshed.error, "sign-in")}`);
      }
    } else if (error) {
      setAuthError(describeAuthError(error, "sign-up"));
    } else if (!data.session) {
      setAuthError("Account created. Confirm your email, then sign in to continue organization setup.");
    }
    setAuthSubmitting(false);
  };

  const visibleVehicles = useMemo(() => persistedVehicles.filter((vehicle: any) => `${vehicle.identity} ${vehicle.name}`.toLowerCase().includes(query.toLowerCase()) && (filter === "All fleet" || vehicle.status === filter)), [query, filter]);
  const visibleOrders = showAllOrders ? persistedOrders : persistedOrders.slice(0, 3);
  const quickFindResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return [
      ...persistedVehicles.filter((vehicle: any) => `${vehicle.identity} ${vehicle.name} ${vehicle.status}`.toLowerCase().includes(term)).map((vehicle: any) => ({ type: "Vehicle", id: vehicle.id, title: vehicle.identity, detail: vehicle.name })),
      ...persistedOrders.filter((order: any) => `${order.id} ${order.title} ${order.vehicle} ${order.owner}`.toLowerCase().includes(term)).map((order: any) => ({ type: "Work order", id: order.id, title: order.title, detail: `${order.vehicle} · ${order.status}` })),
      ...(backendRole === "SUPERADMIN" ? (liveInventory ?? []).filter((part: any) => `${part.sku} ${part.name} ${part.binLocation ?? ""}`.toLowerCase().includes(term)).map((part: any) => ({ type: "Inventory", id: part.id, title: `${part.sku} · ${part.name}`, detail: `${part.quantityOnHand} on hand · reorder at ${part.minReorderLevel}` })) : []),
      ...(backendRole === "SUPERADMIN" ? (liveFinancials ?? []).filter((record: any) => `${record.category} ${record.vendor ?? ""} ${record.invoiceNumber ?? ""} ${record.amount}`.toLowerCase().includes(term)).map((record: any) => ({ type: "Financial record", id: record.id, title: `${record.type} · ${record.category}`, detail: `₹${Number(record.amount).toLocaleString("en-IN")} · ${record.invoiceNumber ?? "No invoice"}` })) : []),
    ].slice(0, 8);
  }, [persistedVehicles, persistedOrders, liveInventory, liveFinancials, backendRole, query]);
  const vehicleCount = liveVehicles?.length ?? 0;
  const activeVehicleCount = liveVehicles?.filter((vehicle: any) => vehicle.status === "ACTIVE").length ?? 0;
  const fleetHealth = vehicleCount ? Math.round((activeVehicleCount / vehicleCount) * 100) : 0;
  const lowStockCount = liveInventory?.filter((part: any) => Number(part.quantityOnHand) <= Number(part.minReorderLevel)).length ?? 0;
  const unreadNotificationCount = liveNotifications?.filter((item: any) => !item.isRead).length ?? 0;
  const expenseTotal = liveFinancials?.filter((record: any) => record.type === "EXPENSE").reduce((total: number, record: any) => total + Number(record.amount), 0) ?? 0;
  const operatorName = session?.user.user_metadata?.fullName ?? session?.user.email ?? "";
  const operatorInitials = operatorName.slice(0, 2).toUpperCase();

  if (session && isRecoveryFlow) return <PublicAuthSurface view="update" email={authEmail} password={authPassword} fullName={authFullName} recoveryPassword={recoveryPassword} error={authError} submitting={authSubmitting} onEmail={setAuthEmail} onPassword={setAuthPassword} onFullName={setAuthFullName} onRecoveryPassword={setRecoveryPassword} onSubmit={handlePasswordUpdate} />;
  if (session && sessionTransition) return <main className="auth-page"><section className="auth-card"><div className="panel-kicker">VahanSync connection</div><h1>Securing your role workspace.</h1><p>We are clearing the previous session context before opening data for this authenticated account.</p><div className="workspace-state"><RefreshCw className="spin" size={18} /> Connecting to the assigned organization…</div></section></main>;
  if (session && (metadataNeedsOnboarding || backendSummary?.needsOnboarding)) return <OrganizationOnboarding initialName={String(session.user.user_metadata?.fullName ?? backendSummary?.org?.name ?? "")} initialOrganization={String(session.user.user_metadata?.orgName ?? "")} onComplete={async () => { const { error } = await refreshSession(); if (error) { toast.error("Session refresh failed", { description: error.message }); return; } window.localStorage.setItem("fleetops.openTeam", "1"); await refetchSummary(); }} />;
  if (session && staleSessionRecoveryAttempted && !backendSummary) return <main className="auth-page"><section className="auth-card"><div className="panel-kicker">VahanSync connection</div><h1>Reconfirming your workspace session.</h1><p>The new Supabase session is active, but the organization summary needs one fresh authorization check before operational data opens.</p><div className="workspace-state"><RefreshCw className="spin" size={18} /> Reconnecting to your organization…</div><button className="primary-button" onClick={() => { setStaleSessionRecoveryAttempted(false); void refetchSummary(); }}>Retry workspace load</button></section></main>;
  if (session && !backendSummary && summaryError) return <main className="auth-page"><section className="auth-card"><div className="panel-kicker">VahanSync connection</div><h1>We could not load your workspace.</h1><p>Your Supabase session is active, but the organization summary did not respond. Retry the request without leaving your secure session.</p><button className="primary-button" onClick={() => { void refetchSummary(); }}>Retry workspace load</button></section></main>;
  if (session && !backendSummary && summaryLoading) return <main className="auth-page"><section className="auth-card"><div className="panel-kicker">VahanSync connection</div><h1>Loading your workspace.</h1><p>We are checking your organization and role before opening operational data.</p><div className="workspace-state"><RefreshCw className="spin" size={18} /> Connecting to Supabase…</div></section></main>;
  if (!authLoading && !session && publicMode === "landing") return <LandingPage />;
  if (!authLoading && !session) return <PublicAuthSurface view={authMode} email={authEmail} password={authPassword} fullName={authFullName} recoveryPassword={recoveryPassword} error={authError} submitting={authSubmitting} onEmail={setAuthEmail} onPassword={setAuthPassword} onFullName={setAuthFullName} onRecoveryPassword={setRecoveryPassword} onSubmit={authMode === "signup" ? handleSignUp : authMode === "recover" ? handleRecoveryRequest : handleSignIn} onSetView={(view) => { setAuthMode(view); setAuthError(""); }} />;

  const completeOrder = (id?: string) => {
    if (!id || !session) return;
    completeWorkOrder.mutate({ workOrderId: id, parts: [] });
  };

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) toast.error("Sign out failed", { description: error.message });
    else toast.success("Signed out of VahanSync");
  };

  const chooseRole = (nextRole: typeof role) => {
    setShowRoleMenu(false);
    if (currentRole !== "SUPERADMIN" || nextRole.name !== "Super Admin / Owner command center") { toast.info("Role switching is disabled", { description: "VahanSync opens the workspace assigned to your authenticated account." }); return; }
    setActiveNav("Command center");
  };

  const replacementVehicles: CommandVehicle[] = persistedVehicles.map((vehicle) => ({
    id: vehicle.id,
    identity: vehicle.identity,
    name: vehicle.name,
    status: vehicle.status,
    odo: vehicle.odo,
    service: vehicle.service,
    tone: vehicle.tone === "good" ? "good" : "warn",
  }));

  const replacementContent = activeNav === "Command center" ? (
    <CommandDeck
      operatorName={operatorName}
      activeVehicles={activeVehicleCount}
      vehicleCount={vehicleCount}
      unreadCount={unreadNotificationCount}
      lowStockCount={lowStockCount}
      expenseTotal={formatInr(expenseTotal)}
      orders={persistedOrders}
      vehicles={replacementVehicles}
      commandOpen={quickFindOpen}
      query={query}
      commandResults={quickFindResults}
      onQuery={setQuery}
      onCloseCommand={() => { setQuickFindOpen(false); setQuery(""); }}
      onSelect={setActiveNav}
      onCompleteOrder={completeOrder}
    />
  ) : (
    <section className="replacement-workspace-host">
      <FunctionalWorkspace section={activeNav} session={Boolean(session)} organizationName={organizationName || undefined} onBack={() => setActiveNav(allowedNavLabels[0] ?? "Command center")} onSignOut={() => void handleSignOut()} />
    </section>
  );

  return (
    <OperationsFrame
      activeNav={activeNav}
      items={allowedNavItems}
      roleLabel={roleDescriptor[currentRole] ?? "Operations workspace"}
      organizationLabel={organizationLabel}
      organizationInitials={organizationInitials}
      vehicleCount={vehicleCount}
      operatorName={operatorName}
      operatorInitials={operatorInitials}
      unreadCount={unreadNotificationCount}
      showMobileNav={showMobileNav}
      onToggleMobileNav={() => setShowMobileNav((open) => !open)}
      onCloseMobileNav={() => setShowMobileNav(false)}
      onSelect={setActiveNav}
      onSignOut={() => void handleSignOut()}
      onToggleCommand={() => { setQuickFindOpen((open) => !open); setQuery(""); }}
    >
      {replacementContent}
    </OperationsFrame>
  );

  /* Legacy dashboard presentation retired for the frontend replacement.
  if (activeNav !== "Command center") return <div className="app-shell"><aside className={`sidebar ${showMobileNav ? "mobile-open" : ""}`}><div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><Route className="brand-mark-route" size={20} strokeWidth={2.4} /></div><div><div className="brand-name">VahanSync</div><div className="brand-tag">Fleet intelligence for India’s operators</div></div><button className="mobile-close" onClick={() => setShowMobileNav(false)} aria-label="Close navigation"><X size={18} /></button></div><div className="org-switcher"><div className="org-avatar">{organizationInitials}</div><div className="org-copy"><strong>{organizationLabel}</strong><span>{vehicleCount} vehicles · Supabase</span></div><ChevronDown size={15} /></div><div className="sidebar-scope"><span className="scope-dot" /> {roleDescriptor[currentRole] ?? "Operations workspace"}</div><WorkspaceNav items={allowedNavItems as typeof navItems} activeNav={activeNav} onSelect={setActiveNav} onClose={() => setShowMobileNav(false)} /></aside><main className="main-canvas"><header className="topbar"><div className="breadcrumb"><span>{organizationLabel}</span><span>/</span><strong>{activeNav}</strong></div><div className="topbar-actions"><button className="role-select" onClick={handleSignOut}>{session ? "Sign out" : "Sign in"}</button></div></header><section className="page-content"><FunctionalWorkspace section={activeNav} session={Boolean(session)} organizationName={organizationName || undefined} onBack={() => setActiveNav(allowedNavLabels[0] ?? "Command center")} /></section></main></div>;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${showMobileNav ? "mobile-open" : ""}`}>
        <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><Route className="brand-mark-route" size={20} strokeWidth={2.4} /></div><div><div className="brand-name">VahanSync</div><div className="brand-tag">Fleet intelligence for India’s operators</div></div><button className="mobile-close" onClick={() => setShowMobileNav(false)} aria-label="Close navigation"><X size={18} /></button></div>
        <div className="org-switcher"><div className="org-avatar">{organizationInitials}</div><div className="org-copy"><strong>{organizationLabel}</strong><span>{vehicleCount} vehicles · Supabase</span></div><ChevronDown size={15} /></div>
        <div className="sidebar-scope"><span className="scope-dot" /> {roleDescriptor[currentRole] ?? "Operations workspace"}</div>
        <WorkspaceNav items={allowedNavItems as typeof navItems} activeNav={activeNav} onSelect={setActiveNav} onClose={() => setShowMobileNav(false)} />
        <div className="sidebar-bottom">{currentRole === "SUPERADMIN" && <><div className="trial-card"><div className="trial-kicker"><Sparkles size={13} /> {billingStatus?.planName ?? billingStatus?.tier?.replaceAll("_", " ") ?? "Subscription"} <span>{billingStatus?.lifecycle === "TRIAL" ? `${billingStatus.daysRemaining} days left` : billingStatus?.lifecycle?.replaceAll("_", " ") ?? "—"}</span></div><strong>{billingStatus?.activeVehicles ?? vehicleCount} of {billingStatus?.maxVehicles ?? "—"} vehicles included</strong><div className="trial-progress"><span style={{ width: `${billingStatus?.maxVehicles ? Math.min(100, (vehicleCount / billingStatus.maxVehicles) * 100) : 0}%` }} /></div><div className="billing-mini-summary">Estimated {billingStatus?.currency === "INR" ? "₹" : ""}{billingStatus?.estimatedSubtotalPaise ? (billingStatus.estimatedSubtotalPaise / 100).toLocaleString("en-IN") : "—"} / month{billingStatus?.overageVehicles ? ` · ${billingStatus.overageVehicles} overage` : ""}</div><button onClick={() => setActiveNav("Billing")}>Review plan <SquareArrowOutUpRight size={13} /></button></div><button className="nav-item" onClick={() => setActiveNav("Billing")}><Settings2 size={17} /><span>Workspace settings</span></button></>}<div className="user-chip"><div className="user-avatar">{operatorInitials}</div><div><strong>{operatorName}</strong><span>Authenticated operator</span></div><MoreHorizontal size={16} /></div></div>
      </aside>

      <main className="main-canvas">
        <header className="topbar"><button className="mobile-menu" onClick={() => setShowMobileNav(true)} aria-label="Open navigation"><Menu size={19} /></button><div className="breadcrumb"><span>{organizationLabel}</span><span>/</span><strong>{activeNav}</strong></div><div className="topbar-actions">{currentRole === "SUPERADMIN" && <button className="command-button" onClick={() => { setQuickFindOpen((open) => !open); setQuery(""); }}><Command size={15} /> <span>Quick find</span><kbd>⌘ K</kbd></button>}<button className="notification-button" onClick={() => setActiveNav("Notifications")} aria-label="Notifications"><Bell size={18} />{liveNotifications?.filter((item: any) => !item.isRead).length ? <i>{liveNotifications.filter((item: any) => !item.isRead).length}</i> : null}</button><div className="role-select-wrap"><button className="role-select" onClick={() => { if (currentRole === "SUPERADMIN") setShowRoleMenu(!showRoleMenu); }} aria-haspopup={currentRole === "SUPERADMIN"} aria-expanded={currentRole === "SUPERADMIN" ? showRoleMenu : undefined}><span className="role-dot" /><span>{role.short}</span>{currentRole === "SUPERADMIN" && <ChevronDown size={14} />}</button>{showRoleMenu && <div className="role-menu">{roleMenuOptions.map((item: any) => <button key={item.name} onClick={() => chooseRole(item)}><item.icon size={15} /><span>{item.name}</span>{role.name === item.name && <Check size={14} />}</button>)}<button className="role-menu-auth" onClick={() => session ? void handleSignOut() : toast.info("Supabase Auth required", { description: "Sign in with your VahanSync Supabase account to sync this workspace." })}>{session ? "Sign out" : "Sign in to sync"}</button></div>}</div></div></header>

        {quickFindOpen && <div className="quick-find-panel"><div className="quick-find-head"><div><div className="panel-kicker">Command search</div><strong>Find a fleet record</strong></div><button className="icon-button" onClick={() => setQuickFindOpen(false)} aria-label="Close search"><X size={16} /></button></div><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Registration, order, part, invoice, vendor…" />{query && <div className="quick-find-results">{quickFindResults.length ? quickFindResults.map((result) => <button key={`${result.type}-${result.id}`} onClick={() => { setQuickFindOpen(false); setActiveNav(result.type === "Vehicle" ? "Vehicles" : result.type === "Inventory" ? "Inventory" : result.type === "Financial record" ? "Accountant ledger" : "Work orders"); }}><span className="quick-find-type">{result.type}</span><span><strong>{result.title}</strong><small>{result.detail}</small></span><ArrowUpRight size={14} /></button>) : <div className="quick-find-empty">No fleet records match “{query}”.</div>}</div>}</div>}

        <section className="page-content">
          <div className="hero-row"><div><div className="eyebrow"><span className="eyebrow-line" /> Fleet command center</div><h1>Good morning, {operatorName}<span className="accent-dot">.</span></h1><p className="hero-copy">Your fleet is <strong>{fleetHealth}% active</strong>. {lowStockCount || unreadNotificationCount ? `${lowStockCount + unreadNotificationCount} live signals need review.` : "No live signals need review."}</p></div></div>

          <div className="insight-banner"><div className="insight-icon"><CircleAlert size={19} /></div><div><strong>{summaryError ? "Live data unavailable" : summaryLoading ? "Syncing fleet signal" : "Maintenance signal detected"}</strong><p>{summaryError ? "Live data is temporarily unavailable. Open the relevant workspace to retry." : lowStockCount ? `${lowStockCount} inventory parts are below reorder threshold.` : unreadNotificationCount ? `${unreadNotificationCount} unread notifications need attention.` : "No active signals have been recorded."}</p></div><button onClick={() => setActiveNav(currentRole === "SUPERADMIN" ? "Notifications" : "Fleet manager workspace")}>Review signal <ArrowUpRight size={15} /></button></div>
          {session && <div className="backend-status-line">{[vehiclesError, ordersError, inventoryError, notificationsError, activityError].some(Boolean) ? "Some live panels are showing the last known snapshot." : vehiclesLoading || ordersLoading || inventoryLoading || notificationsLoading || activityLoading ? "Syncing live fleet, work orders, inventory, notifications, and activity…" : `Live data connected · ${liveInventory?.length ?? 0} inventory parts · ${liveActivity?.length ?? 0} recent events`}</div>}

          <div className="metrics-grid"><Metric label="Fleet health" value={`${fleetHealth} / 100`} delta={`${activeVehicleCount}`} detail="active vehicles" icon={Gauge} accent="orange" /><Metric label="Active vehicles" value={`${activeVehicleCount} / ${vehicleCount}`} delta={`${vehicleCount}`} detail="live from Supabase" icon={Bus} accent="blue" /><Metric label="Open work orders" value={String(backendSummary?.openWorkOrders ?? 0)} delta={String(persistedOrders.length)} detail="live work-order records" icon={Wrench} accent="orange" /><Metric label="Operating spend" value={formatInr(expenseTotal)} delta={String(liveFinancials?.length ?? 0)} detail="financial records" icon={IndianRupee} accent="green" /></div>

          <div className="workspace-grid"><section className="panel fleet-panel"><div className="panel-heading"><div><div className="panel-kicker">Live fleet register</div><h2>Vehicle health</h2></div><button className="text-button" onClick={() => setActiveNav("Vehicles")}>View all vehicles <ArrowUpRight size={15} /></button></div><div className="fleet-toolbar"><div className="search-field"><Search size={15} /><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search VIN, registration, or route" /></div><div className="filter-tabs">{["All fleet", "On route", "At depot"].map((item: any) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? "selected" : ""}>{item}</button>)}</div></div><div className="vehicle-list">{visibleVehicles.map((vehicle: any) => <button className="vehicle-row" key={vehicle.id} onClick={() => setActiveNav("Vehicles")}><div className="vehicle-icon"><Bus size={18} /></div><div className="vehicle-info"><strong>{vehicle.identity}</strong><span>{vehicle.name}</span></div><div className={`vehicle-status signal-chip ${vehicle.tone}`}><span className="status-dot" />{vehicle.status}<small>{vehicle.tone === "good" ? "ready" : vehicle.tone === "warn" ? "review" : "held"}</small></div><HealthRing value={vehicle.health} /><div className="vehicle-meta"><strong>{vehicle.odo}</strong><span>{vehicle.service}</span></div><ArrowUpRight size={16} className="row-arrow" /></button>)}</div></section>

          <aside className="decision-rail"><section className="panel readiness-panel"><div className="panel-heading compact"><div><div className="panel-kicker">Dispatch readiness</div><h2>Tomorrow, 06:00</h2></div><span className="live-pill"><span />Live</span></div><div className="readiness-score"><div className="big-score">{activeVehicleCount}<span>/{vehicleCount}</span></div><div><strong>active vehicles</strong><p>{vehicleCount - activeVehicleCount} vehicles are not active.</p></div></div><div className="readiness-bar"><span style={{ width: `${vehicleCount ? (activeVehicleCount / vehicleCount) * 100 : 0}%` }} /></div><div className="readiness-legend"><span><i className="dot-ready" /> Active <b>{activeVehicleCount}</b></span><span><i className="dot-warning" /> Inactive <b>{vehicleCount - activeVehicleCount}</b></span><span><i className="dot-critical" /> Alerts <b>{unreadNotificationCount}</b></span></div></section><section className="panel spend-panel"><div className="panel-heading compact"><div><div className="panel-kicker">Operating spend</div><h2>{formatInr(expenseTotal)} <small>live expenses</small></h2></div><span className="trend-up"><TrendingUp size={14} /> {liveFinancials?.length ?? 0} records</span></div><div className="sparkline">{liveFinancials?.length ? liveFinancials.slice(0, 10).map((record: any) => <span key={record.id} style={{ height: `${Math.min(100, Math.max(8, (Number(record.amount) / Math.max(expenseTotal, 1)) * 100))}%` }} />) : <div className="empty-state">No financial records yet.</div>}</div><div className="spend-footer"><span>Supabase financial ledger</span><span>{liveFinancials?.length ?? 0} records</span></div></section></aside></div>

          <div className="lower-grid"><section className="panel orders-panel"><div className="panel-heading"><div><div className="panel-kicker">Action queue</div><h2>Work orders</h2></div><button className="text-button" onClick={() => setShowAllOrders(!showAllOrders)}>{showAllOrders ? "Show less" : `View all ${persistedOrders.length}`} <ArrowUpRight size={15} /></button></div><div className="orders-table"><div className="table-head"><span>Order</span><span>Vehicle</span><span>Owner</span><span>Priority</span><span>Due</span><span /></div>{visibleOrders.map((order: any) => <div className="table-row" key={order.id}><div className="order-cell"><strong>{order.id}</strong><span>{order.title}</span></div><span className="vehicle-cell">{order.vehicle}</span><span className="owner-cell"><span className="mini-avatar">{order.owner.split(" ").map((part: any) => part[0]).join("")}</span>{order.owner}</span><span className={`priority signal-chip ${order.priority.toLowerCase()}`}><span className="status-dot" />{order.priority}</span><span className="due-cell"><Clock3 size={13} />{order.due}</span>{order.status !== "Completed" && order.sourceId ? <button className="row-action" onClick={() => completeOrder(order.sourceId)} disabled={completeWorkOrder.isPending} aria-label={`Complete ${order.id}`}><Check size={15} /></button> : order.status === "Completed" ? <span className="completed-check"><Check size={15} /></span> : <span className="row-action-disabled" title="Only persisted work orders can be completed">—</span>}</div>)}</div></section><section className="panel activity-panel"><div className="panel-heading"><div><div className="panel-kicker">Operations feed</div><h2>Recent activity <small>{session ? `${liveActivity?.length ?? 0} live` : ""}</small></h2></div><button className="icon-button" onClick={() => setActiveNav("Notifications")}><MoreHorizontal size={18} /></button></div><div className="maintenance-strip"><div className="maintenance-illustration" aria-hidden="true"><Wrench size={20} /></div><div><strong>{lowStockCount ? "Inventory signal" : "Operations feed"}</strong><span>{lowStockCount ? `${lowStockCount} parts are below their configured reorder threshold.` : "No active maintenance signal has been recorded."}</span></div></div><div className="inventory-signal"><div><div className="panel-kicker">Inventory ledger</div><strong>Live stock watch</strong></div><span className="signal-chip warn"><Package size={12} />{`${lowStockCount} below reorder`}</span></div>{session && <div className="inventory-state">{inventoryLoading ? "Loading inventory ledger…" : inventoryError ? "Inventory is temporarily unavailable." : liveInventory?.length ? liveInventory.slice(0, 3).map((part: any) => <span key={part.id}><strong>{part.name}</strong><small>{part.quantityOnHand} on hand · reorder at {part.minReorderLevel}</small></span>) : "No inventory parts have been added yet."}</div>}<div className="activity-list">{session && activityLoading ? <div className="empty-state">Loading recent operations…</div> : session && activityError ? <div className="empty-state">Activity is temporarily unavailable.</div> : session && liveActivity?.length ? liveActivity.slice(0, 3).map((event) => <div className="activity-item" key={event.id}><span className="activity-bubble orange"><Activity size={15} /></span><div><p><strong>{event.title}</strong></p><span>{event.detail} · {new Date(event.createdAt).toLocaleString()}</span></div></div>) : <div className="empty-state">No activity has been recorded for this organization yet.</div>}</div></section></div>

          <footer className="page-footer"><span><span className="footer-pulse" /> {authLoading ? "Connecting Supabase Auth" : "Supabase Auth + Realtime connected"}</span><span>Live query result · {liveActivity?.length ?? 0} events</span><span>© VahanSync / {organizationLabel}</span></footer>
        </section>
      </main>
    </div>
  );
  */
}
