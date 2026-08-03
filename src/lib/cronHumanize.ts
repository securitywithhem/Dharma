/**
 * src/lib/cronHumanize.ts
 *
 * Render a cron expression as English for the Reports → Schedules table.
 *
 * Deliberately NOT a general cron-to-English library. Schedules in Dharma are
 * created from three fixed presets (`reportCronPresets` in
 * src/server/lib/cronMatch.ts), so covering the whole cron grammar would be
 * dead code with a dependency attached. This handles the presets exactly, plus
 * the small generalisation of an arbitrary time-of-day for each shape, and
 * falls back to the raw expression for anything it does not recognise — a
 * user seeing `0 8 * * 1` is no worse off than before, and never sees a wrong
 * description.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatTime(minute: string, hour: string): string | null {
  const m = Number(minute);
  const h = Number(hour);
  if (!Number.isInteger(m) || !Number.isInteger(h)) return null;
  if (m < 0 || m > 59 || h < 0 || h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * @returns a sentence like "Daily at 08:00", or the input unchanged when the
 * expression is outside the supported shapes.
 */
export function humanizeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const time = formatTime(minute, hour);
  if (!time) return cron;
  if (month !== "*") return cron;

  // Daily — every day of month, every weekday.
  if (dayOfMonth === "*" && dayOfWeek === "*") return `Daily at ${time}`;

  // Weekly — a single named weekday.
  if (dayOfMonth === "*" && /^[0-6]$/.test(dayOfWeek)) {
    return `Weekly on ${DAY_NAMES[Number(dayOfWeek)]} at ${time}`;
  }

  // Monthly — a single day of the month.
  if (dayOfWeek === "*" && /^([1-9]|[12][0-9]|3[01])$/.test(dayOfMonth)) {
    return `Monthly on the ${ordinal(Number(dayOfMonth))} at ${time}`;
  }

  return cron;
}
