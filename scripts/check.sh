#!/usr/bin/env bash
# One gate both agents run before handing off. Non-zero exit = do NOT hand off.
set -uo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0
step() { printf "\n\033[1m==> %s\033[0m\n" "$1"; }

step "contracts: build"
(cd contracts && forge build) || fail=1

step "contracts: unit tests (skips fork/*)"
(cd contracts && forge test --no-match-path 'test/fork/*') || fail=1

step "contracts: Shanghai-safety check"
node tools/check-shanghai.mjs contracts/out || fail=1

step "typescript: typecheck (server, examples, web…)"
pnpm -r --if-present typecheck || fail=1

if [ "$fail" -ne 0 ]; then
  printf "\n\033[31mCHECKS FAILED — do not hand off.\033[0m\n"
  exit 1
fi
printf "\n\033[32mALL CHECKS PASSED — safe to hand off.\033[0m\n"
