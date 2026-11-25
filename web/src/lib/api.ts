/**
 * Typed client for the AevumPay API server (see docs/API.md).
 * Amounts are decimal strings in tUSD8 (6 decimals), exactly as the server sends them.
 */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");

export type Role = "personal" | "business";

export interface User {
  id: string;
  username: string;
  role: Role;
  address: string;
}

/** The wallet key encrypted in the browser; the server keeps it but can't open it. */
export interface WalletBlob {
  v: 1;
  iv: string;
  ct: string;
}

/** A browser-signed EIP-3009 authorization (see lib/sign.ts). */
export interface Authorization {
  value: string;
  validAfter: string;
  validBefore: string;
  salt: string;
  signature: string;
}

export interface AuthResult {
  token: string;
  user: User;
  wallet: WalletBlob;
}

export interface Balance {
  address: string;
  balance: string;
  symbol: string;
}

export interface PaymentResult {
  txHash: string;
  explorer: string;
  paymentId: string;
  blockNumber?: number;
  amount: string;
}

export interface SendResult extends PaymentResult {
  to: string;
}

export interface ProductPaymentResult extends PaymentResult {
  productId: string;
  product: string;
  merchant: string;
  merchantUsername: string | null;
  /** The 0.5% store fee, paid out of the merchant's side. */
  fee: string;
}

export interface Receipt {
  id: string;
  payer: string;
  payee: string;
  amount: string;
  productId: string;
  paidAt: number;
  memo: string;
  /** Merchant fee taken from this payment (0 for person-to-person). */
  fee: string;
  /** The agent key that signed it, if any. */
  via: string | null;
  subscriptionId: string;
}

export interface ActivityItem {
  id: string;
  direction: "in" | "out";
  counterparty: string;
  counterpartyUsername: string | null;
  amount: string;
  fee: string;
  productId: string;
  memo: string;
  txHash: string;
  explorer: string;
  blockNumber: number;
}

export interface Activity {
  address: string;
  count: number;
  payments: ActivityItem[];
}

export interface Product {
  id: number;
  name: string;
  price: string;
  active: boolean;
}

export interface Store {
  owner: string;
  name: string;
  active: boolean;
  products: Product[];
}

/** A trackable payment request (pay link with ?r=…). */
export interface PayRequest {
  id: string;
  to: { username: string; address: string };
  amount: string | null;
  note: string;
  oneTime: boolean;
  status: "open" | "paid" | "expired" | "cancelled";
  expiresAt: number | null;
  createdAt: number;
  paidCount: number;
  paidTotal: string;
  payments: { paymentId: string; payerUsername: string | null; amount: string; txHash: string; at: number }[];
  url?: string;
}

export interface PublicUser {
  username: string;
  address: string;
  role: Role | null;
}

export interface AgentAllowance {
  agent: string;
  owner: string;
  status: "active" | "expired" | "revoked";
  budget: string;
  spent: string;
  remaining: string;
  maxPerPayment: string;
  expiresAt: number;
  payeesRestricted: boolean;
  ownerUsername?: string | null;
}

export interface Plan {
  id: number;
  merchant: string;
  merchantUsername?: string | null;
  name: string;
  amount: string;
  /** Seconds between charges. */
  period: number;
  active: boolean;
}

export interface Subscription {
  id: number;
  planId: number;
  planName: string;
  subscriber: string;
  subscriberUsername: string | null;
  merchant: string;
  merchantUsername: string | null;
  amount: string;
  period: number;
  nextDue: number;
  paidCount: number;
  maxPayments: number;
  status: "active" | "cancelled" | "lapsed" | "completed" | "none";
  pastDue: boolean;
  due: boolean;
}

