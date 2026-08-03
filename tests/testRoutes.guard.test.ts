/**
 * The /api/test-* routes include a full authentication bypass (test-auth
 * signs the caller in as any email). The guard must be deny-by-default:
 * off unless a deployment explicitly opts in, independent of NODE_ENV.
 */
import { describe, it, expect, afterEach } from "@jest/globals";
import { assertTestRoutesEnabled } from "@/server/testRoutes";

const original = process.env.ENABLE_E2E_AUTH;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.ENABLE_E2E_AUTH = original;
  (process.env as Record<string, unknown>).NODE_ENV = originalNodeEnv;
});

describe("assertTestRoutesEnabled", () => {
  it("allows the route when explicitly opted in", () => {
    process.env.ENABLE_E2E_AUTH = "true";
    expect(assertTestRoutesEnabled()).toBeNull();
  });

  it("blocks when the flag is unset", () => {
    delete process.env.ENABLE_E2E_AUTH;
    expect(assertTestRoutesEnabled()?.status).toBe(404);
  });

  it("blocks when the flag is any value other than 'true'", () => {
    process.env.ENABLE_E2E_AUTH = "1";
    expect(assertTestRoutesEnabled()?.status).toBe(404);
  });

  // The regression this guard replaces: the old check only refused when
  // NODE_ENV === "production", leaving staging/demo instances wide open.
  it("blocks in a non-production environment when not opted in", () => {
    (process.env as Record<string, unknown>).NODE_ENV = "development";
    delete process.env.ENABLE_E2E_AUTH;
    expect(assertTestRoutesEnabled()?.status).toBe(404);
  });
});
