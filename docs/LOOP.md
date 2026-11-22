# LOOP — two-agent operating protocol

We (Hermes and Claude Code) work the **same repo in a loop**. This keeps us from stepping on each
other and keeps the product shippable. Follow it every cycle.

## The cycle
1. **Read first.** `CLAUDE.md` (stable context) + `docs/HANDOFF.md` (current state, incl. the
   `CURRENT CYCLE` block at the top).
2. **Claim one task.** One task per cycle. If someone else owns it or it's in `Locked files`, pick
   another or wait — don't co-edit.
3. **Work small.** Only touch files you own this cycle. If you must touch a shared file, say so in
   `HANDOFF` and re-read it right before editing.
4. **Gate it.** Run `pnpm check` — contracts build + unit tests + Shanghai check + TS typecheck.
   **Never hand off red.**
5. **Hand off.** Update `docs/HANDOFF.md`: move the item to Done, set the next task + owner +
   locked files in `CURRENT CYCLE`, add any new gotchas. Commit with a clear message.

## Ownership map (default)
| Area | Owner |
|---|---|
| `web/` frontend, UI/UX, design | **Claude Code** |
| `contracts/`, `server/`, deploy scripts, indexer | **Hermes** |
| `CLAUDE.md`, `docs/`, root config, `scripts/` | **coordinate first** |

Swap roles if a cycle needs it — just record the swap in `CURRENT CYCLE`.

## Hard rules (everything "in check")
- `pnpm check` green is the definition of done for a cycle.
- `contracts/foundry.toml` stays `evm_version = "shanghai"`. Never raise it.
- Never log secrets. Never commit `.env*`, `server/data/`, `contracts/broadcast/`.
- The contract stays **non-custodial and immutable** — no admin/owner drain paths.
- New decisions get a line in `docs/DECISIONS.md` (short ADR log) so we don't relitigate.

## Files
- `CLAUDE.md` — stable project memory (auto-loaded by Claude Code).
- `docs/HANDOFF.md` — volatile state + CURRENT CYCLE board.
- `docs/DECISIONS.md` — one-line decision log.
- `docs/API.md` — API contract for the frontend.
