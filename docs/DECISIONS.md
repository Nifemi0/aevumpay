# DECISIONS — short ADR log

One line per decision. Add new ones at the top. Don't delete — supersede.

- **Non-custodial, real per-user wallets.** Contract never holds funds; a bug can't drain users. Exportable keys = self-custody. (Supersedes: internal-ledger idea.)
- **Username registry on-chain.** `@username → wallet` lives in the contract so payment routing can't be spoofed by the backend.
- **Gasless payments via EIP-3009 + relayer.** Users need zero tQDAY; the relayer pays gas. (Trade-off: relayer is a hot wallet — keep balance minimal, rotate.)
- **Keys encrypted at rest** (AES-256-GCM + scrypt, per-user salt). Passwords scrypt-hashed.
- **Shanghai EVM, always.** Never enable Cancun-only opcodes.
- **JSON-file DB for now.** Fine for the demo; move to Postgres for scale (no decision yet on when).
- **Server signs gasless txs with the user's decrypted key.** Simpler for the demo; client-side/passkey signing is a future upgrade, not a reversal.
