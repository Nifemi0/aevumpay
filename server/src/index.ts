import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { formatUnits, parseUnits, zeroAddress } from "viem";
import type { Address } from "viem";
import { AEVUMPAY_ADDRESS, DB_PATH, KEY_ENCRYPTION_SECRET, PORT } from "./config";
import { addUser, createSession, findUserByUsername, loadDb, userForToken, type User } from "./db";
import {
  decryptPrivateKey,
  encryptPrivateKey,
  hashPassword,
  newId,
  newWallet,
  verifyPassword,
} from "./crypto";
import {
  addProductOnChain,
  balanceOf,
  chain,
  createStoreOnChain,
  devMint,
  explorerTx,
  gaslessPay,
  getPaymentsFor,
  nextPaymentId,
  nextProductId,
  publicClient,
  registerOnChain,
  resolveUsername,
  usernameFor,
} from "./chain";
import { aevumPayAbi } from "./abi";

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

app.get("/", (_req, res) => {
  res.json({
    name: "AevumPay API",
    chainId: chain.id,
    contract: AEVUMPAY_ADDRESS,
    endpoints: [
      "POST /auth/register { username, role, password }",
      "POST /auth/login { username, password }",
      "GET  /auth/me",
      "GET  /users/:username",
      "GET  /wallet/balance",
      "POST /payments/send { to, amount, memo }",
      "GET  /payments/:id",
      "POST /stores { name }",
      "POST /stores/products { name, price }",
      "GET  /stores/:owner",
    ],
  });
});

app.get("/health", (_req, res) => res.json({ ok: true, chainId: chain.id }));

// ---- auth ----
app.post("/auth/register", authLimiter, async (req, res) => {
  try {
    const username = norm(String(req.body?.username ?? ""));
    const role = req.body?.role === "business" ? "business" : "personal";
    const password = String(req.body?.password ?? "");
    if (username.length < 3 || username.length > 24) {
      return res.status(400).json({ error: "username must be 3-24 chars (a-z, 0-9, _, .)" });
    }
    if (password.length < 6) return res.status(400).json({ error: "password must be 6+ characters" });
    if (findUserByUsername(username)) return res.status(409).json({ error: "username already used" });

    const onchain = await resolveUsername(username);
    if (onchain !== zeroAddress) return res.status(409).json({ error: "username already used" });

    const { privateKey, address } = newWallet();
    await registerOnChain(privateKey, username); // relayer tops up gas; the user's key signs

    const pw = hashPassword(password);
    const user: User = {
      id: newId(),
      username,
      role,
      address,
      salt: pw.salt,
      hash: pw.hash,
      keyBlob: encryptPrivateKey(privateKey, KEY_ENCRYPTION_SECRET),
      createdAt: Date.now(),
    };
    addUser(user);
    const token = createSession(user.id);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error("register failed:", e);
    res.status(500).json({ error: "register failed", detail: (e as Error).message });
  }
});

app.post("/auth/login", authLimiter, (req, res) => {
  const username = norm(String(req.body?.username ?? ""));
  const password = String(req.body?.password ?? "");
  if (isLockedOut(username)) {
    return res.status(429).json({ error: "too many failed attempts; try again in 15 minutes" });
  }
  const user = findUserByUsername(username);
  if (!user || !verifyPassword(password, user.salt, user.hash)) {
    recordFailedLogin(username);
    return res.status(401).json({ error: "invalid credentials" });
  }
  failedLogins.delete(username);
  const token = createSession(user.id);
  res.json({ token, user: publicUser(user) });
});

app.get("/auth/me", auth, (req, res) => res.json({ user: publicUser(me(req)) }));

