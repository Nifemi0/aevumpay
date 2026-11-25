import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  defineChain,
  http,
  keccak256,
  parseSignature,
  parseTransaction,
  recoverTransactionAddress,
  toHex,
  verifyTypedData,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { RPC_URL, CHAIN_ID, AEVUMPAY_ADDRESS, TUSD8_ADDRESS, RELAYER_PRIVATE_KEY } from "./config";
import { aevumPayAbi, erc20Abi, mockMintAbi, receiveWithAuthorizationTypes } from "./abi";
import { chargeRelayTx, chargeTopUp } from "./budget";

export const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 44005 ? "QDay Aevum Testnet" : `Aevum (${CHAIN_ID})`,
  nativeCurrency: { name: "Test QDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  testnet: true,
});

/**
 * Aevum makes a block about every second, but viem polls for receipts every 4s by default, which
 * made each payment feel ~20s slow on testnet. Poll every second instead.
 */
// Aevum confirms in ~1 s; checking for receipts every 300 ms answers a payment that much sooner.
export const publicClient = createPublicClient({ chain, transport: http(RPC_URL), pollingInterval: 300 });

export function explorerTx(hash: string): string {
  return CHAIN_ID === 44005 ? `https://explorer-test.qday.info/tx/${hash}` : "";
}

export function relayer() {
  if (!RELAYER_PRIVATE_KEY) throw new Error("RELAYER_PRIVATE_KEY not configured");
  return privateKeyToAccount(RELAYER_PRIVATE_KEY);
}

export function relayerWallet() {
  return createWalletClient({ account: relayer(), chain, transport: http(RPC_URL) });
}

/**
 * The relayer sends from one address, so its transactions must go out one at a time or they race
 * for the same nonce (payments, agent payments and the subscription collector all use it).
 */
let relayQueue: Promise<unknown> = Promise.resolve();
export function withRelayer<T>(fn: () => Promise<T>): Promise<T> {
  const run = relayQueue.then(fn, fn);
  relayQueue = run.catch(() => undefined);
  return run;
}

