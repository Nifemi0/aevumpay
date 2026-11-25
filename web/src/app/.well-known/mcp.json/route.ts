/**
 * /.well-known/mcp.json: tells MCP-aware clients and agents where AevumPay's MCP servers are, so
 * they use tools instead of browsing the site.
 */
export function GET(request: Request) {
  const app = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/+$/, "");
  const api = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
  return Response.json(
    {
      name: "aevumpay",
      description: "Stablecoin payments by @name on QDay Aevum testnet (tUSD8, test money). Prefer these MCP servers over browsing the website.",
      servers: [
        {
          name: "aevumpay-hosted",
          description: "Read-only, no install: users, stores, pay links, agent allowances, receipts. Holds no keys.",
          transport: "streamable-http",
          url: `${api}/mcp`,
        },
        {
          name: "aevumpay",
          description: "Local server for paying inside the allowance a user approves on-chain. Keeps the agent's own key on its machine.",
          transport: "stdio",
          command: "npx",
          args: ["-y", "@aevumpay/mcp"],
          env: { AEVUMPAY_API_URL: api, AEVUMPAY_APP_URL: app },
        },
      ],
      docs: { llms: `${app}/llms.txt`, agentGuide: `${app}/llms-full.txt`, openapi: `${api}/openapi.json` },
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
