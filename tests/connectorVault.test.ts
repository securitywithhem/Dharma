process.env.CONNECTOR_ENCRYPTION_KEY =
  process.env.CONNECTOR_ENCRYPTION_KEY ??
  "d41829a3f639e0b691ca7ab133b091d0af70733eb2b1a9ff0a7ac66d44f84b7";

import {
  encryptConnectorConfig,
  decryptConnectorConfig,
} from "@/server/lib/crypto/connectorVault";

describe("connectorVault", () => {
  it("round-trips a config object through encrypt/decrypt", () => {
    const plain = { roleArn: "arn:aws:iam::123456789012:role/DharmaReadOnly", externalId: "abc-123", region: "us-east-1" };
    const cipherText = encryptConnectorConfig(plain);

    expect(cipherText).not.toEqual(JSON.stringify(plain));
    expect(cipherText.split(":")).toHaveLength(3);

    const decrypted = decryptConnectorConfig(cipherText);
    expect(decrypted).toEqual(plain);
  });

  it("throws when the ciphertext has been tampered with", () => {
    const cipherText = encryptConnectorConfig({ secret: "value" });
    const [iv, tag, data] = cipherText.split(":");
    const tampered = `${iv}:${tag}:${data.slice(0, -2)}${data.slice(-2) === "AA" ? "BB" : "AA"}`;

    expect(() => decryptConnectorConfig(tampered)).toThrow();
  });

  it("throws when the auth tag has been tampered with", () => {
    const cipherText = encryptConnectorConfig({ secret: "value" });
    const [iv, , data] = cipherText.split(":");
    const tamperedTag = Buffer.alloc(16, 1).toString("base64");

    expect(() => decryptConnectorConfig(`${iv}:${tamperedTag}:${data}`)).toThrow();
  });

  it("throws a clear error when the encryption key is missing", () => {
    const original = process.env.CONNECTOR_ENCRYPTION_KEY;
    delete process.env.CONNECTOR_ENCRYPTION_KEY;
    jest.resetModules();

    const { encryptConnectorConfig: encryptWithoutKey } = require("@/server/lib/crypto/connectorVault");
    expect(() => encryptWithoutKey({ a: 1 })).toThrow(/CONNECTOR_ENCRYPTION_KEY/);

    process.env.CONNECTOR_ENCRYPTION_KEY = original;
  });
});
