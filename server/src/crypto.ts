import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

/*
 * The server never creates, stores or sees a user's wallet key. The browser derives two values
 * from the password: an auth key (sent here, hashed below like a password) and an encryption key
 * (never sent) that locks the wallet key. We only keep the locked copy, as opaque ciphertext.
 */

// ---------------- auth-key hashing (scrypt) ----------------

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return { salt: salt.toString("base64"), hash: hash.toString("base64") };
}

export function verifyPassword(password: string, saltB64: string, hashB64: string): boolean {
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const got = scryptSync(password, salt, expected.length);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** The browser-encrypted wallet key (AES-256-GCM). The server can't decrypt it. */
export interface WalletBlob {
  v: 1;
  iv: string; // base64, 12 bytes
  ct: string; // base64, 32-byte key + 16-byte tag
}

export function isWalletBlob(x: unknown): x is WalletBlob {
  const b = x as WalletBlob;
  return (
    !!b &&
    b.v === 1 &&
    typeof b.iv === "string" &&
    typeof b.ct === "string" &&
    /^[A-Za-z0-9+/=]{16}$/.test(b.iv) &&
    /^[A-Za-z0-9+/=]{40,96}$/.test(b.ct)
  );
}

export function newId(): string {
  return randomUUID();
}
