import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { formatUnits, isAddress, isHex, parseUnits, toFunctionSelector, zeroAddress } from "viem";
import type { Address, Hex } from "viem";
import { AEVUMPAY_ADDRESS, CHAIN_ID, DB_PATH, PORT, TUSD8_ADDRESS } from "./config";
import { addUser, createSession, findUserByUsername, loadDb, userForToken, type User } from "./db";
import { hashPassword, isWalletBlob, newId, verifyPassword } from "./crypto";
import {
  balanceOf,
  broadcastUserTx,
  chain,
  devMint,
  explorerTx,

  feeFor,
  inspectUserTx,
  memoHash,
  paymentNonce,
  nextProductId,
  publicClient,
  relayProductPayment,
  relayUsernamePayment,
  resolveUsername,
  txParams,
  usernameFor,
  verifyAuthorization,
  type SignedAuthorization,
} from "./chain";
import { aevumPayAbi } from "./abi";
import { RelayerBudgetError } from "./budget";
import {
  agentInfo,
  allowancesGrantedBy,
  approvalOf,
  planById,
  plansOf,
  readAll,
  relayAgentPayment,
  startCollector,
  subscriptionsOf,
} from "./features";
import { claimGrant, grantStatus, grantWallet, GrantError } from "./grant";
import { paymentsFor, startIndexer } from "./indexer";

loadDb(DB_PATH);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "16kb" }));

// --- CORS: allowlist from CORS_ORIGIN (comma-separated); "*" only for dev ---
const allowedOrigins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- Rate limiting (in-memory; swap to a Redis store for multi-instance) ---
const limiter = (max: number, windowMs = 60_000) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "too many requests, slow down" },
  });
const globalLimiter = limiter(120);
const authLimiter = limiter(8); // 8 auth calls / min / IP
const payLimiter = limiter(30); // 30 sends / min / IP
app.use(globalLimiter);

// --- Login brute-force lockout (per username; in-memory) ---
const failedLogins = new Map<string, { count: number; first: number; until: number }>();
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;
function isLockedOut(username: string): boolean {
  const e = failedLogins.get(username);
  if (!e) return false;
  if (e.until > Date.now()) return true;
  if (e.until && e.until <= Date.now()) failedLogins.delete(username);
  return false;
}
function recordFailedLogin(username: string): void {
  const now = Date.now();
  const e = failedLogins.get(username);
  if (!e || now - e.first > FAIL_WINDOW_MS) {
    failedLogins.set(username, { count: 1, first: now, until: 0 });
    return;
  }
  e.count++;
  if (e.count >= MAX_FAILS) e.until = now + LOCK_MS;
}

const norm = (u: string) => u.trim().toLowerCase().replace(/[^a-z0-9_.]/g, "");

function publicUser(u: User) {
  return { id: u.id, username: u.username, role: u.role, address: u.address };
}

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const user = token ? userForToken(token) : undefined;
  if (!user) return res.status(401).json({ error: "unauthorized" });
  (req as unknown as { user: User }).user = user;
  next();
}

const me = (req: express.Request) => (req as unknown as { user: User }).user;

// ============================ routes ============================
//
// Custody model: wallet keys are created, encrypted and used only in the browser. This server
// stores an encrypted copy it cannot open, checks the signatures the browser sends, and relays
// them (paying gas). It never signs anything for a user.

/** The web app's public URL, so agents that land on the API can find the plain-text guides. */
const APP_URL = (process.env.APP_URL || "").replace(/\/+$/, "");

// llms.txt convention: AI tools look for it at the root of any host, including this API.
app.get(["/llms.txt", "/llms-full.txt"], (req, res) => {
  if (!APP_URL) return res.status(404).json({ error: "set APP_URL to link the agent guide" });
  res.redirect(302, APP_URL + req.path);
});

