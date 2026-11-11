"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RosterEntry } from "@/lib/profile";
import { addTeamMember, removeTeamMember, setTeamMemberActive, updateTeamMember } from "./team-actions";

const inputCls = "w-full rounded border border-black/20 px-2 py-1.5 text-sm";

type Filter = "all" | "agents" | "dispatchers" | "inactive";

export default function TeamManager({ roster }: { roster: RosterEntry[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Add form
  const [name, setName] = useState("");
  const [isAgent, setIsAgent] = useState(true);
  const [isDispatcher, setIsDispatcher] = useState(false);
  const [notes, setNotes] = useState("");

  // Edit form
  const [edit, setEdit] = useState({ name: "", isAgent: true, isDispatcher: false, notes: "" });

  const counts = useMemo(
    () => ({
      agents: roster.filter((r) => r.is_active && r.is_agent).length,
      dispatchers: roster.filter((r) => r.is_active && r.is_dispatcher).length,
      inactive: roster.filter((r) => !r.is_active).length,
    }),
    [roster]
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roster.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (filter === "agents") return r.is_active && r.is_agent;
      if (filter === "dispatchers") return r.is_active && r.is_dispatcher;
      if (filter === "inactive") return !r.is_active;
      return true;
    });
  }, [roster, filter, search]);

  function run(action: () => Promise<{ success: true } | { error: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    run(
      () => addTeamMember({ name, isAgent, isDispatcher, notes }),
      () => {
        setName("");
        setNotes("");
        setIsAgent(true);
        setIsDispatcher(false);
      }
    );
  }

  function startEdit(r: RosterEntry) {
    setError(null);
    setEditingId(r.id);
    setEdit({ name: r.name, isAgent: r.is_agent, isDispatcher: r.is_dispatcher, notes: r.notes ?? "" });
  }

  function handleRemove(r: RosterEntry) {
    if (!window.confirm(`Remove ${r.name} from the list?\n\nThis only works if they were never used on any job, lead or login.`)) {
      return;
    }
    run(() => removeTeamMember(r.id));
  }

  function handleToggle(r: RosterEntry) {
    if (r.is_active) {
      const ok = window.confirm(
        `Deactivate ${r.name}?\n\nThey will no longer appear in the Agent or Dispatcher dropdowns for new assignments. Their past jobs, leads and reports are not changed.`
      );
      if (!ok) return;
    }
    run(() => setTeamMemberActive(r.id, !r.is_active));
  }

  const tabs: { id: Filter; label: string }[] = [
    { id: "all", label: `All (${roster.length})` },
    { id: "agents", label: `Agents (${counts.agents})` },
    { id: "dispatchers", label: `Dispatchers (${counts.dispatchers})` },
    { id: "inactive", label: `Deactivated (${counts.inactive})` },
  ];

  return (
    <div className="space-y-6">
      <form onSubmit={handleAdd} className="space-y-3 rounded-lg border border-black/10 p-4">
        <h2 className="text-sm font-semibold">Add a person</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-black/60">Full name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-black/60">Notes (optional)</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. night shift, team lead"
              className={inputCls}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isAgent} onChange={(e) => setIsAgent(e.target.checked)} />
            Agent
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isDispatcher} onChange={(e) => setIsDispatcher(e.target.checked)} />
            Dispatcher
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {isPending ? "Saving..." : "Add"}
          </button>
        </div>
      </form>

      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  filter === t.id ? "border-black bg-black text-white" : "border-black/20 text-black/70 hover:bg-black/5"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="w-56 rounded border border-black/20 px-3 py-1.5 text-sm"
          />
        </div>

        <div className="overflow-hidden rounded-lg border border-black/10">
          <table className="w-full text-sm">
            <thead className="bg-black/5 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Notes</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-black/50">
                    No one matches.
                  </td>
                </tr>
              )}
              {shown.map((r) =>
                editingId === r.id ? (
                  <tr key={r.id} className="border-t border-black/10 bg-black/[0.03]">
                    <td className="px-4 py-2">
                      <input
                        value={edit.name}
                        onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                        aria-label="Name"
                        className={inputCls}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <label className="mr-3 inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={edit.isAgent}
                          onChange={(e) => setEdit({ ...edit, isAgent: e.target.checked })}
                        />
                        Agent
                      </label>
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={edit.isDispatcher}
                          onChange={(e) => setEdit({ ...edit, isDispatcher: e.target.checked })}
                        />
                        Dispatcher
                      </label>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={edit.notes}
                        onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                        aria-label="Notes"
                        className={inputCls}
                      />
                    </td>
                    <td className="px-4 py-2 text-xs text-black/50" colSpan={2}>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => run(() => updateTeamMember(r.id, edit), () => setEditingId(null))}
                          className="rounded bg-black px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded border border-black/20 px-3 py-1 text-xs"
                        >
                          Cancel
                        </button>
                        {edit.name.trim() !== r.name && (
                          <span>Past jobs and leads keep the old name &ldquo;{r.name}&rdquo;.</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className={`border-t border-black/10 ${r.is_active ? "" : "bg-black/[0.03] text-black/50"}`}>
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-4 py-2">
                      <span className="flex flex-wrap gap-1">
                        {r.is_agent && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">Agent</span>}
                        {r.is_dispatcher && (
                          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-800">Dispatcher</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-black/60">{r.notes ?? ""}</td>
                    <td className="px-4 py-2">
                      {r.is_active ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Active</span>
                      ) : (
                        <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs text-black/60">
                          Deactivated
                          {r.deactivated_at ? ` ${new Date(r.deactivated_at).toLocaleDateString("en-US")}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-3 text-xs">
                        <button type="button" onClick={() => startEdit(r)} className="underline underline-offset-2">
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleToggle(r)}
                          className="underline underline-offset-2"
                        >
                          {r.is_active ? "Deactivate" : "Reactivate"}
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleRemove(r)}
                          className="text-red-600 underline underline-offset-2"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-black/50">
          Deactivate is the normal way to retire someone. Remove only works for an entry that was never used on any job,
          lead or login (for example a typo).
        </p>
      </div>
    </div>
  );
}
