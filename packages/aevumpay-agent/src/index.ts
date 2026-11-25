/**
 * @aevumpay/agent: pay from an AevumPay user's wallet, within limits they set on-chain.
 *
 * The agent has its own key. It never holds the user's key or the user's money. The user grants
 * the agent's address an allowance (budget, per-payment cap, expiry, optional payee list) from the
 * AevumPay app via a connect link. The agent then signs each payment (EIP-712 `AgentPayment`) and
 * the AevumPay API relays it, paying gas. The AevumPay contract checks every limit, so a buggy or
 * prompt-injected agent still can't overspend.
 *
 *   const agent = new AevumPayAgent({ apiUrl, appUrl, privateKey });
 *   console.log(agent.connectLink({ name: "Shopping assistant", budget: "20", maxPerPayment: "5", days: 7 }));
 *   await agent.pay({ to: "@kemi", amount: "5", memo: "lunch" });
 */
import { keccak256, parseUnits, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export interface AgentOptions {
  /** AevumPay API, e.g. http://127.0.0.1:8787 */
  apiUrl: string;
  /** AevumPay web app, used to build the connect link, e.g. http://localhost:3000 */
  appUrl?: string;
  /** This agent's own key (not the user's). Create one with AevumPayAgent.generateKey(). */
  privateKey: Hex;
}

export interface AllowanceStatus {
  agent: Address;
  owner: Address;
  ownerUsername: string | null;
  status: "active" | "expired" | "revoked";
  budget: string;
  spent: string;
  remaining: string;
  maxPerPayment: string;
  expiresAt: number;
  payeesRestricted: boolean;
}

export interface PaymentReceipt {
  paymentId: string;
  txHash: string;
  explorer: string;
  blockNumber: number;
  amount: string;
}

export class AevumPayError extends Error {
  constructor(
    message: string,
    /** The contract rule that refused the payment, e.g. "OverBudget", when there is one. */
    readonly rule?: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const AGENT_PAYMENT_TYPES = {
  AgentPayment: [
    { name: "payee", type: "address" },
    { name: "productId", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "memo", type: "bytes32" },
    { name: "nonce", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** What a pay link asks for (GET /pay/:username on the API). */
export interface PaymentRequestInfo {
  type: "aevumpay.payment-request";
  to: { username: string; address: Address };
  amount: string | null;
  note: string;
  requestId: string | null;
  status: "open" | "paid" | "expired" | "cancelled";
  paidCount: number;
  link: string;
}

/** `https://pay.example/pay/kemi?amount=5&r=abc` → { username: "kemi", query: "amount=5&r=abc" }. */
export function parsePayLink(link: string): { username: string; query: string } {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new AevumPayError("that isn't a link");
  }
  const m = url.pathname.match(/\/pay\/@?([a-z0-9_.]+)\/?$/i);
  if (!m) throw new AevumPayError("that isn't an AevumPay pay link (…/pay/<username>)");
  const q = new URLSearchParams();
  for (const k of ["amount", "note", "r"]) {
    const v = url.searchParams.get(k);
    if (v) q.set(k, v);
  }
  return { username: m[1]!.toLowerCase(), query: q.toString() };
}

export class AevumPayAgent {
  private readonly account: PrivateKeyAccount;
  private readonly apiUrl: string;
  private readonly appUrl: string;
  private config?: Promise<{ chainId: number; aevumPay: Address }>;

  static generateKey(): Hex {
    return generatePrivateKey();
  }

  constructor(opts: AgentOptions) {
    this.account = privateKeyToAccount(opts.privateKey);
    this.apiUrl = opts.apiUrl.replace(/\/+$/, "");
    this.appUrl = (opts.appUrl ?? "http://localhost:3000").replace(/\/+$/, "");
  }

  /** The agent's address: what the user grants the allowance to. */
  get address(): Address {
    return this.account.address;
  }

  /**
   * A link the user opens in AevumPay to approve this agent. The numbers are only a proposal; the
   * user can change every limit before approving.
   */
  connectLink(o: { name: string; budget: string; maxPerPayment: string; days: number; payees?: string[] }): string {
    const q = new URLSearchParams({
      agent: this.address,
      name: o.name,
      budget: o.budget,
      max: o.maxPerPayment,
      days: String(o.days),
    });
    if (o.payees?.length) q.set("payees", o.payees.map((p) => p.replace(/^@/, "")).join(","));
    return `${this.appUrl}/connect?${q}`;
  }

  /** This agent's allowance, or null if no one has connected it yet. */
  async status(): Promise<AllowanceStatus | null> {
    try {
      return await this.get<AllowanceStatus>(`/agents/${this.address}`);
    } catch (e) {
      if (e instanceof AevumPayError && e.status === 404) return null;
      throw e;
    }
  }

  /** Look up an @username's wallet (checked on-chain by the AevumPay registry). */
  async findUser(username: string): Promise<{ username: string; address: Address }> {
    const u = await this.get<{ username: string; address: Address }>(`/users/${encodeURIComponent(username.replace(/^@/, ""))}`);
    return { username: u.username, address: u.address };
  }

  /** Pay an @username from the owner's wallet. `amount` is a decimal string in tUSD8, e.g. "5" or "4.50". */
  async pay(o: { to: string; amount: string; memo?: string }): Promise<PaymentReceipt> {
    const payee = (await this.findUser(o.to)).address;
    return this.submit({ payee, productId: 0n, amount: parseUnits(o.amount, 6), memo: o.memo ?? "" });
  }

  /** Buy a store product. The price comes from the chain; the payment must match it exactly. */
  async buy(o: { store: string; productId: number; memo?: string }): Promise<PaymentReceipt> {
    const store = await this.get<{ owner: Address; products: { id: number; price: string; active: boolean }[] }>(
      `/stores/${encodeURIComponent(o.store.replace(/^@/, ""))}`,
    );
    const product = store.products.find((p) => p.id === o.productId);
    if (!product) throw new AevumPayError(`@${o.store} has no product #${o.productId}`);
    if (!product.active) throw new AevumPayError("this product is not for sale");
    return this.submit({ payee: store.owner, productId: BigInt(o.productId), amount: parseUnits(product.price, 6), memo: o.memo ?? "" });
  }

  /**
   * Read a pay link (`https://…/pay/kemi?amount=5&note=…&r=…`) without paying it: who it's for, how
   * much, and whether it's still open. Handy for an agent to confirm with its user first.
   */
  async readRequest(link: string): Promise<PaymentRequestInfo> {
    const { username, query } = parsePayLink(link);
    return this.get<PaymentRequestInfo>(`/pay/${encodeURIComponent(username)}${query ? `?${query}` : ""}`);
  }

  /**
   * Pay a pay link from the owner's wallet, within this agent's on-chain allowance. A link with a
   * fixed amount pays exactly that; for an "any amount" link pass `amount`. If the link is a tracked
   * request it's marked paid for the person who sent it (they see it live).
   */
  async payRequest(link: string, o: { amount?: string } = {}): Promise<PaymentReceipt & { requestId: string | null }> {
    const info = await this.readRequest(link);
    if (info.status !== "open") throw new AevumPayError(`this request is ${info.status}`);
    const amount = info.amount ?? o.amount;
    if (!amount) throw new AevumPayError("this link doesn't set an amount; pass { amount }");
    if (info.amount && o.amount && parseUnits(o.amount, 6) !== parseUnits(info.amount, 6)) {
      throw new AevumPayError(`this request is for exactly $${info.amount}`);
    }
    const receipt = await this.submit({ payee: info.to.address, productId: 0n, amount: parseUnits(amount, 6), memo: info.note ?? "" }, info.requestId);
    return { ...receipt, requestId: info.requestId };
  }

  private async submit(p: { payee: Address; productId: bigint; amount: bigint; memo: string }, requestId: string | null = null): Promise<PaymentReceipt> {
    const cfg = await this.chainConfig();
    const payment = {
      payee: p.payee,
      productId: p.productId,
      amount: p.amount,
      memo: keccak256(toHex(p.memo)),
      nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
    };
    const signature = await this.account.signTypedData({
      domain: { name: "AevumPay", version: "2", chainId: cfg.chainId, verifyingContract: cfg.aevumPay },
      types: AGENT_PAYMENT_TYPES,
      primaryType: "AgentPayment",
      message: payment,
    });
    return this.post<PaymentReceipt>("/agent/pay", {
      payment: {
        ...payment,
        productId: payment.productId.toString(),
        amount: payment.amount.toString(),
        deadline: payment.deadline.toString(),
      },
      signature,
      ...(requestId ? { requestId } : {}),
    });
  }

  private chainConfig() {
    this.config ??= this.get<{ chainId: number; aevumPay: Address }>("/config");
    return this.config;
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(this.apiUrl + path, init);
    const data = (await res.json().catch(() => ({}))) as { error?: string; rule?: string };
    if (!res.ok) throw new AevumPayError(data.error ?? `request failed (${res.status})`, data.rule, res.status);
    return data as T;
  }
}
