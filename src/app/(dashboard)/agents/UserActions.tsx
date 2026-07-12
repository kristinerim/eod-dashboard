"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS } from "@/lib/constants";
import { ALL_ROLES } from "@/lib/roles";
import { updateUserRole, deactivateUser, reactivateUser, deleteUserAccount } from "./actions";

export default function UserActions({
  userId,
  role,
  isBanned,
  isSelf,
}: {
  userId: string;
  role: string;
  isBanned: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRoleChange(newRole: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateUserRole(userId, newRole);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleToggleActive() {
    setError(null);
    startTransition(async () => {
      const result = isBanned ? await reactivateUser(userId) : await deactivateUser(userId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm("Delete this account? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteUserAccount(userId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          defaultValue={role}
          disabled={isSelf || isPending}
          onChange={(e) => handleRoleChange(e.target.value)}
          className="rounded border border-black/20 px-2 py-1 text-xs disabled:opacity-50"
        >
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleToggleActive}
          disabled={isSelf || isPending}
          className="rounded border border-black/20 px-2 py-1 text-xs disabled:opacity-50"
        >
          {isBanned ? "Reactivate" : "Deactivate"}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isSelf || isPending}
          className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
