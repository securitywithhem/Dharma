/**
 * WAVE 10.1 / 10.2 — the alerting config actually alerts.
 *
 * Closes fullstack-audit-2026-08-06 DEV-4 and DEV-8.
 *
 * DEV-4: monitoring/prometheus.yml has always set
 * `rule_files: ["rules/*.yml"]`, and monitoring/rules did not exist.
 * Prometheus tolerates a non-matching glob SILENTLY — it starts clean, logs
 * nothing, and loads zero rules. Alertmanager was commented out. So the config
 * looked like alerting and delivered none: Postgres down, Redis down, queue
 * backlog and probe_success == 0 alerted nobody.
 *
 * That silence is precisely why this test exists and why it asserts the
 * directory is NON-EMPTY. `promtool check rules` on an empty glob passes; only
 * an explicit "there is at least one rule, and it covers these conditions"
 * catches a regression to the original defect.
 *
 * DEV-8: auth_attempts_total was instrumented and never dashboarded.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const MONITORING = path.join(__dirname, "..", "monitoring");
const RULES_DIR = path.join(MONITORING, "rules");

type Rule = { alert?: string; expr?: string; for?: string; labels?: Record<string, string> };
type Group = { name: string; rules: Rule[] };

function loadRules(): { groups: Group[]; files: string[] } {
  const files = readdirSync(RULES_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  const groups = files.flatMap(
    (f) => (parse(readFileSync(path.join(RULES_DIR, f), "utf8")) as { groups: Group[] }).groups ?? [],
  );
  return { groups, files };
}

describe("the rules directory exists and is not empty (DEV-4)", () => {
  it("monitoring/rules exists", () => {
    // The whole finding: prometheus.yml pointed here and here was nothing.
    expect(existsSync(RULES_DIR)).toBe(true);
  });

  it("contains at least one rule file", () => {
    const { files } = loadRules();
    expect(files.length).toBeGreaterThan(0);
  });

  it("matches the glob prometheus.yml actually configures", () => {
    const prom = readFileSync(path.join(MONITORING, "prometheus.yml"), "utf8");
    const config = parse(prom) as { rule_files?: string[] };
    expect(config.rule_files).toContain("rules/*.yml");

    // A .yaml file here would be silently ignored by that glob — the same
    // class of silent miss as the missing directory.
    const { files } = loadRules();
    expect(files.every((f) => f.endsWith(".yml"))).toBe(true);
  });
});

describe("alerting is wired to a receiver (DEV-4)", () => {
  it("prometheus.yml points at Alertmanager", () => {
    const config = parse(readFileSync(path.join(MONITORING, "prometheus.yml"), "utf8")) as {
      alerting?: { alertmanagers?: Array<{ static_configs?: Array<{ targets: string[] }> }> };
    };
    const targets = config.alerting?.alertmanagers?.[0]?.static_configs?.[0]?.targets ?? [];
    expect(targets).toContain("alertmanager:9093");
  });

  it("alertmanager routes to the same webhook the app's alert.ts uses", () => {
    // One destination, not two half-built ones.
    const am = parse(readFileSync(path.join(MONITORING, "alertmanager.yml"), "utf8")) as {
      receivers: Array<{ name: string; webhook_configs?: Array<{ url_file?: string; url?: string }> }>;
    };
    const receiver = am.receivers.find((r) => r.webhook_configs?.length);
    expect(receiver).toBeDefined();

    const hook = receiver!.webhook_configs![0];
    // url_file, not a templated url: a config with an unsubstituted
    // placeholder cannot be validated by `amtool check-config` as committed,
    // and an alerting config no tool can check is how DEV-4 happened.
    expect(hook.url_file).toBeTruthy();
    expect(hook.url).toBeUndefined();
  });

  it("never commits a webhook URL", () => {
    const am = readFileSync(path.join(MONITORING, "alertmanager.yml"), "utf8");
    expect(am).not.toMatch(/https:\/\/hooks\.slack\.com/);
    expect(am).not.toMatch(/discord\.com\/api\/webhooks/);
  });
});

describe("the conditions the audit named are covered (DEV-4)", () => {
  const { groups } = loadRules();
  const rules = groups.flatMap((g) => g.rules).filter((r) => r.alert);
  const exprs = rules.map((r) => `${r.alert} ${r.expr}`).join("\n");

  it.each([
    ["Postgres down", /pg_up == 0/],
    ["Redis down", /redis_up == 0/],
    ["probe_success == 0", /probe_success == 0/],
    ["queue backlog / stall", /queue_jobs_processed_total/],
    ["dead-letter / failure rate", /status="failed"/],
  ])("alerts on %s", (_label, pattern) => {
    expect(exprs).toMatch(pattern);
  });

  it("every alert has a `for:` so a scrape blip is not an incident", () => {
    // A channel that cries wolf gets muted, which is worse than no channel.
    const missing = rules.filter((r) => !r.for).map((r) => r.alert);
    expect(missing).toEqual([]);
  });

  it("every alert carries a severity label the routing can match on", () => {
    const missing = rules.filter((r) => !r.labels?.severity).map((r) => r.alert);
    expect(missing).toEqual([]);
  });

  it("uses only severities alertmanager.yml routes or inhibits", () => {
    const used = new Set(rules.map((r) => r.labels!.severity));
    expect([...used].sort()).toEqual(["critical", "warning"]);
  });
});

describe("auth_attempts_total is dashboarded (DEV-8)", () => {
  const dashboard = JSON.parse(
    readFileSync(path.join(MONITORING, "grafana", "dashboards", "dharma-overview.json"), "utf8"),
  ) as { panels: Array<{ title?: string; type?: string; targets?: Array<{ expr?: string }> }> };

  const exprs = dashboard.panels
    .flatMap((p) => p.targets ?? [])
    .map((t) => t.expr ?? "")
    .join("\n");

  it("charts the metric that was instrumented and never shown", () => {
    // Failed-login rate is the one security metric a GRC buyer asks about.
    expect(exprs).toMatch(/auth_attempts_total/);
  });

  it("splits by status, so a rising total is interpretable", () => {
    expect(exprs).toMatch(/status/);
  });

  it("keeps the panels the dashboard already had", () => {
    const titles = dashboard.panels.map((p) => p.title);
    for (const existing of [
      "tRPC Response Time (p95)",
      "Jobs Processed/sec by Queue",
      "Ollama Service Health",
    ]) {
      expect(titles).toContain(existing);
    }
  });

  it("does not overlap the existing panels' grid positions", () => {
    // Appending a row at the wrong y silently stacks panels on top of each
    // other in Grafana rather than erroring.
    const seen = new Set<string>();
    for (const p of dashboard.panels as Array<{ gridPos?: { x: number; y: number } }>) {
      if (!p.gridPos) continue;
      const key = `${p.gridPos.x},${p.gridPos.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
