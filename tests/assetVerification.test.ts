import { describe, it, expect } from "@jest/globals";
import {
  normalizeTarget,
  assetCoversTarget,
  ipv4InCidr,
  isValidIpv4Cidr,
  generateVerificationToken,
  dnsTxtChallengePresent,
  assertTargetVerified,
  AssetVerificationError,
  TargetNotVerifiedError,
  DNS_TXT_PREFIX,
} from "@/server/pentest/assetVerification";

// WAVE 0.1 — unit coverage for the ownership-proof primitives. The router
// integration (create is gated, tenant isolation, audit trail) lives in
// tests/pentest.router.test.ts.

describe("normalizeTarget", () => {
  it.each([
    ["example.com", "example.com"],
    ["Example.COM", "example.com"],
    ["example.com.", "example.com"],
    ["https://example.com", "example.com"],
    ["http://user:pass@example.com:8443/a/b?c=1#d", "example.com"],
    ["  example.com  ", "example.com"],
  ])("normalizes %s -> %s", (input, expected) => {
    expect(normalizeTarget(input)).toEqual({ kind: "DOMAIN", value: expected });
  });

  it("classifies IP literals as IP, not DOMAIN", () => {
    expect(normalizeTarget("127.0.0.1")).toEqual({ kind: "IP", value: "127.0.0.1" });
    expect(normalizeTarget("::1")).toEqual({ kind: "IP", value: "::1" });
  });

  it("unwraps a bracketed IPv6 literal with a port without shredding the address", () => {
    expect(normalizeTarget("[::1]:8080")).toEqual({ kind: "IP", value: "::1" });
  });

  it.each(["", "   ", "not a domain!!", "no-tld", "-bad.example.com"])(
    "rejects %p",
    (input) => {
      expect(() => normalizeTarget(input)).toThrow(AssetVerificationError);
    },
  );
});

describe("assetCoversTarget", () => {
  const apex = { kind: "DOMAIN" as const, value: "example.com" };

  it("covers the apex itself", () => {
    expect(assetCoversTarget(apex, normalizeTarget("example.com"))).toBe(true);
  });

  it("covers a subdomain, since proving a TXT record proves zone control", () => {
    expect(assetCoversTarget(apex, normalizeTarget("app.example.com"))).toBe(true);
    expect(assetCoversTarget(apex, normalizeTarget("a.b.example.com"))).toBe(true);
  });

  it("does NOT cover a suffix-confusable sibling domain", () => {
    // The bug this pins: a naive endsWith("example.com") would authorize
    // scanning notexample.com off a verified example.com.
    expect(assetCoversTarget(apex, normalizeTarget("notexample.com"))).toBe(false);
    expect(assetCoversTarget(apex, normalizeTarget("example.com.evil.test"))).toBe(false);
  });

  it("does not let a domain claim cover an IP, or vice versa", () => {
    expect(assetCoversTarget(apex, normalizeTarget("93.184.216.34"))).toBe(false);
    expect(
      assetCoversTarget({ kind: "CIDR", value: "10.0.0.0/8" }, normalizeTarget("example.com")),
    ).toBe(false);
  });

  it("covers an IP inside a verified CIDR", () => {
    const cidr = { kind: "CIDR" as const, value: "203.0.113.0/24" };
    expect(assetCoversTarget(cidr, normalizeTarget("203.0.113.7"))).toBe(true);
    expect(assetCoversTarget(cidr, normalizeTarget("203.0.114.7"))).toBe(false);
  });
});

describe("ipv4InCidr", () => {
  it.each([
    ["203.0.113.7", "203.0.113.0/24", true],
    ["203.0.113.255", "203.0.113.0/24", true],
    ["203.0.114.0", "203.0.113.0/24", false],
    ["10.1.2.3", "10.0.0.0/8", true],
    ["11.1.2.3", "10.0.0.0/8", false],
    ["203.0.113.7", "203.0.113.7/32", true],
    ["203.0.113.8", "203.0.113.7/32", false],
  ])("%s in %s -> %s", (ip, cidr, expected) => {
    expect(ipv4InCidr(ip, cidr)).toBe(expected);
  });

  it("handles /0 without relying on a shift that JS computes mod 32", () => {
    expect(ipv4InCidr("8.8.8.8", "0.0.0.0/0")).toBe(true);
  });

  it("returns false rather than throwing on malformed input", () => {
    expect(ipv4InCidr("8.8.8.8", "garbage")).toBe(false);
    expect(ipv4InCidr("8.8.8.8", "203.0.113.0/33")).toBe(false);
    expect(ipv4InCidr("::1", "203.0.113.0/24")).toBe(false);
  });

  it("isValidIpv4Cidr accepts only well-formed IPv4 CIDRs", () => {
    expect(isValidIpv4Cidr("203.0.113.0/24")).toBe(true);
    expect(isValidIpv4Cidr("203.0.113.0")).toBe(false);
    expect(isValidIpv4Cidr("::/0")).toBe(false);
  });
});

