// Phase 9 Part 2 — minimal cron matcher for the schedule-dispatch worker.
//
// The report scheduler UI only offers daily/weekly/monthly PRESETS that map
// to fixed 5-field crons (see reportCronPresets), so a full cron engine (and
// the cron-parser dependency the repo has deliberately avoided) is overkill.
// This matches the hour / day-of-month / month / day-of-week fields against a
// given time, supporting `*`, plain integers, and comma lists — enough for
// every preset. The dispatch job runs hourly at minute 0, so the minute field
// is not evaluated. DESIGN-GAP: arbitrary cron expressions (ranges, steps)
// are NOT supported; only the presets are.
export const reportCronPresets = {
  daily: "0 8 * * *", // 08:00 every day
  weekly: "0 8 * * 1", // 08:00 every Monday
  monthly: "0 8 1 * *", // 08:00 on the 1st
} as const;

export type ReportCronPreset = keyof typeof reportCronPresets;

function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  return field
    .split(",")
    .map((part) => Number(part.trim()))
    .some((n) => Number.isFinite(n) && n === value);
}

/**
 * Returns true when `cron` (5-field: min hour dom month dow) is due at `now`.
 * The dispatch runs once per hour, so we compare hour, day-of-month, month,
 * and day-of-week; the minute field is ignored.
 */
export function cronMatchesNow(cron: string, now: Date = new Date()): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [, hour, dom, month, dow] = parts;

  return (
    fieldMatches(hour, now.getHours()) &&
    fieldMatches(dom, now.getDate()) &&
    fieldMatches(month, now.getMonth() + 1) &&
    fieldMatches(dow, now.getDay())
  );
}
