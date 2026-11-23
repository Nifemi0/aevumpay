"use client";

/**
 * Everything the browser signs. The server only relays what we hand it.
 *  - Payments: an EIP-3009 `ReceiveWithAuthorization` for one exact amount, to AevumPay, valid 10 min.
 *  - Contract calls (register, createStore, addProduct…): a legacy tx the server tops up and broadcasts.
 */

import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseUnits, toHex, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { api } from "./api";

export interface ChainConfig {
  chainId: number;
  aevumPay: Address;
  tusd8: Address;
  hasExplorer: boolean;
}

let configPromise: Promise<ChainConfig> | null = null;
export function chainConfig(): Promise<ChainConfig> {
  configPromise ??= api.config().catch((e) => {
    configPromise = null;
    throw e;
  });
  return configPromise;
}

const userCalls = parseAbi([
  "function register(string username)",
  "function createStore(string name)",
  "function addProduct(string name, uint256 price) returns (uint256)",
  "function setProductActive(uint256 productId, bool active)",
  "function grantAllowance(address agent, uint128 budget, uint128 maxPerPayment, uint64 expiresAt, address[] payees)",
  "function revokeAllowance(address agent)",
  "function createPlan(string name, uint128 amount, uint64 period) returns (uint256)",
  "function setPlanActive(uint256 planId, bool active)",
  "function subscribe(uint256 planId, uint32 maxPayments) returns (uint256)",
  "function cancelSubscription(uint256 subscriptionId)",
  "function collect(uint256 subscriptionId) returns (bool)",
]);

const tokenCalls = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

type UserCall =
  | { functionName: "register"; args: [string] }
  | { functionName: "createStore"; args: [string] }
  | { functionName: "addProduct"; args: [string, bigint] }
  | { functionName: "setProductActive"; args: [bigint, boolean] }
  | { functionName: "grantAllowance"; args: [Address, bigint, bigint, bigint, Address[]] }
  | { functionName: "revokeAllowance"; args: [Address] }
  | { functionName: "createPlan"; args: [string, bigint, bigint] }
  | { functionName: "setPlanActive"; args: [bigint, boolean] }
  | { functionName: "subscribe"; args: [bigint, number] }
  | { functionName: "cancelSubscription"; args: [bigint] }
  | { functionName: "collect"; args: [bigint] };

/** Sign a call to AevumPay from the user's own wallet. Gas is topped up by the server before broadcast. */
export async function signContractCall(account: PrivateKeyAccount, call: UserCall): Promise<Hex> {
  const cfg = await chainConfig();
  return signTx(account, cfg.aevumPay, encodeFunctionData({ abi: userCalls, ...call } as never));
}

/**
 * Let AevumPay draw up to `amount` tUSD8 from this wallet (needed for allowances and subscriptions).
 * Never unlimited: the server refuses approvals above 100,000 tUSD8, and 0 revokes everything.
 */
export async function signApproval(account: PrivateKeyAccount, amount: bigint): Promise<Hex> {
  const cfg = await chainConfig();
  return signTx(account, cfg.tusd8, encodeFunctionData({ abi: tokenCalls, functionName: "approve", args: [cfg.aevumPay, amount] }));
}

async function signTx(account: PrivateKeyAccount, to: Address, data: Hex): Promise<Hex> {
  const cfg = await chainConfig();
  // The server estimates gas (with headroom) and fails here, before signing, if the call would revert.
  const params = await api.txParams(account.address, { to, data });
  return account.signTransaction({
    type: "legacy",
    chainId: cfg.chainId,
    nonce: params.nonce,
    gasPrice: BigInt(params.gasPrice),
    gas: params.gas ? BigInt(params.gas) : 300_000n,
    to,
    value: 0n,
    data,
  });
}

export interface Authorization {
  value: string;
  validAfter: string;
  validBefore: string;
  salt: Hex;
  signature: Hex;
}

const PAYMENT_NONCE_TAG = keccak256(toHex("AevumPay.payment.v2"));

/** Mirrors AevumPay.paymentNonce: what we sign commits to the payee, product and memo. */
export function paymentNonce(payee: Address, productId: bigint, memoText: string, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }],
      [PAYMENT_NONCE_TAG, payee, productId, keccak256(toHex(memoText)), salt],
    ),
  );
}

/**
 * Sign permission for AevumPay to move exactly `amount` tUSD8 from this wallet to `payee`, once,
 * within 10 minutes. The payee, product and memo are baked into the signed nonce, so nobody who
 * relays it (including our server) can send the money anywhere else.
 */
export async function signPayment(
  account: PrivateKeyAccount,
  amount: string,
  to: { payee: Address; productId?: bigint; memo?: string },
): Promise<Authorization> {
  const cfg = await chainConfig();
  const value = parseUnits(amount, 6);
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const nonce = paymentNonce(to.payee, to.productId ?? 0n, to.memo ?? "", salt);
  const signature = await account.signTypedData({
    domain: { name: "tUSD8", version: "2", chainId: cfg.chainId, verifyingContract: cfg.tusd8 },
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "ReceiveWithAuthorization",
    message: { from: account.address, to: cfg.aevumPay, value, validAfter, validBefore, nonce },
  });
  return { value: value.toString(), validAfter: validAfter.toString(), validBefore: validBefore.toString(), salt, signature };
}

/** The relay refuses approvals above this (100,000 tUSD8), so we never ask for more. */
export const MAX_APPROVAL = 100_000n * 1_000_000n;

/**
 * Make sure AevumPay may draw at least `extra` more than it may now, by signing a new approval in
 * this browser. Approvals are shared by allowances and subscriptions, so we add to the current one
 * instead of replacing it, and never go above the cap.
 */
export async function raiseApproval(account: PrivateKeyAccount, extra: bigint): Promise<void> {
  const { approved } = await api.approval();
  const current = parseUnits(approved, 6);
  let target = current + extra;
  if (target > MAX_APPROVAL) target = MAX_APPROVAL;
  if (target <= current) return;
  await api.sendTx(await signApproval(account, target));
}
