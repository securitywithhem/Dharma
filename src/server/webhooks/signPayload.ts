import { createHmac, timingSafeEqual } from "node:crypto";

/** Header name convention mirrors GitHub's own X-Hub-Signature-256 scheme. */
export const SIGNATURE_HEADER = "X-Dharma-Signature-256";

/** HMAC-SHA256 hex digest of `body`, keyed by the webhook's signing secret. */
export function sign(secret: string, body: string): string {
  const digest = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return `sha256=${digest}`;
}

/** Constant-time comparison — guards against timing side-channels on verify. */
export function verify(secret: string, body: string, signature: string): boolean {
  const expected = sign(secret, body);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
