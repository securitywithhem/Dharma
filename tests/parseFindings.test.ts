import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "@jest/globals";
import { Severity } from "@prisma/client";
import { parseNucleiJsonl } from "@/server/pentest/scanner";
import { parseNucleiFindings } from "@/server/pentest/parseFindings";

const FIXTURE_RAW = readFileSync(
  path.join(__dirname, "fixtures/nuclei-sample-output.jsonl"),
  "utf-8",
);

describe("parseFindings — parseNucleiFindings", () => {
  it("maps all 4 fixture findings to Vulnerability create inputs", () => {
    const findings = parseNucleiJsonl(FIXTURE_RAW);
    const inputs = parseNucleiFindings(findings, "pt_1", "org_1");

    expect(inputs).toHaveLength(4);
    expect(inputs.every((i) => i.penTestId === "pt_1" && i.organizationId === "org_1")).toBe(true);
  });

  it("derives severity + score from a CVSS vector when the template provides one", () => {
    const findings = parseNucleiJsonl(FIXTURE_RAW);
    const inputs = parseNucleiFindings(findings, "pt_1", "org_1");

    const rce = inputs.find((i) => i.title.includes("Remote Code Execution"))!;
    expect(rce.severity).toBe(Severity.CRITICAL);
    expect(rce.cvssScore).toBeCloseTo(9.8, 1);
    expect(rce.cvssVector).toBe("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H");
    expect(rce.remediation).toMatch(/Upgrade the affected component/);
  });

  it("falls back to nuclei's own severity and leaves cvssScore null when no CVSS metrics are present", () => {
    const findings = parseNucleiJsonl(FIXTURE_RAW);
    const inputs = parseNucleiFindings(findings, "pt_1", "org_1");

    const tls = inputs.find((i) => i.title.includes("Deprecated TLS"))!;
    expect(tls.severity).toBe(Severity.MEDIUM);
    expect(tls.cvssScore).toBeNull();
    expect(tls.cvssVector).toBeNull();

    const headers = inputs.find((i) => i.title.includes("Missing HTTP Security Headers"))!;
    expect(headers.severity).toBe(Severity.NONE);
    expect(headers.cvssScore).toBeNull();
  });

  it("maps nuclei's low/info severities correctly without CVSS metrics", () => {
    const findings = parseNucleiJsonl(FIXTURE_RAW);
    const inputs = parseNucleiFindings(findings, "pt_1", "org_1");

    const panel = inputs.find((i) => i.title.includes("Exposed Admin Panel"))!;
    expect(panel.severity).toBe(Severity.LOW);
    expect(panel.remediation).toBeNull();
  });

  it("returns an empty array for no findings", () => {
    expect(parseNucleiFindings([], "pt_1", "org_1")).toEqual([]);
  });
});
