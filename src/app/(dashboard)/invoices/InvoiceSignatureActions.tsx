"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendInvoiceForSignature } from "./invoice-actions";
import { SignatureStatusBadge, type Invoice } from "./InvoicesTable";

function formatDateTime(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Manila" });
}

export default function InvoiceSignatureActions({ invoice }: { invoice: Invoice }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Kept relative so server and client render the same markup — the origin
  // is only needed at copy time, and window.location isn't available on the
  // server anyway.
  const signPath = `/sign/${invoice.signature_token}`;

  function handleSend() {
    setError(null);
    startTransition(async () => {
      const result = await sendInvoiceForSignature(invoice.id);
      if ("error" in result) return setError(result.error);
      router.refresh();
    });
  }

  async function handleCopy() {
    const fullUrl = `${window.location.origin}${signPath}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy automatically — copy the link manually.");
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-black/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Signature:</span>
        <SignatureStatusBadge status={invoice.signature_status} />
        {invoice.signature_status === "Not Sent" && (
          <button
            onClick={handleSend}
            disabled={isPending}
            type="button"
            className="rounded bg-black px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Send for signature
          </button>
        )}
        {invoice.signature_status !== "Signed" && (
          <>
            <input
              readOnly
              value={signPath}
              onFocus={(e) => e.target.select()}
              className="min-w-[200px] flex-1 rounded border border-black/20 px-2 py-1 text-xs"
            />
            <button
              onClick={handleCopy}
              type="button"
              className="rounded border border-black/20 px-3 py-1 text-xs"
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
          </>
        )}
      </div>

      {invoice.signature_status === "Sent" && (
        <p className="text-xs text-black/50">
          Sent for signature {formatDateTime(invoice.signature_sent_at)}. The customer does not need an account to
          open or sign it.
        </p>
      )}

      {invoice.signature_status === "Signed" && (
        <p className="text-sm">
          Signed by: <span className="font-medium">{invoice.signed_name}</span>
          <br />
          Date/Time: {formatDateTime(invoice.signed_at)}
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
