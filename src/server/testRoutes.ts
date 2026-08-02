import { NextResponse } from "next/server";

/**
 * Guard for the /api/test-* helper routes (test-auth, test-seed-pentest,
 * test-seed-regulatory-alert).
 *
 * These routes mint a session for an arbitrary email and insert fixture rows.
 * `test-auth` in particular is a complete authentication bypass: anyone who
 * can reach it signs in as any user in the org.
 *
 * The previous guard was allow-by-default — it refused only when
 * NODE_ENV === "production". Any other deployment (staging, a demo box, a
 * docker run left at NODE_ENV=development) exposed the bypass to the network.
 *
 * This is deny-by-default instead: the routes stay off unless a deployment
 * explicitly opts in with ENABLE_E2E_AUTH=true, regardless of NODE_ENV. Any
 * environment intended for demos or real users must simply not set it.
 */
export function assertTestRoutesEnabled(): NextResponse | null {
  if (process.env.ENABLE_E2E_AUTH === "true") return null;

  return new NextResponse(
    "Test-only route. Set ENABLE_E2E_AUTH=true to enable (never in an environment with real users).",
    { status: 404 },
  );
}
