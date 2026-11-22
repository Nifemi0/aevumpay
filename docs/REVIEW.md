# REVIEW — all-round inspection checklist

Run by Hermes at the end of a cycle to inspect what the builder produced. Start with `pnpm check`,
then walk this list. Report **PASS / FAIL** per item with the file:line evidence for any FAIL.

## 1. Gate
- [ ] `pnpm check` green (contracts build, 35+ tests, Shanghai check, TS typecheck)
- [ ] no new compile/type errors introduced

## 2. Aevum correctness
- [ ] `contracts/foundry.toml` still `evm_version = "shanghai"`
- [ ] no MCOPY / TSTORE / TLOAD / blob opcodes anywhere
- [ ] no WebSocket RPC; `getLogs` chunked to ≤ 1,000 blocks
- [ ] tUSD8 treated as 6 decimals (`parseUnits(x, 6)`, `formatUnits(x, 6)`)
- [ ] EIP-3009 domain name `tUSD8`, version `2`; signature `to` = AevumPay address

## 3. Security
- [ ] contract stays non-custodial — no fund custody, no admin/owner drain path
- [ ] no secrets in the diff (`git diff` + grep for keys/tokens); `.env*`, `server/data/` not staged
- [ ] `auth` middleware on every private route; input validation; rate limiters intact
- [ ] key encryption intact (AES-256-GCM + scrypt); passwords scrypt
- [ ] no `dangerouslySetInnerHTML` / `eval` / shell injection with user input
- [ ] new dependencies reviewed (typosquats, postinstall scripts)

## 4. Loop hygiene
- [ ] `docs/HANDOFF.md` CURRENT CYCLE updated (owner, task, locked files)
- [ ] new decisions recorded in `docs/DECISIONS.md`
- [ ] commit message explains the *why*; no secrets; locked files respected

## 5. Product / challenge fit
- [ ] still a **human payment app**: role at signup, `@username`, wallet, stores, checkout
- [ ] demo path produces on-chain proof (tx hashes / receipts)
- [ ] docs cover problem, architecture, workflows, testnet addresses, reproduction
- [ ] no malicious code; only Aevum testnet; code built in the build window

## Reporting format
```
CYCLE <commit> — REVIEW
Gate: PASS/FAIL
FAILs: <item> — <file:line> — <why>
Warnings: <non-blocking notes>
Verdict: SHIP / FIX-FIRST
```
