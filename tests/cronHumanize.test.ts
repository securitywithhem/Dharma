import { humanizeCron } from "@/lib/cronHumanize";
import { reportCronPresets } from "@/server/lib/cronMatch";

describe("humanizeCron", () => {
  it("describes every preset the report scheduler can actually produce", () => {
    expect(humanizeCron(reportCronPresets.daily)).toBe("Daily at 08:00");
    expect(humanizeCron(reportCronPresets.weekly)).toBe("Weekly on Monday at 08:00");
    expect(humanizeCron(reportCronPresets.monthly)).toBe("Monthly on the 1st at 08:00");
  });

  it("generalises the time of day within each supported shape", () => {
    expect(humanizeCron("30 17 * * *")).toBe("Daily at 17:30");
    expect(humanizeCron("0 9 * * 5")).toBe("Weekly on Friday at 09:00");
    expect(humanizeCron("15 6 22 * *")).toBe("Monthly on the 22nd at 06:15");
  });

  it("uses correct ordinals", () => {
    expect(humanizeCron("0 8 2 * *")).toContain("2nd");
    expect(humanizeCron("0 8 3 * *")).toContain("3rd");
    expect(humanizeCron("0 8 11 * *")).toContain("11th");
    expect(humanizeCron("0 8 21 * *")).toContain("21st");
  });

  it("returns the raw expression rather than describing it wrongly", () => {
    // Ranges, steps, lists and month constraints are outside what the UI can
    // create; showing the raw cron is correct, inventing a sentence is not.
    for (const cron of ["0 8 * * 1-5", "*/15 * * * *", "0 8 1 1 *", "0 8 1,15 * *", "not a cron"]) {
      expect(humanizeCron(cron)).toBe(cron);
    }
  });

  it("rejects out-of-range time fields", () => {
    expect(humanizeCron("99 8 * * *")).toBe("99 8 * * *");
    expect(humanizeCron("0 25 * * *")).toBe("0 25 * * *");
  });
});