app.get("/", (_req, res) => {
  res.json({
    name: "AevumPay API",
    about: "Stablecoin payments by @username on QDay Aevum testnet. AI agents: read the guide before paying.",
    ...(APP_URL ? { agentGuide: `${APP_URL}/llms-full.txt`, llmsTxt: `${APP_URL}/llms.txt`, app: APP_URL } : {}),
    chainId: chain.id,
    contract: AEVUMPAY_ADDRESS,
    endpoints: [
      "GET  /config",
      "GET  /tx/params?address=0x…",
      "POST /auth/register { username, role, authKey, address, wallet, registerTx }",
      "POST /auth/login { username, authKey }",
      "GET  /auth/me",
      "GET  /users/:username",
      "GET  /wallet/balance",
      "POST /payments/send { to, amount, memo, authorization }",
      "POST /payments/product { productId, memo, authorization }",
      "GET  /payments/:id",
      "GET  /activity",
      "POST /tx/send { rawTx }",
      "GET  /stores/:owner",
      "GET  /wallet/approval",
      "GET  /allowances",
      "GET  /agents/:address",
      "POST /agent/pay { payment, signature }",
      "GET  /plans/:owner",
      "GET  /plan/:id",
      "GET  /subscriptions",
      "GET  /grant",
      "POST /grant",
    ],
  });
});

app.get("/health", (_req, res) => res.json({ ok: true, chainId: chain.id }));

/** Everything the browser needs to build signatures for this deployment. */
app.get("/config", (_req, res) => {
  res.json({ chainId: CHAIN_ID, aevumPay: AEVUMPAY_ADDRESS, tusd8: TUSD8_ADDRESS, hasExplorer: CHAIN_ID === 44005 });
});

/** Nonce and gas price for a browser to sign a transaction from `address`. Read-only. */
app.get("/tx/params", async (req, res) => {
  const address = String(req.query.address ?? "");
  const to = req.query.to ? String(req.query.to) : undefined;
  const data = req.query.data ? String(req.query.data) : undefined;
  if (!isAddress(address)) return res.status(400).json({ error: "valid address required" });
  if ((to || data) && !(to && isAddress(to) && data && isHex(data))) return res.status(400).json({ error: "to and data must both be valid" });
  try {
    const p = await txParams(address, to && data ? { to: to as Address, data: data as Hex } : undefined);
    res.json({ chainId: p.chainId, nonce: p.nonce, gasPrice: p.gasPrice.toString(), gas: p.gas?.toString() ?? null });
  } catch (e) {
    // A failed estimate means the call would revert: say which rule stopped it instead of a 500.
    sendError(res, e, "estimate");
  }
});

/** Contract error selectors → names, so a refused call can say which rule stopped it. */
const ERROR_NAMES = aevumPayAbi.filter((x) => x.type === "error").map((x) => x.name);
const ERROR_SELECTORS = new Map(ERROR_NAMES.map((name) => [toFunctionSelector(`${name}()`), name] as const));

/**
 * Find the contract rule in a node/viem error message. viem reports a custom error either by name
 * ('reverted with the following reason: UsernameTooShort()' / 'Error: UsernameTooShort()') or, when
 * it can't decode it, by its 4-byte selector. Try both.
 */
function ruleFromRevert(msg: string): string | null {
  for (const name of ERROR_NAMES) if (new RegExp(`\\b${name}\\(`).test(msg)) return name;
  for (const m of msg.matchAll(/0x[0-9a-fA-F]{8}(?![0-9a-fA-F])/g)) {
    const name = ERROR_SELECTORS.get(m[0].toLowerCase() as Hex);
    if (name) return name;
  }
  return null;
}

/**
 * Problems that aren't AevumPay rules: the token's own checks, the node, the network. Matched on the
 * message text, first match wins. `code` goes to the client so it can word things its own way.
 */
