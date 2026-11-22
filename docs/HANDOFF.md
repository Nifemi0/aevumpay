# HANDOFF — living status board

Keep this current. Both agents (Hermes and Claude Code) read it to know what the other has done.
Last updated: 2026-11-22.

## CURRENT CYCLE
- **Owner:** Hermes
- **Task:** backend finalised; next is Aevum testnet deploy + payment-history indexer
- **Locked files:** `contracts/`, `server/`
- **Next for Claude Code:** frontend in `web/` against `docs/API.md`
- **Gate:** `pnpm check` must be green before any handoff.

## Done ✅

- **`contracts/src/AevumPay.sol`** — username registry, direct payments by @username, storefront products, on-chain receipts, EIP-3009 gasless variants. Non-custodial, immutable.
  - `contracts/test/AevumPay.t.sol` — 24 tests, all pass. Full suite 35/35. Shanghai-safe (6 blobs).
- **`contracts/script/DeployAevumPay.s.sol`** — deploys MockUSD8 (local) or uses real tUSD8 (Aevum), then AevumPay.
- **`server/`** — Express + viem API:
  - accounts (register/login/me), generated wallets encrypted at rest (AES-256-GCM+scrypt), scrypt passwords
  - username resolve, balance, gasless payment via relayer, on-chain receipt lookup
  - store create / add product / read store
  - rate limiting (120/min global, 8/min auth, 30/min payments) + 5-fail login lockout + helmet + CORS allowlist
  - `/dev/faucet` (local chains only)
  - **Verified end-to-end on anvil**: register alice+bob, faucet 100, gasless send 25 → alice 75 / bob 25, receipt #1 correct, store + product created.

## Local test env (verified working)

- anvil chain 31337; MockUSD8 `0x5FbDB2315678afecb367f032d93F642f64180aa3`; AevumPay `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`.
- `server/.env` holds local anvil config (dev-only secrets). Not committed.

## Next ⏭

1. **Deploy to Aevum testnet (44005).** Needs a deployer wallet with a little tQDAY (faucet: https://faucet.qday.info/en). Then `DeployAevumPay` uses the real tUSD8. Fill `server/.env` with mainnet-testnet values.
2. **Frontend** (the big one): signup (role + @username) → wallet → balance → send/receive by @username → store setup → checkout → receipts. Next.js in `web/`.
3. **Payment history indexer**: read `Paid` events in ≤1000-block chunks so the app can list a user's transactions.
4. **EIP-3009 client-side signing** so the frontend can pay gaslessly without the server holding the key (currently the server signs for gasless).
5. README rewrite for the challenge submission (problem, architecture, workflows, addresses, reproduction).

## Open decisions

- Custody model: **real per-user wallets** (current) vs an internal ledger. Chosen: real wallets, exportable. Keep it.
- Where the frontend signs payments: currently the server signs gasless txs with the user's decrypted key. For a "perfect product", move signing client-side (wallet in browser / passkey) — but that's a bigger change.

## Gotchas hit so far

- Public mappings in Solidity return **tuples**, not structs — added explicit `getStore/getProduct/getReceipt` getters.
- `@alice` in a NatSpec doc comment parses as a tag — don't put `@` in comments.
- `parseSignature` v may be undefined (EIP-2098) — compute `v = v ?? 27 + yParity`.
- Explorer links must only be emitted for chain 44005 (local anvil txs have no explorer).
