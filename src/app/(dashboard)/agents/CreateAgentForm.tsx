"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TEAM_MEMBERS, ROLE_LABELS } from "@/lib/constants";
import { ALL_ROLES } from "@/lib/roles";
import { createUser } from "./actions";

export default function CreateAgentForm({ existingAgentNames = [] }: { existingAgentNames?: string[] }) {
  const nameSuggestions = Array.from(new Set([...TEAM_MEMBERS, ...existingAgentNames])).sort();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("agent");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; password: string } | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createUser(email, name, role);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setResult({ email, password: res.password });
      setEmail("");
      setName("");
      setRole("agent");
      router.refresh();
    });
  }

  if (result) {
    return (
      <div className="max-w-md space-y-3 rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="text-sm font-medium text-green-800">Account created.</p>
        <p className="text-sm text-green-800">
          Send these login details to the user directly (text, WhatsApp, etc.) — this password
          won&apos;t be shown again.
        </p>
        <div className="rounded border border-green-300 bg-white p-3 text-sm">
          <div>
            <span className="text-black/50">Email:</span> {result.email}
          </div>
          <div>
            <span className="text-black/50">Password:</span>{" "}
            <span className="font-mono">{result.password}</span>
          </div>
        </div>
        <button
          onClick={() => setResult(null)}
          type="button"
          className="text-sm underline text-green-800"
        >
          Add another user
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md space-y-3">
      <div className="space-y-1">
        <label htmlFor="user-email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="user-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-black/20 px-3 py-1.5 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="user-role" className="text-sm font-medium">
          Role
        </label>
        <select
          id="user-role"
          required
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full rounded border border-black/20 px-3 py-1.5 text-sm"
        >
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="user-name" className="text-sm font-medium">
          Name
        </label>
        <input
          id="user-name"
          list={role === "agent" ? "agent-name-suggestions" : undefined}
          required={role === "agent"}
          placeholder={role === "agent" ? "Type a name, or pick an existing one" : "Full name"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-black/20 px-3 py-1.5 text-sm"
        />
        {role === "agent" && (
          <>
            <datalist id="agent-name-suggestions">
              {nameSuggestions.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <p className="text-xs text-black/50">
              New hire? Just type their name — it doesn&apos;t need to be on the list.
            </p>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Creating..." : "Create account"}
      </button>
    </form>
  );
}
