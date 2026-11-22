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
export const KEY_ENCRYPTION_SECRET = required("KEY_ENCRYPTION_SECRET", env("KEY_ENCRYPTION_SECRET"));
export const JWT_SECRET = env("JWT_SECRET", "dev-only-change-me");
export const DB_PATH = env("DB_PATH", "./data/db.json");
export const PORT = Number(env("PORT", "8787"));

if (!RELAYER_PRIVATE_KEY) {
  console.warn("[warn] RELAYER_PRIVATE_KEY not set — gasless payments and gas top-ups will fail.");
}
if (KEY_ENCRYPTION_SECRET.length < 16) {
  console.warn("[warn] KEY_ENCRYPTION_SECRET is short; use 32+ random characters in production.");
}
