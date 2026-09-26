"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { submitInvoiceSignature } from "./actions";

export default function SignaturePadForm({ token, defaultName }: { token: string; defaultName: string }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const hasDrawnRef = useRef(false);

  const [printedName, setPrintedName] = useState(defaultName);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function getCanvasPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = getCanvasPoint(e);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const point = getCanvasPoint(e);
    const last = lastPointRef.current;
    if (last) {
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    lastPointRef.current = point;
    if (!hasDrawnRef.current) {
      hasDrawnRef.current = true;
      setHasDrawn(true);
    }
  }

  function handlePointerUp() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawnRef.current = false;
    setHasDrawn(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!hasDrawn) {
      setError("Please draw your signature before submitting.");
      return;
    }
    if (!printedName.trim()) {
      setError("Enter your printed name.");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    setSubmitting(true);
    const formData = new FormData();
    formData.set("signature_image", canvas.toDataURL("image/png"));
    formData.set("signed_name", printedName.trim());

    const result = await submitInvoiceSignature(token, formData);
    if ("error" in result) {
      setSubmitting(false);
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3 rounded border border-black/10 bg-black/[0.02] p-4 print:hidden">
      <h3 className="text-sm font-semibold">Sign Invoice</h3>

      <div>
        <label className="mb-1 block text-xs font-medium text-black/60">Draw your signature</label>
        <canvas
          ref={canvasRef}
          width={600}
          height={150}
          className="w-full touch-none rounded border border-black/30 bg-white"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        <button type="button" onClick={handleClear} className="mt-1 text-xs underline">
          Clear
        </button>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-black/60">Printed Name</label>
        <input
          value={printedName}
          onChange={(e) => setPrintedName(e.target.value)}
          required
          className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Submit / Confirm Signature"}
      </button>
    </form>
  );
}
