import { useEffect, useState } from "react";
import { ArrowLeft, Check, Download, Gauge, Mail, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { TeamWorkspace } from "@/components/workspaces/TeamWorkspace";
import { NotificationWorkspace } from "@/components/workspaces/NotificationWorkspace";
import { WorkspaceState as State } from "@/components/workspaces/WorkspaceState";
import type { DocumentRow, FinancialMetricRow, FinancialRecord, FinancialReconciliationRow, FleetVehicle, ProcurementOrderRow, WorkOrderRow } from "@/types/fleet";
import { AccountantRoleWorkspace } from "@/components/RoleWorkspaces";
import { DriverWorkspace } from "@/components/workspaces/DriverWorkspace";
import { ExecutiveOverviewWorkspace } from "@/components/workspaces/ExecutiveOverviewWorkspace";
import { FleetManagerOverviewWorkspace } from "@/components/workspaces/FleetManagerOverviewWorkspace";
import { InventoryManagerWorkspace as InventoryControlWorkspace } from "@/components/workspaces/InventoryManagerWorkspace";
import { MechanicExecutionWorkspace } from "@/components/workspaces/MechanicExecutionWorkspace";
import { TechnicianExecutionWorkspace } from "@/components/workspaces/TechnicianExecutionWorkspace";
import { ProcurementWorkspace } from "@/components/workspaces/ProcurementWorkspace";
import { ResourceWorkspace } from "@/components/workspaces/ResourceWorkspace";
import { ComplianceWorkspace } from "@/components/workspaces/ComplianceWorkspace";
import { AccountantWorkspace } from "@/components/workspaces/AccountantWorkspace";
import { BillingWorkspace } from "@/components/workspaces/BillingWorkspace";
import { OrganizationSettingsWorkspace } from "@/components/workspaces/OrganizationSettingsWorkspace";
import { VehicleRegisterWorkspace } from "@/components/workspaces/VehicleRegisterWorkspace";
import { ComponentLifecycleWorkspace } from "@/components/workspaces/ComponentLifecycleWorkspace";
import { WorkOrderReviewWorkspace } from "@/components/workspaces/WorkOrderReviewWorkspace";
import { ProfileWorkspace } from "@/components/workspaces/ProfileWorkspace";

type Props = { section: string; session: boolean; onBack: () => void; organizationName?: string; onSignOut?: () => void };
type GenericResourceRow = { id: string; [key: string]: unknown };

function downloadCsv(filename: string, content: string) { const blob = new Blob([content], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }
function downloadPdf(filename: string, base64: string) { const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)); const blob = new Blob([bytes], { type: "application/pdf" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }


export default function FunctionalWorkspace({ section, session, onBack, organizationName, onSignOut }: Props) {
  if (!session) return <section className="panel auth-gate"><Mail size={24} /><h2>Sign in to open {section}</h2><p>This workspace is connected to Supabase and does not show demo records while signed out.</p><button className="primary-button" onClick={() => toast.info("Use your Supabase Auth sign-in flow to continue.")}><Plus size={16} /> Sign in to sync</button></section>;
  const fleetManagerPage = section === "Fleet manager workspace" ? { label: "Fleet readiness", title: "Operate the connected fleet", description: "Vehicles, components, work orders, driver handoffs, and compliance signals stay linked to the same organization." } : section === "Vehicles" ? { label: "Asset register", title: "Vehicles", description: "Create, assign, edit, and monitor every vehicle before maintenance signals become breakdowns." } : section === "Components" ? { label: "Maintenance signals", title: "Components", description: "Install service components with odometer thresholds so the next work order starts with evidence." } : section === "Work orders" ? { label: "Dispatch control", title: "Work orders", description: "Turn vehicle signals and driver reports into assigned, traceable maintenance handoffs." } : section === "Compliance vault" ? { label: "Readiness records", title: "Compliance vault", description: "Keep vehicle and driver documents visible, dated, and ready for renewal before they expire." } : null;
  const sharedPage = ({
    Team: ["People and access", "Team", "Invite organization members, review roles, and manage secure membership boundaries."],
    Settings: ["Organization controls", "Settings", "Maintain organization identity, operating limits, labor rates, and safety contacts."],
    Inventory: ["Parts control", "Inventory", "Track tenant-scoped stock, movements, reservations, and reorder signals."],
    Vendors: ["Procurement directory", "Vendors", "Keep supplier contacts ready for purchase orders and receiving."],
    "Purchase orders": ["Procurement workflow", "Purchase orders", "Create, approve, receive, and reconcile supplier orders with variance traceability."],
    Notifications: ["Operational signals", "Notifications", "Review recipient-scoped alerts and resolve source records through permitted actions."],
    "P&L analytics": ["INR financials", "P&L analytics", "Review organization-scoped ledger, cost attribution, and vehicle profitability."],
    Billing: ["Subscription governance", "Billing", "Review trial capacity and organization subscription state as the account owner."],
    Profile: ["Account controls", "Profile", "Keep your personal details current and manage this authenticated VahanSync session."],
  } as Record<string, [string, string, string]>)[section];
  const pageHeader = fleetManagerPage ?? (sharedPage ? { label: sharedPage[0], title: sharedPage[1], description: sharedPage[2] } : null);
  const content = section === "Team" ? <TeamWorkspace enabled={session} /> : session && section === "Settings" ? <OrganizationSettingsWorkspace /> : session && section === "Profile" ? <ProfileWorkspace organizationName={organizationName} onSignOut={onSignOut} /> : session && section === "Command center" ? <ExecutiveOverviewWorkspace organizationName={organizationName} /> : session && section === "Fleet manager workspace" ? <FleetManagerOverviewWorkspace organizationName={organizationName} /> : session && section === "Vehicles" ? <VehicleRegisterWorkspace /> : session && section === "Components" ? <ComponentLifecycleWorkspace /> : session && section === "Work orders" ? <WorkOrderReviewWorkspace organizationName={organizationName} /> : session && section === "Inventory manager workspace" ? <InventoryControlWorkspace /> : session && section === "Inventory" ? <ResourceWorkspace section="Inventory" organizationName={organizationName} /> : session && section === "Vendors" ? <ResourceWorkspace section="Vendors" organizationName={organizationName} /> : session && section === "Purchase orders" ? <ProcurementWorkspace /> : session && section === "Mechanic workspace" ? <MechanicExecutionWorkspace organizationName={organizationName ?? "your organization"} role="MECHANIC" /> : session && section === "Technician workspace" ? <TechnicianExecutionWorkspace organizationName={organizationName ?? "your organization"} /> : session && section === "Mechanic / Technician workspace" ? <MechanicExecutionWorkspace organizationName={organizationName ?? "your organization"} role="MECHANIC" /> : session && (section === "Accountant ledger" || section === "P&L analytics") ? <AccountantRoleWorkspace organizationName={organizationName}><AccountantWorkspace showApprovalQueue={section === "P&L analytics"} /></AccountantRoleWorkspace> : session && section === "Driver portal" ? <DriverWorkspace /> : session && section === "Notifications" ? <NotificationWorkspace /> : session && section === "Compliance vault" ? <ComplianceWorkspace /> : session && section === "Billing" ? <BillingWorkspace /> : <section className="replacement-unavailable-workspace"><h2>Workspace unavailable</h2><p>This signed-in role does not have a workspace for the requested route.</p></section>;
  const sectionClass = section.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return <div className={`functional-workspace ${sectionClass}${fleetManagerPage ? " fleet-manager-surface" : ""}`}><button className="back-link" onClick={onBack} aria-label={`Return from ${section} to command center`}><ArrowLeft size={15} aria-hidden="true" /> Back to command center</button>{pageHeader && <header className="workspace-page-header"><div><div className="panel-kicker">{pageHeader.label}{fleetManagerPage ? " · Fleet Manager" : " · Organization workspace"}</div><h1>{pageHeader.title}<span className="accent-dot">.</span></h1><p>{pageHeader.description}</p></div><div className="workspace-chain" aria-label={`${pageHeader.title} workflow context`}><span className="chain-node active">01</span><span>Context</span><i aria-hidden="true" /> <span className="chain-node">02</span><span>Records</span><i aria-hidden="true" /> <span className="chain-node">03</span><span>Next action</span></div><div className="workspace-header-foot"><span className="signal-chip good"><span className="status-dot" /> Live organization view</span><span>Tenant-scoped records</span><span>Role boundaries active</span></div></header>}{content}</div>;
}
