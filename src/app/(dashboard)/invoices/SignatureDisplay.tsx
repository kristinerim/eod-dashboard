function formatSignedDate(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { timeZone: "Asia/Manila" });
  const time = d.toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
  return { date, time };
}

export default function SignatureDisplay({
  signedAt,
  signedName,
  signatureImage,
}: {
  signedAt: string | null;
  signedName: string | null;
  signatureImage: string | null;
}) {
  const { date, time } = formatSignedDate(signedAt);

  return (
    <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
      <div>
        <div className="text-black/50">Customer Signature</div>
        <div className="mt-1 flex h-14 items-end border-b border-black/30">
          {signatureImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={signatureImage} alt="Customer signature" className="max-h-14" />
          )}
        </div>
      </div>
      <div>
        <div className="text-black/50">Printed Name</div>
        <div className="mt-1 flex h-14 items-end border-b border-black/30 pb-1 text-sm">{signedName ?? ""}</div>
      </div>
      <div>
        <div className="text-black/50">Date Signed</div>
        <div className="mt-1 border-b border-black/30 pb-1 text-sm">{date}</div>
      </div>
      <div>
        <div className="text-black/50">Time Signed</div>
        <div className="mt-1 border-b border-black/30 pb-1 text-sm">{time}</div>
      </div>
    </div>
  );
}
