process.env.WEBHOOK_ENCRYPTION_KEY =
  process.env.WEBHOOK_ENCRYPTION_KEY ??
  "db4b123385e764d3ba36c585a895c339884dc4be8dd081e8fe9415c0d13ce89";
process.env.CONNECTOR_ENCRYPTION_KEY =
  process.env.CONNECTOR_ENCRYPTION_KEY ??
  "d41829a3f639e0b691ca7ab133b091d0af70733eb2b1a9ff0a7ac66d44f84b7";

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
