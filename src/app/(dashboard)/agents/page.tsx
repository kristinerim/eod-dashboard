import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/profile";
import CreateAgentForm from "./CreateAgentForm";

export default async function AgentsPage() {
  const profile = await getCurrentProfile();

  if (profile?.role !== "manager") {
    return <p className="text-sm text-black/70">Only managers can manage agent accounts.</p>;
  }

  const supabase = await createClient();
  const { data: agents } = await supabase
    .from("profiles")
    .select("id, agent_name, email, created_at")
    .eq("role", "agent")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">Agents</h1>
        <p className="text-sm text-black/60">
          Create a login for a field agent. They can add/edit jobs and clock in/out, but can&apos;t
          delete jobs or create other accounts.
        </p>
      </div>

      <CreateAgentForm />

      <div>
        <h2 className="mb-2 text-sm font-semibold">Existing agents ({agents?.length ?? 0})</h2>
        <div className="overflow-hidden rounded-lg border border-black/10">
          <table className="w-full text-sm">
            <thead className="bg-black/5 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
              </tr>
            </thead>
            <tbody>
              {(agents ?? []).map((a) => (
                <tr key={a.id} className="border-t border-black/10">
                  <td className="px-4 py-2">{a.agent_name ?? "-"}</td>
                  <td className="px-4 py-2">{a.email ?? "-"}</td>
                </tr>
              ))}
              {(agents ?? []).length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-2 text-black/50">
                    No agents yet.
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
