import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? "" : "http://localhost:8000");

type QueryOptions = { enabled?: boolean; retry?: boolean };
type MutationOptions = { onSuccess?: (value: unknown) => void; onError?: (error: Error) => void };

function tokenFromStorage() {
  return sessionStorage.getItem("vahana:access-token");
}

async function accessToken() {
  const localToken = tokenFromStorage();
  if (localToken) return localToken;
  if (!supabase) return undefined;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

async function request(path: string, input?: unknown, method = "GET") {
  const send = async (token?: string) => fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(input ?? {}) }),
  });
  let token = await accessToken();
  let response = await send(token);
  if (response.status === 401 && supabase) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.data.session?.access_token) {
      token = refreshed.data.session.access_token;
      response = await send(token);
    } else {
      await supabase.auth.signOut({ scope: "local" });
      window.dispatchEvent(new CustomEvent("fleetops-session-expired"));
    }
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = Array.isArray(body?.detail)
      ? body.detail.map((item: { msg?: string }) => item.msg ?? "Invalid request").join(", ")
      : body?.detail;
    const error = new Error(detail || `Request failed with status ${response.status}`);
    Object.assign(error, { status: response.status, data: { code: response.status === 401 ? "UNAUTHORIZED" : "BAD_REQUEST" } });
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function collectionPath(path: string) {
  const root = path.split(".")[0];
  const map: Record<string, string> = {
    vehicles: "/api/v1/vehicles",
    workOrders: "/api/v1/work-orders",
    components: "/api/v1/components",
    documents: "/api/v1/documents",
    notifications: "/api/v1/notifications",
    inventory: "/api/v1/parts",
    vendors: "/api/v1/vendors",
    purchaseOrders: "/api/v1/purchase-orders",
    users: "/api/v1/users",
    team: "/api/v1/users",
    financials: "/api/v1/expenses",
    expenses: "/api/v1/expenses",
    maintenanceTemplates: "/api/v1/maintenance/templates",
    planning: "/api/v1/maintenance-plans",
    compliance: "/api/v1/compliance",
    reports: "/api/v1/reports",
    activity: "/api/v1/activity-feed",
    triage: "/api/v1/triage/queue",
    billing: "/api/v1/billing",
    profile: "/api/v1/auth/me",
    organizationSettings: "/api/v1/organization/settings",
    dashboard: "/api/v1/dashboard/summary",
  };
  return map[root] ?? `/api/v1/${root}`;
}

function queryPath(path: string, input: unknown) {
  if (path === "auth.me") return "/api/v1/auth/me";
  if (path === "dashboard.summary") return "/api/v1/dashboard/summary";
  if (path === "financials.metrics") return "/api/v1/financials/metrics";
  if (path === "compliance.summary") return "/api/v1/compliance/summary";
  if (path === "billing.plans") return "/api/v1/subscription/plans";
  if (path === "billing.status") return "/api/v1/subscription";
  if (path === "billing.invoices" || path === "financials.invoices") return "/api/v1/billing/invoices";
  if (path === "activity.recent") return "/api/v1/activity-feed";
  if (path === "triage.queue") return "/api/v1/triage/queue";
  if (path === "planning.maintenance") return "/api/v1/maintenance-plans";
  if (path === "maintenanceTemplates.list") return "/api/v1/maintenance/templates";
  if (path === "reports.maintenancePerformance") return "/api/v1/reports/maintenance-performance";
  if (path === "team.members") return "/api/v1/users";
  if (path === "team.operationalRoster") return "/api/v1/team/roster";
  if (path === "team.assignableMembers") return "/api/v1/team/assignable-members";
  if (path === "inventory.movements") return "/api/v1/inventory/movements";
  if (path === "inventory.references" && (input as { partId?: string | number } | undefined)?.partId) return `/api/v1/inventory/parts/${(input as { partId: string | number }).partId}/references`;
  if (path === "inventory.get" && (input as { partId?: string | number } | undefined)?.partId) return `/api/v1/inventory/parts/${(input as { partId: string | number }).partId}/detail`;
  if (path === "financials.approvalQueue") return "/api/v1/financials/approval-queue";
  if (path === "financials.reconcile") return "/api/v1/financials/reconciliation";
  if (path === "notifications.sourceDetail" && (input as { notificationId?: string | number } | undefined)?.notificationId) return `/api/v1/notifications/${(input as { notificationId: string | number }).notificationId}/source-detail`;
  if (path === "vendors.pricingHistory" && (input as { vendorId?: string | number } | undefined)?.vendorId) return `/api/v1/vendors/${(input as { vendorId: string | number }).vendorId}/pricing-history`;
  if (path === "purchaseOrders.list") return "/api/v1/purchase-orders";
  if (path === "compliance.summary") return "/api/v1/compliance/summary";
  const base = collectionPath(path);
  const value = input as { id?: string | number; vehicleId?: string | number; workOrderId?: string | number } | undefined;
  if (path.endsWith("detail") && value?.id) return `${base}/${value.id}`;
  if (path.includes("odometerHistory") && value?.vehicleId) return `/api/v1/vehicles/${value.vehicleId}/odometer`;
  if (path.includes("handoffTimeline") && value?.workOrderId) return `/api/v1/work-orders/${value.workOrderId}/handoff-timeline`;
  return base;
}

