import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile, isFullAdmin } from "@/lib/profile";
import { ROLE_LABELS } from "@/lib/constants";
import CreateAgentForm from "./CreateAgentForm";
import UserActions from "./UserActions";

export default async function AgentsPage() {
  const profile = await getCurrentProfile();

  if (!isFullAdmin(profile?.role)) {
    return (
      <p className="text-sm text-black/70">
        Only Operations Managers and Admin Coordinators can manage users.
      </p>
    );
  }

  const supabase = await createClient();
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  const { data: users } = await supabase
    .from("profiles")
    .select("id, role, agent_name, email, created_at")
    .order("created_at", { ascending: false });

  const admin = createAdminClient();
  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 200 });
  const bannedById = new Map(
    (authData?.users ?? []).map((u) => [
      u.id,
      !!u.banned_until && new Date(u.banned_until) > new Date(),
    ])
  );

  const existingAgentNames = (users ?? [])
    .filter((u) => u.role === "agent")
    .map((u) => u.agent_name)
    .filter((n): n is string => !!n);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">Users</h1>
        <p className="text-sm text-black/60">
          Create logins and manage roles. Operations Managers and Admin Coordinators have full
          access; Team Leaders can manage jobs but not users; Agents can only manage their own
          jobs.
        </p>
      </div>

      <CreateAgentForm existingAgentNames={existingAgentNames} />

      <div>
        <h2 className="mb-2 text-sm font-semibold">Existing users ({users?.length ?? 0})</h2>
        <div className="overflow-hidden rounded-lg border border-black/10">
          <table className="w-full text-sm">
            <thead className="bg-black/5 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => {
                const isSelf = u.id === currentUser?.id;
                const isBanned = bannedById.get(u.id) ?? false;
                return (
                  <tr key={u.id} className="border-t border-black/10">
                    <td className="px-4 py-2">
                      {u.role === "agent" ? (
                        <Link href={`/agents/${u.id}`} className="underline">
                          {u.agent_name ?? "-"}
                        </Link>
                      ) : (
                        u.agent_name || <span className="text-black/40">{ROLE_LABELS[u.role]}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">{u.email ?? "-"}</td>
                    <td className="px-4 py-2">
                      {isBanned ? (
                        <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-black/50">
                          Deactivated
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <UserActions
                        userId={u.id}
                        role={u.role}
                        isBanned={isBanned}
                        isSelf={isSelf}
                      />
                    </td>
                  </tr>
                );
              })}
              {(users ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-2 text-black/50">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
