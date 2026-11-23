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

  private async submit(p: { payee: Address; productId: bigint; amount: bigint; memo: string }): Promise<PaymentReceipt> {
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
