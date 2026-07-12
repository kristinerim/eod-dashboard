export type Role = "operations_manager" | "admin_coordinator" | "team_leader" | "agent";

export const ALL_ROLES: Role[] = ["operations_manager", "admin_coordinator", "team_leader", "agent"];

/** Operations Manager or Admin Coordinator: full access, including user management. */
export function isFullAdmin(role: Role | string | null | undefined): boolean {
  return role === "operations_manager" || role === "admin_coordinator";
}

/** Full admins plus Team Leader: job CRUD on any job, view-all dashboards/hours. */
export function isSupervisor(role: Role | string | null | undefined): boolean {
  return isFullAdmin(role) || role === "team_leader";
}