function mutationPath(path: string, input: unknown) {
  const value = input as { id?: string | number; vehicleId?: string | number; workOrderId?: string | number; notificationId?: string | number; issueId?: string | number; partId?: string | number; poId?: string | number; vendorId?: string | number } | undefined;
  const base = collectionPath(path);
  if (path === "auth.logout") return "/api/v1/auth/logout";
  if (path === "profile.update") return "/api/v1/users/me";
  if (path === "team.invite") return "/api/v1/invitations";
  if (path === "organizationSettings.update") return "/api/v1/organization/settings";
  if (path.includes("startWork") && value?.workOrderId) return `/api/v1/work-orders/${value.workOrderId}/start`;
  if (path.includes("complete") && value?.workOrderId) return `/api/v1/work-orders/${value.workOrderId}/complete`;
  if (path.includes("approve") && value?.id) return `/api/v1/work-orders/${value.id}/approve`;
  if (path.includes("assignVehicle") && value?.vehicleId) return `/api/v1/vehicles/${value.vehicleId}/assign-driver`;
  if (path.includes("markRead") && value?.notificationId) return `/api/v1/notifications/${value.notificationId}`;
  if (path.includes("resolve") && value?.notificationId) return `/api/v1/notifications/${value.notificationId}/resolve`;
  if (path.includes("createWorkOrderFromIssue") && value?.issueId) return `/api/v1/triage/issues/${value.issueId}/create-work-order`;
  if (path.includes("reservePart") && value?.workOrderId) return `/api/v1/work-orders/${value.workOrderId}/reserve-part`;
  if (path.includes("returnReservedPart") && value?.workOrderId) return `/api/v1/work-orders/${value.workOrderId}/return-reserved-part`;
  if (path.includes("receivePartial") && value?.poId) return `/api/v1/purchase-orders/${value.poId}/receive-partial`;
  if (path.includes("pricingHistory") && value?.vendorId) return `/api/v1/vendors/${value.vendorId}/pricing-history`;
  if (path.includes("applyTemplate") && value?.id) return `/api/v1/maintenance/templates/${value.id}/apply`;
  if (path.includes("update") && value?.issueId) return `/api/v1/triage/issues/${value.issueId}`;
  if (value?.id && (path.endsWith("update") || path.endsWith("remove"))) return `${base}/${value.id}`;
  return base;
}

function mutationMethod(path: string) {
  if (path.endsWith("update") || path.endsWith("updateStatus") || path === "profile.update" || path === "organizationSettings.update" || path.includes("markRead")) return "PATCH";
  if (path.includes("updateChecklist") || path.includes("reconcile")) return "PUT";
  if (path.endsWith("remove")) return "DELETE";
  return "POST";
}

function useApiQuery(path: string, input: unknown, options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  const inputKey = JSON.stringify(input);
  const [state, setState] = useState<{ data: unknown; error: Error | null; isLoading: boolean }>({ data: undefined, error: null, isLoading: enabled });
  const refetch = useCallback(async () => {
    if (!enabled) return;
    setState((current) => ({ ...current, isLoading: true, error: null }));
    try {
      const data = await request(queryPath(path, input), input);
      setState({ data, error: null, isLoading: false });
      return { data };
    } catch (error) {
      setState({ data: undefined, error: error as Error, isLoading: false });
      return { error };
    }
  }, [enabled, inputKey, path]);
  useEffect(() => { void refetch(); }, [refetch]);
  return { ...state, isError: Boolean(state.error), refetch };
}

function useApiMutation(path: string, options?: MutationOptions) {
  const [state, setState] = useState<{ error: Error | null; isPending: boolean }>({ error: null, isPending: false });
  const mutateAsync = useCallback(async (input?: unknown) => {
    setState({ error: null, isPending: true });
    try {
      const data = await request(mutationPath(path, input), input, mutationMethod(path));
      setState({ error: null, isPending: false });
      options?.onSuccess?.(data);
      return data;
    } catch (error) {
      setState({ error: error as Error, isPending: false });
      options?.onError?.(error as Error);
      throw error;
    }
  }, [options, path]);
  return { ...state, mutateAsync, mutate: (input?: unknown) => { void mutateAsync(input); } };
}

function createUtilsProxy(): any {
  return new Proxy({}, {
    get(_target, property: string) {
      if (property === "invalidate") return async () => undefined;
      if (property === "setData") return () => undefined;
      return createUtilsProxy();
    },
  });
}

const utils = createUtilsProxy();

function createProxy(path = ""): any {
  return new Proxy(() => undefined, {
    get(_target, property: string) {
      if (property === "useQuery") return (input?: unknown, options?: QueryOptions) => useApiQuery(path, input, options);
      if (property === "useMutation") return (options?: MutationOptions) => useApiMutation(path, options);
      if (property === "useUtils") return () => utils;
      if (property === "Provider") return ({ children }: { children: ReactNode }) => children;
      if (property === "createClient") return () => ({});
      return createProxy(path ? `${path}.${property}` : property);
    },
  });
}

export const trpc = createProxy();
