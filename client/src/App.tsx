/* VahanSync application shell: role-aware navigation and operational command canvas. */
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import JoinOrganization from "./pages/JoinOrganization";
import { AboutPage, PricingPage, SecurityPage } from "./pages/MarketingPages";
import { useFleetOpsAuth } from "./hooks/useFleetOpsAuth";
import { trpc } from "./lib/trpc";
import { getAllowedWorkspace } from "./workspaceAccess";
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
  const { session, loading, signOut } = useFleetOpsAuth();
  const metadataNeedsOnboarding = session?.user.user_metadata?.needsOnboarding === true || session?.user.user_metadata?.needsOnboarding === "true";
  const summary = trpc.dashboard.summary.useQuery(undefined, { enabled: Boolean(session), retry: 2, refetchOnWindowFocus: false, refetchOnReconnect: false });
  useEffect(() => {
    if (summary.error?.data?.code === "UNAUTHORIZED" && !metadataNeedsOnboarding) void signOut();
  }, [metadataNeedsOnboarding, signOut, summary.error]);

  if (!session && !loading) return <Home publicMode="signin" />;
  if (session && metadataNeedsOnboarding && summary.error?.data?.code === "UNAUTHORIZED") return <Home publicMode="signup" />;
  if (loading || (session && summary.isLoading)) return <div className="auth-page"><div className="auth-card"><h1>Loading workspace access…</h1><p>Confirming your current role session before opening operational data.</p></div></div>;
  if (session && summary.isError) return <div className="auth-page"><div className="auth-card"><h1>Workspace connection needs attention.</h1><p>We could not load your assigned workspace. Please sign in again to resume live data.</p><button className="primary-button" onClick={() => void summary.refetch()}>Retry workspace load</button></div></div>;
  if (session && summary.data?.role && !allowedRoles.includes(summary.data.role)) return <div className="auth-page"><div className="auth-card"><h1>Workspace access restricted.</h1><p>Your VahanSync role does not have access to the {section} workspace.</p><a className="primary-button" href="/">Return to command center</a></div></div>;
  const allowedSection = summary.data?.role
    ? getAllowedWorkspace(summary.data.role, section)
    : section;
  return <Home initialSection={allowedSection} initialSummary={summary.data} />;
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
