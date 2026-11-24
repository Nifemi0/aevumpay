# DECISIONS — short ADR log

One line per decision. Add new ones at the top. Don't delete — supersede.

- **Relayer budgets.** Top-ups cover only the next tx's cost + 20%; daily caps per wallet and in total on top-ups and relayed txs; 429 when exceeded. (Hermes review #1.)
- **Testnet first, every flow on-chain.** v2 is deployed on Aevum testnet (`0xAA36…95F7`); local anvil is for unit-style checks only. Always set `AEVUMPAY_DEPLOY_BLOCK`, and poll receipts every 1s (Aevum blocks are ~1s).

- **Any agent integrates with its own key.** Agents never get the owner's key. They sign EIP-712 `AgentPayment`s that the public `POST /agent/pay` relays after simulating. Shipped as an SDK (`@aevumpay/agent`) and an MCP server (`@aevumpay/mcp`) so Claude, Cursor or any script can use it. Limits live in the contract, which defends against prompt injection.
- **Collector = convenience, never authority.** It simulates `collect` (the chain's clock decides "due"), sends what passes, records a miss once, and retries a past-due subscription only when it can be covered or its grace has ended. Merchants also get a collect button.
- **One relayer, one queue.** All relayer transactions go through `withRelayer()` to avoid nonce collisions.
- **Gas for browser-signed txs is estimated per call** (`/tx/params?to&data`, +25%). Fixed limits broke `subscribe` (~367k). The estimate also refuses a doomed call before the user signs, naming the contract rule.

- **Contract v2 (2026-11-23).** One deploy for: payee-bound payment signatures (the EIP-3009 nonce = `paymentNonce(payee, productId, memo, salt)`, closing the redirect gap below); a fixed 0.5% fee on store purchases and subscription charges to an immutable treasury (P2P free); on-chain agent allowances (budget, per-payment cap, expiry, optional payee list, revoke); subscriptions (fixed terms, anyone may `collect`, one period max, no back-charging, grace = min(3 days, period), then lapse). Still no owner/admin/upgrade.
- **Approvals are capped, never unlimited.** Allowances and subscriptions draw via ERC-20 `approve(AevumPay, x)`; the relay refuses x > 100,000 tUSD8 and approvals to any other spender. (The local MockUSD8 has no EIP-2612 permit, so we use plain approve, signed in the browser.)
- **Collection is permissionless.** Our server may run a collector as a convenience, but merchants (or anyone) can call `collect`; the server holds no authority over subscriptions.

- **Browser-held keys.** The wallet key is generated and used only in the browser. A password-derived key (PBKDF2, never sent) encrypts it; the server stores that ciphertext plus a hash of a separate password-derived auth key, so it can't open the wallet. The browser signs every payment (EIP-3009) and contract call; the server verifies, pays gas, broadcasts. Trade-off: a forgotten password can't be reset — users back up by exporting the key from Profile. (Supersedes: "Server signs gasless txs" and "Keys encrypted at rest" below.)
- **(Fixed in v2) Known gap: the payee wasn't bound by the payment signature.** EIP-3009 signs amount and `to = AevumPay`, not the recipient; the relayer passes the username. A compromised server could redirect a signed payment (that amount, within 10 min). Fix before testnet deploy: make the contract require `nonce == keccak256(payee, productId, memo, salt)`.

- **Frontend talks only to the AevumPay API, no browser wallet.** The starter kit's RainbowKit/wagmi flow is gone from `web/`; wallets are generated at signup. Session token lives in `localStorage` (fine for testnet; move to an httpOnly cookie before anything real).
- **Product checkout prices come from the chain.** `POST /payments/product` takes only `productId`; the server reads price and merchant from `getProduct`, so a client can't change what it pays.
- **Memo text is kept in the payer's browser.** On-chain memo is a keccak hash, so receipts show the note only on the device that sent it. A server-side memo store is an option later.
- **Design direction: lime band + white sheet.** From the Paynex reference; tokens in `web/src/app/globals.css`. Lime is never a text colour.

- **Non-custodial, real per-user wallets.** Contract never holds funds; a bug can't drain users. Exportable keys = self-custody. (Supersedes: internal-ledger idea.)
- **Username registry on-chain.** `@username → wallet` lives in the contract so payment routing can't be spoofed by the backend.
- **Gasless payments via EIP-3009 + relayer.** Users need zero tQDAY; the relayer pays gas. (Trade-off: relayer is a hot wallet — keep balance minimal, rotate.)
- **Keys encrypted at rest** (AES-256-GCM + scrypt, per-user salt). Passwords scrypt-hashed.
- **Shanghai EVM, always.** Never enable Cancun-only opcodes.
- **JSON-file DB for now.** Fine for the demo; move to Postgres for scale (no decision yet on when).
- **Server signs gasless txs with the user's decrypted key.** Simpler for the demo; client-side/passkey signing is a future upgrade, not a reversal.
