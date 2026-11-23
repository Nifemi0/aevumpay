# @aevumpay/agent

Let any agent (an AI assistant, a script, a bot) pay from an AevumPay user's wallet, within limits the user sets on-chain.

- **The agent has its own key.** It never sees the user's key and never holds money.
- **The user sets the limits:** total budget, max per payment, expiry, and optionally which @usernames it may pay. The user approves them in the AevumPay app and can revoke them in one tap.
- **The AevumPay contract enforces every limit.** A buggy or prompt-injected agent still can't go past them.
- **The agent needs no gas and no tUSD8.** It signs; the AevumPay API relays and pays gas.

## Use

```ts
import { AevumPayAgent } from "@aevumpay/agent";

const agent = new AevumPayAgent({
  apiUrl: "http://127.0.0.1:8787",   // AevumPay API
  appUrl: "http://localhost:3000",   // AevumPay web app (for the connect link)
  privateKey: process.env.AGENT_KEY as `0x${string}`, // AevumPayAgent.generateKey() once, then keep it
});

// 1. Ask the user to connect you (they can change these numbers before approving).
console.log(agent.connectLink({ name: "Shopping assistant", budget: "20", maxPerPayment: "5", days: 7 }));

// 2. Check what you're allowed to spend.
console.log(await agent.status()); // { status: "active", remaining: "20", maxPerPayment: "5", ownerUsername: "ada", ... }

// 3. Pay.
const receipt = await agent.pay({ to: "@kemi", amount: "5", memo: "lunch" });
console.log(receipt.paymentId, receipt.txHash);

// Or buy a store product at its on-chain price.
await agent.buy({ store: "bolabakes", productId: 1 });
```

When the contract refuses, `AevumPayError.rule` names the rule: `OverBudget`, `OverPerPaymentLimit`, `AllowanceExpired`, `AllowanceInactive` (revoked), `PayeeNotAllowed`, …

## How a payment is signed

EIP-712, domain `{ name: "AevumPay", version: "2", chainId, verifyingContract: <AevumPay> }`:

```
AgentPayment(address payee, uint256 productId, uint256 amount, bytes32 memo, bytes32 nonce, uint256 deadline)
```

- `payee` is the resolved wallet (for a product, the merchant).
- `memo` is `keccak256(text)`.
- `nonce` is 32 random bytes, used once.
- `deadline` is a unix time, 10 minutes ahead by default.

Anyone may submit `AevumPay.agentPay(payment, signature)`. The AevumPay API does it for you at `POST /agent/pay`.
