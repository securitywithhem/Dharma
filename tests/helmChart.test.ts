/**
 * WAVE 6 — Helm chart contract.
 *
 * Closes fullstack-audit-2026-08-06 ARCH-1 (the chart deploys no pentest
 * worker, so scans queue forever with no consumer) and DEV-1 (no migration
 * runs on deploy, so new pods roll out against the old schema and pass their
 * health probe while broken).
 *
 * These render the chart with the real `helm` binary rather than asserting on
 * YAML text, because the defects being pinned are *template logic* — a
 * missing hook annotation and a missing guard — not file contents.
 *
 * If helm is unavailable the suite fails rather than skipping: a silently
 * skipped infrastructure test is how ARCH-1 survived in the first place. CI
 * installs helm in .github/workflows/infra-validate.yml.
 */
import { describe, it, expect, beforeAll } from "@jest/globals";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { parseAllDocuments } from "yaml";

const CHART = path.join(__dirname, "..", "helm", "dharma");

function template(args: string[] = []): string {
  return execFileSync("helm", ["template", "dharma", CHART, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Renders and returns stderr instead of throwing, for the failure cases. */
function templateExpectingFailure(args: string[]): string {
  try {
    template(args);
    throw new Error("Expected `helm template` to fail, but it succeeded.");
  } catch (error) {
    const err = error as { stderr?: Buffer | string; message: string };
    if (!err.stderr) throw error;
    return err.stderr.toString();
  }
}

function docs(rendered: string): Array<Record<string, any>> {
  return parseAllDocuments(rendered)
    .map((d) => d.toJS() as Record<string, any> | null)
    .filter((d): d is Record<string, any> => Boolean(d));
}

beforeAll(() => {
  // Fail with an actionable message rather than an opaque ENOENT.
  try {
    execFileSync("helm", ["version"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "helm is required for this suite. Install it (brew install helm) — " +
        "these tests pin infrastructure behaviour that cannot be asserted otherwise.",
    );
  }
});

describe("migration hook (DEV-1)", () => {
  it("renders a migration Job as a pre-install/pre-upgrade hook", () => {
    const job = docs(template()).find(
      (d) => d.kind === "Job" && d.metadata?.name === "dharma-migrate",
    );

    expect(job).toBeDefined();

    const annotations = job!.metadata.annotations;
    // Must run BEFORE the Deployments update — that is the whole fix. A Job
    // without this annotation is just a Job that races the rollout.
    expect(annotations["helm.sh/hook"]).toBe("pre-install,pre-upgrade");
    expect(Number(annotations["helm.sh/hook-weight"])).toBeLessThan(0);
  });

  it("runs the migration command that CI never called", () => {
    const job = docs(template()).find((d) => d.kind === "Job");
    expect(job!.spec.template.spec.containers[0].command).toEqual(["npm", "run", "db:deploy"]);
  });

  it("does not retry a failed migration", () => {
    // Retrying concurrently against shared schema state is worse than failing
    // fast, and a failed `prisma migrate deploy` is rarely transient.
    const job = docs(template()).find((d) => d.kind === "Job");
    expect(job!.spec.backoffLimit).toBe(0);
    expect(job!.spec.template.spec.restartPolicy).toBe("Never");
  });

  it("renders the hook for the two values files CI actually deploys with", () => {
    for (const file of ["values-staging.yaml", "values-production.yaml"]) {
      const job = docs(template(["-f", path.join(CHART, file)])).find(
        (d) => d.kind === "Job" && d.metadata?.name === "dharma-migrate",
      );
      expect(job).toBeDefined();
    }
  });
});

describe("pentest scan backend guard (ARCH-1)", () => {
  it("refuses to render when pentest is enabled with no backend chosen", () => {
    // Previously the chart installed happily and every scan queued forever
    // with no consumer, no error and no UI signal.
    const stderr = templateExpectingFailure(["--set", "pentest.enabled=true"]);
    expect(stderr).toMatch(/pentest\.scanBackend/);
  });

  it("refuses the not-yet-implemented kubernetes-job backend explicitly", () => {
    const stderr = templateExpectingFailure([
      "--set",
      "pentest.enabled=true",
      "--set",
      "pentest.scanBackend=kubernetes-job",
    ]);
    expect(stderr).toMatch(/not implemented/i);
  });

  it("renders with an external scan backend", () => {
    expect(() =>
      template(["--set", "pentest.enabled=true", "--set", "pentest.scanBackend=external"]),
    ).not.toThrow();
  });

  it("never mounts the host Docker socket into a pod", () => {
    // The shortcut this chart deliberately refuses: on a shared cluster it
    // grants node-level root, which is a downgrade from Compose's single-host
    // model rather than an equivalent to it.
    const rendered = template([
      "--set",
      "pentest.enabled=true",
      "--set",
      "pentest.scanBackend=external",
    ]);
    expect(rendered).not.toMatch(/docker\.sock/);
  });

  it("renders by default, with pentest disabled", () => {
    expect(() => template()).not.toThrow();
  });
});

describe("deployment naming (DEV-2)", () => {
  it("names its Deployments dharma-app / dharma-worker", () => {
    // deploy.yml's verify step addressed `deployment/nextjs`, which NotFounds
    // after a successful rollout. Pinning the names here means a rename
    // breaks this test rather than the production deploy.
    const names = docs(template())
      .filter((d) => d.kind === "Deployment")
      .map((d) => d.metadata.name)
      .sort();

    expect(names).toEqual(["dharma-app", "dharma-worker"]);
  });

  it("labels pods app.kubernetes.io/name=dharma, which the NetworkPolicies match", () => {
    // k8s/namespace.yaml's default-deny allow-rules select on this label. A
    // mismatch does not error — it silently drops every app→data packet.
    const deployments = docs(template()).filter((d) => d.kind === "Deployment");
    for (const d of deployments) {
      expect(d.spec.template.metadata.labels["app.kubernetes.io/name"]).toBe("dharma");
    }
  });
});
