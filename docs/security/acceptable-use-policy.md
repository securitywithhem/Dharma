# Acceptable Use Policy — Dharma VAPT scanning

**Applies to:** every deployment of Dharma with the pentest module enabled.
**Owner:** the operator of the deployment (self-hosted: your organization).
**Last reviewed:** 2026-08-05.

Dharma can direct an active vulnerability scanner (nuclei) at a network target.
In most jurisdictions, doing that to infrastructure you do not control is a
criminal offence — India's IT Act 2000 §43/§66, the US CFAA, the UK Computer
Misuse Act 1990. This document states what the software will and will not let
you do, and what happens when something goes wrong.

---

## 1. What you may scan

You may scan a target only if **all** of the following hold:

1. Your organization owns or operates it, **or** you hold written authorization
   from the party that does.
2. The target is registered as a `VerifiedAsset` in your organization and the
   ownership challenge has been confirmed by Dharma server-side.
3. Scanning it does not breach a third party's terms — this catches the common
   case of a domain you own that is *hosted* by someone else (SaaS, shared
   hosting, a managed CDN). Owning the DNS zone is not the same as being
   permitted to run an active scan against the infrastructure serving it.

Point 3 is the one the software cannot check for you. Points 1 and 2 are
enforced in code; point 3 is yours.

## 2. What the software enforces

| Control | Where | Effect |
|---|---|---|
| Ownership proof | `src/server/pentest/assetVerification.ts` | A scan is rejected unless a `VerifiedAsset` row for the org covers the target, verified via a DNS TXT challenge the server resolves itself. |
| Re-check at dispatch | `src/server/queue/workers/pentestScanWorker.ts` | Verification is re-asserted when the job actually runs, so a revoked asset or an expired scheduled scan cannot fire. |
| SSRF / internal-range block | `src/server/pentest/scanner.ts` | Rejects RFC1918, loopback, link-local (incl. the `169.254.169.254` cloud metadata endpoint), and IPv4-mapped IPv6 equivalents — at both authorization and scan time, which closes the DNS-rebinding window. |
| Separation of duties | `src/server/routers/pentest.ts` | Verifying a new target is ADMIN-only. A MANAGER can run scans but cannot authorize new targets for themselves. |
| Authorization trail | `PENTEST_SCAN_AUTHORIZED` audit action | Records which asset, which verification, which admin attested — in the hash-chained audit log. |
| Breadth signal | `src/server/pentest/scanAnomaly.ts` | Flags (does not block) an org scanning an unusual number of distinct assets in an hour. |

### What it does not enforce

- **Legal ownership.** A DNS TXT record proves control of a zone. It does not
  prove the claimant is entitled to it — a compromised zone, a lapsed domain,
  or an employee acting outside their authority all still pass.
- **Third-party hosting terms.** See §1.3.
- **Scan intensity or timing.** Nothing here stops an authorized scan from
  taking a fragile production service down.
- **CIDR self-service.** IP ranges have no automated proof path; a verified
  CIDR must be added out of band by an operator who has checked the paperwork.

---

## 3. Abuse-response runbook

Trigger: an abuse complaint, a hosting-provider notice, a law-enforcement
contact, or an unexpected-target report from the `PENTEST_SCAN_SPREAD_ANOMALY`
audit signal.

### Step 0 — Acknowledge (within 1 hour of receipt)

Reply confirming receipt and that an investigation has started. Do not
speculate about cause, admit liability, or share customer identity yet.

**Notify:** the deployment operator's security contact and legal contact. In a
self-hosted single-tenant deployment these may be the same person; name them
here before you need them:

| Role | Name | Contact |
|---|---|---|
| Security contact | _fill in_ | _fill in_ |
| Legal contact | _fill in_ | _fill in_ |
| Deployment operator | _fill in_ | _fill in_ |

### Step 1 — Stop the bleeding (immediately, before investigating)

In this order, because each step is cheaper to reverse than the last:

1. **Revoke the asset.** Pentests → Verified assets → Revoke, or
   `UPDATE "VerifiedAsset" SET "revokedAt" = now() WHERE ...`. The worker
   re-checks verification at dispatch, so this stops queued *and* scheduled
   scans against that target without touching anything else.
2. **Drain in-flight scans** for the target: cancel the `PenTest` rows
   (`status = CANCELLED`), which the worker honours between enqueue and pickup.
3. **Suspend the org's scanning** if the pattern is broader than one asset —
   revoke all its verified assets.
4. **Stop the pentest worker** (`docker compose stop pentest-worker`) only if
   the above is insufficient. This is deployment-wide and affects every tenant.

Do **not** delete anything. `VerifiedAsset` revocation is a tombstone by design,
and the audit log is append-only and hash-chained — deletion destroys the
evidence that would establish what was authorized and by whom.

### Step 2 — Establish the facts (same day)

Pull, for the target in question:

- `AuditLog` entries with action `PENTEST_SCAN_AUTHORIZED` — gives the
  authorizing asset, its verification method and timestamp, the admin who
  verified it, and the admin who attested ownership at scan time.
- `ASSET_VERIFICATION_REQUESTED` / `_CONFIRMED` / `_FAILED` — the challenge
  history, including failed attempts.
- `PenTest` rows and their `containerLogUrl` — the raw scanner output in MinIO.

Run the Audit Log's **Verify chain integrity** action first and record the
result. A complaint response is stronger when it opens with a verified,
tamper-evident chain.

### Step 3 — Decide (within 3 business days)

- **The scan was authorized and the complainant is a third-party host** (§1.3):
  provide the authorization record, keep the asset revoked until the hosting
  party consents in writing.
- **The scan was not authorized** — the verification was obtained over a zone
  the claimant did not legitimately control: preserve everything, involve legal
  before any further external communication, and treat it as a security
  incident against your own deployment, not merely a policy violation.
- **The control failed** — the scan ran with no covering `VerifiedAsset`: this
  is a defect in the gate. File it as a P0, and check whether any other scan
  took the same path before fixing forward.

### Step 4 — Close out

- Written response to the complainant.
- If a control failed, a regression test that would have caught it (this is the
  same standard the rest of this remediation pass is held to).
- Update this runbook with what was actually unclear when you used it.

---

## 4. Retention

Authorization records — `VerifiedAsset` rows (including revoked ones) and the
associated audit entries — are the operator's defence if a scan is disputed.
Retain them for at least the limitation period applicable in your jurisdiction
(India: 3 years for most civil claims). Do not include them in routine tenant
data-deletion tooling without legal review.

Note: `VerifiedAsset` cascades on organization delete, per the repo-wide tenant
convention. If your retention obligation outlives tenant offboarding, export
the authorization trail before deleting the organization.
