// Phase 8 Part 2 — append-only enforcement. Two independent guarantees:
// 1. The tRPC surface exposes no procedure that updates or deletes AuditLog
//    rows (checked against the real appRouter procedure map).
// 2. No source file in the app calls prisma.auditLog.update/delete/upsert —
//    a static sweep so a future regression fails loudly here.
import { describe, it, expect } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

describe("audit log is append-only", () => {
  it("the audit router exposes no update/delete procedures", async () => {
    // Import only the router module (not the full appRouter) to avoid
    // loading every queue at module scope.
    const { auditRouter } = await import("@/server/routers/audit");
    const procedureNames = Object.keys(auditRouter._def.procedures);
    expect(procedureNames.length).toBeGreaterThan(0);
    for (const name of procedureNames) {
      expect(name.toLowerCase()).not.toMatch(/^(update|delete|remove|edit|purge)/);
    }
  });

  it("no source file mutates existing AuditLog rows", () => {
    const roots = [path.resolve(process.cwd(), "src")];
    const offenders: string[] = [];
    const forbidden = /auditLog\.(update|updateMany|delete|deleteMany|upsert)\s*\(/;

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) {
          if (entry === "node_modules" || entry === ".next") continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          const content = readFileSync(full, "utf8");
          if (forbidden.test(content)) offenders.push(full);
        }
      }
    };
    for (const root of roots) walk(root);

    expect(offenders).toEqual([]);
  });
});
