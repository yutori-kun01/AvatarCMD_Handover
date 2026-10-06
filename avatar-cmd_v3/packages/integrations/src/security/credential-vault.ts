// ==============================================
// Credential Vault — AES-256-GCM Encryption
// ==============================================
// Zero-trust credential storage. All sensitive data
// (tokens, passwords, session cookies) must go through this.

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "crypto";

export interface EncryptedData {
  iv: string;
  authTag: string;
  ciphertext: string;
}

export class CredentialVault {
  private encryptionKey: Buffer;

  constructor(masterKey?: string) {
    const key = masterKey || process.env.ENCRYPTION_KEY;
    if (!key) {
      throw new Error(
        "ENCRYPTION_KEY is required. Generate with: openssl rand -hex 32"
      );
    }
    // Derive a 256-bit key using PBKDF2
    this.encryptionKey = pbkdf2Sync(key, "avatar-cmd-salt", 100000, 32, "sha512");
  }

  /**
   * Encrypt a plaintext string.
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag().toString("hex");

    // Format: iv:authTag:ciphertext
    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
  }

  /**
   * Decrypt an encrypted string.
   */
  decrypt(encryptedString: string): string {
    const parts = encryptedString.split(":");
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted data format");
    }

    const [ivHex, authTagHex, ciphertext] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Encrypt and return structured data (for storage in JSON fields).
   */
  encryptToObject(plaintext: string): EncryptedData {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");

    return {
      iv: iv.toString("hex"),
      authTag: cipher.getAuthTag().toString("hex"),
      ciphertext: encrypted,
    };
  }

  /**
   * Decrypt structured data.
   */
  decryptFromObject(data: EncryptedData): string {
    const iv = Buffer.from(data.iv, "hex");
    const authTag = Buffer.from(data.authTag, "hex");

    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(data.ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Mask a string for display (show first 4 + last 4 chars).
   */
  static mask(value: string, visibleChars: number = 4): string {
    if (value.length <= visibleChars * 2) {
      return "●".repeat(value.length);
    }
    const start = value.slice(0, visibleChars);
    const end = value.slice(-visibleChars);
    const masked = "●".repeat(Math.min(value.length - visibleChars * 2, 8));
    return `${start}${masked}${end}`;
  }
}
