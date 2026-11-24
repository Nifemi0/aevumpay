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
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked: the session lasts until reload */
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
  "this action would fail on-chain": "That can't go through right now. Check your balance and try again.",
};

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
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

  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    const raw = data.error ?? `Request failed (${res.status})`;
    throw new ApiError(FRIENDLY[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1), res.status);
  }
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
  send: (to: string, amount: string, memo: string, authorization: Authorization) =>
    request<SendResult>("POST", "/payments/send", { to, amount, memo, authorization }),
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
