"use client";

export default function PrintInvoiceButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white"
    >
      Print / Save as PDF
    </button>
  );
}