const OTHER_ERRORS: { test: RegExp; status: number; code: string; error: string }[] = [
  { test: /exceeds balance|insufficient balance|ERC20InsufficientBalance/i, status: 400, code: "InsufficientBalance", error: "not enough tUSD8 for this" },
  { test: /authorization is (used|canceled)|nonce (already )?used/i, status: 409, code: "AuthorizationUsed", error: "this payment was already sent" },
  { test: /authorization is (not yet valid|expired)/i, status: 400, code: "AuthorizationExpired", error: "this payment request expired; try again" },
  { test: /invalid signature|signature is invalid/i, status: 400, code: "BadSignature", error: "the signature didn't check out; try again" },
  { test: /insufficient funds for (gas|intrinsic)/i, status: 503, code: "RelayerOutOfGas", error: "our gas wallet is running low; try again in a little while" },
  { test: /nonce too low|replacement transaction underpriced|already known/i, status: 409, code: "Busy", error: "another transaction was in flight; try again" },
  { test: /fetch failed|timed? ?out|ECONNRESET|ENOTFOUND|socket hang up|HTTP request failed/i, status: 503, code: "NetworkBusy", error: "the Aevum network didn't answer; try again in a moment" },
];

/**
 * One place that turns any failure into an answer the app can show: which contract rule refused it
 * (`rule`), or what else went wrong (`code`), in plain words (`error`). Raw node messages are logged
 * here and never sent to the browser.
 */
function sendError(res: express.Response, e: unknown, what: string) {
  if (e instanceof RelayerBudgetError) return res.status(429).json({ error: e.message, code: "DailyLimit" });
  const msg = (e as Error)?.message ?? String(e);
  if (msg.startsWith("BAD_TX")) return res.status(400).json({ error: msg.replace(/^BAD_TX: /, ""), code: "BadTransaction" });
  const rule = ruleFromRevert(msg);
  if (rule) return res.status(400).json({ error: RULE_TEXT[rule] ?? "the contract refused this", rule });
  for (const o of OTHER_ERRORS) if (o.test.test(msg)) return res.status(o.status).json({ error: o.error, code: o.code });
  if (msg === "TX_REVERTED" || /revert|execution/i.test(msg)) {
    console.error(`[${what}] refused without a known rule:`, msg.split(/\r?\n/)[0]);
    return res.status(400).json({ error: "the contract refused this", code: "Reverted" });
  }
  console.error(`[${what}] failed:`, msg.split(/\r?\n/)[0]);
  return res.status(500).json({ error: "something went wrong on our side", code: "ServerError" });
}
const RULE_TEXT: Record<string, string> = {
  AgentInUse: "this agent is already connected to another AevumPay account",
  BadAgent: "that agent address can't be used",
  BadAllowance: "check the limits: the per-payment limit must be at most the budget, and the end date in the future",
  NotAllowanceOwner: "only the account that connected this agent can revoke it",
  AllowanceInactive: "this agent was already revoked",
  NoStore: "open a store first",
  StoreExists: "you already have a store",
  StoreInactive: "your store is paused",
  NotStoreOwner: "only the store owner can do that",
  PeriodTooShort: "the billing period must be at least a minute",
  PlanInactive: "this plan isn't taking new subscribers",
  PlanNotFound: "plan not found",
  NotDue: "nothing is due yet",
  SubscriptionNotActive: "this subscription has already ended",
  NotSubscriptionParty: "only the subscriber or the store can cancel this",
  SelfPayment: "you can't pay yourself",
  UsernameTaken: "that username is taken",
  UsernameTooShort: "usernames need at least 3 characters",
  UsernameTooLong: "usernames can be at most 24 characters",
  AlreadyRegistered: "this wallet already has a username",
  NotRegistered: "this wallet doesn't have a username yet",
  UnknownUser: "no one has that username yet",
  ZeroAmount: "the amount must be more than $0",
  ZeroAddress: "that address can't be used",
  ProductNotFound: "product not found",
  ProductInactive: "this product isn't for sale right now",
  AllowanceExpired: "this agent's permission has expired",
  OverPerPaymentLimit: "that's above this agent's limit per payment",
  OverBudget: "that's more than this agent has left in its budget",
  PayeeNotAllowed: "this agent isn't allowed to pay that account",
};

// ---- auth ----

