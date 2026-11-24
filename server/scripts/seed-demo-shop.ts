/**
 * Set up the Demo Bakery: a shop new users can buy from straight after claiming welcome dollars.
 *
 *   pnpm --filter server seed:demo        (uses .env.aevum, i.e. Aevum testnet)
 *
 * The shop belongs to the grant wallet (GRANT_PRIVATE_KEY, or the treasury key), so every demo
 * purchase flows back into the welcome-dollar pot. Safe to run again: it skips whatever exists.
 * The relayer pays the gas (it tops up the grant wallet with just enough tQDAY first).
 */
import { createWalletClient, formatEther, http, parseUnits, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { AEVUMPAY_ADDRESS, RPC_URL } from "../src/config";
import { aevumPayAbi } from "../src/abi";
import { chain, publicClient, relayerWallet } from "../src/chain";

const USERNAME = process.env.DEMO_SHOP_USERNAME || "demobakery";
const STORE_NAME = process.env.DEMO_SHOP_NAME || "Demo Bakery";
const PRODUCTS: [string, string][] = [
  ["Sourdough loaf", "1.50"],
  ["Butter croissant", "0.75"],
  ["Weekend box", "3.00"],
];

const key = (process.env.GRANT_PRIVATE_KEY || process.env.TREASURY_PRIVATE_KEY) as Hex | undefined;
if (!key) throw new Error("Set GRANT_PRIVATE_KEY or TREASURY_PRIVATE_KEY: the demo shop belongs to the grant wallet.");
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });

const read = <T>(functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address: AEVUMPAY_ADDRESS, abi: aevumPayAbi, functionName, args } as never) as Promise<T>;

async function send(functionName: string, args: unknown[]) {
  const data = { address: AEVUMPAY_ADDRESS, abi: aevumPayAbi, functionName, args } as const;
  const gas = ((await publicClient.estimateContractGas({ ...data, account } as never)) * 125n) / 100n;
  const gasPrice = await publicClient.getGasPrice();
  const need = gas * gasPrice;
  const have = await publicClient.getBalance({ address: account.address });
  if (have < need) {
    const top = ((need - have) * 150n) / 100n;
    const h = await relayerWallet().sendTransaction({ to: account.address, value: top } as never);
    await publicClient.waitForTransactionReceipt({ hash: h });
    console.log(`  gas top-up ${formatEther(top)} tQDAY`);
  }
  const hash = await wallet.writeContract({ ...data, gas, gasPrice, type: "legacy" } as never);
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
  console.log(`  ${functionName} ✓ ${hash}`);
}

console.log(`Demo shop wallet: ${account.address} on chain ${chain.id}`);

const owner = await read<Address>("resolve", [USERNAME]);
const mine = await read<string>("usernameOf", [account.address]);
if (owner !== zeroAddress && owner.toLowerCase() !== account.address.toLowerCase()) {
  throw new Error(`@${USERNAME} belongs to someone else (${owner}). Pick another DEMO_SHOP_USERNAME.`);
}
if (mine && mine !== USERNAME) throw new Error(`This wallet is already @${mine}. Set DEMO_SHOP_USERNAME=${mine} to use it.`);
if (!mine) await send("register", [USERNAME]);
else console.log(`  @${USERNAME} already registered`);

const store = await read<{ name: string }>("getStore", [account.address]);
if (!store.name) await send("createStore", [STORE_NAME]);
else console.log(`  store "${store.name}" already exists`);

const next = Number(await read<bigint>("nextProductId"));
const have = new Set<string>();
for (let i = 1; i < next; i++) {
  const p = await read<{ merchant: Address; name: string }>("getProduct", [BigInt(i)]);
  if (p.merchant.toLowerCase() === account.address.toLowerCase()) have.add(p.name);
}
for (const [name, price] of PRODUCTS) {
  if (have.has(name)) console.log(`  "${name}" already listed`);
  else await send("addProduct", [name, parseUnits(price, 6)]);
}

// A subscription plan, short and cheap so a demo can show a renewal live (the contract minimum period is 60s).
const PLAN_NAME = "Bread Club";
const nextPlan = Number(await read<bigint>("nextPlanId"));
let hasPlan = false;
for (let i = 1; i < nextPlan; i++) {
  const p = await read<{ merchant: Address; name: string }>("getPlan", [BigInt(i)]);
  if (p.merchant.toLowerCase() === account.address.toLowerCase() && p.name === PLAN_NAME) hasPlan = true;
}
if (hasPlan) console.log(`  plan "${PLAN_NAME}" already exists`);
else await send("createPlan", [PLAN_NAME, parseUnits("0.10", 6), 60n]);

console.log(`Done. Shop: /shop/${USERNAME}`);