export async function balanceOf(address: Address): Promise<bigint> {
  return publicClient.readContract({
    address: TUSD8_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

export async function resolveUsername(username: string): Promise<Address> {
  return (await publicClient.readContract({
    address: AEVUMPAY_ADDRESS,
    abi: aevumPayAbi,
    functionName: "resolve",
    args: [username],
  })) as Address;
}

export async function nextPaymentId(): Promise<bigint> {
  return (await publicClient.readContract({
    address: AEVUMPAY_ADDRESS,
    abi: aevumPayAbi,
    functionName: "nextPaymentId",
  })) as bigint;
}

export async function nextProductId(): Promise<bigint> {
  return (await publicClient.readContract({
    address: AEVUMPAY_ADDRESS,
    abi: aevumPayAbi,
    functionName: "nextProductId",
  })) as bigint;
}

/**
 * Make sure `address` can pay for one transaction costing up to `need` wei. We top up only the
 * shortfall plus 20%, never a fixed float, so throwaway accounts can't collect tQDAY from the relayer;
 * each top-up is also charged to the daily budget (see budget.ts).
 */
export async function ensureGas(address: Address, need: bigint): Promise<boolean> {
  const bal = await publicClient.getBalance({ address });
  if (bal >= need) return false;
  const amount = ((need - bal) * 120n) / 100n;
  chargeTopUp(address, amount);
  await withRelayer(async () => {
    const hash = await relayerWallet().sendTransaction({ to: address, value: amount } as never);
    await publicClient.waitForTransactionReceipt({ hash });
  });
  return true;
}

/** The 0.5% merchant fee the contract takes on store purchases and subscription charges. */
export async function feeFor(amount: bigint): Promise<bigint> {
  return (await publicClient.readContract({
    address: AEVUMPAY_ADDRESS,
    abi: aevumPayAbi,
    functionName: "feeFor",
    args: [amount],
  })) as bigint;
}

// ---------------- user transactions, signed in the browser ----------------

/** Pull the decoded custom-error name out of a viem error, e.g. "UsernameTooShort". */
function ruleNameFromError(e: unknown): string | null {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) {
      const n = (r.data as { errorName?: string } | null)?.errorName ?? r.reason;
      return n ?? null;
    }
  }
  return null;
}

/**
 * What a browser needs to sign a legacy tx for `address`. With `call`, also a gas limit: the node's
 * estimate plus 25%, which fails early (before anything is signed) if the call would revert.
 */
export async function txParams(address: Address, call?: { to: Address; data: Hex }) {
  const [nonce, gasPrice] = await Promise.all([
    publicClient.getTransactionCount({ address, blockTag: "pending" }),
    publicClient.getGasPrice(),
  ]);
  let gas: bigint | undefined;
  if (call) {
    // QDay's estimateGas answers "Execution reverted for an unknown reason" with no data, so the
    // app can't name the rule. Simulate through the ABI first (eth_call decodes the custom error),
    // then rethrow as "Rule()" so the shared error handler names it.
    if (call.to.toLowerCase() === AEVUMPAY_ADDRESS.toLowerCase()) {
      let decoded: { functionName: string; args?: readonly unknown[] } | null = null;
      try {
        decoded = decodeFunctionData({ abi: aevumPayAbi, data: call.data }) as {
          functionName: string;
          args?: readonly unknown[];
        };
      } catch {
        decoded = null;
      }
      if (decoded) {
        try {
          await publicClient.simulateContract({
            account: address,
            address: AEVUMPAY_ADDRESS,
            abi: aevumPayAbi,
            functionName: decoded.functionName,
            args: decoded.args,
          } as never);
        } catch (e) {
          const name = ruleNameFromError(e);
          if (name) throw new Error(`${name}()`);
          throw e;
        }
      }
    }
    const est = await publicClient.estimateGas({ account: address, to: call.to, data: call.data });
    gas = (est * 125n) / 100n;
    if (gas > MAX_USER_GAS) throw new Error("BAD_TX: this call needs more gas than we relay");
  }
  return { chainId: CHAIN_ID, nonce, gasPrice, gas };
}

/**
 * Contract calls a user may send through us. Anything else is refused.
 *
 * `changeUsername` is deliberately NOT here: the browser salts the password key derivation with the
 * username (web/src/lib/wallet.ts), so a rename would change both the auth key and the key that
 * decrypts the wallet backup. Supporting renames needs a flow that re-derives with the new name,
 * re-encrypts the backup and replaces the stored auth hash in the same step.
 */
const USER_CALLS = new Set([
  "register",
  "createStore",
  "renameStore",
  "setStoreActive",
  "addProduct",
  "setProductActive",
  "grantAllowance",
  "revokeAllowance",
  "createPlan",
  "setPlanActive",
  "subscribe",
  "cancelSubscription",
  "collect",
]);
const MAX_USER_GAS = 800_000n;
/**
 * Token approvals to AevumPay (needed for allowances and subscriptions) are capped: we refuse to relay
 * an "unlimited" approval, so a bug can never expose a whole wallet. 100,000 tUSD8.
 */
export const MAX_APPROVAL = 100_000n * 1_000_000n;

/**
 * Decode and check a raw, browser-signed transaction before we pay gas for it: it must be signed
 * by `expectedFrom`, call AevumPay on this chain, use an allowed function, and not overpay for gas
 * (so a caller can't burn the relayer's top-ups).
 */
export async function inspectUserTx(raw: Hex, expectedFrom: Address) {
  let tx: ReturnType<typeof parseTransaction>;
  try {
    tx = parseTransaction(raw);
  } catch {
    throw new Error("BAD_TX: not a signed transaction");
  }
  const from = await recoverTransactionAddress({ serializedTransaction: raw as never });
  if (from.toLowerCase() !== expectedFrom.toLowerCase()) throw new Error("BAD_TX: signed by a different wallet");
  if (tx.chainId !== CHAIN_ID) throw new Error("BAD_TX: wrong chain");
  if (tx.value && tx.value !== 0n) throw new Error("BAD_TX: must not send value");
  if (!tx.data) throw new Error("BAD_TX: no call data");
  const to = tx.to?.toLowerCase();
  let call: { functionName: string; args?: readonly unknown[] };
  if (to === AEVUMPAY_ADDRESS.toLowerCase()) {
    call = decodeFunctionData({ abi: aevumPayAbi, data: tx.data });
    if (!USER_CALLS.has(call.functionName)) throw new Error(`BAD_TX: ${call.functionName} is not allowed`);
  } else if (to === TUSD8_ADDRESS.toLowerCase()) {
    // The only token call we relay: approve(AevumPay, capped amount).
    call = decodeFunctionData({ abi: erc20Abi, data: tx.data });
    const [spender, amount] = (call.args ?? []) as [Address, bigint];
    if (call.functionName !== "approve" || spender.toLowerCase() !== AEVUMPAY_ADDRESS.toLowerCase()) {
      throw new Error("BAD_TX: only approve(AevumPay, amount) is allowed on the token");
    }
    if (amount > MAX_APPROVAL) throw new Error("BAD_TX: approval above the 100,000 tUSD8 cap");
  } else {
    throw new Error("BAD_TX: must call AevumPay or approve it on tUSD8");
  }
  const gas = tx.gas ?? 0n;
  const price = tx.gasPrice ?? 0n;
  const current = await publicClient.getGasPrice();
  if (gas === 0n || gas > MAX_USER_GAS) throw new Error("BAD_TX: gas limit out of range");
  if (price > current * 3n + 1_000_000_000n) throw new Error("BAD_TX: gas price too high");
  return { from, functionName: call.functionName, args: (call.args ?? []) as readonly unknown[] };
}

/** Top up the user's gas from the relayer, then broadcast their signed tx and wait for it. */
export async function broadcastUserTx(raw: Hex, from: Address) {
  const tx = parseTransaction(raw);
  // The most this tx can cost: its own gas limit at its own price (inspectUserTx bounded both).
  await ensureGas(from, (tx.gas ?? 0n) * (tx.gasPrice ?? 0n));
  const hash = await publicClient.sendRawTransaction({ serializedTransaction: raw });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("TX_REVERTED");
  return { hash, receipt };
}

/** Local-only faucet: mint MockUSD8 to an address. */
export async function devMint(to: Address, amount: bigint): Promise<Hex> {
  return withRelayer(() => devMintNow(to, amount));
}

async function devMintNow(to: Address, amount: bigint): Promise<Hex> {
  const rl = relayer();
  const wallet = createWalletClient({ account: rl, chain, transport: http(RPC_URL) });
  const hash = await wallet.writeContract({
    address: TUSD8_ADDRESS,
    abi: mockMintAbi,
    functionName: "mint",
    args: [to, amount],
    chain,
    account: rl,
  } as never);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// Payment history comes from the event index (indexer.ts), not a per-request log scan.

// Usernames can move between wallets, so this cache is short: it only saves repeated lookups of
// the same counterparties across one burst of page loads.
const NAME_TTL_MS = 60_000;
const names = new Map<string, { name: string; at: number }>();

/** Username for an address, or "" if none. */
export async function usernameFor(address: Address): Promise<string> {
  const k = address.toLowerCase();
  const hit = names.get(k);
  if (hit && Date.now() - hit.at < NAME_TTL_MS) return hit.name;
  try {
    const name = (await publicClient.readContract({
      address: AEVUMPAY_ADDRESS,
      abi: aevumPayAbi,
      functionName: "usernameOf",
      args: [address],
    })) as string;
    names.set(k, { name, at: Date.now() });
    return name;
  } catch {
    return "";
  }
}

/** Mirrors AevumPay.paymentNonce: the EIP-3009 nonce commits to payee, product and memo. */
const PAYMENT_NONCE_TAG = keccak256(toHex("AevumPay.payment.v2"));
export function paymentNonce(payee: Address, productId: bigint, memo: Hex, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }],
      [PAYMENT_NONCE_TAG, payee, productId, memo, salt],
    ),
  );
}

