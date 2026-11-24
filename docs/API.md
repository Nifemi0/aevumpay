# AevumPay API

Base URL (local): `http://127.0.0.1:8787`
Auth: `Authorization: Bearer <token>` from `/auth/register` or `/auth/login`.
Amounts are decimal strings in tUSD8 (6 dp), e.g. `"25"`, `"4.50"`.

## Custody model

The server never creates, stores or sees a user's wallet key. The browser (`web/src/lib/wallet.ts`):

1. Generates the private key.
2. Derives 64 bytes from the password with PBKDF2-SHA256, 600,000 rounds, salt `aevumpay/v1/<username>`.
   - First 32 bytes → **auth key** (hex). Sent to the server, which stores only its scrypt hash.
   - Last 32 bytes → **encryption key**. Never leaves the browser. Encrypts the wallet key (AES-256-GCM).
3. Sends the server that ciphertext (`wallet`) as a backup it cannot open, so the user can log in on another device.

Everything a user does on-chain is signed in the browser. The server checks signatures, pays gas, and broadcasts.

## Health and config
`GET /health` → `{ ok: true, chainId }`
`GET /config` → `{ chainId, aevumPay, tusd8, hasExplorer }`: what the browser needs to build signatures.
`GET /tx/params?address=0x…[&to=0x…&data=0x…]` → `{ chainId, nonce, gasPrice, gas }`: for signing a legacy tx from that address. With `to` and `data`, `gas` is the node's estimate + 25%. If the call would revert, you get `400 this action would fail on-chain` before anything is signed.

## Auth
`POST /auth/register`
```json
{ "username": "alice", "role": "personal", "authKey": "<64 hex>",
  "address": "0x…", "wallet": { "v": 1, "iv": "<b64>", "ct": "<b64>" },
  "registerTx": "0x<signed legacy tx calling register(\"alice\")>" }
```
→ `{ token, user: { id, username, role, address }, wallet }`
- The tx must be signed by `address`, call `AevumPay.register(username)` on this chain, and have a sane gas limit and price.
- The server tops up the wallet's gas, broadcasts the tx, and saves the account only once it succeeds.

`POST /auth/login` `{ "username": "alice", "authKey": "<64 hex>" }` → `{ token, user, wallet }`
- 5 bad attempts → `429` lockout for 15 min. Accounts from before browser-held keys → `410 legacy account`.

`GET /auth/me` → `{ user, wallet }`. The wallet backup comes back so a new device can unlock with the password.

## Users
`GET /users/:username` → `{ username, address, role }` (404 if unregistered)

## Wallet
`GET /wallet/balance` → `{ address, balance: "75", symbol: "tUSD8" }`

## Payments (browser-signed, relayed)
Both payment calls take an EIP-3009 `ReceiveWithAuthorization` the browser signed:
```json
"authorization": { "value": "25000000", "validAfter": "0", "validBefore": "<unix secs>",
                   "salt": "0x<32 random bytes>", "signature": "0x…" }
```
Domain `{ name: "tUSD8", version: "2", chainId, verifyingContract: tusd8 }`; `from` = the caller's wallet, `to` = AevumPay.
The signed **nonce is not random**: it must be `AevumPay.paymentNonce(payee, productId, keccak256(memo), salt)`, i.e.
`keccak256(abi.encode(keccak256("AevumPay.payment.v2"), payeeWallet, productId, memoHash, salt))`. The signature
therefore fixes who gets paid, for which product and with which memo; a relayer can't change any of them.
The server refuses it unless:
- the signature recovers to the caller's wallet;
- `value` equals the amount being paid;
- it expires within the hour.

`POST /payments/send` `{ "to": "bob", "amount": "25", "memo": "lunch", "authorization": {…} }`
→ `{ txHash, explorer, paymentId, blockNumber, to, amount }`
- Errors: 404 recipient not found; 400 insufficient balance / bad amount / self-pay / bad authorization.

`POST /payments/product` `{ "productId": 1, "memo": "", "authorization": {…} }` → buy a store product.
→ `{ txHash, explorer, paymentId, blockNumber, productId, product, merchant, merchantUsername, amount, fee }`
- The price is read from the chain, and the authorization must be for exactly that price.
- 0.5% (`fee`) goes to the treasury; the merchant receives `amount - fee`. Person-to-person payments are free.
- Errors: 404 product not found; 400 not for sale / own product / insufficient balance / bad authorization.

`GET /payments/:id` →
```json
{ "id": "1", "payer": "0x..", "payee": "0x..", "amount": "25", "productId": "0", "paidAt": 1795337463, "memo": "0x..",
  "fee": "0", "via": null, "subscriptionId": "0" }
```

