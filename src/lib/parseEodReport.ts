import * as XLSX from "xlsx";
import { US_STATE_CODES, PLATFORMS } from "./constants";

const US_STATE_CODE_SET = new Set(US_STATE_CODES);

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[$,]/g, "").trim();
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function toText(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function norm(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

const TOTALS_LABELS: Record<string, string> = {
  "TOTAL PROFIT": "total_profit",
  "TOTAL CONVERTED JOBS": "total_converted_jobs",
  "TOTAL JOB AMOUNT": "total_job_amount",
  "TOTAL VENDOR PAYMENT": "total_vendor_payment",
  "TOTAL REFUNDED TO CLIENT": "total_refunded_to_client",
  "TOTAL COMPLETED JOBS": "total_completed_jobs",
  "TOTAL CANCELLED JOBS": "total_cancelled_jobs",
};

const JOB_HEADER_MAP: Record<string, string> = {
  AGENT: "agent",
  DISPATCHER: "dispatcher",
  "JOB NUMBER": "job_number",
  "JOB AMOUNT": "job_amount",
  "VENDOR'S FEE": "vendors_fee",
  "REFUNDED TO CLIENT": "refunded_to_client",
  PROFIT: "profit",
  "CUSTOMER CHARGED VIA": "customer_charged_via",
  "VENDOR PAID VIA": "vendor_paid_via",
  "VENDOR NAME": "vendor_name",
  "LAST 4 OF VPC": "last4_vpc",
  "JOB STATUS": "job_status",
  "DISPATCHED TIME": "dispatched_time",
  "VENDOR'S ETA": "vendor_eta",
  "REVIEWED BY": "reviewed_by",
  STATE: "state",
  "CUSTOMER'S PHONE NUMBER": "customer_phone",
  "CALL QUE": "call_que",
  "BREX CHECK": "brex_check",
  "SLASH CHECK": "slash_check",
  "WC (ENTERED BY JON)": "wc_entered_by_jon",
  "FINAL CHECKED BY ZUMI": "final_checked_by_zumi",
  NOTES: "notes",
};

const CURRENCY_FIELDS = new Set([
  "job_amount",
  "vendors_fee",
  "refunded_to_client",
  "profit",
]);

const PHONE_RE = /^\d{10,11}$/;

export interface ParsedPlatform {
  platform: string;
  rate: number | null;
  count: number | null;
  amount: number | null;
}

export interface ParsedJob {
  row_number: number | null;
  [field: string]: string | number | null;
}

export interface ParsedReport {
  reportDate: string;
  totals: Record<string, number | null>;
  platformBreakdown: ParsedPlatform[];
  jobs: ParsedJob[];
}

export function parseEodWorkbook(buffer: ArrayBuffer): ParsedReport[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];

  const blockStarts: number[] = [];
  grid.forEach((row, i) => {
    if (norm(row?.[0]) === "EOD REPORT") blockStarts.push(i);
  });

  if (blockStarts.length === 0) {
    throw new Error('Could not find an "EOD REPORT" block in this file.');
  }

  return blockStarts.map((start, idx) => {
    const end = idx + 1 < blockStarts.length ? blockStarts[idx + 1] : grid.length;
    const block = grid.slice(start, end);

    const totals: Record<string, number | null> = {};
    let reportDate: string | null = null;

    // All 7 totals labels live on one row together; find that row and map label -> column.
    let labelRowIdx = -1;
    const labelCols: Record<string, number> = {};
    for (let r = 0; r < Math.min(6, block.length); r++) {
      const row = block[r] ?? [];
      const idx = row.findIndex((v) => norm(v) === "TOTAL PROFIT");
      if (idx !== -1) {
        labelRowIdx = r;
        row.forEach((v, c) => {
          const label = norm(v);
          if (TOTALS_LABELS[label]) labelCols[label] = c;
        });
        break;
      }
    }

    if (labelRowIdx !== -1) {
      // The matching values row is whichever nearby row has numeric values in the
      // most of these columns at once (platform-breakdown rows partially overlap
      // the same columns, so "first numeric value" alone is not a safe signal).
      let bestRow = -1;
      let bestScore = -1;
      for (let r2 = labelRowIdx + 1; r2 < Math.min(labelRowIdx + 6, block.length); r2++) {
        const row = block[r2] ?? [];
        const score = Object.values(labelCols).filter(
          (c) => toNumber(row[c]) !== null
        ).length;
        if (score > bestScore) {
          bestScore = score;
          bestRow = r2;
        }
      }

      if (bestRow !== -1 && bestScore > 0) {
        const valuesRow = block[bestRow] ?? [];
        for (const [label, key] of Object.entries(TOTALS_LABELS)) {
          const col = labelCols[label];
          if (col !== undefined) totals[key] = toNumber(valuesRow[col]);
        }
        const dateRaw = valuesRow[0];
        if (dateRaw) {
          const d = new Date(String(dateRaw));
          if (!Number.isNaN(d.getTime())) {
            reportDate = d.toISOString().slice(0, 10);
          }
        }
      }
    }

    if (!reportDate) {
      throw new Error(
        `Could not determine the report date for the EOD block starting at sheet row ${start + 1}.`
      );
    }

    const platformBreakdown: ParsedPlatform[] = [];
    for (let r = 0; r < Math.min(6, block.length); r++) {
      const row = block[r] ?? [];
      for (let c = 0; c < row.length; c++) {
        const cellText = norm(row[c]);
        if (PLATFORMS.includes(cellText)) {
          platformBreakdown.push({
            platform: cellText,
            rate: toNumber(row[c + 1]),
            count: toNumber(row[c + 2]),
            amount: toNumber(row[c + 3]),
          });
        }
      }
    }

    let headerRowIdx = -1;
    const colMap: Record<number, string> = {};
    for (let r = 0; r < Math.min(8, block.length); r++) {
      const row = block[r] ?? [];
      if (row.some((v) => norm(v) === "AGENT")) {
        headerRowIdx = r;
        row.forEach((v, c) => {
          const label = norm(v);
          if (JOB_HEADER_MAP[label]) colMap[c] = JOB_HEADER_MAP[label];
        });
        break;
      }
    }

    if (headerRowIdx === -1) {
      throw new Error(
        `Could not find the job table header row for the EOD block starting at sheet row ${start + 1}.`
      );
    }

    const stateCol = Object.entries(colMap).find(([, f]) => f === "state")?.[0];
    const searchStart = stateCol !== undefined ? Number(stateCol) : null;

    const jobs: ParsedJob[] = [];
    for (let r = headerRowIdx + 1; r < block.length; r++) {
      const row = block[r] ?? [];
      const rowNumberCell = row[0];
      if (rowNumberCell === null || rowNumberCell === undefined) continue;

      const job: ParsedJob = { row_number: toNumber(rowNumberCell) };
      for (const [colIdx, field] of Object.entries(colMap)) {
        const raw = row[Number(colIdx)];
        job[field] = CURRENCY_FIELDS.has(field) ? toNumber(raw) : toText(raw);
      }

      // The source sheet sometimes has extra blank cells before this section,
      // shifting STATE/PHONE right by 1-2 columns on individual rows. State codes
      // and phone numbers have distinct enough shapes to locate directly instead
      // of trusting the header's fixed column position.
      if (searchStart !== null) {
        for (let c = searchStart; c < Math.min(searchStart + 4, row.length); c++) {
          const t = norm(row[c]);
          if (US_STATE_CODE_SET.has(t)) {
            job.state = t;
            break;
          }
        }
        for (let c = searchStart; c < Math.min(searchStart + 4, row.length); c++) {
          const t = norm(row[c]).replace(/\D/g, "");
          if (PHONE_RE.test(t)) {
            job.customer_phone = t;
            break;
          }
        }
      }

      // Skip empty placeholder rows the sheet pre-numbers but never fills in
      // (row number present, but no agent and no job number).
      if (job.agent === null && job.job_number === null) continue;

      jobs.push(job);
    }

    return { reportDate, totals, platformBreakdown, jobs };
  });
}
