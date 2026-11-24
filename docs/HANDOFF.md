# HANDOFF — living status board

Keep this current. Both agents (Hermes and Claude Code) read it to know what the other has done.
Last updated: 2026-11-24.

## CURRENT CYCLE
- **Owner:** Claude Code (Opus) building frontend; **Hermes owns contract/backend/deploy + review.**
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
- **Hermes review addressed** (CHANGES.md §11): relayer gas budget, username-salt rule, Next 16.4.5, `.claude/` ignored, MCP deps patched. Not yet committed.
- **Deployed to Aevum testnet:** AevumPay `0xAA36d954e8930FFe29078bDF67975534A31895F7` (block 3,946,807). Every flow verified on-chain (CHANGES.md §11).
- **Gate:** `pnpm check` green; `docs/REVIEW.md` to run.
- **2026-11-24 (CHANGES.md §12), not committed:** welcome grant (`server/src/grant.ts`, `GET/POST /grant`), Demo Bakery seed script, Add money screen (`/topup`), two-step sign-up, friendlier log-in, stale local-chain data cleared from browsers, landing page rebuilt for phones. Web is live at https://aevumpay-theta.vercel.app.
- **✅ LIVE on Aevum testnet (44005).** App **https://pay.nuvixes.studio** → API **https://api.pay.nuvixes.studio** (VPS at `5ced7c6`; nginx vhost + Let's Encrypt on `api.pay.nuvixes.studio`; `CORS_ORIGIN=https://pay.nuvixes.studio,https://aevumpay-theta.vercel.app`; `APP_URL=https://pay.nuvixes.studio`). Contract `0xAA36…95F7`; Demo Bakery `@demobakery` seeded; welcome grant **$1** (treasury now ~2 tUSD8 — top up for $5). Repo default branch **main** = the v2 product + submission README (`0106eb0`). Live E2E verified on testnet: register → +1 grant (`0x82812ad…`) → gasless send 0.2 (payment #6, `0x9c9f4f0…`). DB at `/root/aevumpay-data/aevum-db.json`. Deploy loop: `git push origin aevumpay-v2` → VPS `git pull && pm2 restart aevumpay-api`. Submission kit: `README.md`, `docs/DEMO.md`, `docs/SUBMISSION.md`.

- **Domain (2026-11-24, in progress).** App → **`pay.nuvixes.studio`** (added to the Vercel project `aevumpay`); API → **`api.pay.nuvixes.studio`** (the VPS).
  DNS for `nuvixes.studio` is on NS1 (`dns1-4.p03.nsone.net`, i.e. Netlify DNS), managed by the user. Steps:
  1. ✅ DNS records added in Netlify (TTL 300): `A pay → 76.76.21.21` (Vercel) and `A api.pay → 104.252.77.136` (VPS). Both resolve
     publicly. `https://pay.nuvixes.studio` serves the app with a valid certificate. `api.pay` reaches the VPS, which answers 404 for
     that host name until step 2.
  2. ✅ Hermes: nginx + Let's Encrypt on `api.pay.nuvixes.studio`, CORS and `APP_URL` set. Checked: `/health` → 44005, valid cert,
     `Access-Control-Allow-Origin: https://pay.nuvixes.studio`.
  3. ✅ Vercel Production `NEXT_PUBLIC_API_URL=https://api.pay.nuvixes.studio`, redeployed (aliased to pay.nuvixes.studio and
     aevumpay-theta.vercel.app). Checked in a browser: the app loads only from `pay.nuvixes.studio` and `api.pay.nuvixes.studio`, and the
     live @name check answers. Browsers that were logged in against the old API URL are logged out once (stale-data stamp); accounts are unaffected.
- **llms.txt** (CHANGES §14): `/llms.txt` and `/llms-full.txt` on the app; URLs follow whatever domain serves them.

## Done ✅

