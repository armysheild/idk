import { MechanicExecutionWorkspace } from "./MechanicExecutionWorkspace";

export function TechnicianExecutionWorkspace({
  organizationName,
}: {
  organizationName: string;
}) {
  return (
    <MechanicExecutionWorkspace
      organizationName={organizationName}
      role="TECHNICIAN"
    />
  );
}
