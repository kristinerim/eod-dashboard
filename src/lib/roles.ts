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

/** The names shown for each role in the top-bar profile menu. */
export const ROLE_MENU_LABELS: Record<string, string> = {
  operations_manager: "Owner",
  admin_coordinator: "Admin",
  team_leader: "Team Lead",
  agent: "Agent / Dispatcher",
};
