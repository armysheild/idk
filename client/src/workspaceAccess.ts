export const roleNavAccess: Record<string, string[]> = {
  SUPERADMIN: ["Command center", "Notifications", "Compliance vault", "P&L analytics", "Billing", "Team", "Profile"],
  FLEET_MANAGER: ["Fleet manager workspace", "Vehicles", "Components", "Work orders", "Notifications", "Profile"],
  INVENTORY_MANAGER: ["Inventory manager workspace", "Inventory", "Vendors", "Purchase orders", "Notifications", "Profile"],
  MECHANIC: ["Mechanic workspace", "Notifications", "Profile"],
  TECHNICIAN: ["Technician workspace", "Notifications", "Profile"],
  DRIVER: ["Driver portal", "Notifications", "Profile"],
  ACCOUNTANT: ["Accountant ledger", "Notifications", "Profile"],
};

export const dedicatedWorkspaceByRole: Record<string, string> = {
  SUPERADMIN: "Command center",
  FLEET_MANAGER: "Fleet manager workspace",
  INVENTORY_MANAGER: "Inventory manager workspace",
  MECHANIC: "Mechanic workspace",
  TECHNICIAN: "Technician workspace",
  DRIVER: "Driver portal",
  ACCOUNTANT: "Accountant ledger",
};

export function getAllowedWorkspace(role: string, requestedSection: string): string {
  const allowed = roleNavAccess[role] ?? roleNavAccess.SUPERADMIN;
  return allowed.includes(requestedSection) ? requestedSection : dedicatedWorkspaceByRole[role] ?? "Command center";
}

export function canAccessWorkspace(role: string, section: string): boolean {
  return (roleNavAccess[role] ?? []).includes(section);
}
