// WAVE 8 (extends WAVE 0.2) — shared SSRF guard for user-controlled outbound HTTP.
//
// WHY THIS MODULE EXISTS
// ---------------------
// fullstack-audit-2026-08-06 BE-4, an instance of pattern P1: "the security
// control exists, on one module". WAVE 0.2 built a correct private-range
// blocklist with DNS-rebinding defence — and put it in
// src/server/pentest/scanner.ts, where only the scanner could use it. Four
// other server-side fetches took a user-supplied host with no private-range
// check at all:
//
//   * services/audit/siem-export.ts — validated by z.string().url() only. This
//     is where the AUDIT LOG gets shipped, so an SSRF here is simultaneously an
//     exfiltration channel: point it at http://169.254.169.254/ and the request
//     hits cloud metadata; point it anywhere internal and the tamper-evident
//     log goes there instead.
//   * queue/workers/webhookWorker.ts — HTTPS is enforced at the router, which
//     blocks the plain-HTTP metadata endpoints, but https://10.0.0.5/ and
//     redirect-to-internal were both still reachable.
//   * services/sso/saml.service.ts — HTTPS enforced, no private-range block.
//   * jiraConnector.ts / oktaConnector.ts — base URL comes from user config.
//
// The IP classification below is lifted verbatim from scanner.ts (which now
// imports it) rather than reimplemented, so the two can never disagree.
//
// TWO THINGS THIS GUARD DOES THAT A NAIVE ONE DOES NOT
// ---------------------------------------------------
// 1. Resolves immediately before use and returns the resolved addresses, so
//    the caller can pin the connection to an address that was checked. A guard
//    that validates a hostname and then hands the hostname to fetch() leaves
//    the DNS-rebinding window wide open — the name can resolve differently on
//    the second lookup.
// 2. Rejects redirects to internal space. A single unchecked redirect defeats
//    the entire guard: an attacker registers a public host that 302s to
//    169.254.169.254. Callers must use `assertSafeRedirect` or disable
//    redirect-following outright (see `safeFetch`).
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export class BlockedTargetError extends Error {
  readonly code = "BLOCKED_TARGET" as const;
  constructor(message: string) {
    super(message);
    this.name = "BlockedTargetError";
  }
}

/**
 * RFC1918 / loopback / link-local / other non-routable ranges — IPv4 and IPv6.
 *
 * Lifted from src/server/pentest/scanner.ts (WAVE 0.2), which now imports this
 * rather than keeping a second copy.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
    if (a === 0) return true; // "this network"
    if (a >= 224) return true; // multicast/reserved
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
    return false;
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified
    if (/^fe[89ab]/.test(normalized)) return true; // link-local fe80::/10
    if (/^f[cd]/.test(normalized)) return true; // unique local fc00::/7
    if (normalized.startsWith("::ffff:")) {
      // IPv4-mapped IPv6 — validate the embedded IPv4 address too.
      return isPrivateOrReservedIp(normalized.replace("::ffff:", ""));
    }
    return false;
  }
  return true; // not a valid IP at all — treat as unsafe
}

export type PublicTarget = {
  url: URL;
  /** Every address the hostname resolved to, all verified public. */
  addresses: string[];
};

export type AssertOptions = {
  /**
   * Protocols the caller accepts. Defaults to HTTPS only — callers that
   * genuinely need plain HTTP must say so, rather than it being the default
   * that lets http://169.254.169.254/ through.
   */
  allowedProtocols?: string[];
};

/**
 * Assert that `rawUrl` is a well-formed absolute HTTP(S) URL whose hostname
 * resolves exclusively to public address space.
 *
 * Throws BlockedTargetError on anything else. Returns the parsed URL and the
 * resolved addresses so a caller can pin the connection.
 */
export async function assertPublicHttpTarget(
  rawUrl: string,
  options: AssertOptions = {}
): Promise<PublicTarget> {
  const allowedProtocols = options.allowedProtocols ?? ["https:"];

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedTargetError(`"${rawUrl}" is not a valid absolute URL.`);
  }

  if (!allowedProtocols.includes(url.protocol)) {
    throw new BlockedTargetError(
      `Protocol "${url.protocol}" is not allowed (expected ${allowedProtocols.join(", ")}).`
    );
  }

  // Strip the brackets IPv6 literals carry in a URL host.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (!hostname) {
    throw new BlockedTargetError("URL has no hostname.");
  }

  // A literal IP needs no DNS round-trip, and must be checked directly —
  // otherwise `http://127.0.0.1/` sails past a resolver-only guard.
  if (isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new BlockedTargetError(
        `Target "${hostname}" is in private or reserved address space.`
      );
    }
    return { url, addresses: [hostname] };
  }

  // Rejected before resolution: these never route anywhere legitimate for an
  // outbound integration, and some resolvers happily map them to 127.0.0.1.
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) {
    throw new BlockedTargetError(`Target "${hostname}" is not a public host.`);
  }

  let resolved: { address: string }[];
  try {
    resolved = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new BlockedTargetError(`Target "${hostname}" could not be resolved.`);
  }

  if (resolved.length === 0) {
    throw new BlockedTargetError(`Target "${hostname}" did not resolve to any address.`);
  }

  // EVERY address must be public. A hostname with one public and one private
  // A-record is a rebinding primitive, not a partial success.
  for (const { address } of resolved) {
    if (isPrivateOrReservedIp(address)) {
      throw new BlockedTargetError(
        `Target "${hostname}" resolves to a private or reserved address (${address}).`
      );
    }
  }

  return { url, addresses: resolved.map((r) => r.address) };
}

/**
 * Validate a redirect target before following it.
 *
 * Exists because a single unchecked redirect defeats the whole guard: an
 * attacker registers a public host that 302s to 169.254.169.254. Prefer
 * `safeFetch` below, which handles this for you.
 */
export async function assertSafeRedirect(
  location: string,
  base: URL,
  options: AssertOptions = {}
): Promise<PublicTarget> {
  // Relative redirects resolve against the (already-validated) base, but still
  // get re-checked — the base being safe says nothing about the target.
  const absolute = new URL(location, base).toString();
  return assertPublicHttpTarget(absolute, options);
}

export type SafeFetchOptions = RequestInit &
  AssertOptions & {
    /** Redirects to follow, each re-validated. 0 disables following. */
    maxRedirects?: number;
  };

/**
 * fetch() with the SSRF guard applied to the initial URL and to every redirect
 * hop.
 *
 * `redirect: "manual"` is forced: the platform fetch would otherwise follow
 * redirects internally, with no opportunity to validate the intermediate hops
 * — which is precisely the hole this closes.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<Response> {
  const { maxRedirects = 0, allowedProtocols, ...init } = options;

  let target = await assertPublicHttpTarget(rawUrl, { allowedProtocols });
  let hops = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // `.toString()` rather than the URL object: functionally identical to
    // fetch, but keeps the argument shape callers and their tests already see.
    const response = await fetch(target.url.toString(), { ...init, redirect: "manual" });

    const isRedirect = response.status >= 300 && response.status < 400;
    if (!isRedirect) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    if (hops >= maxRedirects) {
      throw new BlockedTargetError(
        `Refusing to follow redirect to "${location}" (maxRedirects=${maxRedirects}).`
      );
    }

    target = await assertSafeRedirect(location, target.url, { allowedProtocols });
    hops += 1;
  }
}