/** The welcome grant: a few test dollars for each new account. */
export interface GrantStatus {
  enabled: boolean;
  amount: string;
  claimed: boolean;
  available: boolean;
  reason?: string;
  txHash?: string;
  explorer?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The contract rule (e.g. "UsernameTooShort") or server code behind the failure, when known. */
    readonly reason?: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = "aevumpay.token";
/** Which server + chain this browser's saved data belongs to. */
const STAMP_KEY = "aevumpay.network";

/**
 * Data saved in this browser (session, receipts, agent names) belongs to one server on one chain.
 * If the app now talks to a different one, e.g. it moved from a local test chain to Aevum testnet,
 * that data is stale: drop it. Returns true when something was dropped. (Wallet keys in IndexedDB
 * are checked per account instead: see the session, which drops a key whose address doesn't match.)
 */
export function checkNetworkStamp(chainId: number): boolean {
  const stamp = `${API_URL}|${chainId}`;
  try {
    const old = localStorage.getItem(STAMP_KEY);
    if (old === stamp) return false;
    // A browser with no stamp yet may still hold data from before stamps existed.
    const stale = Object.keys(localStorage).filter((k) => k.startsWith("aevumpay.") && k !== STAMP_KEY);
    stale.forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(STAMP_KEY, stamp);
    return stale.length > 0 || old !== null;
  } catch {
    return false;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    // A different session (or none): what we remembered for the last one isn't theirs.
    if (token !== localStorage.getItem(TOKEN_KEY)) clearCache();
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked: the session lasts until reload */
  }
}

// ---------------- remembered answers (instant screens) ----------------
//
// Every read is slow-ish (it ends at a testnet). Screens show the last answer for the same read
// straight away and swap in the fresh one when it lands, so the app feels instant on return
// visits. Only reads are remembered, per session, in this browser; signing out forgets them.

const CACHE_PREFIX = "aevumpay.c.";
const SESSION_USER_KEY = "aevumpay.user";
const NOT_REMEMBERED = ["/health", "/auth/me", "/tx/params", "/config"];
let capturing: string[] | null = null;

function cacheKey(path: string) {
  const t = getToken();
  return `${CACHE_PREFIX}${t ? t.slice(-12) : "anon"}|${path}`;
}

/** Run `fn` and report which reads it started (so a screen knows what to show from memory). */
export function captureReads<T>(fn: () => T): { result: T; paths: string[] } {
  const prev = capturing;
  capturing = [];
  try {
    const result = fn();
    return { result, paths: capturing };
  } finally {
    capturing = prev;
  }
}

/** The last answer this browser got for the read at `path`, if any. */
export function remembered<T>(path: string): T | undefined {
  try {
    const v = localStorage.getItem(cacheKey(path));
    return v === null ? undefined : (JSON.parse(v) as T);
  } catch {
    return undefined;
  }
}

function remember(path: string, data: unknown) {
  if (NOT_REMEMBERED.some((p) => path.startsWith(p))) return;
  try {
    localStorage.setItem(cacheKey(path), JSON.stringify(data));
  } catch {
    clearCache(); // full: start over rather than fail
  }
}

export function clearCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(CACHE_PREFIX) || k === SESSION_USER_KEY)
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage blocked */
  }
}

/** The signed-in user as last seen, so the app can open on it before the server answers. */
export function rememberedUser(): User | null {
  try {
    const v = localStorage.getItem(SESSION_USER_KEY);
    return v ? (JSON.parse(v) as User) : null;
  } catch {
    return null;
  }
}

export function rememberUser(user: User | null) {
  try {
    if (user) localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_USER_KEY);
  } catch {
    /* storage blocked */
  }
}

// ---------------- live updates ----------------

export interface LivePayment {
  id: string;
  payer: string;
  payee: string;
  payerUsername: string | null;
  payeeUsername: string | null;
  amount: string;
  txHash: string;
}
/** Sent to the payee the moment a payment to them is broadcast, about a second before it confirms. */
export interface LiveIncoming {
  payer: string;
  payerUsername: string | null;
  amount: string;
  txHash: string;
}
export type LiveEvent =
  | { type: "payment"; data: LivePayment }
  | { type: "incoming"; data: LiveIncoming }
  | { type: "request"; data: PayRequest }
  | { type: "change"; data: { kind: string; txHash: string } };

/**
 * Follow the server's event stream for this session, calling `onEvent` for each event. Reconnects
 * by itself until `signal` is aborted. (fetch rather than EventSource, so the session token goes in
 * a header and never in a URL.)
 */
