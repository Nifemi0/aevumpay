/**
 * Contract v2 features on the server: reads for agent allowances, subscription plans and
 * subscriptions; relaying agent payments; and the optional subscription collector.
 *
 * None of this gives the server authority over money. Allowance limits and subscription terms are
 * enforced by AevumPay.sol; the server only reads them, pays gas, and presses "collect" when a
 * charge is due (which anyone else may also do).
 */
import { BaseError, ContractFunctionRevertedError, formatUnits, recoverTypedDataAddress, zeroAddress } from "viem";
import type { Address, Hex } from "viem";
import { AEVUMPAY_ADDRESS, CHAIN_ID, TUSD8_ADDRESS } from "./config";
import { chargeRelayTx } from "./budget";
import { aevumPayAbi, erc20Abi } from "./abi";
import { explorerTx, publicClient, relayer, relayPaymentNow, relayerWallet, usernameFor, withRelayer } from "./chain";
import { agentsGrantedBy } from "./indexer";

/** Read ids 1..next-1 with `read`, a few at a time (the RPC is slow, so in sequence it adds up). */
export async function readAll<T>(next: number, cap: number, read: (id: number) => Promise<T>): Promise<[number, T][]> {
  const ids = Array.from({ length: Math.max(0, Math.min(next, cap) - 1) }, (_, i) => i + 1);
  const out: [number, T][] = [];
  for (let i = 0; i < ids.length; i += 12) {
    const batch = ids.slice(i, i + 12);
    out.push(...(await Promise.all(batch.map(async (id) => [id, await read(id)] as [number, T]))));
  }
  return out;
}

const SUB_STATUS = ["none", "active", "cancelled", "lapsed", "completed"] as const;
/** Mirrors AevumPay.GRACE_PERIOD (3 days); the contract uses min(this, period). */
const GRACE_SECONDS = 3n * 24n * 3600n;
const usd = (x: bigint) => formatUnits(x, 6);

/**
 * Turn a revert into a rule name, e.g. "OverBudget". The token's own refusals come back as a plain
 * `Error(string)` revert; those are named from their reason, so a payment the owner can't cover
 * says `InsufficientBalance` (or `InsufficientApproval`) instead of a bare "Error".
 */
export function revertName(e: unknown): string | null {
  if (e instanceof BaseError) {
    const r = e.walk((err) => err instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) {
      const name = r.data?.errorName;
      if (name && name !== "Error" && name !== "Panic") return name;
      return ruleFromReason(`${r.reason ?? ""} ${String(r.data?.args?.[0] ?? "")} ${e.message}`) ?? name ?? r.reason ?? null;
    }
    return ruleFromReason(e.message);
  }
  return null;
}

/** Name the token's text refusals (ERC-20 / FiatToken style messages and OpenZeppelin 5 errors). */
export function ruleFromReason(text: string): string | null {
  if (/exceeds balance|insufficient balance|ERC20InsufficientBalance/i.test(text)) return "InsufficientBalance";
  if (/exceeds allowance|insufficient allowance|ERC20InsufficientAllowance/i.test(text)) return "InsufficientApproval";
  return null;
}

// ---------------- token approval ----------------

/** How much AevumPay may currently draw from `owner` (shared by all allowances and subscriptions). */
export async function approvalOf(owner: Address): Promise<bigint> {
  return publicClient.readContract({ address: TUSD8_ADDRESS, abi: erc20Abi, functionName: "allowance", args: [owner, AEVUMPAY_ADDRESS] });
}

// ---------------- agent allowances ----------------

interface AllowanceState {
  owner: Address;
  expiresAt: bigint;
  active: boolean;
  payeesRestricted: boolean;
  grantId: number;
  budget: bigint;
  spent: bigint;
  maxPerPayment: bigint;
}

export async function allowanceOf(agent: Address): Promise<AllowanceState> {
  return (await publicClient.readContract({
    address: AEVUMPAY_ADDRESS,
    abi: aevumPayAbi,
    functionName: "getAllowance",
    args: [agent],
  })) as unknown as AllowanceState;
}

function allowanceView(agent: Address, a: AllowanceState) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const status = !a.active ? "revoked" : a.expiresAt <= now ? "expired" : "active";
  return {
    agent,
    owner: a.owner,
    status,
    budget: usd(a.budget),
    spent: usd(a.spent),
    remaining: usd(a.budget > a.spent ? a.budget - a.spent : 0n),
    maxPerPayment: usd(a.maxPerPayment),
    expiresAt: Number(a.expiresAt),
    payeesRestricted: a.payeesRestricted,
  };
}

/** Every agent `owner` has granted an allowance to (from AllowanceGranted logs), with its live state. */
export async function allowancesGrantedBy(owner: Address) {
  const agents = await agentsGrantedBy(owner);
  const states = await Promise.all(agents.map(async (agent) => [agent, await allowanceOf(agent)] as const));
  const out = [];
  for (const [agent, a] of states) {
    // The same agent key may since have been re-granted by someone else; skip it if so.
    if (a.owner.toLowerCase() !== owner.toLowerCase()) continue;
    out.push(allowanceView(agent, a));
  }
  return out.sort((x, y) => (x.status === y.status ? y.expiresAt - x.expiresAt : x.status === "active" ? -1 : 1));
}