export const memoHash = (memoText: string): Hex => keccak256(toHex(memoText));

/** A browser-signed EIP-3009 `ReceiveWithAuthorization` (from the user, to AevumPay). */
export interface SignedAuthorization {
  from: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  salt: Hex;
  signature: Hex;
}

/**
 * Check the signature locally before the relayer spends gas on it. `nonce` is what the browser must
 * have signed for this payee/product/memo, so a signature for anything else fails here (and on-chain).
 */
export async function verifyAuthorization(a: SignedAuthorization, nonce: Hex): Promise<boolean> {
  try {
    return await verifyTypedData({
      address: a.from,
      domain: { name: "tUSD8", version: "2", chainId: CHAIN_ID, verifyingContract: TUSD8_ADDRESS },
      types: receiveWithAuthorizationTypes,
      primaryType: "ReceiveWithAuthorization",
      message: {
        from: a.from,
        to: AEVUMPAY_ADDRESS,
        value: a.value,
        validAfter: a.validAfter,
        validBefore: a.validBefore,
        nonce,
      },
      signature: a.signature,
    });
  } catch {
    return false;
  }
}

function authTuple(a: SignedAuthorization) {
  const parsed = parseSignature(a.signature);
  const v = Number(parsed.v ?? 27n + BigInt(parsed.yParity ?? 0));
  return { from: a.from, validAfter: a.validAfter, validBefore: a.validBefore, salt: a.salt, v, r: parsed.r, s: parsed.s };
}