export async function followLive(onEvent: (e: LiveEvent) => void, signal: AbortSignal) {
  while (!signal.aborted) {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/events`, { headers: { Authorization: `Bearer ${token}` }, signal });
      // Signed out, or a server without live updates (older API): don't keep knocking.
      if (res.status === 401 || res.status === 404) return;
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let cut;
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          let type = "message";
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) type = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if ((type === "payment" || type === "incoming" || type === "change" || type === "request") && data) {
            try {
              onEvent({ type, data: JSON.parse(data) } as LiveEvent);
            } catch {
              /* a malformed event: skip it */
            }
          }
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    await new Promise((r) => setTimeout(r, 3000)); // dropped: try again shortly
  }
}

/** Plain-language versions of the server's error strings. */
const FRIENDLY: Record<string, string> = {
  "invalid credentials": "That username and password don't match.",
  "username already used": "That username is taken. Try another.",
  "insufficient balance": "You don't have enough tUSD8 for this payment.",
  "recipient not found": "No one has that username yet. Check the spelling.",
  "cannot pay yourself": "You can't send money to yourself.",
  "cannot buy your own product": "This is your own product, so you can't buy it.",
  "product is not for sale": "This product isn't for sale right now.",
  "product not found": "This product doesn't exist.",
  "too many requests, slow down": "Too many requests. Wait a minute and try again.",
  unauthorized: "Your session ended. Log in again.",
  "legacy account": "This account was made before keys moved into your browser. Create a new account.",
  "authorization signature is not valid": "The payment signature didn't check out. Try again.",
  "this action would fail on-chain": "The network turned this down. Check what you entered and try again.",
  // Wording from older servers that didn't name the cause.
  "the contract refused this": "The network turned this down. Check what you entered and try again.",
  "the transaction was rejected on-chain": "The network turned this down. Check what you entered and try again.",
  "transaction failed": "Something went wrong on our side. If this was a payment, check Activity before trying again.",
  "send failed": "Something went wrong on our side. Check Activity before trying the payment again.",
  "payment failed": "Something went wrong on our side. Check Activity before trying the payment again.",
  "something went wrong on our side": "Something went wrong on our side. If this was a payment, check Activity before trying again.",
};

/**
 * Plain words for contract rules, by error name. The server sends `rule` alongside its message; this
 * covers servers that don't have the newest wording yet.
 */
const RULES: Record<string, string> = {
  UsernameTooShort: "Your @name needs at least 3 characters.",
  UsernameTooLong: "Your @name can be at most 24 characters.",
  UsernameTaken: "That @name was just taken. Try another.",
  AlreadyRegistered: "This wallet already has an @name.",
  UnknownUser: "No one has that @name yet. Check the spelling.",
  ZeroAmount: "Enter an amount above $0.",
  ProductInactive: "This product isn't for sale right now.",
  PlanInactive: "This plan isn't taking new subscribers.",
  SelfPayment: "You can't pay yourself.",
  OverBudget: "That's more than this agent has left in its budget.",
  OverPerPaymentLimit: "That's above this agent's limit per payment.",
  // Not contract rules: the server's `code` for other kinds of failure.
  InsufficientBalance: "You don't have enough tUSD8 for this. Add money and try again.",
  AuthorizationUsed: "This payment already went through. Check Activity.",
  AuthorizationExpired: "This took too long and expired. Try again.",
  RelayerOutOfGas: "Our gas wallet is running low, so we can't send this right now. Try again in a little while.",
  Busy: "Another transaction was still going through. Try again in a moment.",
  NetworkBusy: "The Aevum network didn't answer. Try again in a moment.",
  ServerError: "Something went wrong on our side. If this was a payment, check Activity before trying again.",
};

/** The message to show for a failed request: the most specific thing we know, in plain words. */
function explain(status: number, data: { error?: string; rule?: string; code?: string }): string {
  const key = data.rule ?? data.code;
  if (key && RULES[key]) return RULES[key];
  const raw = data.error;
  if (raw && FRIENDLY[raw]) return FRIENDLY[raw];
  if (raw) return sentence(raw);
  if (status === 429) return "That's a lot of requests at once. Wait a minute and try again.";
  if (status >= 500) return RULES.ServerError!;
  return `That didn't work (error ${status}). Try again.`;
}

/** "the contract refused this" → "The contract refused this." */
function sentence(s: string): string {
  const t = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  if (method === "GET") capturing?.push(path); // must run before the first await (see captureReads)
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("Can't reach AevumPay right now. Check your connection and try again.", 0);
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string; rule?: string; code?: string };
  if (!res.ok) throw new ApiError(explain(res.status, data), res.status, data.rule ?? data.code);
  if (method === "GET") remember(path, data);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  health: () => request<{ ok: boolean; chainId: number }>("GET", "/health"),
  config: () => request<{ chainId: number; aevumPay: `0x${string}`; tusd8: `0x${string}`; hasExplorer: boolean }>("GET", "/config"),
  /** Nonce, gas price and (for a given call) a gas estimate with headroom, for signing in the browser. */
  txParams: (address: string, call?: { to: string; data: string }) =>
    request<{ chainId: number; nonce: number; gasPrice: string; gas: string | null }>(
      "GET",
      `/tx/params?address=${enc(address)}${call ? `&to=${enc(call.to)}&data=${enc(call.data)}` : ""}`,
    ),
  register: (body: { username: string; role: Role; authKey: string; address: string; wallet: WalletBlob; registerTx: string }) =>
    request<AuthResult>("POST", "/auth/register", body),
  login: (username: string, authKey: string) => request<AuthResult>("POST", "/auth/login", { username, authKey }),
  me: () => request<{ user: User; wallet: WalletBlob | null }>("GET", "/auth/me"),
  user: (username: string) => request<PublicUser>("GET", `/users/${enc(username)}`),
  balance: () => request<Balance>("GET", "/wallet/balance"),
  send: (to: string, amount: string, memo: string, authorization: Authorization, requestId?: string | null) =>
    request<SendResult>("POST", "/payments/send", { to, amount, memo, authorization, ...(requestId ? { requestId } : {}) }),
  createRequest: (body: { amount?: string; note?: string; oneTime?: boolean; expiresInHours?: number }) =>
    request<PayRequest>("POST", "/requests", body),
  requests: () => request<{ requests: PayRequest[] }>("GET", "/requests"),
  request: (id: string) => request<PayRequest>("GET", `/requests/${enc(id)}`),
  cancelRequest: (id: string) => request<PayRequest>("POST", `/requests/${enc(id)}/cancel`),
  payProduct: (productId: number, authorization: Authorization, memo = "") =>
    request<ProductPaymentResult>("POST", "/payments/product", { productId, memo, authorization }),
  receipt: (id: string) => request<Receipt>("GET", `/payments/${enc(id)}`),
  activity: (limit = 50) => request<Activity>("GET", `/activity?limit=${limit}`),
  store: (owner: string) => request<Store>("GET", `/stores/${enc(owner)}`),
  /** Broadcast a contract call the browser signed (createStore, addProduct…). */
  sendTx: (rawTx: string) => request<{ txHash: string; explorer: string; call: string }>("POST", "/tx/send", { rawTx }),
  approval: () => request<{ approved: string }>("GET", "/wallet/approval"),
  allowances: () => request<{ allowances: AgentAllowance[] }>("GET", "/allowances"),
  agent: (address: string) => request<AgentAllowance>("GET", `/agents/${enc(address)}`),
  plans: (owner: string) => request<{ plans: Plan[] }>("GET", `/plans/${enc(owner)}`),
  plan: (id: string | number) => request<Plan>("GET", `/plan/${enc(String(id))}`),
  subscriptions: () => request<{ asSubscriber: Subscription[]; asMerchant: Subscription[] }>("GET", "/subscriptions"),
  /** Local development chain only: mint MockUSD8. The testnet server refuses it. */
  faucet: (amount = "100") => request<{ minted: string }>("POST", "/dev/faucet", { amount }),
  grantStatus: () => request<GrantStatus>("GET", "/grant"),
  claimGrant: () => request<{ amount: string; txHash: string; explorer: string }>("POST", "/grant"),
};

export const AEVUM_CHAIN_ID = 44005;