/** Public view of one agent's allowance: what an agent checks before trying to pay. */
export async function agentInfo(agent: Address) {
  const a = await allowanceOf(agent);
  if (a.owner === zeroAddress) return null;
  // What the owner's wallet can actually cover right now, so an agent knows before it signs:
  // the allowance's remaining budget, the wallet's tUSD8 balance and its approval for AevumPay.
  const [ownerUsername, balance, approval] = await Promise.all([
    usernameFor(a.owner),
    publicClient.readContract({ address: TUSD8_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [a.owner] }),
    approvalOf(a.owner),
  ]);
  const view = allowanceView(agent, a);
  const remaining = a.budget > a.spent ? a.budget - a.spent : 0n;
  const limits = [remaining, balance, approval, a.maxPerPayment];
  const spendable = view.status === "active" ? limits.reduce((m, x) => (x < m ? x : m)) : 0n;
  return {
    ...view,
    ownerUsername: ownerUsername || null,
    ownerBalance: usd(balance),
    ownerApproval: usd(approval),
    /** The largest single payment that would go through right now (0 if none). */
    spendableNow: usd(spendable),
  };
}

export interface AgentPaymentInput {
  payee: Address;
  productId: bigint;
  amount: bigint;
  memo: Hex;
  nonce: Hex;
  deadline: bigint;
}

/**
 * Relay an agent-signed payment. We simulate first so a payment the contract would refuse
 * (over budget, expired, revoked…) costs nothing and returns the rule's name.
 */
