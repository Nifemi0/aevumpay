import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  http,
  keccak256,
  parseSignature,
  toHex,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { randomBytes } from "node:crypto";
import { RPC_URL, CHAIN_ID, AEVUMPAY_ADDRESS, TUSD8_ADDRESS, RELAYER_PRIVATE_KEY } from "./config";
import { aevumPayAbi, erc20Abi, mockMintAbi, paidEvent, receiveWithAuthorizationTypes } from "./abi";

export const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 44005 ? "QDay Aevum Testnet" : `Aevum (${CHAIN_ID})`,
  nativeCurrency: { name: "Test QDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  testnet: true,
});

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

export function explorerTx(hash: string): string {
  return CHAIN_ID === 44005 ? `https://explorer-test.qday.info/tx/${hash}` : "";
}

function relayer() {
  if (!RELAYER_PRIVATE_KEY) throw new Error("RELAYER_PRIVATE_KEY not configured");
  return privateKeyToAccount(RELAYER_PRIVATE_KEY);
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

/** "0.01 tQDAY" — enough for a handful of register/createStore txs. */
const GAS_MIN = 10_000_000_000_000_000n;
const GAS_TOPUP = 50_000_000_000_000_000n;

/** Top a user's wallet up with a little native gas from the relayer, if needed. */
export async function ensureGas(address: Address): Promise<boolean> {
  const bal = await publicClient.getBalance({ address });
  if (bal >= GAS_MIN) return false;
  const rl = relayer();
  const wallet = createWalletClient({ account: rl, chain, transport: http(RPC_URL) });
  const hash = await wallet.sendTransaction({ to: address, value: GAS_TOPUP });
  await publicClient.waitForTransactionReceipt({ hash });
  return true;
}

async function sendAsUser(privateKey: Hex, functionName: string, args: unknown[]) {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
  const hash = await wallet.writeContract({
    address: AEVUMPAY_ADDRESS,
    abi: aevumPayAbi,
    functionName,
    args,
    chain,
    account,
  } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

export async function registerOnChain(privateKey: Hex, username: string) {
  await ensureGas(privateKeyToAccount(privateKey).address);
  return sendAsUser(privateKey, "register", [username]);
}

export async function createStoreOnChain(privateKey: Hex, name: string) {
  await ensureGas(privateKeyToAccount(privateKey).address);
  return sendAsUser(privateKey, "createStore", [name]);
}

export async function addProductOnChain(privateKey: Hex, name: string, price: bigint) {
  await ensureGas(privateKeyToAccount(privateKey).address);
  return sendAsUser(privateKey, "addProduct", [name, price]);
}

/** Local-only faucet: mint MockUSD8 to an address. */
export async function devMint(to: Address, amount: bigint): Promise<Hex> {
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

// ---------------- payment history (chunked logs) ----------------

export interface PaymentEvent {
  paymentId: bigint;
  payer: Address;
  payee: Address;
  amount: bigint;
  productId: bigint;
  memo: Hex;
  blockNumber: bigint;
  txHash: Hex;
  logIndex: number;
}

// Aevum caps eth_getLogs at 1,000 blocks per call.
const LOG_CHUNK = 999n;

/** Every `Paid` event where `user` is payer or payee, newest first. */
export async function getPaymentsFor(user: Address, maxResults = 100): Promise<PaymentEvent[]> {
  const latest = await publicClient.getBlockNumber();
  const start = process.env.AEVUMPAY_DEPLOY_BLOCK ? BigInt(process.env.AEVUMPAY_DEPLOY_BLOCK) : 0n;
  const out: PaymentEvent[] = [];

  async function scan(args: { payer?: Address; payee?: Address }) {
    for (let from = start; from <= latest; from += LOG_CHUNK + 1n) {
      const to = from + LOG_CHUNK > latest ? latest : from + LOG_CHUNK;
      const logs = await publicClient.getLogs({
        address: AEVUMPAY_ADDRESS,
        event: paidEvent,
        args: args as never,
        fromBlock: from,
        toBlock: to,
      });
      for (const l of logs) {
        const a = l.args as unknown as Omit<PaymentEvent, "blockNumber" | "txHash" | "logIndex">;
        out.push({
          ...a,
          blockNumber: l.blockNumber ?? 0n,
          txHash: l.transactionHash ?? ("0x" as Hex),
          logIndex: l.logIndex ?? 0,
        });
      }
    }
  }

  await scan({ payer: user });
  await scan({ payee: user });

  out.sort((a, b) =>
    a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1,
  );
  return out.slice(0, maxResults);
}

/** Username for an address, or "" if none. */
export async function usernameFor(address: Address): Promise<string> {
  try {
    return (await publicClient.readContract({
      address: AEVUMPAY_ADDRESS,
      abi: aevumPayAbi,
      functionName: "usernameOf",
      args: [address],
    })) as string;
  } catch {
    return "";
  }
}

/**
 * Pay `toUsername` gaslessly: the payer signs an EIP-3009 `ReceiveWithAuthorization`
 * with `to = AevumPay`, and the relayer submits `payUsernameWithAuthorization` and pays gas.
 */
export async function gaslessPay(params: {
  fromPrivateKey: Hex;
  toUsername: string;
  amount: bigint;
  memo?: string;
}): Promise<{ hash: Hex; paymentId: bigint }> {
  const account = privateKeyToAccount(params.fromPrivateKey);
  const toWallet = await resolveUsername(params.toUsername);
  if (toWallet === zeroAddress) throw new Error("UNKNOWN_USER");

  const nonce = ("0x" + randomBytes(32).toString("hex")) as Hex;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const validAfter = 0n;
  const validBefore = now + 600n;
  const memo = keccak256(toHex(params.memo ?? ""));

  const signature = await account.signTypedData({
    domain: { name: "tUSD8", version: "2", chainId: CHAIN_ID, verifyingContract: TUSD8_ADDRESS },
    types: receiveWithAuthorizationTypes,
    primaryType: "ReceiveWithAuthorization",
    message: {
      from: account.address,
      to: AEVUMPAY_ADDRESS,
      value: params.amount,
      validAfter,
      validBefore,
      nonce,
    },
  });

  const parsed = parseSignature(signature);
  const v = Number(parsed.v ?? 27n + BigInt(parsed.yParity ?? 0));

  const rl = relayer();
  const wallet = createWalletClient({ account: rl, chain, transport: http(RPC_URL) });
  const hash = await wallet.writeContract({
    address: AEVUMPAY_ADDRESS,
    abi: aevumPayAbi,
    functionName: "payUsernameWithAuthorization",
    args: [
      params.toUsername,
      account.address,
      params.amount,
      validAfter,
      validBefore,
      nonce,
      memo,
      v,
      parsed.r,
      parsed.s,
    ],
    chain,
    account: rl,
  } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

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
  return { hash, paymentId };
}