const AUTH_KEY = /^[0-9a-f]{64}$/;

function txError(res: express.Response, e: unknown) {
  return sendError(res, e, "tx");
}

/**
 * Create an account. The browser has already made the wallet: it sends the address, its key
 * encrypted with a password-derived key we never see, and a signed `register(username)` tx.
 * We check the tx is exactly that, top up gas, broadcast it, and only then save the account.
 */
app.post("/auth/register", authLimiter, async (req, res) => {
  try {
    const username = norm(String(req.body?.username ?? ""));
    const role = req.body?.role === "business" ? "business" : "personal";
    const authKey = String(req.body?.authKey ?? "");
    const address = String(req.body?.address ?? "");
    const wallet = req.body?.wallet;
    const registerTx = String(req.body?.registerTx ?? "");

    if (username.length < 3 || username.length > 24) {
      return res.status(400).json({ error: "username must be 3-24 chars (a-z, 0-9, _, .)" });
    }
    if (!AUTH_KEY.test(authKey)) return res.status(400).json({ error: "invalid auth key" });
    if (!isAddress(address)) return res.status(400).json({ error: "invalid wallet address" });
    if (!isWalletBlob(wallet)) return res.status(400).json({ error: "invalid encrypted wallet" });
    if (!isHex(registerTx)) return res.status(400).json({ error: "signed register transaction required" });
    if (findUserByUsername(username)) return res.status(409).json({ error: "username already used" });
    if ((await resolveUsername(username)) !== zeroAddress) return res.status(409).json({ error: "username already used" });

    const tx = await inspectUserTx(registerTx as Hex, address as Address);
    if (tx.functionName !== "register" || tx.args[0] !== username) {
      return res.status(400).json({ error: "transaction rejected: must register this username" });
    }
    await broadcastUserTx(registerTx as Hex, address as Address);

    const pw = hashPassword(authKey);
    const user: User = { id: newId(), username, role, address, salt: pw.salt, hash: pw.hash, wallet, createdAt: Date.now() };
    addUser(user);
    const token = createSession(user.id);
    res.json({ token, user: publicUser(user), wallet });
  } catch (e) {
    return txError(res, e);
  }
});

app.post("/auth/login", authLimiter, (req, res) => {
  const username = norm(String(req.body?.username ?? ""));
  const authKey = String(req.body?.authKey ?? "");
  if (isLockedOut(username)) {
    return res.status(429).json({ error: "too many failed attempts; try again in 15 minutes" });
  }
  const user = findUserByUsername(username);
  if (!user || !AUTH_KEY.test(authKey) || !verifyPassword(authKey, user.salt, user.hash)) {
    recordFailedLogin(username);
    return res.status(401).json({ error: "invalid credentials" });
  }
  if (!user.wallet) {
    return res.status(410).json({ error: "legacy account" });
  }
  failedLogins.delete(username);
  const token = createSession(user.id);
  res.json({ token, user: publicUser(user), wallet: user.wallet });
});

/** The encrypted wallet comes back so a browser without the key can unlock it with the password. */
app.get("/auth/me", auth, (req, res) => res.json({ user: publicUser(me(req)), wallet: me(req).wallet ?? null }));

// ---- users ----
app.get("/users/:username", async (req, res) => {
  try {
    const username = norm(req.params.username);
    const address = await resolveUsername(username);
    if (address === zeroAddress) return res.status(404).json({ error: "unknown user" });
    const local = findUserByUsername(username);
    res.json({ username, address, role: local?.role ?? null });
  } catch (e) {
    sendError(res, e, "read");
  }
});

// ---- wallet ----
app.get("/wallet/balance", auth, async (req, res) => {
  try {
    const u = me(req);
    const bal = await balanceOf(u.address as Address);
    res.json({ address: u.address, balance: formatUnits(bal, 6), symbol: "tUSD8" });
  } catch (e) {
    sendError(res, e, "read");
  }
});

// ---- payments (browser-signed EIP-3009, relayed here) ----

