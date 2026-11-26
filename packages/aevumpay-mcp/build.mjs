// Bundle the MCP server into one runnable file (dist/aevumpay-mcp.mjs) for `npx -y @aevumpay/mcp`.
// The agent SDK (a workspace package) is bundled in; the MCP SDK, viem and zod stay real dependencies.
import { chmodSync } from "node:fs";
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/aevumpay-mcp.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  external: ["@modelcontextprotocol/sdk", "viem", "zod"],
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
});
chmodSync("dist/aevumpay-mcp.mjs", 0o755); // runnable as a bin on Linux and macOS
console.log("built dist/aevumpay-mcp.mjs");
