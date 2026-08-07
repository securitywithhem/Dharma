// GH #22 — session lifetime and revocation policy, in one place.
//
// Two independent consumers mint Dharma sessions:
//   * NextAuth's own provider flow (src/server/auth.ts), and
//   * the enterprise SSO callbacks (src/server/services/sso/session.ts), which
//     encode the same JWT by hand because they run outside NextAuth's flow.
//
// Before this module the two carried the max-age as separate literals with a
// "match authOptions.session.maxAge" comment between them — a comment is not a
// mechanism, and the SSO half would have silently kept a 30-day lifetime when
// the NextAuth half was shortened. Both now import from here.

/**
 * Absolute idle lifetime of a session token, in seconds.
 *
 * WHY 7 DAYS, NOT 30 (the previous value) AND NOT 8 HOURS:
 *
 * NextAuth's JWT `maxAge` is an *idle* window, not an absolute one — the token
 * is re-encoded with a fresh expiry whenever a request comes in more than
 * SESSION_UPDATE_AGE_SECONDS after the last re-issue. So this number is "how
 * long a session survives with no activity", which is the number a SOC 2
 * assessor actually asks about under logical access.
 *
 * 30 days was indefensible for a compliance product: a laptop stolen on day 1
 * kept a working session for a month, and until the revocation switch below
 * existed there was no way to shorten that after the fact.
 *
 * 8 hours (the aggressive end) was rejected because Dharma's primary non-SSO
 * credential is a magic link — there is no refresh token to trade, so a short
 * window means users re-authenticate through their inbox, and the predictable
 * response to that friction is that admins turn SSO enforcement *off*. A
 * control that pushes operators toward a weaker configuration is a bad control.
 *
 * 7 days idle + hourly rotation is the deliberate middle: it bounds an
 * abandoned session to a week, and — crucially — it is no longer the *only*
 * bound, because an admin can now cut every session for the org or for one user
 * instantly. Orgs that need a tighter window enforce it at their IdP, whose
 * re-authentication policy governs the SSO path.
 */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * How often an active session's token is re-issued. One hour rather than
 * NextAuth's 24-hour default: re-issuing more often costs one extra Set-Cookie
 * per hour and keeps the idle clock honest for genuinely active users.
 *
 * Re-issuing does NOT reset the revocation stamp — see `sessionIssuedAt`.
 */
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60;

/**
 * The JWT claim carrying when the session was first established.
 *
 * DELIBERATELY OUR OWN CLAIM RATHER THAN THE STANDARD `iat`. NextAuth rewrites
 * `iat` every time it re-encodes the token (i.e. every hour, per the constant
 * above), so a revocation cutoff compared against `iat` would be defeated by
 * the token simply refreshing itself past the cutoff — the session would
 * survive the kill-switch by staying active, which is exactly backwards. This
 * claim is written once, when `user` is present in the `jwt` callback (only
 * true at sign-in), and copied verbatim on every subsequent re-encode.
 */
export const SESSION_ISSUED_AT_CLAIM = "sessionIssuedAt";

/**
 * Is a session minted at `sessionIssuedAt` (epoch SECONDS, as carried in the
 * JWT) still honoured, given the user's revocation cutoff (epoch MILLISECONDS,
 * as carried on the resolved identity)?
 *
 * The two units differ because each side is in the unit its own layer uses —
 * JWT claims are seconds by convention, `Date.getTime()` is milliseconds — and
 * converting at the boundary here is safer than a lossy normalisation at two
 * call sites. Both parameter names say which is which.
 *
 * FAILS CLOSED on a missing stamp. A token with no `sessionIssuedAt` predates
 * this feature; once a cutoff exists we cannot prove such a token was issued
 * after it, and the whole point of the switch is that an admin who pressed it
 * gets a guarantee rather than a best effort. With no cutoff set, an unstamped
 * token is fine — there is nothing to compare it against, so existing sessions
 * are not mass-signed-out by the mere act of deploying this.
 */
export function isSessionWithinValidity(
  sessionIssuedAtSeconds: number | null | undefined,
  sessionsValidFromMs: number | null | undefined,
): boolean {
  if (sessionsValidFromMs == null) {
    return true;
  }
  if (
    typeof sessionIssuedAtSeconds !== "number" ||
    !Number.isFinite(sessionIssuedAtSeconds)
  ) {
    return false;
  }
  // Second granularity on the token vs. millisecond on the column means a
  // session minted in the same second the admin pressed revoke is ambiguous.
  // The safe reading of an ambiguous kill-switch is "killed", so this is a
  // strict `>` against the cutoff rather than `>=` against its floor.
  return sessionIssuedAtSeconds * 1000 > sessionsValidFromMs;
}

/** The stamp to write into a newly-minted session token. */
export function nowSessionIssuedAt(): number {
  return Math.floor(Date.now() / 1000);
}
