import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const rawKey = process.env.APP_SECRET_KEY || "omnimail-secret-encryption-key-2026";
  // Create a predictable 32-byte key from whatever string or hex is provided
  return crypto.createHash("sha256").update(rawKey).digest();
}

/**
 * Encrypts plain text using AES-256-GCM.
 * Output format: ivHex:authTagHex:encryptedHex
 */
export function encryptSecret(plainText: string): string {
  if (!plainText) return "";
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM encrypted cipher text.
 */
export function decryptSecret(cipherText: string): string {
  if (!cipherText) return "";
  try {
    const parts = cipherText.split(":");
    if (parts.length !== 3) {
      // In case legacy or plain text was passed
      return cipherText;
    }
    const [ivHex, authTagHex, encrypted] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("Failed to decrypt secret:", error);
    return "";
  }
}
