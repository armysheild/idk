import type { FleetVehicle } from "@/types/fleet";

export function formatVehicleIdentity(vehicle?: Pick<FleetVehicle, "vin" | "licensePlate"> | null) {
  const vin = String(vehicle?.vin ?? "").trim().toUpperCase();
  const registration = String(vehicle?.licensePlate ?? "").trim().toUpperCase();
  if (vin && registration) return `VIN ${vin} · Reg ${registration}`;
  if (vin) return `VIN ${vin}`;
  if (registration) return `Reg ${registration}`;
  return "Vehicle unavailable";
}
