export function statusKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
}

export function isActiveVehicleStatus(value: unknown): boolean {
  return !["OUT_OF_SERVICE", "RETIRED"].includes(statusKey(value));
}

export function isTerminalWorkOrderStatus(value: unknown): boolean {
  return ["COMPLETED", "CLOSED", "ARCHIVED", "CANCELLED"].includes(
    statusKey(value),
  );
}