export async function relayAgentPayment(p: AgentPaymentInput, signature: Hex) {
  try {
    await publicClient.simulateContract({
      account: relayer(),
      address: AEVUMPAY_ADDRESS,
      abi: aevumPayAbi,
      functionName: "agentPay",
      args: [p, signature],
    });
  } catch (e) {
    throw new Error(`AGENT_REFUSED:${revertName(e) ?? "rejected"}`);
  }
  // Charge the agent key (the simulation proved it signed a valid payment) against the daily budget.
  const agent = await recoverTypedDataAddress({
    domain: { name: "AevumPay", version: "2", chainId: CHAIN_ID, verifyingContract: AEVUMPAY_ADDRESS },
    types: {
      AgentPayment: [
        { name: "payee", type: "address" },
        { name: "productId", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "memo", type: "bytes32" },
        { name: "nonce", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "AgentPayment",
    message: p,
    signature,
  });
  chargeRelayTx(agent);
  return withRelayer(() => relayPaymentNow("agentPay", [p, signature]));
}

// ---------------- subscription plans ----------------

interface PlanState {
  merchant: Address;
  amount: bigint;
  period: bigint;
  active: boolean;
  name: string;
}

async function nextId(fn: "nextPlanId" | "nextSubscriptionId"): Promise<number> {
  return Number(await publicClient.readContract({ address: AEVUMPAY_ADDRESS, abi: aevumPayAbi, functionName: fn }));
}

async function plan(id: number): Promise<PlanState> {
  return (await publicClient.readContract({
    address: AEVUMPAY_ADDRESS,
    abi: aevumPayAbi,
    functionName: "getPlan",
    args: [BigInt(id)],
  })) as unknown as PlanState;
}

const planView = (id: number, p: PlanState) => ({
  id,
  merchant: p.merchant,
  name: p.name,
  amount: usd(p.amount),
  period: Number(p.period),
  active: p.active,
});

export async function plansOf(merchant: Address) {
  const next = await nextId("nextPlanId");
  const all = await readAll(next, 1000, plan);
  return all.filter(([, p]) => p.merchant.toLowerCase() === merchant.toLowerCase()).map(([i, p]) => planView(i, p));
}

export async function planById(id: number) {
  const p = await plan(id);
  if (p.merchant === zeroAddress) return null;
  return { ...planView(id, p), merchantUsername: (await usernameFor(p.merchant)) || null };
}

// ---------------- subscriptions ----------------

interface SubState {
  subscriber: Address;
  merchant: Address;
  amount: bigint;
  period: bigint;
  nextDue: bigint;
  pastDueSince: bigint;
  paidCount: number;
  maxPayments: number;
  status: number;
  planId: bigint;
}

async function subscription(id: number): Promise<SubState> {
  return (await publicClient.readContract({
    address: AEVUMPAY_ADDRESS,
    abi: aevumPayAbi,
    functionName: "getSubscription",
    args: [BigInt(id)],
  })) as unknown as SubState;
}

/** Every subscription where `who` is the subscriber or the merchant. */
export async function subscriptionsOf(who: Address) {
  const next = await nextId("nextSubscriptionId");
  const me = who.toLowerCase();
  const names = new Map<string, string>();
  const nameOf = async (a: Address) => {
    if (!names.has(a)) names.set(a, (await usernameFor(a)) || "");
    return names.get(a) || null;
  };
  const planNames = new Map<string, string>();
  const asSubscriber = [];
  const asMerchant = [];
  const now = Math.floor(Date.now() / 1000);
  for (const [i, s] of await readAll(next, 5000, subscription)) {
    const mine = s.subscriber.toLowerCase() === me;
    const theirs = s.merchant.toLowerCase() === me;
    if (!mine && !theirs) continue;
    const pid = s.planId.toString();
    if (!planNames.has(pid)) planNames.set(pid, (await plan(Number(s.planId))).name);
    const status = SUB_STATUS[s.status] ?? "none";
    const view = {
      id: i,
      planId: Number(s.planId),
      planName: planNames.get(pid)!,
      subscriber: s.subscriber,
      subscriberUsername: await nameOf(s.subscriber),
      merchant: s.merchant,
      merchantUsername: await nameOf(s.merchant),
      amount: usd(s.amount),
      period: Number(s.period),
      nextDue: Number(s.nextDue),
      paidCount: s.paidCount,
      maxPayments: s.maxPayments,
      status,
      pastDue: status === "active" && Number(s.pastDueSince) > 0,
      due: status === "active" && Number(s.nextDue) <= now,
    };
    if (mine) asSubscriber.push(view);
    if (theirs) asMerchant.push(view);
  }
  return { asSubscriber, asMerchant };
}

// ---------------- the collector ----------------

/**
 * Press "collect" on every active subscription that is due. A convenience, not an authority:
 * the contract decides the amount, payee and timing, and anyone else may call collect too.
 * Returns how many charges went through and how many failed softly (balance or approval short).
 */
export async function collectDue(): Promise<{ checked: number; charged: number; failed: number }> {
  const next = await nextId("nextSubscriptionId");
  // Our clock and the chain's can disagree (a local chain that was fast-forwarded, a slow block
  // producer), and only the chain's counts. So anything due within the next 10 minutes is a
  // candidate, and a simulated collect() decides: it reverts with NotDue if it isn't due yet.
  const now = BigInt(Math.floor(Date.now() / 1000));
  const block = await publicClient.getBlock();
  const horizon = (block.timestamp > now ? block.timestamp : now) + 600n;
  let checked = 0;
  let charged = 0;
  let failed = 0;
  for (let i = 1; i < next && i < 5000; i++) {
    const s = await subscription(i);
    if (s.status !== 1 || s.nextDue > horizon) continue;
    // Already marked past due and still can't be covered: don't spend gas retrying every round.
    // Send again only once they've topped up (to charge) or the grace period is over (to lapse it).
    if (s.pastDueSince > 0n) {
      const [bal, approved] = await Promise.all([
        publicClient.readContract({ address: TUSD8_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [s.subscriber] }),
        approvalOf(s.subscriber),
      ]);
      const covered = bal >= s.amount && approved >= s.amount;
      const grace = s.period < GRACE_SECONDS ? s.period : GRACE_SECONDS;
      const graceOver = horizon - 600n >= s.nextDue + grace;
      if (!covered && !graceOver) continue;
    }
    try {
      const { result } = await publicClient.simulateContract({
        account: relayer(),
        address: AEVUMPAY_ADDRESS,
        abi: aevumPayAbi,
        functionName: "collect",
        args: [BigInt(i)],
      });
      checked++;
      chargeRelayTx("collector");
      await withRelayer(async () => {
        const hash = await relayerWallet().writeContract({
          address: AEVUMPAY_ADDRESS,
          abi: aevumPayAbi,
          functionName: "collect",
          args: [BigInt(i)],
        } as never);
        await publicClient.waitForTransactionReceipt({ hash });
        console.log(`[collector] subscription #${i}: ${result ? "charged" : "could not be covered"} ${explorerTx(hash) || hash}`);
      });
      if (result) charged++;
      else failed++;
    } catch (e) {
      const rule = revertName(e);
      // Not due yet on the chain's clock, or already collected by someone else: nothing to do.
      if (rule === "NotDue" || rule === "SubscriptionNotActive") continue;
      console.warn(`[collector] subscription #${i}: ${rule ?? (e as Error).message.split("\n")[0]}`);
    }
  }
  return { checked, charged, failed };
}

export function startCollector(intervalMs: number) {
  if (intervalMs <= 0) {
    console.log("[collector] off (COLLECTOR_INTERVAL_MS=0). Merchants can still collect from their dashboard.");
    return;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await collectDue();
      if (r.checked) console.log(`[collector] due ${r.checked}, charged ${r.charged}, short ${r.failed}`);
    } catch (e) {
      console.warn("[collector] round failed:", (e as Error).message.split("\n")[0]);
    } finally {
      running = false;
    }
  };
  setInterval(tick, intervalMs).unref();
  console.log(`[collector] checking for due subscriptions every ${Math.round(intervalMs / 1000)}s`);
}
