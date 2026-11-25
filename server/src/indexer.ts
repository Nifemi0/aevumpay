/**
 * A small event index for AevumPay, so reads don't rescan the chain on every request.
 *
 * Aevum caps eth_getLogs at 1,000 blocks and each RPC round trip is slow (~1 s), so scanning from
 * the deploy block per request costs a few hundred calls and grows every day. Instead we scan once
 * in the background (in parallel), keep the `Paid` and `AllowanceGranted` events in memory, save
 * them to disk so a restart only fetches what's new, and follow the chain head every few seconds.
 *
 * The index is a cache of public on-chain data: it holds nothing secret and decides nothing. Any
 * value the user acts on (balances, allowance state, subscription terms) is still read live.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decodeEventLog, parseAbi } from "viem";
import type { Address, Hex, Log } from "viem";
import { AEVUMPAY_ADDRESS, CHAIN_ID, DB_PATH } from "./config";
import { publicClient } from "./chain";

const LOG_CHUNK = 999n; // Aevum caps eth_getLogs at 1,000 blocks per call
const BACKFILL_CONCURRENCY = 8;
const FOLLOW_MS = 3_000;
const START_BLOCK = process.env.AEVUMPAY_DEPLOY_BLOCK ? BigInt(process.env.AEVUMPAY_DEPLOY_BLOCK) : 0n;
const FILE = join(dirname(DB_PATH), "index.json");

const events = parseAbi([
  "event Paid(uint256 indexed paymentId, address indexed payer, address indexed payee, uint256 amount, uint256 productId, bytes32 memo, uint256 fee)",
  "event AllowanceGranted(address indexed owner, address indexed agent, uint256 budget, uint256 maxPerPayment, uint64 expiresAt, uint32 grantId)",
]);

export interface PaymentEvent {
  paymentId: bigint;
  payer: Address;
  payee: Address;
  amount: bigint;
  productId: bigint;
  memo: Hex;
  fee: bigint;
  blockNumber: bigint;
  txHash: Hex;
  logIndex: number;
}

interface Grant {
  owner: Address;
  agent: Address;
  blockNumber: bigint;
}

let cursor = START_BLOCK - 1n; // last block fully indexed
const payments: PaymentEvent[] = [];
const grants: Grant[] = [];
const seen = new Set<string>();
let ready: Promise<void> | null = null;
let syncing: Promise<void> | null = null;
let lastSync = 0;

// ---------------- persistence ----------------

function load() {
  if (!existsSync(FILE)) return;
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8"));
    if (raw.chainId !== CHAIN_ID || String(raw.contract).toLowerCase() !== AEVUMPAY_ADDRESS.toLowerCase()) return;
    cursor = BigInt(raw.cursor);
    for (const p of raw.payments ?? [])
      add({ ...p, paymentId: BigInt(p.paymentId), amount: BigInt(p.amount), productId: BigInt(p.productId), fee: BigInt(p.fee), blockNumber: BigInt(p.blockNumber) });
    for (const g of raw.grants ?? []) addGrant({ ...g, blockNumber: BigInt(g.blockNumber) });
    console.log(`[index] loaded ${payments.length} payments, ${grants.length} allowance grants up to block ${cursor}`);
  } catch (e) {
    console.warn(`[index] could not read ${FILE}, rebuilding:`, (e as Error).message);
  }
}

function save() {
  const big = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
  mkdirSync(dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ chainId: CHAIN_ID, contract: AEVUMPAY_ADDRESS, cursor, payments, grants }, big));
  renameSync(tmp, FILE);
}

// ---------------- ingest ----------------

function key(txHash: string, logIndex: number) {
  return `${txHash}:${logIndex}`;
}

function add(p: PaymentEvent) {
  const k = key(p.txHash, p.logIndex);
  if (seen.has(k)) return;
  seen.add(k);
  payments.push(p);
}

function addGrant(g: Grant) {
  grants.push(g);
}

function ingest(logs: Log[]) {
  for (const l of logs) {
    try {
      const d = decodeEventLog({ abi: events, data: l.data, topics: l.topics });
      if (d.eventName === "Paid") {
        add({
          ...(d.args as Omit<PaymentEvent, "blockNumber" | "txHash" | "logIndex">),
          blockNumber: l.blockNumber ?? 0n,
          txHash: l.transactionHash ?? ("0x" as Hex),
          logIndex: l.logIndex ?? 0,
        });
      } else if (d.eventName === "AllowanceGranted") {
        const k = key(l.transactionHash ?? "", l.logIndex ?? 0);
        if (seen.has(k)) continue;
        seen.add(k);
        addGrant({ owner: d.args.owner, agent: d.args.agent, blockNumber: l.blockNumber ?? 0n });
      }
    } catch {
      // Another AevumPay event (Registered, Subscribed…): not indexed here.
    }
  }
}

async function logsBetween(from: bigint, to: bigint): Promise<Log[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await publicClient.getLogs({ address: AEVUMPAY_ADDRESS, fromBlock: from, toBlock: to });
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

/** Index every block from `cursor + 1` to `latest`, `BACKFILL_CONCURRENCY` chunks at a time. */
async function catchUp(latest: bigint) {
  if (latest <= cursor) return;
  const ranges: [bigint, bigint][] = [];
  for (let from = cursor + 1n; from <= latest; from += LOG_CHUNK + 1n) {
    ranges.push([from, from + LOG_CHUNK > latest ? latest : from + LOG_CHUNK]);
  }
  // Ranges complete out of order; the cursor only advances past a contiguous finished prefix.
  const done = new Array<boolean>(ranges.length).fill(false);
  let next = 0;
  let prefix = 0;
  const worker = async () => {
    while (next < ranges.length) {
      const i = next++;
      const [from, to] = ranges[i]!;
      ingest(await logsBetween(from, to));
      done[i] = true;
      while (prefix < ranges.length && done[prefix]) cursor = ranges[prefix++]![1];
    }
  };
  await Promise.all(Array.from({ length: Math.min(BACKFILL_CONCURRENCY, ranges.length) }, worker));
  payments.sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1));
  save();
}

