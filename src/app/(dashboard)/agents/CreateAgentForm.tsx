"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TEAM_MEMBERS } from "@/lib/constants";
import { createAgent } from "./actions";

export default function CreateAgentForm({ existingAgentNames = [] }: { existingAgentNames?: string[] }) {
  const nameSuggestions = Array.from(new Set([...TEAM_MEMBERS, ...existingAgentNames])).sort();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [agentName, setAgentName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; password: string } | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createAgent(email, agentName);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setResult({ email, password: res.password });
      setEmail("");
      setAgentName("");
      router.refresh();
    });
  }

  if (result) {
    return (
      <div className="max-w-md space-y-3 rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="text-sm font-medium text-green-800">Account created.</p>
        <p className="text-sm text-green-800">
          Send these login details to the agent directly (text, WhatsApp, etc.) — this password
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
          Add another agent
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md space-y-3">
      <div className="space-y-1">
        <label htmlFor="agent-email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="agent-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-black/20 px-3 py-1.5 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="agent-name" className="text-sm font-medium">
          Agent name
        </label>
        <input
          id="agent-name"
          list="agent-name-suggestions"
          required
          placeholder="Type a name, or pick an existing one"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          className="w-full rounded border border-black/20 px-3 py-1.5 text-sm"
        />
        <datalist id="agent-name-suggestions">
          {nameSuggestions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <p className="text-xs text-black/50">New hire? Just type their name — it doesn&apos;t need to be on the list.</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Creating..." : "Create agent account"}
      </button>
    </form>
  );
}
