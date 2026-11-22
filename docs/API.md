# AevumPay API

Base URL (local): `http://127.0.0.1:8787`
Auth: `Authorization: Bearer <token>` from `/auth/register` or `/auth/login`.
Amounts are decimal strings in tUSD8 (6 dp), e.g. `"25"`, `"4.50"`.

## Health
`GET /health` → `{ ok: true, chainId }`

## Auth
`POST /auth/register`
```json
{ "username": "alice", "role": "personal", "password": "secret123" }
```
→ `{ token, user: { id, username, role, address } }`
- Generates a wallet, registers the username on-chain (relayer tops up gas).
- `role`: `personal` | `business`.

`POST /auth/login` `{ "username": "alice", "password": "secret123" }` → `{ token, user }`
- 5 bad attempts → `429` lockout for 15 min.

`GET /auth/me` → `{ user }`

## Users
`GET /users/:username` → `{ username, address, role }` (404 if unregistered)

## Wallet
`GET /wallet/balance` → `{ address, balance: "75", symbol: "tUSD8" }`

## Payments
`POST /payments/send`
```json
{ "to": "bob", "amount": "25", "memo": "lunch" }
```
→ `{ txHash, explorer, paymentId, to, amount }`
- Gasless: server signs an EIP-3009 auth, relayer submits and pays gas.
- Errors: 404 recipient not found; 400 insufficient balance / bad amount / self-pay.

`GET /payments/:id` →
```json
{ "id": "1", "payer": "0x..", "payee": "0x..", "amount": "25", "productId": "0", "paidAt": 1795337463, "memo": "0x.." }
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
`POST /stores` `{ "name": "Bob's Coffee" }` → `{ txHash, store }`
`POST /stores/products` `{ "name": "Flat White", "price": "4.5" }` → `{ txHash, product }`
`GET /stores/:owner` (username or 0x address) →
```json
{ "owner": "0x..", "name": "Bob's Coffee", "active": true,
  "products": [{ "id": 1, "name": "Flat White", "price": "4.5", "active": true }] }
```

## Local only
`POST /dev/faucet` `{ "amount": "100" }` → mints MockUSD8 to the caller (chain ≠ 44005 only).
