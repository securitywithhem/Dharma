import { sign, verify, SIGNATURE_HEADER } from "@/server/webhooks/signPayload";

describe("signPayload", () => {
  it("produces a deterministic sha256= prefixed hex digest", () => {
    const secret = "whsec_test";
    const body = JSON.stringify({ event: "evidence.updated", data: { a: 1 } });

    const sig1 = sign(secret, body);
    const sig2 = sign(secret, body);

    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("produces different signatures for different secrets", () => {
    const body = JSON.stringify({ event: "control.failed" });
    expect(sign("secret-a", body)).not.toBe(sign("secret-b", body));
  });

  it("produces different signatures when the body is tampered with", () => {
    const secret = "whsec_test";
    const original = sign(secret, JSON.stringify({ amount: 100 }));
    const tampered = sign(secret, JSON.stringify({ amount: 100000 }));
    expect(original).not.toBe(tampered);
  });

  it("verify() accepts a matching signature and rejects a tampered one", () => {
    const secret = "whsec_test";
    const body = JSON.stringify({ event: "evidence.updated" });
    const signature = sign(secret, body);

    expect(verify(secret, body, signature)).toBe(true);
    expect(verify(secret, body + "tampered", signature)).toBe(false);
    expect(verify("wrong-secret", body, signature)).toBe(false);
  });

  it("exports a stable header name convention", () => {
    expect(SIGNATURE_HEADER).toBe("X-Dharma-Signature-256");
  });
});
