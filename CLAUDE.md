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

Judging that matters: UX (#1), demo with on-chain proof (#2), docs (#3), real-world utility (#6), safety (#7), open-source reusability (#8).

## Repo layout

- `contracts/` — Foundry. **`src/AevumPay.sol` is ours.** `src/Checkout.sol`, `src/mocks/MockUSD8.sol` are the starter kit's.
- `server/` — TypeScript / Express / viem API: accounts, generated wallets, gasless payments, storefront.
- `web/` — starter-kit Next.js app (to be rebranded/replaced by the real UI).
- `packages/aevum/` — shared chain config, ABIs, EIP-3009 helpers.
- `examples/` — TS scripts.
- `aevumpay.html`, `ui-preview.html` — design references only (not production).

## Architecture — non-custodial

The contract never holds user funds.

- **Wallet per user**, generated server-side; private key encrypted at rest (AES-256-GCM, scrypt-derived key).
- **On-chain username registry**: `@username → wallet address` (`AevumPay.sol`).
- **Payments** = real tUSD8 transfers payer → payee; the on-chain `Paid` event is the receipt.
- **Gasless**: payer signs an EIP-3009 `ReceiveWithAuthorization` with `to = AevumPay`; a relayer submits `payUsernameWithAuthorization` and pays gas. Users need zero tQDAY.
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
cd server && cp .env.example .env    # fill AEVUMPAY_ADDRESS, TUSD8_ADDRESS, RELAYER_PRIVATE_KEY, KEY_ENCRYPTION_SECRET
pnpm --filter server start           # http://127.0.0.1:8787
```

## Conventions

- TypeScript, ESM, viem `^2.57`, pnpm workspace, `tsx` for dev.
- Contract: OpenZeppelin 5.x, custom errors, events as receipts, **no admin/owner functions, not upgradeable**.
- Server: Express + `helmet` + `express-rate-limit`; keys encrypted at rest; **never log secrets**.
- Keep the contract non-custodial and immutable. Any feature that would custody funds or add a privileged drain path is a design red flag.

## Current status (see docs/HANDOFF.md for detail)

- Contract: done, 24/24 tests, Shanghai-safe.
- API server: done, verified end-to-end on local anvil (register, faucet, gasless send, store, receipts).
- Next: deploy to Aevum testnet; build the real frontend; payment-history indexer.