// ---- users ----
app.get("/users/:username", async (req, res) => {
  try {
    const username = norm(req.params.username);
    const address = await resolveUsername(username);
    if (address === zeroAddress) return res.status(404).json({ error: "unknown user" });
    const local = findUserByUsername(username);
    res.json({ username, address, role: local?.role ?? null });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- wallet ----
app.get("/wallet/balance", auth, async (req, res) => {
  try {
    const u = me(req);
    const bal = await balanceOf(u.address as Address);
    res.json({ address: u.address, balance: formatUnits(bal, 6), symbol: "tUSD8" });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- payments ----
app.post("/payments/send", auth, payLimiter, async (req, res) => {
  try {
    const u = me(req);
    const to = norm(String(req.body?.to ?? ""));
    const amount = String(req.body?.amount ?? "");
    const memo = String(req.body?.memo ?? "");
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

    const pk = decryptPrivateKey(u.keyBlob, KEY_ENCRYPTION_SECRET);
    const { hash, paymentId } = await gaslessPay({ fromPrivateKey: pk, toUsername: to, amount: units, memo });
    res.json({ txHash: hash, explorer: explorerTx(hash), paymentId: paymentId.toString(), to, amount });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "UNKNOWN_USER") return res.status(404).json({ error: "recipient not found" });
    console.error("send failed:", e);
    res.status(500).json({ error: "send failed", detail: msg });
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
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- activity (payment history from Paid events) ----
app.get("/activity", auth, async (req, res) => {
  try {
    const u = me(req);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
    const payments = await getPaymentsFor(u.address as Address, limit);
    const cache = new Map<string, string>();
    const meLower = u.address.toLowerCase();
    const items = [];
    for (const p of payments) {
      const direction = p.payer.toLowerCase() === meLower ? "out" : "in";
      const other = direction === "out" ? p.payee : p.payer;
      if (!cache.has(other)) cache.set(other, await usernameFor(other));
      items.push({
        id: p.paymentId.toString(),
        direction,
        counterparty: other,
        counterpartyUsername: cache.get(other) || null,
        amount: formatUnits(p.amount, 6),
        productId: p.productId.toString(),
        memo: p.memo,
        txHash: p.txHash,
        explorer: explorerTx(p.txHash),
        blockNumber: Number(p.blockNumber),
      });
    }
    res.json({ address: u.address, count: items.length, payments: items });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- stores ----
app.post("/stores", auth, async (req, res) => {
  try {
    const u = me(req);
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "store name required" });
    const pk = decryptPrivateKey(u.keyBlob, KEY_ENCRYPTION_SECRET);
    const { hash } = await createStoreOnChain(pk, name);
    res.json({ txHash: hash, explorer: explorerTx(hash), store: { name, owner: u.address } });
  } catch (e) {
    console.error("create store failed:", e);
    res.status(500).json({ error: "create store failed", detail: (e as Error).message });
  }
});

app.post("/stores/products", auth, async (req, res) => {
  try {
    const u = me(req);
    const name = String(req.body?.name ?? "").trim();
    const price = String(req.body?.price ?? "");
    if (!name) return res.status(400).json({ error: "product name required" });
    let units: bigint;
    try {
      units = parseUnits(price, 6);
    } catch {
      return res.status(400).json({ error: "invalid price" });
    }
    if (units <= 0n) return res.status(400).json({ error: "price must be > 0" });
    const pk = decryptPrivateKey(u.keyBlob, KEY_ENCRYPTION_SECRET);
    const { hash } = await addProductOnChain(pk, name, units);
    res.json({ txHash: hash, explorer: explorerTx(hash), product: { name, price } });
  } catch (e) {
    console.error("add product failed:", e);
    res.status(500).json({ error: "add product failed", detail: (e as Error).message });
  }
});

app.get("/stores/:owner", async (req, res) => {
  try {
    const key = req.params.owner;
    const address = key.startsWith("0x") ? (key as Address) : await resolveUsername(norm(key));
    if (!address || address === zeroAddress) return res.status(404).json({ error: "unknown owner" });

    const store = (await publicClient.readContract({
      address: AEVUMPAY_ADDRESS,
      abi: aevumPayAbi,
      functionName: "getStore",
      args: [address],
    })) as unknown as { name: string; active: boolean };
    if (!store.name) return res.status(404).json({ error: "no store" });

    const products = await listProducts(address);
    res.json({ owner: address, name: store.name, active: store.active, products });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

async function listProducts(merchant: Address) {
  const next = Number(await nextProductId());
  const out: { id: number; name: string; price: string; active: boolean }[] = [];
  for (let i = 1; i < next && i < 500; i++) {
    const p = (await publicClient.readContract({
      address: AEVUMPAY_ADDRESS,
      abi: aevumPayAbi,
      functionName: "getProduct",
      args: [BigInt(i)],
    })) as unknown as { merchant: Address; name: string; price: bigint; active: boolean };
    if (p.merchant.toLowerCase() === merchant.toLowerCase()) {
      out.push({ id: i, name: p.name, price: formatUnits(p.price, 6), active: p.active });
    }
  }
  return out;
}

// keep nextPaymentId import used even if a future refactor drops it
void nextPaymentId;

// ---- local faucet (anvil only) ----
app.post("/dev/faucet", auth, async (req, res) => {
  try {
    if (chain.id === 44005) return res.status(403).json({ error: "faucet is local-only on the real testnet" });
    const u = me(req);
    const amount = parseUnits(String(req.body?.amount ?? "100"), 6);
    const hash = await devMint(u.address as Address, amount);
    res.json({ txHash: hash, explorer: explorerTx(hash), minted: formatUnits(amount, 6), to: u.address });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`AevumPay API on http://127.0.0.1:${PORT}  (chain ${chain.id}, contract ${AEVUMPAY_ADDRESS})`);
});