/**
 * Read and check a signed authorization from the request: it must come from the caller's wallet,
 * be for `expectedValue`, expire within the hour, and carry a valid signature.
 */
async function readAuthorization(
  req: express.Request,
  expectedValue: bigint,
  payee: Address,
  productId: bigint,
  memoText: string,
): Promise<SignedAuthorization | string> {
  const a = req.body?.authorization ?? {};
  try {
    const parsed: SignedAuthorization = {
      from: me(req).address as Address,
      value: BigInt(String(a.value)),
      validAfter: BigInt(String(a.validAfter)),
      validBefore: BigInt(String(a.validBefore)),
      salt: String(a.salt) as Hex,
      signature: String(a.signature) as Hex,
    };
    if (!isHex(parsed.salt) || parsed.salt.length !== 66) return "invalid authorization salt";
    if (!isHex(parsed.signature)) return "invalid authorization signature";
    if (parsed.value !== expectedValue) return "authorization amount does not match";
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (parsed.validBefore <= now || parsed.validBefore > now + 3600n) return "authorization expired or too long-lived";
    // The signed nonce must commit to this payee, product and memo (AevumPay.paymentNonce).
    const nonce = paymentNonce(payee, productId, memoHash(memoText), parsed.salt);
    if (!(await verifyAuthorization(parsed, nonce))) return "authorization signature is not valid";
    return parsed;
  } catch {
    return "invalid authorization";
  }
}

app.post("/payments/send", auth, payLimiter, async (req, res) => {
  try {
    const u = me(req);
    const to = norm(String(req.body?.to ?? ""));
    const amount = String(req.body?.amount ?? "");
    const memo = String(req.body?.memo ?? "").slice(0, 200);
    if (!to) return res.status(400).json({ error: "recipient (username) required" });
    if (to === u.username) return res.status(400).json({ error: "cannot pay yourself" });

    let units: bigint;
    try {
      units = parseUnits(amount, 6);
    } catch {
      return res.status(400).json({ error: "invalid amount" });
    }
    if (units <= 0n) return res.status(400).json({ error: "amount must be > 0" });

    const bal = await balanceOf(u.address as Address);
    if (bal < units) return res.status(400).json({ error: "insufficient balance" });

    const payee = await resolveUsername(to);
    if (payee === zeroAddress) return res.status(404).json({ error: "recipient not found" });
    const a = await readAuthorization(req, units, payee, 0n, memo);
    if (typeof a === "string") return res.status(400).json({ error: a });

    const { hash, paymentId, blockNumber } = await relayUsernamePayment(to, a, memo);
    res.json({
      txHash: hash,
      explorer: explorerTx(hash),
      paymentId: paymentId.toString(),
      blockNumber: Number(blockNumber),
      to,
      amount,
    });
  } catch (e) {
    if ((e as Error).message === "UNKNOWN_USER") return res.status(404).json({ error: "recipient not found" });
    sendError(res, e, "send");
  }
});

// Buy a store product. The price comes from the chain, and the signature must be for exactly it.
app.post("/payments/product", auth, payLimiter, async (req, res) => {
  try {
    const u = me(req);
    let productId: bigint;
    try {
      productId = BigInt(String(req.body?.productId ?? ""));
    } catch {
      return res.status(400).json({ error: "invalid productId" });
    }
    if (productId <= 0n) return res.status(400).json({ error: "invalid productId" });
    const memo = String(req.body?.memo ?? "").slice(0, 200);

    const p = (await publicClient.readContract({
      address: AEVUMPAY_ADDRESS,
      abi: aevumPayAbi,
      functionName: "getProduct",
      args: [productId],
    })) as unknown as { merchant: Address; name: string; price: bigint; active: boolean };
    if (p.merchant === zeroAddress) return res.status(404).json({ error: "product not found" });
    if (!p.active) return res.status(400).json({ error: "product is not for sale" });
    if (p.merchant.toLowerCase() === u.address.toLowerCase()) {
      return res.status(400).json({ error: "cannot buy your own product" });
    }

    const bal = await balanceOf(u.address as Address);
    if (bal < p.price) return res.status(400).json({ error: "insufficient balance" });

    const a = await readAuthorization(req, p.price, p.merchant, productId, memo);
    if (typeof a === "string") return res.status(400).json({ error: a });

    const { hash, paymentId, blockNumber } = await relayProductPayment(productId, a, memo);
    res.json({
      txHash: hash,
      explorer: explorerTx(hash),
      paymentId: paymentId.toString(),
      blockNumber: Number(blockNumber),
      productId: productId.toString(),
      product: p.name,
      merchant: p.merchant,
      merchantUsername: (await usernameFor(p.merchant)) || null,
      amount: formatUnits(p.price, 6),
      fee: formatUnits(await feeFor(p.price), 6),
    });
  } catch (e) {
    sendError(res, e, "product payment");
  }
});

