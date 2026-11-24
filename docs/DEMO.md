# Demo video: script and shot list

**Length: 4:30, hard stop at 5:00.** The DoraHacks form requires a demo video but sets no theme or length. The top 5 also give a
**3–5 minute live demo** on a video call on **Dec 15, 06:00 UTC**; a recording can't replace it, and at least one of us must attend.
So this script is built to work as both: record it now, then present the same run live.

Everything is on **https://pay.nuvixes.studio** (Aevum testnet, chain 44005). Sources: the
[DoraHacks page](https://dorahacks.io/hackathon/qday/detail) (requirements, criteria) and [qday.io/builder-challenge](https://qday.io/builder-challenge) (weights, FAQ).

## What judges score (out of 100) and where the video covers it

| Criterion | Pts | Covered in |
|---|---|---|
| Innovation and originality ("creative agentic mechanics") | **20** | §5 agent with on-chain limits, the longest section |
| User experience and presentation ("compelling narrative", responsive, plain-language errors) | 15 | §1 pitch, §2 sign-up incl. error, §4 phone shot |
| Technical quality ("spending limits, scoped session keys, identity primitives") | 15 | §2 @name registry, §3 gasless signature, §5 agent key + allowance |
| Real-world utility ("workflow fit", "monetization", "roadmap to mainnet") | 15 | §4 shop + 0.5% fee, §7 close |
| Safety, trust and controls ("spend caps, session expiry, instant revocation, audit trail, prompt injection") | 15 | §5 refusals + revoke, §6 receipts |
| Demo clear and well-structured ("core flow, agent actions, edge cases", "tx hashes, explorer links, state changes") | 10 | every section ends on an explorer link or a balance change |
| Documentation | 10 | not in the video; README, docs/API.md, /llms.txt |

**Rules for every shot:** show the explorer page after each on-chain step (judges want visible tx hashes and state changes); say *why*
in one sentence, not what you're clicking; keep the cursor still while talking.

## Before recording

- [ ] **Treasury funded** so the welcome grant pays out (check `GET https://api.pay.nuvixes.studio/grant` while logged in shows
      `available: true`). Note the grant amount (currently $1) and say that number.
- [ ] Two **fresh @names** nobody has (check on the sign-up page), e.g. `@ada…` (payer) and `@kemi…` (payee). Browser profile A = ada,
      profile B (or a phone) = kemi.
- [ ] `@kemi` already has a small balance (claim its grant beforehand) so it can subscribe in §6.
- [ ] **Agent ready**: Claude Desktop or Claude Code with the AevumPay MCP server, env
      `AEVUMPAY_API_URL=https://api.pay.nuvixes.studio`, `AEVUMPAY_APP_URL=https://pay.nuvixes.studio` (or the SDK script in
      `packages/aevumpay-agent/README.md`). Run `aevumpay_status` once so its key exists.
- [ ] Tabs open: the app, `explorer-test.qday.info`, `pay.nuvixes.studio/llms.txt`, the GitHub repo.
- [ ] 1920×1080, browser zoom 110–125%, notifications off, a phone on screen-mirror for §4 (or the browser's phone view).
- [ ] A scratch note for every tx hash as you go: grant, P2P payment, shop purchase, agent payment, subscription charge.

## Script

### 1. Pitch, 0:00–0:25 (UX: narrative)
On screen: the landing page hero.
> "Sending stablecoins today means copying a 42-character address, holding gas, and hoping you typed it right. And now AI
> assistants want to pay for us, with no safe way to let them. AevumPay is payments by name, on Aevum: pay `@kemi`, sell with a
> link, and give your AI a budget it physically can't exceed."

### 2. Sign up, 0:25–1:00 (UX, identity, an edge case)
- **Get your @name** → type a 2-letter name first: the form says *"A little longer: at least 3 characters"* and won't continue.
  > "Errors are plain words, and the contract enforces the same rule."
- Type `@ada…` → green "Nice, it's yours" → **Just me** → password.
  > "The wallet is made right here in the browser and locked with my password. The server never sees the key, and the @name is
  > registered on-chain to that wallet."
- Lands on **Add money**.

### 3. Money in, and paying a person, 1:00–1:50 (core flow, gasless, on-chain proof)
- **Claim** the welcome dollars → balance updates → open the tx on the explorer.
  > "Real tUSD8 on Aevum testnet. I hold no gas and installed no wallet."
- **Send** → `@kemi…` → $0.50 → send → receipt → explorer.
  > "I signed one authorization in the browser; our relayer paid the gas. The payee is fixed inside the signature, so even our
  > server couldn't redirect it."
- Cut to profile B: `@kemi`'s balance went up.

### 4. A shop, on a phone, 1:50–2:30 (utility, monetization, responsive)
- On the **phone**: open `pay.nuvixes.studio/shop/demobakery` → buy the **Butter croissant ($0.75)** → receipt shows the **0.5% fee**.
- Explorer tx.
  > "Any business can sell with a link. Payments between people are free; shops pay 0.5%, a fraction of card fees. That's the
  > business model."

### 5. An AI agent with a budget, 2:30–3:40 (innovation, safety: the longest section)
- In Claude: *"Connect to my AevumPay wallet with a $2 budget, $0.50 max per payment, for 7 days."* → it returns a connect link.
- Open it as `@ada` → review the limits → **Approve**.
  > "The AI gets its own key and an on-chain allowance: a budget, a per-payment cap and an expiry. Never my key."
- *"Pay @kemi $0.25 for coffee."* → paid → open the explorer link it returns: an `agentPay` call, and `@kemi`'s balance went up.
- *"Now pay @kemi $1."* → **refused: over the per-payment limit** (`OverPerPaymentLimit`).
  > "That refusal comes from the contract, not the prompt. A prompt injection or a buggy agent can't get past it."
- **Profile → Spending permissions → Revoke** → back in Claude: *"Pay @kemi $0.25."* → **refused** (`AllowanceInactive`).
  > "One tap and it's cut off, instantly, on-chain."

### 6. Subscriptions and the audit trail, 3:40–4:10 (controls, audit)
- As a business account (or `@demobakery` if you control it): a plan **$0.10 every minute**. As `@kemi`: **Subscribe** → first charge
  → receipt. Within a minute the collector renews it; show the second receipt.
  > "It charges once per period, never back-charges missed ones, and either side can cancel."
- **Activity**: every payment with its explorer link.

### 7. Close, 4:10–4:30 (utility, docs, roadmap)
On screen: the footer, then `pay.nuvixes.studio/llms.txt`.
> "Non-custodial: keys in the browser, a contract with no owner, every payment a public receipt. Any AI can read our llms.txt and
> start paying within limits. Next: passkey recovery, more payment rails for merchants, and mainnet in February."

Show the URLs: `pay.nuvixes.studio` · `github.com/Nifemi0/aevumpay` · contract `0xAA36d954e8930FFe29078bDF67975534A31895F7`.

## If something breaks mid-take

- **Grant not available** (pot empty or daily limit): use a pre-funded profile and say "after claiming welcome dollars". Don't cut
  the explorer shot.
- **A payment is slow**: keep talking about why it's safe; Aevum confirms in about a second, so wait it out rather than re-clicking.
- **The agent says "not connected"**: the approve step didn't finish; reopen the connect link.
- Never retry a payment before checking Activity: it may already have gone through.

## After recording

- Upload to YouTube (unlisted) or Loom; paste the link into `docs/SUBMISSION.md` and the DoraHacks form.
- Add the tx hashes you noted to the README's on-chain proof section.
