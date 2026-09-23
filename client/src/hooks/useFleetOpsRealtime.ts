import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";

export function useFleetOpsRealtime(orgId?: string) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!orgId || !supabase) return;
    const channel = supabase
      .channel(`fleetops-org-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles", filter: `orgId=eq.${orgId}` }, () => {
        void utils.dashboard.summary.invalidate();
        void utils.vehicles.list.invalidate();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "odometer_logs" }, () => {
        void utils.dashboard.summary.invalidate();
        void utils.vehicles.list.invalidate();
        void utils.vehicles.odometerHistory.invalidate();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders", filter: `orgId=eq.${orgId}` }, () => {
        void utils.dashboard.summary.invalidate();
        void utils.workOrders.list.invalidate();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `orgId=eq.${orgId}` }, () => {
        void utils.notifications.list.invalidate();
        void utils.dashboard.summary.invalidate();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_parts", filter: `orgId=eq.${orgId}` }, () => {
        void utils.inventory.list.invalidate();
        void utils.dashboard.summary.invalidate();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "documents", filter: `orgId=eq.${orgId}` }, () => {
        void utils.documents.list.invalidate();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "financial_records", filter: `orgId=eq.${orgId}` }, () => {
        void utils.financials.list.invalidate();
        void utils.financials.metrics.invalidate();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "dvir_inspections", filter: `orgId=eq.${orgId}` }, () => {
        void utils.driver.inspections.invalidate();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "fuel_logs", filter: `orgId=eq.${orgId}` }, () => {
        void utils.driver.fuelLogs.invalidate();
        void utils.financials.metrics.invalidate();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orgId, utils]);
}