app.get("/payments/:id", async (req, res) => {
  try {
    const id = BigInt(req.params.id);
    const r = (await publicClient.readContract({
      address: AEVUMPAY_ADDRESS,
      abi: aevumPayAbi,
      functionName: "getReceipt",
      args: [id],
    })) as unknown as {
      payer: Address;
      payee: Address;
      amount: bigint;
      productId: bigint;
      paidAt: bigint;
      memo: `0x${string}`;
      fee: bigint;
      via: Address;
      subscriptionId: bigint;
    };
    if (r.payer === zeroAddress) return res.status(404).json({ error: "no such payment" });
    res.json({
      id: id.toString(),
      payer: r.payer,
      payee: r.payee,
      amount: formatUnits(r.amount, 6),
      productId: r.productId.toString(),
      paidAt: Number(r.paidAt),
      memo: r.memo,
      fee: formatUnits(r.fee, 6),
      via: r.via === zeroAddress ? null : r.via,
      subscriptionId: r.subscriptionId.toString(),
    });
  } catch (e) {
    sendError(res, e, "read");
  }
});

// ---- activity (payment history from Paid events) ----
app.get("/activity", auth, async (req, res) => {
  try {
    const u = me(req);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
    const payments = await paymentsFor(u.address as Address, limit);
    const meLower = u.address.toLowerCase();
    const counterparty = (p: (typeof payments)[number]) => (p.payer.toLowerCase() === meLower ? p.payee : p.payer);
    // Look up each counterparty's @name once, all at the same time.
    const others = [...new Set(payments.map(counterparty))];
    const cache = new Map(await Promise.all(others.map(async (a) => [a, await usernameFor(a)] as const)));
    const items = [];
    for (const p of payments) {
      const direction = p.payer.toLowerCase() === meLower ? "out" : "in";
      const other = counterparty(p);
      items.push({
        id: p.paymentId.toString(),
        direction,
        counterparty: other,
        counterpartyUsername: cache.get(other) || null,
        amount: formatUnits(p.amount, 6),
        fee: formatUnits(p.fee, 6),
        productId: p.productId.toString(),
        memo: p.memo,
        txHash: p.txHash,
        explorer: explorerTx(p.txHash),
        blockNumber: Number(p.blockNumber),
      });
    }
    res.json({ address: u.address, count: items.length, payments: items });
  } catch (e) {
    sendError(res, e, "read");
  }
});

// ---- store actions: browser-signed AevumPay calls, gas topped up and broadcast here ----
app.post("/tx/send", auth, payLimiter, async (req, res) => {
  try {
    const u = me(req);
    const rawTx = String(req.body?.rawTx ?? "");
    if (!isHex(rawTx)) return res.status(400).json({ error: "signed transaction required" });
    const tx = await inspectUserTx(rawTx as Hex, u.address as Address);
    if (tx.functionName === "register") return res.status(400).json({ error: "transaction rejected: already registered" });
    const { hash, receipt } = await broadcastUserTx(rawTx as Hex, u.address as Address);
    res.json({ txHash: hash, explorer: explorerTx(hash), call: tx.functionName, blockNumber: Number(receipt.blockNumber) });
  } catch (e) {
    return txError(res, e);
  }
});

