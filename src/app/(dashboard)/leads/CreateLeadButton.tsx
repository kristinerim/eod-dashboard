"use client";

import { useState } from "react";
import LeadForm from "./LeadForm";

export default function CreateLeadButton({
  agentOptions,
  currentRole,
  currentAgentName,
}: {
  agentOptions?: string[];
  currentRole?: string;
  currentAgentName?: string | null;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <>
      <button
        onClick={() => setCreating(true)}
        type="button"
        className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white"
      >
        + Create lead
      </button>
      {creating && (
        <LeadForm
          onClose={() => setCreating(false)}
          agentOptions={agentOptions}
          currentRole={currentRole}
          currentAgentName={currentAgentName}
        />
      )}
    </>
  );
}
