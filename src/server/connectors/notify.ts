/**
 * Extension point for outgoing webhooks ("evidence updated" / "control
 * failed") — the dispatcher itself (HTTP delivery, HMAC signing, retry
 * policy) is Phase 4 Part 3 scope. Part 2 only needs to call this at the
 * right place so Part 3 can fill in the body without touching the worker.
 */
export async function notifyEvidenceUpdated(
  organizationId: string,
  controlId: string,
  evidenceId: string,
): Promise<void> {
  // TODO Part 3: dispatch outgoing webhooks here
}
