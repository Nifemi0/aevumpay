# CLAUDE.md — AevumPay

> Project memory for Claude Code. Read this before touching anything.
> Living status + next tasks: `docs/HANDOFF.md`. API reference: `docs/API.md`.

## What this is

**AevumPay** — a stablecoin payment app on the QDay **Aevum testnet** (chain `44005`) using **tUSD8** (6-decimal USD stablecoin).

Entry for **Aevum Builder Challenge #1** (build 16 Nov – 11 Dec 2026; submissions close 11 Dec 08:00 UTC).

Product: a consumer/business payments app.
- Sign up as **personal** or **business owner**, claim a unique **@username**, get an **auto-generated wallet** (exportable = self-custody).
- Pay anyone by **@username** — human-readable, no addresses.
- **Businesses** open a store, add products, share checkout links; customers pay in tUSD8.
- Username transfers are one tap; on-chain receipt with explorer link.

Judging (official DoraHacks list, unweighted): 1 UX and presentation, 2 demo with on-chain proof, 3 documentation, 4 innovation and agentic mechanics, 5 technical quality (session keys, spending limits, identity primitives, tests), 6 real-world utility and monetization, 7 safety and controls (caps, expiry, revoke, audit trail), 8 reusable open source. A **demo video is required** on the submission form.

## Repo layout

- `contracts/` — Foundry. **`src/AevumPay.sol` is ours.** `src/Checkout.sol`, `src/mocks/MockUSD8.sol` are the starter kit's.
- `server/` — TypeScript / Express / viem API: accounts, generated wallets, gasless payments, storefront.
- `web/` — the AevumPay Next.js 16 app (talks to `server/`; no browser wallet).
- `packages/aevum/` — shared chain config, ABIs, EIP-3009 helpers.
- `packages/aevumpay-agent/` — SDK for any agent to pay within an on-chain allowance. `packages/aevumpay-mcp/` — MCP server built on it.
- `examples/` — TS scripts.
- `aevumpay.html`, `ui-preview.html` — design references only (not production).

## Architecture — non-custodial

The contract never holds user funds.

- **Wallet per user, held in the browser.** The key is generated and used only client-side and encrypted with a password-derived key the server never sees; the server keeps that ciphertext as a backup it can't open (see docs/API.md "Custody model").
- **On-chain username registry**: `@username → wallet address` (`AevumPay.sol`).
- **Payments** = real tUSD8 transfers payer → payee; the on-chain `Paid` event is the receipt. P2P is free; store purchases and subscription charges pay a fixed 0.5% fee to an immutable treasury.
- **Agents and subscriptions** spend from the owner's wallet only within on-chain limits (allowance budget/cap/expiry/payees; fixed subscription terms). `collect` is permissionless.
- **Gasless**: the browser signs an EIP-3009 `ReceiveWithAuthorization` with `to = AevumPay`; the server verifies it and its relayer submits `payUsernameWithAuthorization`, paying gas. Users need zero tQDAY. Store actions are browser-signed txs the server tops up with gas and broadcasts.
- **Store**: merchant wallet + products; checkout pays the merchant directly.

## CRITICAL Aevum constraints

- **EVM = Shanghai only.** No MCOPY, TSTORE/TLOAD, blobs. `contracts/foundry.toml` is `evm_version = "shanghai"`. Never raise to `cancun` — it passes tests and fails on chain.
- **No WebSocket RPC.** HTTPS polling only.
- **eth_getLogs ≤ 1,000 blocks per call.** Chunk it.
- **Legacy (type 0) transactions** are safest for scripts.
- **tUSD8** = `0x456569838f1d43009A91ebA4263147Afd7233483`, **6 decimals**, EIP-2612 + EIP-3009, EIP-712 domain name `tUSD8`, version `2`.
- Explorer verification not working yet — put addresses + source commit in the README instead.

## Run it

```bash
# contracts
cd contracts && forge build && forge test --no-match-path 'test/fork/*'
node ../tools/check-shanghai.mjs out        # must stay Shanghai-safe

# local chain + deploy (chain 31337, MockUSD8)
anvil --hardfork shanghai --chain-id 31337
forge script script/DeployAevumPay.s.sol --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast

# api server
cd server && cp .env.example .env    # fill AEVUMPAY_ADDRESS, TUSD8_ADDRESS, RELAYER_PRIVATE_KEY
pnpm --filter server start           # http://127.0.0.1:8787
```

## Conventions

- TypeScript, ESM, viem `^2.57`, pnpm workspace, `tsx` for dev.
- Contract: OpenZeppelin 5.x, custom errors, events as receipts, **no admin/owner functions, not upgradeable**.
- Server: Express + `helmet` + `express-rate-limit`; **never handles user keys** (only verifies and relays browser signatures); **never log secrets**.
- Keep the contract non-custodial and immutable. Any feature that would custody funds or add a privileged drain path is a design red flag.

## Current status (see docs/HANDOFF.md for detail)

- Contract v2: payee-bound payments, 0.5% merchant fee, agent allowances, subscriptions. 61 tests, Shanghai-safe, local only.
- API server: done, verified end-to-end on local anvil (register, faucet, gasless send, product checkout, store, receipts, activity).
- Frontend: done, including spending permissions, agent connect and subscriptions. Agent SDK + MCP server done. All verified on local anvil (see docs/CHANGES.md).
- Next: choose the treasury, deploy v2 to Aevum testnet, host it, write the submission README, record the demo video, add server tests.