/** Bring the index up to the chain head (shared by concurrent callers). */
function sync(): Promise<void> {
  if (!syncing) {
    syncing = (async () => {
      try {
        await catchUp(await publicClient.getBlockNumber());
        lastSync = Date.now();
      } finally {
        syncing = null;
      }
    })();
  }
  return syncing;
}

/** Load the saved index, backfill to the head in the background, then follow new blocks. */
export function startIndexer() {
  load();
  const t0 = Date.now();
  ready = sync().then(
    () => console.log(`[index] ready at block ${cursor}: ${payments.length} payments, ${grants.length} grants (${Date.now() - t0} ms)`),
    (e) => console.warn("[index] backfill failed, will retry:", (e as Error).message.split("\n")[0]),
  );
  setInterval(() => {
    sync().catch((e) => console.warn("[index] follow failed:", (e as Error).message.split("\n")[0]));
  }, FOLLOW_MS).unref();
}

/**
 * Wait until the index is usable and close to the head. A request right after a payment should
 * see it, so if the last sync is more than a second old we catch up first (usually 1–2 calls).
 */
async function fresh() {
  if (!ready) startIndexer();
  await ready;
  if (Date.now() - lastSync > 1_000) await sync().catch(() => {});
}

// ---------------- queries ----------------

/** Every `Paid` event where `user` is payer or payee, newest first. */
export async function paymentsFor(user: Address, maxResults = 100): Promise<PaymentEvent[]> {
  await fresh();
  const u = user.toLowerCase();
  const out: PaymentEvent[] = [];
  for (const p of payments) {
    if (p.payer.toLowerCase() === u || p.payee.toLowerCase() === u) out.push(p);
    if (out.length >= maxResults) break;
  }
  return out;
}

/** Every agent `owner` has ever granted an allowance to (live state is read separately). */
export async function agentsGrantedBy(owner: Address): Promise<Address[]> {
  await fresh();
  const o = owner.toLowerCase();
  return [...new Set(grants.filter((g) => g.owner.toLowerCase() === o).map((g) => g.agent))];
}
