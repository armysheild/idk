const ROLE_LABELS: Record<string, string> = {
  MECHANIC: "Mechanic",
  TECHNICIAN: "Technician",
};

const SPECIALTY_LABELS: Record<string, string> = {
  lead: "Lead",
  suspension: "Suspension",
  body_work: "Body work",
  engine: "Engine",
  ac: "AC",
  wiring: "Wiring",
  tyre_puncture: "Tyre / puncture",
};

export const WORKER_SPECIALTY_OPTIONS: Record<string, { value: string; label: string }[]> = {
  mechanic: [
    { value: "lead", label: "Lead mechanic (all work)" },
    { value: "suspension", label: "Suspension mechanic" },
    { value: "body_work", label: "Body worker" },
    { value: "engine", label: "Engine mechanic" },
  ],
  technician: [
    { value: "lead", label: "Lead technician (all work)" },
    { value: "ac", label: "AC technician" },
    { value: "wiring", label: "Wiring technician" },
    { value: "tyre_puncture", label: "Tyre / puncture technician" },
  ],
};

export function workerLabel(member: { role?: string | null; specialty?: string | null }) {
  const role = ROLE_LABELS[String(member.role ?? "").toUpperCase()] ?? (member.role || "Member");
  const specialty = member.specialty ? SPECIALTY_LABELS[String(member.specialty).toLowerCase()] : null;
  return specialty && specialty !== "Lead" ? `${specialty} ${role}` : role;
}