// ---- spending permissions: token approval, agent allowances, subscriptions ----

/** How much AevumPay may draw from the caller (shared by allowances and subscriptions). */
app.get("/wallet/approval", auth, async (req, res) => {
  try {
    res.json({ approved: formatUnits(await approvalOf(me(req).address as Address), 6) });
  } catch (e) {
    sendError(res, e, "read");
  }
});

/** Agents the caller has given an allowance to, with what is spent and what is left. */
app.get("/allowances", auth, async (req, res) => {
  try {
    res.json({ allowances: await allowancesGrantedBy(me(req).address as Address) });
  } catch (e) {
    sendError(res, e, "read");
  }
});

/** Public: an agent checks its own allowance (owner, remaining budget, cap, expiry). */
app.get("/agents/:address", async (req, res) => {
  const agent = req.params.address;
  if (!isAddress(agent)) return res.status(400).json({ error: "valid agent address required" });
  try {
    const info = await agentInfo(agent);
    if (!info) return res.status(404).json({ error: "no allowance for this agent" });
    res.json(info);
  } catch (e) {
    sendError(res, e, "read");
  }
});

const AGENT_ERRORS: Record<string, string> = {
  OverBudget: "this payment would go over the allowance budget",
  OverPerPaymentLimit: "this payment is above the per-payment limit",
  AllowanceExpired: "the allowance has expired",
  AllowanceInactive: "the allowance was revoked",
  PayeeNotAllowed: "this payee is not on the allowance's list",
  NonceUsed: "this payment was already submitted",
  SignatureExpired: "the signed payment expired; sign it again",
  BadSignature: "no allowance exists for the key that signed this",
  WrongAmount: "the amount must equal the product price",
  UnknownUser: "agents can only pay registered @usernames or stores",
  SelfPayment: "an agent can't pay its own owner",
  ProductInactive: "this product is not for sale",
  ProductNotFound: "product not found",
};

/**
 * Public, for agents. The agent signs an EIP-712 AgentPayment with its own key; the contract checks
 * the signature against the owner's on-chain allowance. No account or session needed, the signature
 * is the authorization. We simulate first, then relay and pay gas.
 */
app.post("/agent/pay", payLimiter, async (req, res) => {
  const b = req.body?.payment ?? {};
  const signature = String(req.body?.signature ?? "");
  let payment;
  try {
    payment = {
      payee: String(b.payee) as Address,
      productId: BigInt(String(b.productId ?? "0")),
      amount: BigInt(String(b.amount)),
      memo: String(b.memo ?? "0x" + "0".repeat(64)) as Hex,
      nonce: String(b.nonce) as Hex,
      deadline: BigInt(String(b.deadline)),
    };
  } catch {
    return res.status(400).json({ error: "invalid payment fields" });
  }
  if (!isAddress(payment.payee) || !isHex(payment.memo) || payment.memo.length !== 66 || !isHex(payment.nonce) || payment.nonce.length !== 66 || !isHex(signature)) {
    return res.status(400).json({ error: "invalid payment fields" });
  }
  try {
    const { hash, paymentId, blockNumber } = await relayAgentPayment(payment, signature as Hex);
    res.json({ paymentId: paymentId.toString(), txHash: hash, explorer: explorerTx(hash), blockNumber: Number(blockNumber), amount: formatUnits(payment.amount, 6) });
  } catch (e) {
    if (e instanceof RelayerBudgetError) return res.status(429).json({ error: e.message });
    const msg = (e as Error).message;
    if (msg.startsWith("AGENT_REFUSED:")) {
      const name = msg.slice("AGENT_REFUSED:".length);
      return res.status(400).json({ error: AGENT_ERRORS[name] ?? "the contract refused this payment", rule: name });
    }
    sendError(res, e, "agent payment");
  }
});

