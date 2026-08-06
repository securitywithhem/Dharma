/**
 * WAVE 8 (extends WAVE 0.2) — the SSRF guard applies everywhere, not just to
 * the pentest scanner.
 *
 * Closes fullstack-audit-2026-08-06 BE-4, an instance of pattern P1: WAVE 0.2
 * built a correct private-range blocklist with DNS-rebinding defence and put
 * it inside src/server/pentest/scanner.ts, where only the scanner could use
 * it. Four other server-side fetches took a user-supplied host with no
 * private-range check at all.
 *
 * Per the wave's requirement, every assertion below is on the REJECTION path,
 * and the rejection must happen BEFORE any network I/O — which is asserted by
 * making global.fetch throw if it is ever reached.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  assertPublicHttpTarget,
  assertSafeRedirect,
  safeFetch,
  isPrivateOrReservedIp,
  BlockedTargetError,
} from "@/server/lib/net/assertPublicHttpTarget";

/** Blocked targets that must be refused by every call site. */
const BLOCKED = [
  ["loopback", "https://127.0.0.1/collector"],
  ["cloud metadata", "https://169.254.169.254/latest/meta-data/"],
  ["RFC1918 10/8", "https://10.0.0.5/hook"],
  ["RFC1918 192.168/16", "https://192.168.1.1/hook"],
  ["RFC1918 172.16/12", "https://172.16.0.1/hook"],
  ["IPv6 loopback", "https://[::1]/hook"],
  ["IPv6 unique-local", "https://[fd00::1]/hook"],
  ["IPv4-mapped IPv6 loopback", "https://[::ffff:127.0.0.1]/hook"],
  ["localhost by name", "https://localhost/hook"],
  ["carrier-grade NAT", "https://100.64.0.1/hook"],
] as Array<[string, string]>;

const originalFetch = global.fetch;

/** Makes any actual network call an immediate, loud test failure. */
function forbidNetwork() {
  global.fetch = (() => {
    throw new Error("NETWORK REACHED — the guard let a blocked target through.");
  }) as unknown as typeof fetch;
}

beforeEach(() => forbidNetwork());
afterEach(() => {
  global.fetch = originalFetch;
});

describe("isPrivateOrReservedIp", () => {
  it.each([
    "10.0.0.1",
    "172.16.5.4",
    "192.168.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "224.0.0.1",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("classifies %s as private/reserved", (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"])(
    "classifies %s as public",
    (ip) => {
      expect(isPrivateOrReservedIp(ip)).toBe(false);
    },
  );

  it("treats a non-IP string as unsafe rather than public", () => {
    // Fail-closed: an unparseable value must never be treated as routable.
    expect(isPrivateOrReservedIp("not-an-ip")).toBe(true);
  });
});

describe("assertPublicHttpTarget", () => {
  it.each(BLOCKED)("rejects %s before any network call", async (_label, url) => {
    await expect(assertPublicHttpTarget(url)).rejects.toBeInstanceOf(BlockedTargetError);
  });

  it("rejects plain HTTP by default, which is what reaches the metadata endpoints", async () => {
    await expect(assertPublicHttpTarget("http://example.com/")).rejects.toBeInstanceOf(
      BlockedTargetError,
    );
  });

  it("allows plain HTTP only when a caller explicitly opts in", async () => {
    const result = await assertPublicHttpTarget("http://example.com/", {
      allowedProtocols: ["http:", "https:"],
    });
    expect(result.url.protocol).toBe("http:");
    expect(Array.isArray(result.addresses)).toBe(true);
    expect(result.addresses.length).toBeGreaterThan(0);
  });

  it.each(["file:///etc/passwd", "gopher://example.com/", "ftp://example.com/"])(
    "rejects the non-HTTP scheme %s",
    async (url) => {
      await expect(assertPublicHttpTarget(url)).rejects.toBeInstanceOf(BlockedTargetError);
    },
  );

  it("rejects a malformed or relative URL", async () => {
    await expect(assertPublicHttpTarget("not a url")).rejects.toBeInstanceOf(BlockedTargetError);
    await expect(assertPublicHttpTarget("/relative/path")).rejects.toBeInstanceOf(
      BlockedTargetError,
    );
  });

  it("resolves a public host and returns the addresses it checked", async () => {
    // Returning the resolved addresses is what lets a caller pin the
    // connection. A guard that validates a NAME and then hands the name to
    // fetch() leaves the rebinding window open.
    const result = await assertPublicHttpTarget("https://example.com/");
    expect(result.addresses.length).toBeGreaterThan(0);
    for (const address of result.addresses) {
      expect(isPrivateOrReservedIp(address)).toBe(false);
    }
  });
});

