# DoraHacks submission — paste-ready

**Project name:** AevumPay

**Tagline:** Stablecoin payments on QDay Aevum — by @username, not by wallet address.

**One-paragraph description:**
AevumPay is a stablecoin payments app for people and small businesses on the QDay Aevum testnet
(chain 44005). Users claim a @username, get a real self-custody wallet created in their browser, and
send tUSD8 by name — gasless, because a relayer submits an EIP-3009 signature and pays the gas.
Businesses open a store and take payments by link with a fixed 0.5% fee to an immutable treasury.
AI agents can be given an on-chain spending allowance (budget, per-payment cap, expiry, payee
allow-list, instant revoke) so they can pay for things without being able to drain a wallet. The
contract is non-custodial, has no owner, and is not upgradeable.

**Category:** Payments / Stablecoins · Agentic commerce

## Links
- **Repo (public):** https://github.com/Nifemi0/aevumpay  (branch `main`)
- **Live app:** https://pay.nuvixes.studio  (mirror: https://aevumpay-theta.vercel.app)
- **API:** https://api.pay.nuvixes.studio
- **Demo video:** _add YouTube/Loom link_
- **Explorer:** https://explorer-test.qday.info

## On-chain proof (Aevum testnet, chain 44005)
- **AevumPay contract:** `0xAA36d954e8930FFe29078bDF67975534A31895F7`
- **tUSD8:** `0x456569838f1d43009A91ebA4263147Afd7233483`
- **Deploy block:** `3,946,807`
- **Deploy tx:** `0xa64f374aaded848dff450efb0374d2545fd8497303117edc9088d180fc27016a`
- **Treasury (0.5% fee):** `0xc2Cb9Ee19527f516127CbB47cbA217BfB1563777`

**Sample transactions**
- Person-to-person payment: `0xf6f41958075d3f5a9093929569ddcb5798762e2e8c1f013f75a53736bcc5049b`
- Agent payment within an allowance: `0xa7e681bb46dacd558c050d7582ac5c03b44134f822c0c4ec53abc374352e67c0`
- Welcome grant: `0x82812ad042de18b24326b5abbdb56355282772380dc158e46a5a70db5a47c587`
- Gasless send (payment #6): `0x9c9f4f038102d11bee7cf93cf25f3a00868c84debdd907da3574d3ab8f023e59`

## Tech stack
Solidity 0.8.24 (Shanghai EVM) + Foundry + OpenZeppelin 5 · Node 22 / TypeScript / Express / viem ·
Next.js 16 / React 19 · `@aevumpay/agent` SDK + `@aevumpay/mcp` MCP server · pnpm workspace.

## How it works (short)
- Browser generates and encrypts the wallet (PBKDF2 600k → auth key + AES-GCM key; non-extractable in IndexedDB). Server holds only an auth-key hash + opaque ciphertext.
- Payments are EIP-3009 signatures whose nonce commits to payee + product + memo; a relayer submits and pays gas.
- Contract forwards payer→payee→treasury in one tx; no custody, no admin, immutable.
- Agent allowances and subscriptions are enforced on-chain.

## Known limits / roadmap
Welcome dollars are $1 on this test deploy (grant treasury holds a few tUSD8). Server test suite,
httpOnly session cookies, passkey recovery, and a Postgres/Redis store are the next steps.

## Team
_Solo / your name._ Built during the Aevum Builder Challenge #1 window.

## License
MIT. Based on the Aevum Starter Kit (MIT, PQA Labs).