/** A merchant's subscription plans (by username or address). */
app.get("/plans/:owner", async (req, res) => {
  try {
    const key = req.params.owner;
    const address = key.startsWith("0x") ? (key as Address) : await resolveUsername(norm(key));
    if (!address || address === zeroAddress) return res.status(404).json({ error: "unknown owner" });
    res.json({ plans: await plansOf(address) });
  } catch (e) {
    sendError(res, e, "read");
  }
});

app.get("/plan/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid plan id" });
  try {
    const p = await planById(id);
    if (!p) return res.status(404).json({ error: "plan not found" });
    res.json(p);
  } catch (e) {
    sendError(res, e, "read");
  }
});

/** The caller's subscriptions, as a customer and as a merchant. */
app.get("/subscriptions", auth, async (req, res) => {
  try {
    res.json(await subscriptionsOf(me(req).address as Address));
  } catch (e) {
    sendError(res, e, "read");
  }
});

app.get("/stores/:owner", async (req, res) => {
  try {
    const key = req.params.owner;
    const address = key.startsWith("0x") ? (key as Address) : await resolveUsername(norm(key));
    if (!address || address === zeroAddress) return res.status(404).json({ error: "unknown owner" });

    const [store, products] = await Promise.all([
      publicClient.readContract({
        address: AEVUMPAY_ADDRESS,
        abi: aevumPayAbi,
        functionName: "getStore",
        args: [address],
      }) as unknown as Promise<{ name: string; active: boolean }>,
      listProducts(address),
    ]);
    if (!store.name) return res.status(404).json({ error: "no store" });
    res.json({ owner: address, name: store.name, active: store.active, products });
  } catch (e) {
    sendError(res, e, "read");
  }
});

async function listProducts(merchant: Address) {
  const next = Number(await nextProductId());
  const all = await readAll(next, 500, async (i) =>
    (await publicClient.readContract({
      address: AEVUMPAY_ADDRESS,
      abi: aevumPayAbi,
      functionName: "getProduct",
      args: [BigInt(i)],
    })) as unknown as { merchant: Address; name: string; price: bigint; active: boolean },
  );
  return all
    .filter(([, p]) => p.merchant.toLowerCase() === merchant.toLowerCase())
    .map(([id, p]) => ({ id, name: p.name, price: formatUnits(p.price, 6), active: p.active }));
}

// ---- welcome grant: a few test dollars for each new account (see grant.ts) ----
app.get("/grant", auth, async (req, res) => {
  try {
    res.json(await grantStatus(me(req)));
  } catch (e) {
    sendError(res, e, "read");
  }
});

app.post("/grant", auth, payLimiter, async (req, res) => {
  try {
    res.json(await claimGrant(me(req), req.ip ?? "unknown"));
  } catch (e) {
    if (e instanceof GrantError) return res.status(e.status).json({ error: e.message, code: "Grant" });
    sendError(res, e, "grant");
  }
});

// ---- local faucet (anvil only) ----
app.post("/dev/faucet", auth, async (req, res) => {
  try {
    if (chain.id === 44005) return res.status(403).json({ error: "faucet is local-only on the real testnet" });
    const u = me(req);
    const amount = parseUnits(String(req.body?.amount ?? "100"), 6);
    const hash = await devMint(u.address as Address, amount);
    res.json({ txHash: hash, explorer: explorerTx(hash), minted: formatUnits(amount, 6), to: u.address });
  } catch (e) {
    sendError(res, e, "read");
  }
});

app.listen(PORT, () => {
  console.log(`AevumPay API on http://127.0.0.1:${PORT}  (chain ${chain.id}, contract ${AEVUMPAY_ADDRESS})`);
  const gw = grantWallet();
  console.log(gw ? `Welcome grants paid from ${gw}` : "Welcome grants off (no GRANT_PRIVATE_KEY or TREASURY_PRIVATE_KEY)");
  startIndexer();
  startCollector(Number(process.env.COLLECTOR_INTERVAL_MS ?? 30_000));
});
