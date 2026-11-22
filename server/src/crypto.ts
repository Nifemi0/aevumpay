import {
  randomBytes,
  randomUUID,
  scryptSync,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

/** Generate a fresh wallet for a new account. */
export function newWallet(): { privateKey: Hex; address: Hex } {
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  return { privateKey, address };
}

// ---------------- password hashing (scrypt) ----------------

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

// ---------------- wallet key encryption at rest (AES-256-GCM + scrypt) ----------------

export interface KeyBlob {
  salt: string;
  iv: string;
  tag: string;
  ct: string;
}

export function encryptPrivateKey(privateKey: Hex, secret: string): KeyBlob {
  const salt = randomBytes(16);
  const key = scryptSync(secret, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(privateKey.slice(2), "hex")), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  };
}

export function decryptPrivateKey(blob: KeyBlob, secret: string): Hex {
  const salt = Buffer.from(blob.salt, "base64");
  const key = scryptSync(secret, salt, 32);
  const iv = Buffer.from(blob.iv, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(blob.ct, "base64")), decipher.final()]);
  return ("0x" + pt.toString("hex")) as Hex;
}

export function newId(): string {
  return randomUUID();
}