`GET /activity?limit=50` → the caller's payment history (payer OR payee), newest first:
```json
{ "address": "0x..", "count": 1,
  "payments": [{ "id": "1", "direction": "out", "counterparty": "0x..",
    "counterpartyUsername": "bob", "amount": "25", "productId": "0",
    "memo": "0x..", "txHash": "0x..", "explorer": "https://explorer-test.qday.info/tx/0x..",
    "blockNumber": 8 }] }
```
Read from `Paid` events in ≤999-block chunks (Aevum's `eth_getLogs` cap).

## Stores
Store changes are AevumPay calls from the merchant's own wallet, so the browser signs them.

`POST /tx/send` `{ "rawTx": "0x<signed legacy tx>" }` → `{ txHash, explorer, call, blockNumber }`
- Allowed AevumPay calls: `createStore`, `renameStore`, `setStoreActive`, `addProduct`, `setProductActive`,
  `grantAllowance`, `revokeAllowance`, `createPlan`, `setPlanActive`, `subscribe`, `cancelSubscription`, `collect`.
- Allowed token call: `approve(AevumPay, amount)` with `amount ≤ 100,000 tUSD8`. Unlimited approvals and approvals to anyone else are refused.
- The tx must be signed by the caller's wallet, send no value, and use gas ≤ 800k at no more than 3× the current price (+1 gwei).
- The server tops up gas, then broadcasts.

`GET /stores/:owner` (username or 0x address) →
```json
{ "owner": "0x..", "name": "Bob's Coffee", "active": true,
  "products": [{ "id": 1, "name": "Flat White", "price": "4.5", "active": true }] }
```

## Local only
`POST /dev/faucet` `{ "amount": "100" }` → mints MockUSD8 to the caller (chain ≠ 44005 only).

## Contract v2 features (called through `/tx/send`)
- **Agent allowances**: `grantAllowance(agent, budget, maxPerPayment, expiresAt, payees[])`, `revokeAllowance(agent)`, `getAllowance(agent)`.
  An agent signs an EIP-712 `AgentPayment(address payee, uint256 productId, uint256 amount, bytes32 memo, bytes32 nonce, uint256 deadline)`
  in domain `{ name: "AevumPay", version: "2", chainId, verifyingContract: aevumPay }`; anyone submits `agentPay(payment, signature)`.
  The contract enforces the budget, per-payment cap, expiry, payee list and nonce; the owner must have approved AevumPay on the token.
  Relay: `POST /agent/pay` (below). SDK: `packages/aevumpay-agent`. MCP server: `packages/aevumpay-mcp`.
- **Subscriptions**: merchants `createPlan(name, amount, period)` (period ≥ 60 s); customers `subscribe(planId, maxPayments)` (first period charged now).
  Anyone may call `collect(subscriptionId)` when due. It charges at most one period, never back-charges missed ones, and if the balance or
  approval is short it emits `CollectionFailed` instead of reverting. It lapses after a grace period of min(3 days, period).
  Either party may `cancelSubscription`. Charges pay the 0.5% fee.

## Spending permissions (agents and subscriptions)

`GET /wallet/approval` (auth) → `{ approved }`: how much AevumPay may draw from you, shared by all allowances and subscriptions.

`GET /allowances` (auth) → `{ allowances: [{ agent, owner, status, budget, spent, remaining, maxPerPayment, expiresAt, payeesRestricted }] }`
- `status` is `active` | `expired` | `revoked`. Read from `AllowanceGranted` logs (≤999-block chunks), then `getAllowance`.

`GET /agents/:address` (public) → the same fields plus `ownerUsername`, or `404` if no one has connected this agent.

`POST /agent/pay` (public; the agent's signature is the authorization)
```json
{ "payment": { "payee": "0x…", "productId": "0", "amount": "5000000", "memo": "0x<32 bytes>",
               "nonce": "0x<32 bytes>", "deadline": "<unix secs>" },
  "signature": "0x…" }
```
→ `{ paymentId, txHash, explorer, blockNumber, amount }`
- Simulated first. A refusal returns `400 { error, rule }`, e.g. `rule: "OverBudget"`, `"OverPerPaymentLimit"`, `"AllowanceExpired"`,
  `"AllowanceInactive"` (revoked), `"PayeeNotAllowed"`, `"NonceUsed"`, `"SignatureExpired"`, `"WrongAmount"`.
- Use `packages/aevumpay-agent` instead of building this by hand.

`GET /plans/:owner` (username or address) → `{ plans: [{ id, merchant, name, amount, period, active }] }`

`GET /plan/:id` → one plan plus `merchantUsername`.

`GET /subscriptions` (auth) → `{ asSubscriber: [...], asMerchant: [...] }`
- Each item: `{ id, planId, planName, subscriber(Username), merchant(Username), amount, period, nextDue, paidCount, maxPayments, status, pastDue, due }`.
- `status` is `active` | `cancelled` | `lapsed` | `completed`.

`GET /grant` (auth) → `{ enabled, amount, claimed, available, reason?, txHash?, explorer? }`: whether this account can claim its welcome dollars.

`POST /grant` (auth) → `{ amount, txHash, explorer }`: sends `GRANT_AMOUNT` tUSD8 (default 5) from the grant wallet to the caller.
- Once per account and per wallet ever, once per IP per UTC day, `GRANT_DAILY_LIMIT` per day in total.
- `409` already claimed or in progress, `429` a cap is reached or the pot is empty, `404` grants are off. See `server/src/grant.ts`.

**Errors from `/tx/params`.** When a call would revert, it returns `400 { error, rule }` with the contract rule in plain words.
For example, `AgentInUse` → "this agent is already connected to another AevumPay account".

**Collector.** The server runs `collect` on due subscriptions every `COLLECTOR_INTERVAL_MS` (default 30000; 0 = off).
- It's a convenience only: `collect` is permissionless, and merchants have a "Collect due payments" button.
- A past-due subscription is retried only when it can be covered, or when its grace period has ended.