/** Called with the transaction hash as soon as a relayed payment is broadcast (before it confirms). */
export type OnSent = (hash: Hex) => void;

/**
 * Relay a signed payment to `toUsername`. The relayer pays gas; it never holds the user's key.
 * The caller has already checked that the name exists (the contract checks again).
 */
export async function relayUsernamePayment(toUsername: string, a: SignedAuthorization, memoText = "", onSent?: OnSent) {
  chargeRelayTx(a.from);
  return relayPayment("payUsernameWithAuthorization", [toUsername, a.value, memoHash(memoText), authTuple(a)], onSent);
}

/** Relay a signed product purchase. The contract re-reads the price, so `a.value` must match it. */
export async function relayProductPayment(productId: bigint, a: SignedAuthorization, memoText = "", onSent?: OnSent) {
  chargeRelayTx(a.from);
  return relayPayment("payProductWithAuthorization", [productId, memoHash(memoText), authTuple(a)], onSent);
}

/** The relayer submits a signed payment, pays the gas, and we read the payment id from `Paid`. */
async function relayPayment(functionName: string, args: unknown[], onSent?: OnSent) {
  return withRelayer(() => relayPaymentNow(functionName, args, onSent));
}

// The gas price barely moves on Aevum; asking for it on every payment costs a round trip.
let gasPriceCache: { value: bigint; at: number } | null = null;
async function gasPriceNow(): Promise<bigint> {
  if (gasPriceCache && Date.now() - gasPriceCache.at < 15_000) return gasPriceCache.value;
  const value = await publicClient.getGasPrice();
  gasPriceCache = { value, at: Date.now() };
  return value;
}

/**
 * Exported for the agent relay; callers must go through withRelayer (one relayer transaction at a
 * time, so the pending nonce read here is the right one).
 *
 * Speed: the testnet RPC takes ~1 s per call, so the nonce, gas price and gas estimate are fetched
 * together (the estimate also simulates the call: a payment the contract would refuse fails here
 * and costs nothing), then the transaction is signed locally as a legacy tx and sent.
 */
export async function relayPaymentNow(functionName: string, args: unknown[], onSent?: OnSent) {
  const rl = relayer();
  const data = encodeFunctionData({ abi: aevumPayAbi, functionName, args } as never);
  const [nonce, gasPrice, gas] = await Promise.all([
    publicClient.getTransactionCount({ address: rl.address, blockTag: "pending" }),
    gasPriceNow(),
    publicClient.estimateGas({ account: rl, to: AEVUMPAY_ADDRESS, data }).catch(async (e) => {
      // The raw estimate can't name the contract's error; a simulation with the ABI can.
      await publicClient.simulateContract({ address: AEVUMPAY_ADDRESS, abi: aevumPayAbi, functionName, args, account: rl } as never);
      throw e;
    }),
  ]);
  const serializedTransaction = await rl.signTransaction({
    type: "legacy",
    chainId: CHAIN_ID,
    to: AEVUMPAY_ADDRESS,
    data,
    nonce,
    gasPrice,
    gas: (gas * 13n) / 10n, // headroom over the estimate
  });
  const hash = await publicClient.sendRawTransaction({ serializedTransaction });
  try {
    onSent?.(hash);
  } catch {
    /* a notification problem must not fail the payment */
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);

  let paymentId = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== AEVUMPAY_ADDRESS.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: aevumPayAbi,
        eventName: "Paid",
        data: log.data,
        topics: log.topics,
      });
      paymentId = (decoded.args as unknown as { paymentId: bigint }).paymentId;
    } catch {
      /* not the Paid event */
    }
  }
  if (paymentId === 0n) paymentId = (await nextPaymentId()) - 1n;
  return { hash, paymentId, blockNumber: receipt.blockNumber };
}
