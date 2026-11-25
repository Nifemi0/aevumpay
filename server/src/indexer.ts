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
const FOLLOW_MS = 2_000;
const START_BLOCK = process.env.AEVUMPAY_DEPLOY_BLOCK ? BigInt(process.env.AEVUMPAY_DEPLOY_BLOCK) : 0n;
const FILE = join(dirname(DB_PATH), "index.json");

// Every AevumPay event, so any change can be noticed and pushed (see onChainEvent).
const events = parseAbi([
  "event Registered(string username, address indexed wallet)",
  "event UsernameChanged(string oldUsername, string newUsername, address indexed wallet)",
  "event StoreCreated(address indexed merchant, string name)",
  "event StoreUpdated(address indexed merchant, string name, bool active)",
  "event ProductAdded(uint256 indexed productId, address indexed merchant, string name, uint256 price)",
  "event ProductUpdated(uint256 indexed productId, bool active)",
  "event Paid(uint256 indexed paymentId, address indexed payer, address indexed payee, uint256 amount, uint256 productId, bytes32 memo, uint256 fee)",
  "event AllowanceGranted(address indexed owner, address indexed agent, uint256 budget, uint256 maxPerPayment, uint64 expiresAt, uint32 grantId)",
  "event AllowanceRevoked(address indexed owner, address indexed agent)",
  "event AgentPaid(uint256 indexed paymentId, address indexed agent, address indexed owner)",
  "event PlanCreated(uint256 indexed planId, address indexed merchant, string name, uint256 amount, uint64 period)",
  "event PlanUpdated(uint256 indexed planId, bool active)",
  "event Subscribed(uint256 indexed subscriptionId, uint256 indexed planId, address indexed subscriber)",
  "event SubscriptionCharged(uint256 indexed subscriptionId, uint256 indexed paymentId, uint64 nextDue)",
  "event CollectionFailed(uint256 indexed subscriptionId, uint64 dueAt)",
  "event SubscriptionEnded(uint256 indexed subscriptionId, uint8 status)",
]);

/** A new AevumPay event, seen after the backfill (i.e. something that just happened). */
export interface ChainEvent {
  name: string;
  args: Record<string, unknown>;
  /** Every address in the event's arguments, lowercase. */
  addresses: string[];
  txHash: Hex;
  blockNumber: bigint;
}
const listeners: ((e: ChainEvent) => void)[] = [];
let live = false; // false during the backfill: old events are not news

/** Call `fn` for every AevumPay event from now on. */
export function onChainEvent(fn: (e: ChainEvent) => void) {
  listeners.push(fn);
}

function emit(e: ChainEvent) {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch (err) {
      console.warn("[index] listener failed:", (err as Error).message);
    }
  }
}

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
  txHash?: Hex;
  logIndex?: number;
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

// Loading from disk: the saved events are already de-duplicated.
function add(p: PaymentEvent) {
  seen.add(key(p.txHash, p.logIndex));
  payments.push(p);
}

function addGrant(g: Grant & { txHash?: string; logIndex?: number }) {
  if (g.txHash) seen.add(key(g.txHash, g.logIndex ?? 0));
  grants.push(g);
}

function ingest(logs: Log[]) {
  for (const l of logs) {
    // A range can be fetched twice (a retry after a failed catch-up): each event counts once.
    const k = key(l.transactionHash ?? "", l.logIndex ?? 0);
    if (seen.has(k)) continue;
    let d;
    try {
      d = decodeEventLog({ abi: events, data: l.data, topics: l.topics });
    } catch {
      continue; // not an event we know (shouldn't happen for this contract)
    }
    seen.add(k);
    const txHash = l.transactionHash ?? ("0x" as Hex);
    const blockNumber = l.blockNumber ?? 0n;
    if (d.eventName === "Paid") {
      payments.push({ ...(d.args as Omit<PaymentEvent, "blockNumber" | "txHash" | "logIndex">), blockNumber, txHash, logIndex: l.logIndex ?? 0 });
    } else if (d.eventName === "AllowanceGranted") {
      grants.push({ owner: d.args.owner, agent: d.args.agent, blockNumber, txHash, logIndex: l.logIndex ?? 0 });
    }
    if (live) {
      const args = (d.args ?? {}) as Record<string, unknown>;
      const addresses = Object.values(args)
        .filter((v): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v))
        .map((a) => a.toLowerCase());
      emit({ name: d.eventName, args, addresses, txHash, blockNumber });
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
        live = true; // the first complete catch-up was the backfill; from here on, events are news
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

/** Look for new events now (after this server relays a transaction), instead of on the next tick. */
export function syncNow() {
  sync().catch(() => {});
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
