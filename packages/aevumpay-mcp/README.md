# @aevumpay/mcp

Let an AI assistant (Claude Desktop, Claude Code, Cursor, any MCP client) use **AevumPay**: pay
people by @name, buy from shops and pay links in tUSD8 on QDay Aevum testnet, but only inside an
on-chain allowance its user approves. Testnet: the money has no real-world value.

## Two ways in

**Just looking things up? Use the hosted server, no install.** Add this URL as a remote MCP server:

```
https://api.pay.nuvixes.studio/mcp
```

Tools: `aevumpay_find_user`, `aevumpay_store`, `aevumpay_read_pay_link`, `aevumpay_agent_status`,
`aevumpay_receipt`, `aevumpay_how_to_pay`. It holds no keys and can't move money.

**Paying? Run this server locally.** It keeps the assistant's own key on its own machine:

```json
{
  "mcpServers": {
    "aevumpay": { "command": "npx", "args": ["-y", "@aevumpay/mcp"] }
  }
}
```

Claude Code: `claude mcp add aevumpay -- npx -y @aevumpay/mcp`

Tools: `aevumpay_status`, `aevumpay_connect_link`, `aevumpay_find_user`, `aevumpay_pay`,
`aevumpay_buy`, `aevumpay_read_request`, `aevumpay_pay_request`.

## How paying stays safe

1. The first run creates an agent key in `~/.aevumpay/agent-key` (mode 600). It is **not** the user's
   wallet key and can't spend anything on its own.
2. `aevumpay_connect_link` gives a link; the user opens it in AevumPay and approves a budget, a
   per-payment cap, an expiry and (optionally) who may be paid.
3. The AevumPay contract refuses any payment outside those limits, and the user can revoke the agent
   in one tap. Instructions hidden in a page or a pay link's note can't get past the contract.

## Settings (environment)

| Variable | Default |
| --- | --- |
| `AEVUMPAY_API_URL` | `https://api.pay.nuvixes.studio` |
| `AEVUMPAY_APP_URL` | `https://pay.nuvixes.studio` |
| `AEVUMPAY_AGENT_KEY` | (unset: use the key file) |
| `AEVUMPAY_AGENT_KEY_FILE` | `~/.aevumpay/agent-key` |

Full guide for agents: https://pay.nuvixes.studio/llms-full.txt · Source: https://github.com/Nifemi0/aevumpay
