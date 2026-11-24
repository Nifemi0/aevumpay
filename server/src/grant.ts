/**
 * Welcome grant: a small amount of real tUSD8 for each new account, so people can try AevumPay
 * without hunting for a faucet first.
 *
 * Where the money comes from: a grant wallet we control (GRANT_PRIVATE_KEY, or the treasury key
 * when that isn't set). We refill it from the QDay faucet, and the treasury also collects the 0.5%
 * shop fee, so fees flow back out to new users. This is a plain token transfer from our own wallet:
 * the AevumPay contract is untouched and still holds nobody's money.
 *
 * Limits, so throwaway accounts can't drain it:
 *   - once per account and once per wallet address, ever (stored in the DB);
 *   - once per IP per UTC day (in memory);
 *   - GRANT_DAILY_LIMIT grants per UTC day in total (default 25);
 *   - only while the grant wallet actually holds enough.
 * Gas for the transfer comes from the relayer through ensureGas, so it counts toward the relayer's
 * daily budget too.
 */
import { createWalletClient, formatUnits, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { RPC_URL, TUSD8_ADDRESS } from "./config";
import { erc20Abi } from "./abi";
import { balanceOf, chain, ensureGas, explorerTx, publicClient } from "./chain";
import { addGrant, grantFor, grantsSince, type User } from "./db";

const KEY = (process.env.GRANT_PRIVATE_KEY || process.env.TREASURY_PRIVATE_KEY || "") as Hex;
const AMOUNT = parseUnits(process.env.GRANT_AMOUNT || "5", 6);
const DAILY_LIMIT = Math.max(0, Number(process.env.GRANT_DAILY_LIMIT ?? 25)) || 0;

const account = KEY ? privateKeyToAccount(KEY) : null;

export class GrantError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const startOfDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};

let ipDay = "";
const ipsToday = new Set<string>();
function ipSeenToday(ip: string, mark: boolean): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== ipDay) {
    ipDay = today;
    ipsToday.clear();
  }
  const seen = ipsToday.has(ip);
  if (mark) ipsToday.add(ip);
  return seen;
}

/** The grant wallet sends from one address, so its transfers go out one at a time. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** In flight right now, so two quick taps can't both pass the "not claimed yet" check. */
const pending = new Set<string>();

export interface GrantStatus {
  enabled: boolean;
  amount: string;
  claimed: boolean;
  /** Can this user claim right now? If not, `reason` says why in plain words. */
  available: boolean;
  reason?: string;
  txHash?: string;
  explorer?: string;
}

export async function grantStatus(user: User): Promise<GrantStatus> {
  const amount = formatUnits(AMOUNT, 6);
  if (!account || DAILY_LIMIT === 0) return { enabled: false, amount, claimed: false, available: false, reason: "Welcome dollars aren't switched on here." };
  const g = grantFor(user.id, user.address);
  if (g) return { enabled: true, amount: g.amount, claimed: true, available: false, txHash: g.txHash, explorer: explorerTx(g.txHash) };
  if (grantsSince(startOfDay()) >= DAILY_LIMIT) return { enabled: true, amount, claimed: false, available: false, reason: "Today's welcome dollars are all claimed. Try again tomorrow, or use the QDay faucet." };
  const pool = await balanceOf(account.address);
  if (pool < AMOUNT) return { enabled: true, amount, claimed: false, available: false, reason: "The welcome pot is empty right now. Use the QDay faucet instead." };
  return { enabled: true, amount, claimed: false, available: true };
}

export function claimGrant(user: User, ip: string) {
  return serial(() => claimGrantNow(user, ip));
}

async function claimGrantNow(user: User, ip: string) {
  if (!account) throw new GrantError("Welcome dollars aren't switched on here.", 404);
  if (pending.has(user.id)) throw new GrantError("Already on its way.", 409);
  const status = await grantStatus(user);
  if (status.claimed) throw new GrantError("You've already had your welcome dollars.", 409);
  if (!status.available) throw new GrantError(status.reason ?? "Not available right now.", 429);
  if (ipSeenToday(ip, false)) throw new GrantError("Welcome dollars already went to this network today. Try again tomorrow.", 429);

  pending.add(user.id);
  try {
    const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
    const to = user.address as Address;
    const gas = await publicClient.estimateContractGas({ account, address: TUSD8_ADDRESS, abi: erc20Abi, functionName: "transfer", args: [to, AMOUNT] });
    const gasPrice = await publicClient.getGasPrice();
    const gasLimit = (gas * 125n) / 100n;
    await ensureGas(account.address, gasLimit * gasPrice);
    const hash = await wallet.writeContract({
      address: TUSD8_ADDRESS,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, AMOUNT],
      gas: gasLimit,
      gasPrice,
      type: "legacy",
    } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("grant transfer reverted");
    ipSeenToday(ip, true);
    const amount = formatUnits(AMOUNT, 6);
    addGrant({ userId: user.id, address: user.address, amount, txHash: hash, at: Date.now() });
    return { amount, txHash: hash, explorer: explorerTx(hash) };
  } finally {
    pending.delete(user.id);
  }
}

/** For logs at startup: which wallet pays grants (address only, never the key). */
export function grantWallet(): Address | null {
  return account?.address ?? null;
}