describe("generateVerificationToken", () => {
  it("returns 32 hex chars and does not repeat", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateVerificationToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("dnsTxtChallengePresent", () => {
  const token = "a".repeat(32);

  it("matches the published challenge", async () => {
    const resolver = { resolveTxt: async () => [[`${DNS_TXT_PREFIX}${token}`]] };
    await expect(dnsTxtChallengePresent("example.com", token, resolver)).resolves.toBe(true);
  });

  it("rejoins a TXT record the resolver split at the 255-byte boundary", async () => {
    const resolver = {
      resolveTxt: async () => [[`${DNS_TXT_PREFIX}${token.slice(0, 10)}`, token.slice(10)]],
    };
    await expect(dnsTxtChallengePresent("example.com", token, resolver)).resolves.toBe(true);
  });

  it("finds the challenge alongside unrelated TXT records", async () => {
    const resolver = {
      resolveTxt: async () => [["v=spf1 -all"], ["unrelated"], [`${DNS_TXT_PREFIX}${token}`]],
    };
    await expect(dnsTxtChallengePresent("example.com", token, resolver)).resolves.toBe(true);
  });

  it("does not match a different org's token", async () => {
    const resolver = { resolveTxt: async () => [[`${DNS_TXT_PREFIX}${"b".repeat(32)}`]] };
    await expect(dnsTxtChallengePresent("example.com", token, resolver)).resolves.toBe(false);
  });

  it("does not match a prefix-only or substring record", async () => {
    const resolver = { resolveTxt: async () => [[DNS_TXT_PREFIX], [token]] };
    await expect(dnsTxtChallengePresent("example.com", token, resolver)).resolves.toBe(false);
  });

  it("treats an NXDOMAIN / resolver error as unproven rather than throwing", async () => {
    const resolver = {
      resolveTxt: async () => {
        throw Object.assign(new Error("queryTxt ENOTFOUND"), { code: "ENOTFOUND" });
      },
    };
    await expect(dnsTxtChallengePresent("nope.invalid", token, resolver)).resolves.toBe(false);
  });
});

describe("assertTargetVerified", () => {
  function fakePrisma(rows: any[]) {
    return {
      verifiedAsset: {
        findMany: async ({ where }: any) => {
          // Mirror the real query's filters so a test cannot pass on rows the
          // production query would never have returned.
          expect(where).toMatchObject({ verifiedAt: { not: null }, revokedAt: null });
          return rows.filter((r) => r.organizationId === where.organizationId);
        },
      },
    } as any;
  }

  // GH #20 — `verifiedAt` is now load-bearing, not decorative: authorization
  // requires a proof that is still CURRENT, not merely present. This fixture
  // always claimed to be a verified asset; it now actually carries the proof
  // date that makes it one. Expiry behaviour has its own suite
  // (tests/assetVerificationExpiry.test.ts) — this one stays focused on
  // coverage matching (apex vs. subdomain vs. unrelated).
  const verified = {
    id: "asset-1",
    organizationId: "org-1",
    value: "example.com",
    kind: "DOMAIN",
    verifiedAt: new Date(),
    revokedAt: null,
  };

  it("returns the covering asset for a verified domain", async () => {
    const asset = await assertTargetVerified(fakePrisma([verified]), "org-1", "example.com");
    expect(asset.id).toBe("asset-1");
  });

  it("returns the covering asset for a subdomain of a verified domain", async () => {
    const asset = await assertTargetVerified(fakePrisma([verified]), "org-1", "app.example.com");
    expect(asset.id).toBe("asset-1");
  });

  it("throws for an unverified domain", async () => {
    await expect(
      assertTargetVerified(fakePrisma([verified]), "org-1", "google.com"),
    ).rejects.toThrow(TargetNotVerifiedError);
  });

  it("throws for another tenant's verified domain", async () => {
    await expect(
      assertTargetVerified(fakePrisma([verified]), "org-2", "example.com"),
    ).rejects.toThrow(TargetNotVerifiedError);
  });

  it("propagates a normalization failure rather than silently authorizing", async () => {
    await expect(
      assertTargetVerified(fakePrisma([verified]), "org-1", "not a domain!!"),
    ).rejects.toThrow(AssetVerificationError);
  });
});
