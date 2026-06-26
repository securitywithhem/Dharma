import crypto from "node:crypto";

export const AUDITOR_COOKIE_NAME = "dharma_auditor_token";
export const AUDITOR_EXCHANGE_PARAM = "code";

export function hashAuditorToken(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateAuditorExchangeCode() {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateAuditorSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}
