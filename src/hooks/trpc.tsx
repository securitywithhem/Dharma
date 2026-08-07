"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, loggerLink } from "@trpc/client";
import superjson from "superjson";
import { api, getBaseUrl } from "@/lib/trpc";

/**
 * GH #21 — how long a single tRPC HTTP call may hang before it becomes an error.
 *
 * Generous on purpose: report generation and AI advisor turns are legitimately
 * slow. Anything genuinely long-running belongs on BullMQ per this codebase's
 * convention, so a request still open after 30s is a hang, not a slow success.
 */
const REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(
  url: RequestInfo | URL,
  options?: RequestInit,
): Promise<Response> {
  // Chained rather than replacing the caller's signal: tRPC passes its own for
  // query cancellation/unmount, and dropping it would leak requests from pages
  // the user has already navigated away from.
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options?.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  return fetch(url, { ...options, signal });
}

/**
 * GH #21 — retry transport failures, never authorization answers.
 *
 * React Query's default is 3 retries for ANY error, which meant a FORBIDDEN
 * from `permissionProcedure` — a definitive answer that will be identical every
 * time — was re-asked four times over roughly seven seconds while the user
 * watched a spinner, then finally surfaced. Four times the load for a
 * guaranteed-identical result, and a seven-second lie about the page's state.
 *
 * 408 and 429 are excluded from the no-retry set because they genuinely do
 * change on a second attempt.
 */
function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = (error as { data?: { httpStatus?: number } } | null)?.data
    ?.httpStatus;

  if (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  ) {
    return false;
  }

  return failureCount < 2;
}

export function TRPCReactProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // GH #21 — why a page "never renders".
            //
            // The SSO settings page was reported stuck on its loading skeleton.
            // The page was missing an error branch, which was a real defect and
            // is fixed there — but adding one is not sufficient, because these
            // two defaults are what kept `isLoading` true long enough for the
            // page to read as hung in the first place. Both are fixed here, at
            // the provider, because they affect EVERY query in the app: any
            // other page with a failing or slow query had the same symptom
            // waiting to be reported.
            retry: shouldRetryQuery,
            retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 5_000),
          },
          mutations: {
            // Mutations are never retried automatically: this app's mutations
            // create audit-log entries, scan jobs and billing side effects, and
            // a "failed" request that actually succeeded server-side would be
            // silently duplicated.
            retry: false,
          },
        }
      }),
  );

  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        loggerLink({
          enabled: () => process.env.NODE_ENV === "development"
        }),
        httpBatchLink({
          transformer: superjson,
          url: `${getBaseUrl()}/api/trpc`,
          // GH #21 — the genuinely indefinite half of the bug. `fetch` has no
          // default timeout, so a request that hangs server-side (a blocking
          // call in the SSO vault/KMS path was the suspected cause) never
          // settles: the query stays `isLoading` forever and NO error branch,
          // however well written, can ever run. A page cannot report a failure
          // it is never told about. This converts a hang into an error the UI
          // can show.
          fetch: fetchWithTimeout,
        })
      ]
    }),
  );

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </api.Provider>
  );
}

export { api };
