import type { Address } from "viem";

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function required(name: string, value: string): string {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const RPC_URL = env("AEVUMPAY_RPC", "https://rpc-test.qday.info");
export const CHAIN_ID = Number(env("AEVUMPAY_CHAIN_ID", "44005"));
export const AEVUMPAY_ADDRESS = required("AEVUMPAY_ADDRESS", env("AEVUMPAY_ADDRESS")) as Address;
export const TUSD8_ADDRESS = env("TUSD8_ADDRESS", "0x456569838f1d43009A91ebA4263147Afd7233483") as Address;
export const RELAYER_PRIVATE_KEY = env("RELAYER_PRIVATE_KEY") as `0x${string}`;
export const DB_PATH = env("DB_PATH", "./data/db.json");
export const PORT = Number(env("PORT", "8787"));

if (!RELAYER_PRIVATE_KEY) {
  console.warn("[warn] RELAYER_PRIVATE_KEY not set — gasless payments and gas top-ups will fail.");
}
// Wallet keys are created and encrypted in the browser; the server never holds a user key, so
// there is no key-encryption secret any more (KEY_ENCRYPTION_SECRET is ignored if still set).
