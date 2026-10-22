import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { HttpError } from "@/lib/errors";

export interface EncryptedSecrets {
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
  updatedAt: number;
}

function encryptionKey(): Buffer {
  const raw = process.env.MARKETPLACE_ENCRYPTION_KEY?.trim() ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new HttpError(
      503,
      "Marketplace credential storage is not configured. Set MARKETPLACE_ENCRYPTION_KEY on the backend.",
    );
  }
  return Buffer.from(raw, "hex");
}

export function encryptMarketplaceSecrets(secrets: Record<string, string>): EncryptedSecrets {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(secrets), "utf8"),
    cipher.final(),
  ]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
    ciphertext: ciphertext.toString("hex"),
    updatedAt: Date.now(),
  };
}

export function decryptMarketplaceSecrets(value: EncryptedSecrets): Record<string, string> {
  if (value.algorithm !== "aes-256-gcm") {
    throw new HttpError(500, "Stored marketplace credentials cannot be read");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(value.iv, "hex"),
    );
    decipher.setAuthTag(Buffer.from(value.authTag, "hex"));
    const cleartext = Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "hex")),
      decipher.final(),
    ]).toString("utf8");
    const parsed: unknown = JSON.parse(cleartext);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid secret payload");
    }
    return parsed as Record<string, string>;
  } catch {
    throw new HttpError(500, "Stored marketplace credentials cannot be read");
  }
}
