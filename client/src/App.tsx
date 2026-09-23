/* VahanSync application shell: role-aware navigation and operational command canvas. */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { useEffect, useState } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import JoinOrganization from "./pages/JoinOrganization";
import { AboutPage, PricingPage, SecurityPage } from "./pages/MarketingPages";
import { useFleetOpsAuth } from "./hooks/useFleetOpsAuth";
import { trpc } from "./lib/trpc";
import { Route, Switch, useRoute } from "wouter";

function WorkspaceRoute() {
  const [, params] = useRoute("/workspace/:section");
  return <GuardedWorkspaceRoute section={decodeURIComponent((params as { section?: string } | null)?.section ?? "Command center")} allowedRoles={["SUPERADMIN", "FLEET_MANAGER", "INVENTORY_MANAGER", "MECHANIC", "TECHNICIAN", "DRIVER", "ACCOUNTANT"]} />;
}

function DefaultRoute() {
  return <Home publicMode="landing" />;
}

function LoginRoute() {
  return <Home publicMode="signin" />;
}

function CreateOrganizationRoute() {
  return <Home publicMode="signup" />;
}

function GuardedWorkspaceRoute({ section, allowedRoles }: { section: string; allowedRoles: string[] }) {
  const { session, loading, refreshSession } = useFleetOpsAuth();
  const summary = trpc.dashboard.summary.useQuery(undefined, { enabled: Boolean(session), retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const [recoveryAttempted, setRecoveryAttempted] = useState(false);
  const [recoveringSession, setRecoveringSession] = useState(false);
  const summaryUnauthorized = summary.error?.data?.code === "UNAUTHORIZED" || /unauthorized|session expired|organization profile/i.test(summary.error?.message ?? "");

  useEffect(() => {
    if (!session || !summary.isError || !summaryUnauthorized || recoveryAttempted || recoveringSession) return;
    setRecoveryAttempted(true);
    setRecoveringSession(true);
    void refreshSession().then(async (result) => {
      if (!result.error && result.data.session) await summary.refetch();
    }).finally(() => setRecoveringSession(false));
  }, [recoveryAttempted, recoveringSession, refreshSession, session, summary, summaryUnauthorized]);

  if (!session && !loading) return <Home publicMode="signin" />;
  if (loading || (session && (summary.isLoading || recoveringSession))) return <div className="auth-page"><div className="auth-card"><h1>Loading workspace access…</h1><p>Confirming your current role session before opening operational data.</p></div></div>;
  if (session && summary.isError) return <div className="auth-page"><div className="auth-card"><h1>Workspace connection needs attention.</h1><p>{summaryUnauthorized ? "Your new role session is being confirmed. Please retry once without signing out." : "We could not load your assigned workspace. Please retry without leaving your secure session."}</p><button className="primary-button" onClick={() => { setRecoveryAttempted(false); void summary.refetch(); }}>Retry workspace load</button></div></div>;
  if (session && summary.data?.role && !allowedRoles.includes(summary.data.role)) return <div className="auth-page"><div className="auth-card"><h1>Workspace access restricted.</h1><p>Your VahanSync role does not have access to the {section} workspace.</p><a className="primary-button" href="/">Return to command center</a></div></div>;
  return <Home initialSection={section} />;
}

function FleetManagerRoute() { return <GuardedWorkspaceRoute section="Fleet manager workspace" allowedRoles={["FLEET_MANAGER"]} />; }
function MechanicRoute() { return <GuardedWorkspaceRoute section="Mechanic workspace" allowedRoles={["MECHANIC"]} />; }
function TechnicianRoute() { return <GuardedWorkspaceRoute section="Technician workspace" allowedRoles={["TECHNICIAN"]} />; }
function DriverRoute() { return <GuardedWorkspaceRoute section="Driver portal" allowedRoles={["DRIVER"]} />; }
function AccountantRoute() { return <GuardedWorkspaceRoute section="Accountant ledger" allowedRoles={["ACCOUNTANT"]} />; }
function TeamRoute() { return <GuardedWorkspaceRoute section="Team" allowedRoles={["SUPERADMIN"]} />; }
function InventoryRoute() { return <GuardedWorkspaceRoute section="Inventory manager workspace" allowedRoles={["INVENTORY_MANAGER"]} />; }

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <OfflineIndicator />
          <PWAInstallPrompt />
          <Switch>
            <Route path="/join/:token" component={JoinOrganization} />
            <Route path="/login" component={LoginRoute} />
            <Route path="/create-organization" component={CreateOrganizationRoute} />
            <Route path="/pricing" component={PricingPage} />
            <Route path="/about" component={AboutPage} />
            <Route path="/security" component={SecurityPage} />
            <Route path="/fleet-manager" component={FleetManagerRoute} />
            <Route path="/mechanic" component={MechanicRoute} />
            <Route path="/technician" component={TechnicianRoute} />
            <Route path="/driver" component={DriverRoute} />
            <Route path="/accountant" component={AccountantRoute} />
            <Route path="/team" component={TeamRoute} />
            <Route path="/inventory" component={InventoryRoute} />
            <Route path="/workspace/:section" component={WorkspaceRoute} />
            <Route path="/" component={DefaultRoute} />
            <Route component={DefaultRoute} />
          </Switch>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
