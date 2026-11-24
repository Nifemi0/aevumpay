# CHANGES: what Claude Code changed and why

For Hermes. Covers everything since your last commit (`8de72ab`, payment-history indexer), up to 2026-11-23.
Read this once, then `docs/HANDOFF.md` for current state, `docs/API.md` for the endpoints, `docs/DECISIONS.md` for one-line decisions.

Nothing here is committed yet. Everything below was built, run and checked on local anvil, and `pnpm check` is green
(72 contract tests, Shanghai-safe, typecheck across server, web, examples and the two new packages).

---

## 0. Why the scope grew: the challenge rules

We re-read the official DoraHacks page (it overrides the starter kit's docs). Key points:
- **Eight judging criteria, unweighted.** Our CLAUDE.md listed six and left out the two we were weakest on:
  - **#4 innovation:** "autonomous agents, agentic payment primitives".
  - **#5 technical quality:** "smart accounts, scoped session keys, spending limits, identity primitives", plus tests handling retries and async.
  - **#7 safety** also asks for "spend caps", "session expiration", "instant revocation", and protection against "prompt injection".
- **The submission form requires a demo video**, a public repo, a live deployment, and docs.
- **Deadline:** 11 Dec 2026 08:00 UTC. All code must be written in the build window, on Aevum testnet with test tokens.

**Decision:** keep the product (a payments app for people and small businesses, by @username) and add one safety layer that
answers #4, #5 and #7 together: **on-chain spending permissions**. These are agent allowances and subscriptions, both enforced by
the contract and both revocable. That's why sections 4–8 exist.

---

## 1. The real frontend (`web/`), replacing the starter kit

**What**
- Rebuilt `web/` as the AevumPay app.
  - **Removed:** the starter kit's pages (setup checker, docs, checkout/receipts demo), RainbowKit, wagmi, react-query, and the `/api/relay` route.
  - **Added deps:** `qrcode` (request QR codes, rendered locally) and `viem`.
- **Design direction:** a lime "band" holding the screen's key number, with a white "sheet" sliding over it (from a reference the user chose).
  - All colours and fonts are tokens at the top of `web/src/app/globals.css`, with light and dark themes. Lime is never used as a text colour.
- **Layout:**
  - **Phone:** band, sheet and a bottom tab bar.
  - **768px and up:** the band runs edge to edge with the navigation on it, and a wide sheet overlaps it. Band and sheet content share one 640px column.
  - These rules sit at the end of `globals.css` on purpose. An earlier version put them first, and the base rules overrode them.
- **Landing page** for signed-out visitors (`components/Landing.tsx`, `app/landing.css`). Every section leads with a picture of the real UI. The user asked for it to be less text-heavy.
- **Routes:**

  | Area | Routes |
  |---|---|
  | Home and accounts | `/` (landing or home), `/signup`, `/login`, `/profile` |
  | Paying | `/send`, `/request`, `/pay/[username]` (a shared request link), `/receipt/[id]`, `/activity` |
  | Stores | `/store`, `/shop/[username]`, `/shop/[username]/[productId]` (checkout) |
  | Added in §7 | `/allowances`, `/connect`, `/subscribe/[planId]`, `/subscriptions` |

**Why**
- UX is judging criterion #1.
- The starter kit was a wallet-connect developer tool. AevumPay's users don't bring a wallet.

**Gotchas**
- **Next.js 16:** any page using `useSearchParams` must be inside `<Suspense>`, or `next build` fails.
- **Note text:** the on-chain memo is a hash, so the note's text only shows on the device that sent the payment (kept in `localStorage`, see `lib/receipts.ts`).

---

## 2. `POST /payments/product` (server, your area)

**What:** gasless store checkout. The server reads the price and merchant from `getProduct`. The client never sends an amount.

**Why:** checkout had no endpoint. Taking the price from the chain means a tampered request can't underpay.

**Later:** made browser-signed in §3, and payee-bound and fee-paying in §4.

---

## 3. Browser-held keys: the server no longer holds user keys (server + web)

**The problem we found**
- The server generated each wallet and encrypted the key with one secret, `KEY_ENCRYPTION_SECRET`.
- Anyone with `server/data/db.json` plus `.env` could decrypt every key and empty every wallet.
- The server also signed every payment. So the contract was non-custodial, but the system wasn't.
- The user picked "browser-held keys" over "password-wrapped keys on the server".

**What changed**

Browser (`web/src/lib/wallet.ts`):
- Generates the private key itself.
- PBKDF2-SHA256, 600k rounds, salt `aevumpay/v1/<username>`, derives 64 bytes from the password:
  - the first 32 bytes become an **auth key**, sent to the server like a password;
  - the last 32 bytes become an **encryption key**, which never leaves the browser.
- AES-256-GCM-encrypts the wallet key with the encryption key. The server keeps that ciphertext as a backup it can't open.
- On this device, the key is also kept encrypted under a **non-extractable** WebCrypto key in IndexedDB. A reload doesn't ask for the password, and the raw key is never stored.

Browser signs everything (`web/src/lib/sign.ts`):
- EIP-3009 payment authorizations.
- Legacy transactions for contract calls (`register`, `createStore`, `addProduct`, …). The server tops up gas and broadcasts them.

Server:
- `crypto.ts`: no wallet generation, no key encryption.
- `db.ts`: `User.wallet` holds the browser ciphertext; `salt` and `hash` are now the scrypt hash of the auth key.
- `config.ts`: `KEY_ENCRYPTION_SECRET` is gone.
- `index.ts` routes:
  - `POST /auth/register` takes `{username, role, authKey, address, wallet, registerTx}`. It checks that the tx is exactly `register(username)`, signed by `address`, then tops up gas, broadcasts, and saves the account.
  - `POST /auth/login` takes `{username, authKey}` and returns the ciphertext.
  - `GET /auth/me` returns the ciphertext, so a new device can unlock.
  - `POST /tx/send` relays browser-signed contract calls (allowlist in §5).
  - `GET /tx/params` gives the nonce, gas price and gas estimate for signing.
  - `GET /config` gives the chain id and contract addresses.
- `chain.ts`: `inspectUserTx` decodes the raw tx and checks the signer, chain, target, allowed function, no value, gas limit and gas price (so a caller can't burn relayer top-ups). `broadcastUserTx` does `ensureGas`, then sends.

UI:
- An **Unlock** screen for a device that has a session but no key.
- **Export private key** in Profile, behind the password.
- The signup copy says plainly that a forgotten password can't be reset.

**Trade-offs**
- No password reset. The answer is key export; passkey recovery is a "next" item.
- Accounts made before this change get `410 legacy account`; re-create local test users.

**Verified (anvil)**
- Signup, store, product, send, checkout, unlock on a fresh device, export.
- The DB holds no private key.
- Eight attacks rejected:
  - a forged signature
  - an amount mismatch
  - underpaying a product
  - a tx signed by another wallet
  - a disallowed contract call
  - a gas-price drain
  - a register tx for a different name
  - a wrong password

---

## 4. Contract v2 (`contracts/src/AevumPay.sol`)

Still immutable, non-custodial, with no owner. One redeploy covers all of it, which is why it's batched.

### 4.1 Payee binding (security fix)
- **Problem:** EIP-3009 signs `{from, to: AevumPay, value, validAfter, validBefore, nonce}`, but not the recipient. The relayer chose the
  username, so a compromised server could redirect a payment the user had just signed (that amount, within 10 minutes).
- **Fix:** the signed `nonce` must equal `paymentNonce(payee, productId, memo, salt)`:
  - `keccak256(abi.encode(keccak256("AevumPay.payment.v2"), payeeWallet, productId, memoHash, salt))`.
  - The contract recomputes it from the payee it resolved, so a different username, product or memo makes the token reject the signature.
- **ABI change:** the `*WithAuthorization` functions now take a struct `Authorization {from, validAfter, validBefore, salt, v, r, s}`.
  This was also required: the flat version hit "stack too deep". Internal settlement uses a `Settlement` struct for the same reason. We
  avoided `via_ir` to keep the build unchanged.

### 4.2 Merchant fee (business model, criterion #6)
- `FEE_BPS = 50` (0.5%) on store purchases, subscription charges and agent product purchases. Person-to-person payments are free.
- The fee goes to an `immutable treasury` set in the constructor (`AevumPay(token, treasury)`).
- The deploy script reads `AEVUMPAY_TREASURY`. It is required on Aevum; on anvil it defaults to account #0.
- `Receipt` gained `fee`, `via` (the agent that signed, if any) and `subscriptionId`.
- The `Paid` event gained a trailing `fee`, so history readers see net amounts without extra calls. The separate `FeePaid` event was removed.
- **Why fixed and immutable:** the rate is public and can't be raised later, which is part of the trust story.

### 4.3 Agent allowances (criteria #4, #5, #7)
- `grantAllowance(agent, budget, maxPerPayment, expiresAt, payees[])`, `revokeAllowance(agent)`, `getAllowance(agent)`, `isAgentPayee`.
- **One owner per agent key:** another wallet can't take over a live grant (`AgentInUse`). A re-grant by the same owner resets the spend
  and the payee list (`grantId`).
- **Paying:** the agent signs EIP-712 `AgentPayment(payee, productId, amount, memo, nonce, deadline)` in domain `("AevumPay","2")`, and
  anyone submits `agentPay(payment, signature)`.
- **Checks:**
  - deadline and nonce replay
  - active, not expired
  - per-payment cap and budget
  - payee list
  - the payee is a registered @username, or the product's merchant at its exact price
- **Money flow:** it moves straight from the owner's wallet via `transferFrom`. This needs an ERC-20 `approve(AevumPay, x)`, see §5.
- **Why:** "any agent from anywhere" can integrate with only its own key. The limits live in the contract, not in the AI, so prompt
  injection can't exceed them.

### 4.4 Subscriptions
- **Merchant side:** `createPlan(name, amount, period)`, with period ≥ 60s so a demo can show live renewals, and `setPlanActive`.
- **Customer side:** `subscribe(planId, maxPayments)` charges the first period immediately and **copies the terms**, so price changes
  never affect existing subscribers.
- `cancelSubscription`: either party.
- `collect(id)` (**anyone may call**):
  - At most one charge per period, never before it's due.
  - **No back-charging:** missed periods are skipped, not billed later.
  - If the balance or approval is short, it emits `CollectionFailed` **without reverting** and records `pastDueSince`.
  - After a grace period of `min(3 days, period)` it marks the subscription `Lapsed`.
- **Why permissionless:** the server is a convenience collector, not an authority. If it's down, merchants or anyone can collect. The
  user raised the centralisation concern explicitly.

### 4.5 Tests
- `contracts/test/AevumPay.t.sol` grew from 24 to **61 tests**, covering every rule above, including:
  - a relayer trying to redirect or relabel a payment;
  - an agent over its cap, its budget, after expiry, after revoke, replayed, stale, tampered, or with a wrong payee;
  - collection not yet due, due, no back-charging, insufficient balance with recovery, lapse after grace, revoked approval, cancel,
    `maxPayments`, a paused plan keeping existing subscribers;
  - fuzz tests on fees and budgets;
  - the contract never holding a balance.
- Size is 20.5 KB (limit 24 KB). Shanghai-safe.

---

## 5. Server changes for v2 (your area, please review)

| File | Change | Why |
|---|---|---|
| `abi.ts` | v2 functions, structs, events and custom errors | so failed simulations name the rule, e.g. `OverBudget` |
| `chain.ts` | `paymentNonce` / `memoHash` mirror the contract; `verifyAuthorization` checks against the payee-bound nonce | refuse a bad signature before spending gas |
| `chain.ts` | `relayUsernamePayment` / `relayProductPayment` pass the `Authorization` struct | v2 ABI |
| `chain.ts` | `txParams(address, call?)` estimates gas +25% | `subscribe` uses ~367k gas, more than the old fixed 300k; an estimate also fails *before* the user signs if the call would revert |
| `chain.ts` | `MAX_USER_GAS` 800k; user-call allowlist adds `grantAllowance`, `revokeAllowance`, `createPlan`, `setPlanActive`, `subscribe`, `cancelSubscription`, `collect` | the new features |
| `chain.ts` | the relay accepts **one token call**: `approve(AevumPay, amount)` with `amount ≤ 100,000 tUSD8` | allowances and subscriptions draw via approve (the local MockUSD8 has no `permit`); never unlimited, never another spender |
| `chain.ts` | `withRelayer()` serial queue around every relayer tx | payments, agent payments and the collector share one relayer nonce; concurrent sends would collide |
| `index.ts` | `/tx/params` returns the rule name and plain text (`RULE_TEXT`) when a call would revert | found in testing: users saw "check your balance" for `AgentInUse` |
| `index.ts` | `/payments/*` read `authorization.salt` (not `nonce`) and return `fee`; `/payments/:id` returns `fee`, `via`, `subscriptionId`; `/activity` items include `fee` | v2 |
| `features.ts` (new) | `GET /wallet/approval`, `GET /allowances`, `GET /agents/:address` (public), `POST /agent/pay` (public: the agent's signature is the authorization), `GET /plans/:owner`, `GET /plan/:id`, `GET /subscriptions` | UI and agent support |
| `features.ts` | `POST /agent/pay` **simulates first** | a refused payment costs no gas and returns the rule |
| `features.ts` | **the collector**: every `COLLECTOR_INTERVAL_MS` (default 30s, `0` disables), it simulates `collect` for active subscriptions due within 10 minutes and sends the ones that pass | see below |

**Collector, two fixes found in testing**
- **Clock skew.** The chain clock, not ours, decides "due". A fast-forwarded anvil was 2.5 minutes ahead, so the collector skipped due
  charges. It now treats a 10-minute window as candidates and lets the simulation decide.
- **Gas waste.** A past-due subscription was retried every 30s, which for a monthly plan means ~8,600 failed transactions over the
  3-day grace. Now it sends once (to record the miss on-chain), then again only when the customer can pay or the grace has ended (to
  lapse it).

**Unchanged:** auth middleware, rate limits, lockout, helmet/CORS, the chunked log reader, and `/dev/faucet` (local only).

---

## 6. Agent SDK and MCP server (new packages, criterion #8)

- **`packages/aevumpay-agent` (`@aevumpay/agent`)**
  - `new AevumPayAgent({ apiUrl, appUrl, privateKey })`.
  - Methods: `connectLink(...)`, `status()`, `findUser()`, `pay({to, amount, memo})`, `buy({store, productId})`.
  - It signs `AgentPayment` and posts to `/agent/pay`. Errors carry `rule`.
  - Has its own README.
- **`packages/aevumpay-mcp` (`@aevumpay/mcp`)**: a stdio MCP server built on `@modelcontextprotocol/sdk@1.12.0` and `zod@3.25.76`.
  - Tools: `aevumpay_status`, `aevumpay_connect_link`, `aevumpay_find_user`, `aevumpay_pay`, `aevumpay_buy`.
  - The key comes from `AEVUMPAY_AGENT_KEY`, or is created once into `~/.aevumpay/agent-key` (mode 600).
  - Works with Claude Desktop, Claude Code, Cursor and others.
- **Why:**
  - Lets "any agent from anywhere" pay from its owner's balance within on-chain limits (the user's requirement).
  - Gives us the demo moment: "Claude, pay @kemi $5".
  - Reusable building blocks score on criterion #8.

---

## 7. Web changes for v2

- **Payee-bound signing:** `signPayment(account, amount, {payee, productId, memo})` computes `paymentNonce` exactly as the contract does.
- **Fees in the UI:** receipts show a store-fee row ("Paid by the store", or "−$x" and "You received" for the merchant). Activity shows a
  merchant the net amount. Store sales are shown after fees.
- **`/allowances` ("Spending permissions"):**
  - each agent with spent/budget, cap and expiry, plus **Revoke now**;
  - how much AevumPay may draw;
  - **Stop all automatic spending** (approve 0).
- **`/connect?agent=…&name=…&budget=…&max=…&days=…&payees=…`:** the agent proposes, the owner edits every limit, then the browser signs
  `approve` and `grantAllowance`. Agent names are remembered per device (`lib/agentNames.ts`); the chain only knows addresses.
- **`/subscribe/[planId]`:** shows the fixed-terms copy, approves 12 periods (never unlimited), then subscribes.
- **`/subscriptions`:** status pills, next charge date, cancel.
- **Store dashboard:** plans (create, copy link), subscribers with status, and **Collect N due payments**.
- **Shop page:** lists plans.
- **Home:** a past-due banner.
- **Activity:** labels "Subscription" / "Subscription payment".
- **Profile:** links to Spending permissions and Subscriptions.
- **`lib/sign.ts`:** `signApproval`, `raiseApproval` (adds to the current approval, capped at 100k), and per-call gas from `/tx/params`.

---

## 8. Verified end to end (local anvil, contract v2 at `0x3228…6c44`)

- **UI:**
  - signup, store, product, payee-bound send, checkout (fee 0.0625 on 12.50 went to the treasury; the merchant got 12.4375);
  - plan creation; subscribe; **automatic renewal by the collector**;
  - "Stop all automatic spending", then a soft-fail recorded once, the past-due banner, and the "Lapsed" status;
  - cancel; key export; unlock on a fresh device.
- **Through the real MCP server (an MCP client calling its tools):**
  - not connected, then a connect link; the owner approves $20 / $5 per payment in the UI;
  - **paid $3** (receipt #8, `via` = the agent);
  - a $6 payment was refused (`OverPerPaymentLimit`), a $12.50 product purchase was refused, and an unknown user was refused;
  - the owner revoked in the UI, after which a payment was refused (`AllowanceInactive`).
  - An accidental case also proved `AgentInUse`: a second wallet couldn't take over a live agent.
- **Through the relay (script):** an unlimited approval was refused, an approval to another spender was refused, and a collection
  before the due date was refused before signing.

---

## 9. Config, docs, housekeeping

- **`server/.env.example`:** removed `KEY_ENCRYPTION_SECRET`; added `COLLECTOR_INTERVAL_MS`.
- **`web/.env.example`:** now only `NEXT_PUBLIC_API_URL`.
- **`NOTICE.md`:** dependency table updated.
- **`CLAUDE.md`:** architecture, judging criteria (all 8) and status updated.
- **`docs/API.md`:** all new endpoints. **`docs/DECISIONS.md`:** new entries at the top.
- **`.claude/launch.json`** (untracked, local only) runs a test API on :8788 against the v2 deploy with its own DB, so the :8787 server
  was never touched. Don't commit it.

---

## 10. Open items and what's next

1. **Deploy v2 to Aevum testnet (44005).**
   - Blocked on a funded deployer wallet (tQDAY from the QDay Discord faucet).
   - **Choose the treasury address first.** It's immutable.
   - Then set `server/.env`: `AEVUMPAY_ADDRESS`, `TUSD8_ADDRESS` (real tUSD8), `AEVUMPAY_RPC`, `AEVUMPAY_CHAIN_ID=44005`, and
     `AEVUMPAY_DEPLOY_BLOCK` (it speeds up log scans).
   - Host the API (it holds the relayer key) and the web app.
2. **README for the submission:** problem, architecture diagram, env vars, testnet addresses, tx hashes, reproduction steps. Then the
   **demo video** (required).
3. **Server tests:** criterion #5 asks for tested retry and async handling. The contract is well covered; the server has none.
4. **Smaller items:**
   - Activity timestamps need `paidAt` in `/activity`.
   - Memo text only shows on the sending device.
   - Agent names only show on the approving device.
   - No passkey recovery.
   - The session token is in `localStorage`; it should move to an httpOnly cookie before anything real.
5. **Next.js 16.4.3** has two moderate advisories, fixed in 16.4.5. Bump `web/package.json`.
6. **Scaling:** the plan and subscription reads loop over ids (`< 5000`), fine for the challenge. Index events if it grows.

---

## 11. After Hermes's review (2026-11-23): fixes, then the first Aevum testnet deploy

### Review fixes (Hermes's list: SHIP-WITH-NOTES)
| # | Finding | Fix |
|---|---|---|
| 1 | Relayer gas griefing: a fixed 0.05 tQDAY top-up per new wallet plus per-IP limits only | `server/src/budget.ts`. Top-ups now cover only the next transaction's own `gas × gasPrice` + 20% (about 0.0001 tQDAY for a register, roughly 400× less). Daily caps per UTC day: total top-up tQDAY (`RELAYER_DAILY_TOPUP_BUDGET`, default 0.5), top-ups per wallet (10), relayed txs total (1000) and per wallet, payer or agent (100). When a cap is hit, the API answers `429` with "try again tomorrow". The collector counts only toward the global cap. Counters are in memory and reset daily or on restart; move them to Redis for multi-instance. |
| 2 | Username is the PBKDF2 salt, so a rename would brick the wallet | Not exploitable today: `changeUsername` isn't on the relay allowlist, and login derives keys from the DB username. Documented at `USER_CALLS` (server) and `deriveKeys` (web). Any future rename must re-derive, re-encrypt the backup and replace the auth hash in one step. |
| 3 | `next build` aborted on the Next 16.4.3 advisory | `next` bumped to 16.4.5; a clean first build compiles. |
| 4 | `.claude/` not gitignored | Added to `.gitignore`. |
| 5 | Branch not pushed | Left local on purpose, until the user says otherwise. |
| — | Not in the review: 9 advisories in the MCP server's deps | `@modelcontextprotocol/sdk` 1.12.0 → 1.32.2 and `zod` 3.25.76 → 4.6.7. `pnpm audit --prod`: no known vulnerabilities. MCP smoke test passes. |

### Aevum testnet deployment (chain 44005)
| | |
|---|---|
| AevumPay v2 | `0xAA36d954e8930FFe29078bDF67975534A31895F7` |
| Deploy tx | `0xa64f374aaded848dff450efb0374d2545fd8497303117edc9088d180fc27016a` (block 3,946,807, 4.57M gas, about 0.0046 tQDAY) |
| tUSD8 | `0x456569838f1d43009A91ebA4263147Afd7233483` (the real token) |
| Relayer / deployer | `0xe3083eDaadFe06b41E717F4e569d91Fc0289d476` (funded with 1 tQDAY + 5 tUSD8 from the QDay faucet) |
| Treasury (fee) | `0xc2Cb9Ee19527f516127CbB47cbA217BfB1563777` |
| Source | branch `aevumpay-v2` (`a1c93b1`) plus the uncommitted review fixes |

The keys for both wallets live only in `server/.env.aevum`, which is gitignored (`.env*`). Run the testnet API with `pnpm --filter server start:aevum`
(port 8790, its own DB `data/aevum-db.json`). Run the web app against it with `NEXT_PUBLIC_API_URL=http://127.0.0.1:8790`.

### Verified on the real testnet (UI + MCP)
- Business signup `@aevumcafe`: the browser-signed `register`, relayed with a small top-up. Open store, add product (Espresso $1).
- Customer signup `@aevumguest`, funded with 2 tUSD8 from the deployer.
- **Gasless payment** of $0.50, receipt #1, tx `0xf6f4…049b`. The explorer shows Success, relayer → AevumPay, and tUSD8 guest → AevumPay → merchant in one tx. 248k gas, about 0.00025 tQDAY. This proves the real tUSD8 accepts our payee-bound EIP-3009 authorization.
- **Checkout** $1 with the 0.5% fee: receipt #2, fee row shown.
- **Subscription** "Coffee club" $0.10/min: subscribe (approve + subscribe in 15.7s), the **collector renewed it on-chain** by itself, then cancel.
- **Agent via the MCP server:** connect link, approved in the UI ($0.25 budget, $0.10 cap), paid $0.10 (receipt #5, explorer link), a $0.20 payment refused (`OverPerPaymentLimit`), remaining budget $0.15.
- Treasury holds exactly 0.006 tUSD8. The relayer spent about 0.007 tQDAY for the whole run, including the deploy.

### What testnet taught us
1. **Log scans from block 0 are unusable.** The chain is at about 3.9M blocks, so ~3,950 `eth_getLogs` calls per history load. Always set
   `AEVUMPAY_DEPLOY_BLOCK` (done: 3,946,807). History, allowances and subscriptions now load in 1.1–1.6s.
2. **Slow confirmations were ours, not the chain's.** The chain confirms in about 1s, but each action took 15–20s because viem polls receipts
   every 4s by default. `publicClient` now uses `pollingInterval: 1_000`.
3. **RPC round trips are about 0.4s each.** Reads that loop over ids (`plansOf`, `subscriptionsOf`, product lists) will slow down as data grows; index events before scale.
4. **New users have no tUSD8 on testnet.** `/dev/faucet` is local-only, and the QDay faucet is per Discord account. For the demo we
   seed test users from the deployer. Consider a small, budgeted "welcome tUSD8" from a sponsor wallet so judges can try it without Discord.
5. Next.js 16 runs only one `next dev` per project, so stop the local-anvil web app before starting the testnet one.

## 12. Getting money to new users, and a gentler first run (2026-11-24)

**Why.** tUSD8 is scarce (the faucet gives about $5 at a time) and a new account starts at $0, so nobody could try a payment. The live
web app also still showed local-chain leftovers, and sign-up read like a wall of rules.

**Welcome grant** (`server/src/grant.ts`; routes `GET /grant`, `POST /grant`):
- A plain tUSD8 transfer of `GRANT_AMOUNT` (default 5) from a wallet we control: `GRANT_PRIVATE_KEY`, falling back to
  `TREASURY_PRIVATE_KEY`. Using the treasury means the 0.5% shop fees flow back out to new users. The contract is untouched and still
  holds nobody's money.
- Limits: once per account and once per wallet address, ever (stored in the DB as `grants`); once per IP per UTC day;
  `GRANT_DAILY_LIMIT` per day in total (default 25; 0 = off); only while the grant wallet holds enough. Transfers go out one at a time;
  gas comes from the relayer via `ensureGas`, so it counts toward the relayer budget.
- Trade-off: people on one shared network (event Wi-Fi) get one grant per day between them; the faucet covers the rest.
- Verified on local anvil: claim gave +$5.00; a second claim got 409 "You've already had your welcome dollars."

**Demo Bakery** (`server/scripts/seed-demo-shop.ts`, `pnpm --filter server seed:demo`): registers `@demobakery` from the grant wallet,
opens "Demo Bakery" and lists three products ($1.50, $0.75, $3.00). Safe to re-run (verified: it skips what exists). Purchases pay the
grant wallet, refilling the pot. `server/tsconfig.json` now type-checks `scripts/` too.

**Web:**
- **`/topup` (Add money):** balance (refreshed every 5s, says when money lands); step 1 claim welcome dollars; step 2 copy address and
  open the QDay faucet; a QR of the address; a "Try a purchase" link to the Demo Bakery once there's money. Home has an "Add money"
  button under the balance. The one-tap MockUSD8 mint now only appears on a dev chain in a dev build.
- **Stale data:** `checkNetworkStamp` (lib/api.ts) records which API + chain this browser's data belongs to. When that changes (local
  chain to Aevum, say), the saved session, receipts and agent names are dropped. A device key whose address doesn't match the account is
  forgotten, so the user gets a password prompt instead of "this browser holds a different wallet". Home warns when the server isn't on
  chain 44005; "Local chain" wording became "Development chain".
- **Sign-up** is two steps: pick your @name (live check, green when free) with "Just me / My business" cards, then a password with
  Show/Hide and one plain sentence on why it can't be reset. Personal accounts land on Add money.
- **Bug fixed:** the `?username=` prefill was read during render, so the server and browser HTML differed and React kept the server's
  `disabled=""` on the Create account button: sign-up couldn't be submitted. It's now read in an effect.
- **Log-in:** Show/Hide password, friendlier copy, an honest "Forgot your password?" answer.
- **Landing page** rebuilt for phones: live send card, facts strip, four tiles, a claim-your-@name ending and a real footer.

## 13. Specific error messages (2026-11-24)

**Why.** A user signing up as `@my` got "That can't go through right now. Check your balance", which was wrong: the contract refused
the name for being under 3 characters. Two causes:
1. `server/src/abi.ts` listed only some of the contract's custom errors, so `UsernameTooShort`, `UsernameTooLong`, `ZeroAddress` and
   `NotRegistered` couldn't be decoded and fell through to a generic message. The ABI now has all 34 (checked against
   `AevumPay.sol`). **Keep the two in step when you add an error.**
2. The web app mapped that generic message to a guess about the balance.

**Server:** one `sendError()` in `index.ts` handles every failure. It names the contract rule (by error name or 4-byte selector) as
`rule`, or another known cause as `code` (`InsufficientBalance`, `AuthorizationUsed`, `RelayerOutOfGas`, `NetworkBusy`, `Busy`,
`DailyLimit`, …), always with plain words in `error`. Raw node messages are logged and never sent to the browser (several read routes
used to return them). Verified on local anvil: `register("my")` → `UsernameTooShort`, a 30-character name → `UsernameTooLong`, a taken
name → `UsernameTaken`.

**Web:** `ApiError` carries `reason` (the rule or code). `explain()` in `lib/api.ts` picks the most specific wording, with fallbacks for
older servers and for 429/5xx. The error box has an icon. Sign-up re-checks the name length on every render and before signing, and a
name problem returned by the server sends the user back to step 1 with the reason shown there.
