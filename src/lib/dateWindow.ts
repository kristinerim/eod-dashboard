import { dateInPHT } from "@/lib/aggregate";

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_WINDOW_DAYS = 7;
export const WINDOW_STEP_DAYS = 7;
const MAX_WINDOW_DAYS = 3650;

// The "?days=" a list page was opened with, kept to a sane range.
export function windowDays(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_WINDOW_DAYS;
  return Math.min(n, MAX_WINDOW_DAYS);
}

// The instant the oldest day in the window begins, in Philippine Time (the
// team's working day), so the window always starts on a whole day.
export function windowStartISO(days: number): string {
  const today = dateInPHT(new Date().toISOString());
  const startOfToday = new Date(`${today}T00:00:00+08:00`).getTime();
  return new Date(startOfToday - (days - 1) * DAY_MS).toISOString();
}
