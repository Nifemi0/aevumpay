# HANDOFF — living status board

Keep this current. Both agents (Hermes and Claude Code) read it to know what the other has done.
Last updated: 2026-11-23.

## CURRENT CYCLE
- **Owner:** Claude Code (Opus). Handing back to Hermes for review.
- **Inspector:** Hermes. Runs `docs/REVIEW.md` (gate + all-round inspection).
- **Read first:** **`docs/CHANGES.md`**. It covers every change since `8de72ab`, why we made it, and how it was verified.
- **Claude Code just finished (nothing committed yet):**
  1. The real frontend (`web/`): design direction, responsive layout, landing page.
  2. **Browser-held keys.** The server no longer holds or uses user keys.
  3. **Contract v2:** payee-bound payments, a 0.5% merchant fee, agent allowances, subscriptions. 61 tests.
  4. Server support for v2: allowances, plans, subscriptions, the agent relay, a permissionless-collection helper, a relayer queue, and gas estimation.
  5. UI for spending permissions, agent connect and subscriptions.
  6. New packages `@aevumpay/agent` (SDK) and `@aevumpay/mcp` (MCP server).
- **Touched Hermes's area (please review):** `server/src/{abi,chain,config,crypto,db,index,features}.ts`, `contracts/src/AevumPay.sol`,
  `contracts/test/AevumPay.t.sol`, `contracts/script/DeployAevumPay.s.sol`. See CHANGES.md §2–§5.
- **Blocked on the user:** a funded deployer wallet (tQDAY) and the **treasury address**, which is fixed at deploy.
- **Gate:** `pnpm check` green; `docs/REVIEW.md` to run.

## Done ✅

| Area | State |
|---|---|
| Contract | `AevumPay.sol` v2. Usernames, stores and products; payee-bound gasless payments; 0.5% merchant fee to an immutable treasury; agent allowances; subscriptions. No owner, not upgradeable. 61 tests, 20.5 KB, Shanghai-safe. |
| Deploy | `DeployAevumPay.s.sol` takes `AEVUMPAY_TREASURY` (required on Aevum; anvil defaults to account #0). |
| Server | Verifies and relays browser signatures, never holds user keys. Accounts store only an auth-key hash plus the wallet ciphertext. Endpoints in `docs/API.md`. Collector on `COLLECTOR_INTERVAL_MS` (default 30s). |
| Web | Next.js 16 on the API, no browser wallet. Landing, signup/login/unlock, home, send, request, pay links, receipts, activity, store (products + plans + collect), shop, checkout, subscribe, subscriptions, spending permissions, agent connect, profile (key export). |
| Agents | `packages/aevumpay-agent` (SDK) and `packages/aevumpay-mcp` (MCP stdio server: status, connect link, find user, pay, buy). |

## Local test env

- anvil chain 31337, run by the user (not by us).
- **v2:** AevumPay `0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44`, MockUSD8 `0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1`, treasury = anvil #0.
- **v1 (old, still deployed):** AevumPay `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`, MockUSD8 `0x5FbD…0aa3`. The user's `server/.env` (port 8787) still points at v1. Update it to the v2 addresses to use the new app.
- `.claude/launch.json` (untracked) runs a test API on **:8788** against v2 with `DB_PATH=./data/test-db-v2.json`, and the web app on :3100.
- The anvil clock is ~2.5 min + 1 day ahead of real time, because tests fast-forwarded it.

## Next ⏭

1. **Deploy v2 to Aevum testnet (44005):** treasury address, then deploy, then `server/.env` (addresses, RPC, chain id, `AEVUMPAY_DEPLOY_BLOCK`), then host the API and web.
2. **Submission README** (architecture diagram, env vars, addresses, tx hashes, reproduction), then the **demo video** (required by DoraHacks).
3. **Server tests:** criterion #5 asks for tested retries and async handling.
4. Bump Next.js to 16.4.5 (two moderate advisories in 16.4.3).
5. **Polish:** Activity timestamps (`paidAt` in `/activity`), cross-device memo and agent names, passkey recovery, httpOnly session cookie.

## Open decisions

- **Custody:** decided. Real per-user wallets, with keys held in the browser (see DECISIONS).
- **Signing:** decided. The browser signs everything; the server relays.
- **Treasury address for the fee:** the user must choose it before the testnet deploy. It can't be changed afterwards.

## Gotchas hit so far

- Public mappings in Solidity return **tuples**, not structs. Use the explicit `get*` getters.
- `@alice` in a NatSpec comment parses as a tag. Don't put `@` in comments.
- `parseSignature`'s `v` may be undefined (EIP-2098). Compute `v = v ?? 27 + yParity`.
- Explorer links only for chain 44005 (local anvil txs have no explorer).
- **Stack too deep** in AevumPay v2: fixed with the `Authorization` and `Settlement` structs, not `via_ir`.
- `subscribe` needs ~367k gas. Never hard-code gas for user txs; use `/tx/params?to&data` (estimate +25%).
- The relayer is one address: wrap every relayer tx in `withRelayer()` or nonces collide.
- "Due" is the **chain's** clock. The collector lets a simulated `collect` decide; don't compare `nextDue` to `Date.now()`.
- `web/` is Next.js 16: pages using `useSearchParams` must be inside `<Suspense>`, and a page file may only export its default component.
- Responsive rules must stay at the **end** of `globals.css`, or the base rules override them.
- On Windows, `bash` in `.claude/launch.json` resolves to WSL. Use `C:/Program Files/Git/bin/bash.exe`.
- `@modelcontextprotocol/sdk@1.12.0` needs `zod ≥ 3.25`.
