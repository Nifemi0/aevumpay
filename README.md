# AevumPay

**Stablecoin payments on QDay Aevum — by `@username`, not by wallet address.**

AevumPay lets anyone send and receive **tUSD8** using a name they choose (`@ada`), with a real
self-custody wallet created in the browser. Small businesses open a store and get paid by link.
AI agents can be given an **on-chain spending allowance** with hard limits. Everything settles on
the **QDay Aevum testnet** (chain `44005`).

| | |
|---|---|
| **Live app** | **https://pay.nuvixes.studio** (also https://aevumpay-theta.vercel.app) |
| **Live API** | **https://api.pay.nuvixes.studio** (also https://aevumpay.104-252-77-136.sslip.io) |
| **Network** | QDay Aevum testnet · chain `44005` · explorer https://explorer-test.qday.info |
| **Contract** | [`0xAA36d954e8930FFe29078bDF67975534A31895F7`](https://explorer-test.qday.info/address/0xAA36d954e8930FFe29078bDF67975534A31895F7) |
| **Built for** | Aevum Builder Challenge #1 (DoraHacks) |

---

## Contents

- [The problem](#the-problem)
- [What AevumPay is](#what-aevumpay-is)
- [Features](#features)
- [Architecture](#architecture)
- [Deployed on Aevum testnet](#deployed-on-aevum-testnet)
- [How the money moves](#how-the-money-moves)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Run it locally](#run-it-locally)
- [Environment variables](#environment-variables)
- [Security model](#security-model)
- [Testing](#testing)
- [Known limits & roadmap](#known-limits--roadmap)
- [Credits & license](#credits--license)

---

## The problem

Stablecoins are the useful part of crypto, but paying with them is still made for traders:

- **Addresses are unusable.** A first-time user is asked to copy `0x8f3c…a41d`, check the chain,
  and buy gas before they can do anything.
- **Custody is the wrong default.** Most "easy" apps hold your keys. One server bug and everyone's
  balance is gone.
- **Small merchants can't accept it.** There is no simple "get paid in dollars by link" flow without
  a processor.
- **Agents can't be trusted with money.** If you give an AI agent a wallet to pay for things, a
  single prompt injection can drain it.

## What AevumPay is

A payments app for **people and small businesses** where the identity is a `@username` and the money
is real **tUSD8**, with three ideas that make it safe:

1. **Browser-held keys.** Your wallet is generated in your browser. The private key is encrypted with
   a key derived from your password (PBKDF2 → AES-GCM) and never leaves the device in the clear. The
   server stores only an **encrypted backup it cannot open** and an **auth-key hash** — it never holds
   a key that can move your money. You can export the key any time; that is true self-custody.
2. **Gasless by default.** A payment is an **EIP-3009** signature. A relayer submits it and pays the
   gas, so a new user needs **zero tQDAY** to send money. Gasless is the default path, not an add-on.
3. **A non-custodial contract.** `AevumPay.sol` never holds user funds. Every payment goes straight
   from the payer's wallet to the payee's (and the fee to the treasury) in the same transaction. It has
   **no owner, no admin, and no upgrade path.**

**Identity lives on-chain, in AevumPay's own contract.** Each wallet registers its `@username` in
`AevumPay.sol` (signed in the browser), and an AI agent is identified by its own key plus the allowance
its owner granted it on-chain. We don't use ERC-8004: QDay's ERC-8004 registry is still in internal
testing and isn't open for this challenge, and the
[Aevum starter kit](https://github.com/qday-io/aevum-starter-kit) says to keep the name-to-address
mapping in your own contract. That is what AevumPay does.

On top of that, a new account can claim **welcome dollars** so they can try the product immediately,
and a **Demo Bakery** shop is seeded so they have something to buy.

## Features

**Identity & onboarding**
- Sign up with a `@username` (3–24 chars); the wallet is created automatically.
- Two-step sign-up with a passphrase strength meter; a forgotten password can't be reset (export the key instead).
- Unlock on a new device by entering your password (the encrypted backup is fetched, the key is decrypted locally).
- Export the private key from Profile.

**Money**
- Send to `@username` — instant, one tap, no address.
- Receive by `@username` or a shareable request link / QR.
- Real on-chain receipt with a tx hash and explorer link.
- Activity list read from on-chain `Paid` events (chunked under Aevum's 1,000-block log cap).

**Stores & checkout**
- Open a store, add products (name + price), pause products or the store.
- Public store page `/shop/@username` and a checkout page per product.
- A **fixed 0.5% merchant fee** on store purchases and subscription charges, to an immutable treasury. Person-to-person stays free.

**Agent allowances (for AI agents, bots, scripts)**
- Let an agent key spend from your wallet within: a **total budget**, a **per-payment cap**, an **expiry**, and an optional **payee allow-list**.
- **Instant revoke.** Spending permissions page shows spent/budget and a "Stop all automatic spending" switch (approve 0).
- The agent signs an EIP-712 `AgentPayment` with its **own** key; the limits are enforced **on-chain**, so a prompt injection cannot exceed them.
- Reusable `@aevumpay/agent` SDK and `@aevumpay/mcp` (an MCP server so Claude/Cursor/etc. can pay).
- **MCP first for AI agents:** a hosted, read-only MCP server at `https://api.pay.nuvixes.studio/mcp`
  (no install; users, stores, pay links, allowances, receipts) and, to pay, the local one:
  `npx -y @aevumpay/mcp` (keeps the agent's own key on its machine). Discovery: `/llms.txt`,
  `/.well-known/mcp.json` and an `mcp-server` meta tag on every page.

**Subscriptions**
- Merchants create a plan (amount + period, minimum 60 s).
- Subscribing charges the first period and **copies the terms** — later price changes never touch existing subscribers.
- **Permissionless collection:** anyone (the merchant dashboard, our optional collector, or a third party) can trigger a due charge; the contract decides what's due.
- At most one charge per period, **never back-charged** for missed periods, soft-fail with a grace period, then `Lapsed`. Either party can cancel.

**Welcome dollars**
- Each new account can claim a small tUSD8 grant once (rate-limited per account, per wallet, per IP/day, and a daily total). Switchable off with `GRANT_DAILY_LIMIT=0`.

## Architecture

```
                      ┌───────────────────────────────────────────────┐   ┌────────────────────────────┐
   Browser            │  web/  (Next.js 16, React 19)                 │   │  AI agent (Claude, Cursor…)│
   ─────────          │  • wallet keys generated + encrypted here     │   │  • @aevumpay/mcp (npx):    │
   ● keys (PBKDF2)    │  • signs EIP-3009 payments and contract calls │   │    own agent key, signs    │
   ● signs txs        │  • public pages rendered on the server        │   │    EIP-712 AgentPayment    │
   ● IndexedDB        │  • live updates over SSE (/events)            │   │  • or hosted /mcp (reads)  │
                      └───────────────────────┬───────────────────────┘   └─────────────┬──────────────┘
                                              │ HTTPS (signed payloads)                 │ MCP / HTTPS
                      ┌───────────────────────▼─────────────────────────────────────────▼──────────────┐
   Server (Node 22)   │  server/  (Express + viem)                                                     │
   ─────────          │  • accounts: auth-key hash + wallet ciphertext   • hosted MCP + OpenAPI        │
   ● never has keys   │  • verifies signatures, relays + pays gas        • pay requests (tracked links)│
   ● relayer (gas)    │  • event indexer → in-memory reads → SSE push    • welcome grants, collector   │
                      └───────────────────────────────────────┬────────────────────────────────────────┘
                                                              │ JSON-RPC (HTTPS)
                      ┌───────────────────────────────────────▼────────────────────────────────────────┐
   Chain (44005)      │  AevumPay.sol  +  tUSD8                                                        │
   ─────────          │  • username registry   • payments + receipts (Paid events)   • stores/products │
                      │  • agent allowances (budget, per-payment cap, expiry, payees) • subscriptions  │
                      │  • 0.5% fee → immutable treasury        • no owner, not upgradeable            │
                      └────────────────────────────────────────────────────────────────────────────────┘
```

**Two ways in, one set of rules:** people sign in the browser; AI agents sign with their own key through the
MCP server (or the SDK). Both reach the same relay, and the contract checks every payment: an agent can
never spend beyond the allowance its owner granted on-chain.

**Fast reads:** the server indexes AevumPay's events once (and follows the chain every 2 s), answers reads
from memory, and pushes new payments to the signed-in user over Server-Sent Events.

**Custody, plainly:** the browser owns the key and signs everything. The server verifies and relays,
and pays gas. The contract never holds a balance — it forwards payer→payee→treasury in one transaction.

**Two signature types:**
- **Payments** are EIP-3009 `ReceiveWithAuthorization` with `to = AevumPay`. The signed `nonce` is
  `paymentNonce(payee, productId, memoHash, salt)`, so the signature itself fixes **who gets paid and how
  much** — a relayer (or a compromised server) cannot redirect it.
- **Contract calls** (`register`, `createStore`, `addProduct`, `grantAllowance`, `subscribe`, …) are
  legacy transactions signed in the browser. The server only relays an allow-listed call from the
  user's own address, with a capped gas limit and a capped token approval.

## Deployed on Aevum testnet

| Item | Value |
|---|---|
| Network | QDay Aevum testnet, chain `44005` |
| RPC | `https://rpc-test.qday.info` |
| Explorer | https://explorer-test.qday.info |
| tUSD8 | `0x456569838f1d43009A91ebA4263147Afd7233483` (6 dp) |
| **AevumPay** | **`0xAA36d954e8930FFe29078bDF67975534A31895F7`** |
| Deploy block | `3,946,807` |
| Deploy tx | [`0xa64f374aaded848dff450efb0374d2545fd8497303117edc9088d180fc27016a`](https://explorer-test.qday.info/tx/0xa64f374aaded848dff450efb0374d2545fd8497303117edc9088d180fc27016a) |
| Treasury (fee) | `0xc2Cb9Ee19527f516127CbB47cbA217BfB1563777` |
| Demo shop | `@demobakery` — Sourdough 1.50, Croissant 0.75, Weekend box 3.00 |

**Example on-chain activity** (click to verify):
- Person-to-person payment: [`0xf6f41958075d3f5a9093929569ddcb5798762e2e8c1f013f75a53736bcc5049b`](https://explorer-test.qday.info/tx/0xf6f41958075d3f5a9093929569ddcb5798762e2e8c1f013f75a53736bcc5049b)
- Agent payment (signed by an agent key within its allowance): [`0xa7e681bb46dacd558c050d7582ac5c03b44134f822c0c4ec53abc374352e67c0`](https://explorer-test.qday.info/tx/0xa7e681bb46dacd558c050d7582ac5c03b44134f822c0c4ec53abc374352e67c0)

The explorer's contract verifier is not working yet on Aevum, so source verification is by
**commit hash + address** here rather than on the explorer. The exact deployed source is this
repository at the commit that produced `0xAA36…95F7` (`contracts/src/AevumPay.sol`).

## How the money moves

**1. Person-to-person (gasless)**
```
@ada signs  ReceiveWithAuthorization(from=ada, to=AevumPay, value, nonce=paymentNonce(@kemi,0,memo,salt))
relayer     payUsernameWithAuthorization("kemi", value, memo, auth)   ← pays gas
contract    receiveWithAuthorization → forwards value to @kemi's wallet → emits Paid(...)
```
Fee: **none**.

**2. Store purchase**
```
buyer signs paymentNonce(merchant, productId, memo, salt)
relayer     payProductWithAuthorization(productId, memo, auth)
contract    re-reads the product price (can't be underpaid) → merchant gets price−fee, treasury gets fee
```
Fee: **0.5%** to the treasury. The buyer needs no tQDAY.

**3. Agent allowance**
```
owner  grantAllowance(agent, budget, maxPerPayment, expiresAt, payees[])   ← on-chain limits
agent  signs AgentPayment(payee, productId, amount, memo, nonce, deadline)   ← its own key
anyone agentPay(payment, signature)
contract  checks nonce/deadline/active/expiry/cap/budget/payee-list → transferFrom(owner → payee)
```
The AI never holds the owner's key; the contract caps every payment. Revoke is one call.

**4. Subscription**
```
merchant  createPlan(name, amount, period)
customer  subscribe(planId, maxPayments)          ← charges the first period, copies the terms
anyone    collect(subscriptionId)                 ← at most one charge per period; skipped periods are never back-charged
```
Fee: **0.5%** on each charge.

## Tech stack

- **Contracts:** Solidity `0.8.24` on the **Shanghai** EVM, Foundry, OpenZeppelin 5.x. Shanghai only —
  no `MCOPY`/`TSTORE`/blobs. Compiled with `evm_version = "shanghai"` and checked with
  `tools/check-shanghai.mjs`.
- **Backend:** Node 22, TypeScript (ESM), Express, viem, `helmet`, `express-rate-limit`.
- **Frontend:** Next.js 16 (App Router), React 19, viem, `qrcode`. No wallet extension required.
- **Agents:** `@aevumpay/agent` (TypeScript SDK), `@aevumpay/mcp` (MCP stdio server, bundled for `npx`) and a hosted read-only MCP endpoint (`POST /mcp`, Streamable HTTP).
- **Workspace:** pnpm workspaces; one `pnpm check` gate (build + 61 tests + Shanghai check + typecheck).

## Repository layout

```
contracts/                     Foundry project
  src/AevumPay.sol               the product contract (usernames, payments, allowances, subscriptions)
  src/mocks/MockUSD8.sol         local tUSD8 stand-in (local chains only)
  test/AevumPay.t.sol            61 tests
  script/DeployAevumPay.s.sol    deploys to anvil / Aevum (needs AEVUMPAY_TREASURY on Aevum)
server/                        API server (Express + viem)
  src/index.ts                   routes: auth, tx relay, payments, stores, plans, subscriptions
  src/chain.ts                   chain clients, tx validation, payee-bound nonce, revert naming
  src/grant.ts                   welcome dollars (rate-limited)
  src/features.ts                allowances, plans, subscriptions, collector
web/                           Next.js app
  src/lib/wallet.ts              browser key generation + AES-GCM encryption + IndexedDB
  src/lib/sign.ts                EIP-3009 + contract-call signing
  src/app/…                      signup, home, send, request, activity, store, shop, checkout,
                                 subscribe, subscriptions, allowances, connect, profile, topup
packages/aevumpay-agent/       agent SDK
packages/aevumpay-mcp/         MCP server (status, connect link, find user, pay, buy)
packages/aevum/                shared chain config + ABIs (from the starter kit)
docs/                          API reference, design decisions (ADR log)
tools/check-shanghai.mjs       fails the build on Cancun-only opcodes
```

## Run it locally

Prereqs: Node 22+, pnpm, Foundry (`foundryup`).

```bash
git clone https://github.com/Nifemi0/aevumpay.git
cd aevumpay
git checkout main
pnpm install
(cd contracts && forge build && forge test --no-match-path 'test/fork/*')   # 61 tests
node tools/check-shanghai.mjs contracts/out
```

Full stack against a local chain:

```bash
# 1. local chain + deploy (chain 31337, MockUSD8)
anvil --hardfork shanghai --chain-id 31337 &
(cd contracts && forge script script/DeployAevumPay.s.sol \
   --rpc-url http://127.0.0.1:8545 \
   --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast)
# prints token + AevumPay addresses

# 2. API (copy server/.env.example → server/.env and fill the printed addresses)
pnpm --filter server start                 # http://127.0.0.1:8787

# 3. web (copy web/.env.example → web/.env.local, set NEXT_PUBLIC_API_URL)
pnpm --filter web dev                      # http://localhost:3000
```

The one gate everyone runs before handing off:

```bash
pnpm check    # contracts build + tests + Shanghai check + typecheck across all packages
```

## Environment variables

**`server/.env`**
| Variable | Purpose |
|---|---|
| `AEVUMPAY_RPC` | Chain RPC (`https://rpc-test.qday.info`) |
| `AEVUMPAY_CHAIN_ID` | `44005` |
| `AEVUMPAY_ADDRESS` | Deployed AevumPay address |
| `TUSD8_ADDRESS` | `0x4565…3483` |
| `AEVUMPAY_DEPLOY_BLOCK` | Faster log scans + activity |
| `RELAYER_PRIVATE_KEY` | The gas relayer (a TEST wallet with a little tQDAY; never a hot mainnet key) |
| `TREASURY_PRIVATE_KEY` / `GRANT_PRIVATE_KEY` | Pays welcome dollars (optional) |
| `GRANT_AMOUNT` / `GRANT_DAILY_LIMIT` | Welcome dollars amount (default `5`) and daily cap (default `25`; `0` disables) |
| `CORS_ORIGIN` | Comma-separated allowed web origins |
| `APP_URL` | Public web URL (used for agent-guide links) |
| `DB_PATH` | JSON data file (keep it **outside** the repo) |
| `PORT` | API port |
| `COLLECTOR_INTERVAL_MS` | Subscription collector interval (`0` disables) |

**`web/.env.local`**
| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | The API base URL (baked at build time) |

Never commit `.env*`, the data dir, or `contracts/broadcast/` — all are gitignored.

## Security model

**On-chain**
- Non-custodial: the contract forwards funds in the same transaction and holds no balance.
- No owner/admin; not upgradeable. The merchant fee rate is a constant and the treasury is immutable.
- Payee-bound EIP-3009 nonces stop a relayer from redirecting a signed payment.
- Agent allowances are enforced on-chain (budget, per-payment cap, expiry, payee list, replay-protected nonces), so an agent can't exceed them even if fully compromised.
- Subscriptions are fixed-term, one charge per period, never back-charged.

**Keys & accounts**
- Wallet keys are created and encrypted in the browser (PBKDF2-SHA256, 600k rounds → separate auth key + encryption key; AES-256-GCM; non-extractable key in IndexedDB on the device).
- The server stores only a scrypt hash of the auth key and the opaque ciphertext — it cannot decrypt the wallet.
- Passwords: scrypt + per-user salt; timing-safe compare.

**Server**
- Signed payloads are validated before any gas is spent: signer, chain, target, allow-listed function, capped token approval (≤100,000 tUSD8), capped gas.
- Helmet headers, CORS allow-list, per-IP rate limits, login brute-force lockout.
- Read routes never send raw node errors to the browser; contract reverts are mapped to named rules in plain words.

## Testing

- **Contract:** 61 Foundry tests covering usernames, payments, the fee, agent allowances (over cap,
  over budget, expired, revoked, replayed, tampered, wrong payee), and subscriptions (not due, due,
  no back-charging, soft-fail + recovery, lapse, cancel, `maxPayments`, paused plans). Plus fuzz tests.
- **Live checks:** every deployed flow was exercised end-to-end against Aevum testnet (sign-up,
  gasless send, store checkout, agent payment, subscription collection), with the tx hashes above.

## Known limits & roadmap

- **Welcome dollars are small on this test deploy** (`$0.25` a new account, because the grant treasury
  holds only a few tUSD8, about 8 sign-ups' worth). Top up the treasury and set `GRANT_AMOUNT=5` for the
  intended amount; when it runs dry, the app points people to the QDay faucet instead.
- **No server test suite yet** (the contract is well covered). Next: supertest coverage for the relay
  and error paths.
- **Session token in `localStorage`** — move to an httpOnly cookie before real money.
- **Memo text / agent names are per-device** (kept in `localStorage`), not shared across devices.
- **No passkey / password recovery yet** — key export is the recovery path today.
- **`server/data` JSON store** — fine at demo scale; move to Postgres and a Redis rate-limit store for production.
- **ERC-8004:** when QDay opens its ERC-8004 registry, register AevumPay agents there too (their on-chain allowances stay as they are).
- **Relayer is a hot wallet** — keep its balance minimal and rotate it; a managed signer is the production path.

## Credits & license

- **Based on Aevum Starter Kit (MIT, PQA Labs)** — the shared `packages/aevum`, the Shanghai tooling
  and the original contract scaffolding come from it. See [NOTICE.md](NOTICE.md) for third-party
  licenses.
- Licensed under **MIT** — see [LICENSE](LICENSE).

> Testnet only: tQDAY and tUSD8 here have no monetary value. Do not send mainnet funds to any address
> in this repository.
