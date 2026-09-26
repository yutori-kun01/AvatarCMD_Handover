import { describe, it, expect } from "vitest";
import { CredentialVault } from "../src/security/credential-vault";

describe("CredentialVault", () => {
  it("round-trips and detects tampering", () => {
    const v = new CredentialVault("test-key");
    const enc = v.encrypt("token-123");
    expect(enc).not.toContain("token-123");
    expect(v.decrypt(enc)).toBe("token-123");
    const [iv, tag, ct] = enc.split(":");
    const tampered = `${iv}:${tag}:${ct.slice(0, -2)}${ct.endsWith("00") ? "11" : "00"}`;
    expect(() => v.decrypt(tampered)).toThrow();
    expect(() => new CredentialVault("other").decrypt(enc)).toThrow();
  });
});
