# Demo video — shot list (target 3–4 min)

Record at **https://pay.nuvixes.studio** (Aevum testnet, chain 44005). Have a second browser profile or
phone ready as the "other person". Keep explorer tabs open to paste tx hashes. Talk through *why*, not
just clicks.

### 0:00–0:20 — Hook (problem)
- "Sending stablecoins today means copying `0x…` addresses, buying gas, and trusting a custodian. AevumPay
  makes it as easy as a name: `@you`."
- One line on the four problems: addresses, custody, merchants, AI agents.

### 0:20–0:55 — Sign up
- Open the site → **Get your @name** → pick role (Personal) → choose `@ada` (+3 chars) → password.
- "The wallet is generated in the browser; the key is encrypted with your password and never leaves the device."
- Land on Home, show the balance card ($0 → after grant below).

### 0:55–1:25 — Welcome dollars
- Tap **Add money / claim welcome dollars** → confirm $1 arrives.
- Open the tx on the explorer (paste the hash) → "real tUSD8, on Aevum."
- Point out: "no gas, no address, no wallet extension."

### 1:25–2:05 — Pay a person by @username
- On the second account, sign up as `@kemi`.
- Back on `@ada`: **Send** → `@kemi` → amount → send.
- Show the **success receipt**, the balance change on both sides, and the explorer tx.
- "Gasless: the payer signed an EIP-3009 authorization; our relayer paid the gas and **could not redirect
  it** — the payee is baked into the signature."

### 2:05–2:45 — Store checkout + fee
- Open **/shop/demobakery** → buy the **Butter croissant (0.75)**.
- Show the receipt: the **0.5% store fee** and what the merchant received.
- Explorer tx. "Anyone can open a store and get paid by link — no processor."

### 2:45–3:25 — Agent allowance (the safety story)
- Go to **Spending permissions / Connect agent**; grant an agent `$budget`, a `per-call cap`, an `expiry`.
- From the terminal, run the agent (MCP/SDK): "Claude, pay @kemi $0.50" → succeeds.
- Try an amount **over the cap** → **refused** (`OverPerPaymentLimit`). "The limit is on-chain; a prompt
  injection can't exceed it."
- Click **Revoke now** → the agent is immediately refused.

### 3:25–3:55 — Subscriptions (optional if time)
- As the merchant: create a plan (e.g. $0.50 / 60s). As `@kemi`: subscribe.
- Show the first charge + receipt; show the merchant "Collect due" or the auto-collector renewal.

### 3:55–4:15 — Close
- Architecture in one breath: **browser keys → API relays/pays gas → non-custodial contract on Aevum**.
- Links on screen: app `pay.nuvixes.studio`, repo `github.com/Nifemi0/aevumpay`, contract
  `0xAA36…95F7`, explorer `explorer-test.qday.info`.

### Recording tips
- 1440×900 or 1920×1080, browser zoom ~110% so text is readable.
- Show the **explorer page** for at least one payment and one agent payment (judges want on-chain proof).
- Keep a note of each tx hash as you go: person-to-person, store purchase, agent payment, subscription charge.
- If the welcome pot is empty mid-take, top up the treasury or use a pre-funded test wallet.