| Area | State |
|---|---|
| Contract | `AevumPay.sol` v2. Usernames, stores and products; payee-bound gasless payments; 0.5% merchant fee to an immutable treasury; agent allowances; subscriptions. No owner, not upgradeable. 61 tests, 20.5 KB, Shanghai-safe. |
| Deploy | `DeployAevumPay.s.sol` takes `AEVUMPAY_TREASURY` (required on Aevum; anvil defaults to account #0). |
| Server | Verifies and relays browser signatures, never holds user keys. Accounts store only an auth-key hash plus the wallet ciphertext. Endpoints in `docs/API.md`. Collector on `COLLECTOR_INTERVAL_MS` (default 30s). |
| Web | Next.js 16 on the API, no browser wallet. Landing, signup/login/unlock, home, send, request, pay links, receipts, activity, store (products + plans + collect), shop, checkout, subscribe, subscriptions, spending permissions, agent connect, profile (key export). |
| Agents | `packages/aevumpay-agent` (SDK) and `packages/aevumpay-mcp` (MCP stdio server: status, connect link, find user, pay, buy). |

## Aevum testnet (live)

- AevumPay v2 `0xAA36d954e8930FFe29078bDF67975534A31895F7`, tUSD8 `0x4565…3483`, deploy block 3,946,807, deploy tx `0xa64f…016a`.
- Relayer/deployer `0xe3083eDaadFe06b41E717F4e569d91Fc0289d476`; treasury `0xc2Cb9Ee19527f516127CbB47cbA217BfB1563777`. Keys only in `server/.env.aevum` (gitignored).
- Run: `pnpm --filter server start:aevum` (port 8790), web with `NEXT_PUBLIC_API_URL=http://127.0.0.1:8790`.
- Test accounts: `@aevumcafe` (store, Espresso, Coffee club plan), `@aevumguest` (customer). Sample txs: payment `0xf6f41958075d3f5a9093929569ddcb5798762e2e8c1f013f75a53736bcc5049b`, agent payment `0xa7e681bb46dacd558c050d7582ac5c03b44134f822c0c4ec53abc374352e67c0`.

## Local test env

- anvil chain 31337, run by the user (not by us).
- **v2:** AevumPay `0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44`, MockUSD8 `0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1`, treasury = anvil #0.
- **v1 (old, still deployed):** AevumPay `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`, MockUSD8 `0x5FbD…0aa3`. The user's `server/.env` (port 8787) still points at v1. Update it to the v2 addresses to use the new app.
- `.claude/launch.json` (untracked) runs a test API on **:8788** against v2 with `DB_PATH=./data/test-db-v2.json`, and the web app on :3100.
- The anvil clock is ~2.5 min + 1 day ahead of real time, because tests fast-forwarded it.

## Next ⏭

1. ~~Host it publicly~~ done: web on Vercel, API on the VPS behind nginx + Let's Encrypt (`aevumpay.104-252-77-136.sslip.io`). Custom domain `aevumpay.nuvixes.studio` pending DNS.
2. ~~Test tUSD8 for new users~~ done: welcome grant + Add money screen (CHANGES §12). Fund the treasury; the user is asking the organizers for more tUSD8.
3. **Submission README** (architecture diagram, env vars, addresses, tx hashes, reproduction), then the **demo video** (required by DoraHacks).
4. **Server tests:** criterion #5 asks for tested retries and async handling.
5. **Polish:** Activity timestamps (`paidAt` in `/activity`), cross-device memo and agent names, passkey recovery, httpOnly session cookie.

## Open decisions

- **Custody:** decided. Real per-user wallets, with keys held in the browser (see DECISIONS).
- **Signing:** decided. The browser signs everything; the server relays.
- **Treasury address for the fee:** done for testnet (a generated test wallet). Choose a real one for any mainnet deploy.

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
- **Testnet ≠ local for contract errors.** QDay's `eth_estimateGas` answers `"Execution reverted for an unknown reason."` with **no revert data**, so server-side rule-naming that worked on anvil fell back to a generic message on 44005. Fix (commit `5ced7c6`): `txParams` (server/src/chain.ts) simulates the call through the ABI (eth_call decodes the custom error) before estimating gas, then rethrows as `Rule()`. Always verify message/error behaviour against the real RPC, not just anvil.
