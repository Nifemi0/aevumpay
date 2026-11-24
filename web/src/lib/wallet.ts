"use client";

/**
 * Browser-held wallet keys.
 *
 * - The private key is generated here and never leaves this browser unencrypted.
 * - From the password we derive two independent values (PBKDF2-SHA256, 600k rounds, salted with
 *   the username): an auth key that the server stores as a hash to check logins, and an
 *   encryption key that never leaves the browser. The wallet key is encrypted with the second one
 *   and the server keeps that ciphertext as a backup it cannot open.
 * - On this device the key is also kept encrypted under a non-extractable AES key in IndexedDB,
 *   so a reload doesn't ask for the password again, and the raw key is never written to storage.
 */

import { bytesToHex, hexToBytes, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export interface WalletBlob {
  v: 1;
  iv: string;
  ct: string;
}

const PBKDF2_ROUNDS = 600_000;
const enc = new TextEncoder();

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Turn the password into an auth key (sent to the server) and an encryption key (kept here).
 * The salt is the username registered at signup. Don't let the username change without re-deriving
 * and re-encrypting the backup, or the wallet can no longer be unlocked (see USER_CALLS in server/src/chain.ts).
 */
export async function deriveKeys(username: string, password: string): Promise<{ authKey: string; kek: CryptoKey }> {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(`aevumpay/v1/${username.toLowerCase()}`), iterations: PBKDF2_ROUNDS },
      base,
      512,
    ),
  );
  const authKey = bytesToHex(bits.slice(0, 32)).slice(2);
  const kek = await crypto.subtle.importKey("raw", bits.slice(32), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { authKey, kek };
}

async function seal(key: CryptoKey, privateKey: Hex): Promise<WalletBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array(hexToBytes(privateKey))));
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}

async function open(key: CryptoKey, blob: WalletBlob): Promise<Hex> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return bytesToHex(new Uint8Array(pt));
}

export function newPrivateKey(): Hex {
  return generatePrivateKey();
}

export const encryptForBackup = seal;

/** Decrypt the server-held backup with the password-derived key. Throws on a wrong password. */
export async function openBackup(kek: CryptoKey, blob: WalletBlob): Promise<Hex> {
  return open(kek, blob);
}

// ---------------- this device's copy (IndexedDB) ----------------

const DB = "aevumpay";
const STORE = "keys";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbRun<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface DeviceRecord {
  wrap: CryptoKey; // non-extractable: scripts can use it but can't read it out
  blob: WalletBlob;
  address: string;
}

/** Keep the key on this device, encrypted under a fresh non-extractable key. */
export async function saveOnDevice(username: string, privateKey: Hex): Promise<void> {
  const wrap = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const blob = await seal(wrap, privateKey);
  const address = privateKeyToAccount(privateKey).address;
  await idbRun("readwrite", (s) => s.put({ wrap, blob, address } satisfies DeviceRecord, username.toLowerCase()));
}

export async function hasDeviceKey(username: string): Promise<boolean> {
  try {
    return Boolean(await idbRun("readonly", (s) => s.get(username.toLowerCase())));
  } catch {
    return false;
  }
}

/** The signer for `username` on this device, or null if this browser doesn't hold the key. */
export async function deviceAccount(username: string): Promise<PrivateKeyAccount | null> {
  try {
    const rec = (await idbRun("readonly", (s) => s.get(username.toLowerCase()))) as DeviceRecord | undefined;
    if (!rec) return null;
    return privateKeyToAccount(await open(rec.wrap, rec.blob));
  } catch {
    return null;
  }
}

/** The wallet address this device holds for `username`, or null. */
export async function deviceAddress(username: string): Promise<string | null> {
  try {
    const rec = (await idbRun("readonly", (s) => s.get(username.toLowerCase()))) as DeviceRecord | undefined;
    return rec?.address ?? null;
  } catch {
    return null;
  }
}

export async function forgetDevice(username: string): Promise<void> {
  try {
    await idbRun("readwrite", (s) => s.delete(username.toLowerCase()));
  } catch {
    /* nothing stored */
  }
}