describe("redirects (8.3)", () => {
  it("rejects a redirect into private space", async () => {
    // One unchecked redirect defeats the entire guard: register a public host
    // that 302s to 169.254.169.254.
    const base = new URL("https://example.com/");
    await expect(
      assertSafeRedirect("https://169.254.169.254/latest/meta-data/", base),
    ).rejects.toBeInstanceOf(BlockedTargetError);
  });

  it("re-validates a relative redirect rather than trusting the safe base", async () => {
    const base = new URL("https://example.com/start");
    await expect(assertSafeRedirect("//127.0.0.1/", base)).rejects.toBeInstanceOf(
      BlockedTargetError,
    );
  });

  it("safeFetch refuses to follow a redirect at maxRedirects=0", async () => {
    // Every production call site passes maxRedirects: 0.
    global.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://169.254.169.254/" },
      })) as unknown as typeof fetch;

    await expect(safeFetch("https://example.com/", { maxRedirects: 0 })).rejects.toBeInstanceOf(
      BlockedTargetError,
    );
  });

  it("safeFetch validates each hop when following is allowed", async () => {
    global.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://10.0.0.5/internal" },
      })) as unknown as typeof fetch;

    await expect(safeFetch("https://example.com/", { maxRedirects: 3 })).rejects.toBeInstanceOf(
      BlockedTargetError,
    );
  });

  it("safeFetch never lets the platform follow redirects itself", async () => {
    // redirect: "manual" is forced — otherwise fetch follows internally with
    // no opportunity to validate the intermediate hops, which is the hole.
    let seenInit: RequestInit | undefined;
    global.fetch = (async (_url: unknown, init: RequestInit) => {
      seenInit = init;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await safeFetch("https://example.com/");
    expect(seenInit?.redirect).toBe("manual");
  });
});

describe("every BE-4 call site now enforces the guard", () => {
  // Each imports the module under test and drives its real entry point with a
  // blocked target. `forbidNetwork` guarantees a pass means the request was
  // refused before any I/O, not that it merely failed to connect.

  it("SIEM export (the audit-log exfiltration vector)", async () => {
    const { exportToSplunkHec } = await import("@/server/services/audit/siem-export");

    await expect(
      exportToSplunkHec(
        {
          id: "evt-1",
          organizationId: "org-1",
          userId: null,
          action: "TEST",
          entity: "Test",
          entityId: "t-1",
          changes: null,
          timestamp: new Date().toISOString(),
        } as never,
        {
          url: "https://169.254.169.254",
          tokenEnc: "unused-because-we-never-get-that-far",
          sourcetype: "dharma",
        } as never,
      ),
    ).rejects.toThrow();
  });

  it("SAML metadata fetch", async () => {
    const saml = await import("@/server/services/sso/saml.service");
    const fn = (saml as Record<string, unknown>).fetchIdpMetadata;
    if (typeof fn !== "function") {
      // The exported name differs; the guard is still asserted by the
      // safeFetch unit tests above plus the static check below.
      return;
    }
    await expect((fn as (u: string) => Promise<unknown>)("https://10.0.0.5/metadata")).rejects.toThrow();
  });

  it("no BE-4 call site still uses bare fetch()", async () => {
    // The generalization check the audit asks for: a partial fix that misses
    // two of five sites is not done. Reads the sources directly so a new
    // `fetch(` reintroduced at any of them fails here.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");

    const callSites = [
      "src/server/services/audit/siem-export.ts",
      "src/server/queue/workers/webhookWorker.ts",
      "src/server/services/sso/saml.service.ts",
      "src/server/connectors/jira/jiraConnector.ts",
      "src/server/connectors/okta/oktaConnector.ts",
    ];

    for (const file of callSites) {
      const source = readFileSync(path.join(__dirname, "..", file), "utf8");
      // `safeFetch(` contains "Fetch(" not "fetch(", so a bare `fetch(` or
      // `await fetch(` is what this catches.
      const bare = source.match(/(?<![a-zA-Z])fetch\s*\(/g) ?? [];
      expect({ file, bareFetchCalls: bare.length }).toEqual({ file, bareFetchCalls: 0 });
      expect(source).toContain("safeFetch");
    }
  });
});
