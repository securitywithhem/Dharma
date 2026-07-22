process.env.WEBHOOK_ENCRYPTION_KEY =
  process.env.WEBHOOK_ENCRYPTION_KEY ??
  "2663fe6fbfc3ad8bccefdd22386906a66e7ed93d9433b7ed9de17fcbace9c4c6";
process.env.CONNECTOR_ENCRYPTION_KEY =
  process.env.CONNECTOR_ENCRYPTION_KEY ??
  "63f0fdbfb1adecbbe70619602bbffd2243b78170bb71bb02225c6603f0edccc3";

import {
  encryptWebhookSecret,
  decryptWebhookSecret,
} from "@/server/lib/crypto/webhookVault";
import { encryptConnectorConfig } from "@/server/lib/crypto/connectorVault";

describe("webhookVault", () => {
  it("round-trips a signing secret through encrypt/decrypt", () => {
    const plain = "whsec_" + "a".repeat(32);
    const cipherText = encryptWebhookSecret(plain);

    expect(cipherText).not.toEqual(plain);
    expect(cipherText.split(":")).toHaveLength(3);

    const decrypted = decryptWebhookSecret(cipherText);
    expect(decrypted).toEqual(plain);
  });

  it("throws when the ciphertext has been tampered with", () => {
    const cipherText = encryptWebhookSecret("whsec_value");
    const [iv, tag, data] = cipherText.split(":");
    const tampered = `${iv}:${tag}:${data.slice(0, -2)}${data.slice(-2) === "AA" ? "BB" : "AA"}`;

    expect(() => decryptWebhookSecret(tampered)).toThrow();
  });

  it("cannot decrypt a connector-encrypted payload with the webhook key (key isolation)", () => {
    const connectorCipherText = encryptConnectorConfig({ token: "leaked-if-shared" });
    expect(() => decryptWebhookSecret(connectorCipherText)).toThrow();
  });
});
