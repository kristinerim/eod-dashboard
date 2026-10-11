import Link from "next/link";
import { DEFAULT_WINDOW_DAYS, WINDOW_STEP_DAYS } from "@/lib/dateWindow";

// "Showing the last N days — X of Y" with links to look further back.
export default function WindowControls({
  basePath,
  days,
  shown,
  total,
  noun,
}: {
  basePath: string;
  days: number;
  shown: number;
  total: number;
  noun: string;
}) {
  const hasMore = shown < total;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-black/60">
      <span>
        Showing the last {days} days — {shown.toLocaleString("en-US")} of {total.toLocaleString("en-US")} {noun}.
      </span>
      {hasMore && (
        <>
          <Link href={`${basePath}?days=${days + WINDOW_STEP_DAYS}`} className="font-medium text-black underline underline-offset-2">
            Show {WINDOW_STEP_DAYS} more days
          </Link>
          <Link href={`${basePath}?days=3650`} className="underline underline-offset-2">
            Show all
          </Link>
        </>
      )}
      {days > DEFAULT_WINDOW_DAYS && (
        <Link href={basePath} className="underline underline-offset-2">
          Back to the last {DEFAULT_WINDOW_DAYS} days
        </Link>
      )}
    </div>
  );
}
