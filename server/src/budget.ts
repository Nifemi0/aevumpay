/**
 * Daily budgets for the relayer, so nobody can drain its tQDAY.
 *
 * Per-IP rate limits alone don't stop a distributed attacker or a pile of throwaway accounts, so
 * we also cap, per UTC day:
 *   - top-ups per wallet, and the total tQDAY the relayer may hand out in top-ups;
 *   - relayed transactions per wallet (payer, agent or subscriber), and in total.
 * When a cap is hit the API answers 429 with a plain "try again tomorrow".
 *
 * Counters live in memory and reset at UTC midnight or on restart. That's enough for a testnet
 * demo; a multi-instance deploy would move them to Redis alongside the rate limiter.
 */
import { parseEther } from "viem";

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const LIMITS = {
  /** Total tQDAY the relayer may send as gas top-ups per day. */
  dailyTopUpWei: parseEther(process.env.RELAYER_DAILY_TOPUP_BUDGET || "0.5"),
  /** Top-ups one wallet may receive per day. */
  topUpsPerWallet: num("RELAYER_TOPUPS_PER_WALLET", 10),
  /** Transactions the relayer may send per day in total (payments, agent payments, collector, top-ups). */
  dailyTx: num("RELAYER_DAILY_TX_LIMIT", 1000),
  /** Relayed transactions one wallet may cause per day. */
  txPerWallet: num("RELAYER_TX_PER_WALLET", 100),
};

export class RelayerBudgetError extends Error {
  constructor(message: string) {
    super(message);
  }
}

let day = "";
let topUpWei = 0n;
let txCount = 0;
const topUpsByWallet = new Map<string, number>();
const txByWallet = new Map<string, number>();

function rollDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (today === day) return;
  day = today;
  topUpWei = 0n;
  txCount = 0;
  topUpsByWallet.clear();
  txByWallet.clear();
}

/**
 * Reserve one relayed transaction for `wallet` (lower-cased address, or "collector" for our own
 * subscription collector, which only counts toward the global cap). Throws when a cap is reached.
 */
export function chargeRelayTx(wallet: string): void {
  rollDay();
  const key = wallet.toLowerCase();
  if (txCount >= LIMITS.dailyTx) throw new RelayerBudgetError("the relayer has reached its daily limit; try again tomorrow");
  if (key !== "collector") {
    const used = txByWallet.get(key) ?? 0;
    if (used >= LIMITS.txPerWallet) throw new RelayerBudgetError("this wallet has reached today’s limit of gas-free transactions; try again tomorrow");
    txByWallet.set(key, used + 1);
  }
  txCount++;
}

/** Reserve a gas top-up of `wei` for `wallet`. Throws when a cap is reached. */
export function chargeTopUp(wallet: string, wei: bigint): void {
  rollDay();
  const key = wallet.toLowerCase();
  const used = topUpsByWallet.get(key) ?? 0;
  if (used >= LIMITS.topUpsPerWallet) throw new RelayerBudgetError("this wallet has reached today’s limit of gas top-ups; try again tomorrow");
  if (topUpWei + wei > LIMITS.dailyTopUpWei) throw new RelayerBudgetError("the relayer has reached its daily gas budget; try again tomorrow");
  if (txCount >= LIMITS.dailyTx) throw new RelayerBudgetError("the relayer has reached its daily limit; try again tomorrow");
  topUpsByWallet.set(key, used + 1);
  topUpWei += wei;
  txCount++;
}

/** For /health and tests: what has been used today. */
export function budgetUsage() {
  rollDay();
  return {
    day,
    topUpWei: topUpWei.toString(),
    txCount,
    limits: { ...LIMITS, dailyTopUpWei: LIMITS.dailyTopUpWei.toString() },
  };
}
