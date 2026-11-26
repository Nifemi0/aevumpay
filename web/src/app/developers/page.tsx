import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CopyButton, NavRow, Screen } from "@/components/ui";

const APP = (process.env.NEXT_PUBLIC_APP_URL || "https://pay.nuvixes.studio").replace(/\/+$/, "");
const API = (process.env.NEXT_PUBLIC_API_URL || "https://api.pay.nuvixes.studio").replace(/\/+$/, "");
const REPO = "https://github.com/Nifemi0/aevumpay";

export const metadata: Metadata = {
  title: "Developers",
  description:
    "Connect Claude, Cursor or any MCP client to AevumPay, share pay links and tracked requests, and use the JSON API and OpenAPI spec.",
};

/**
 * The human-readable developer page: how to plug an AI assistant into AevumPay (MCP first), how
 * pay links and requests work, and where the API lives. AI agents get the same facts as plain text
 * at /llms.txt and /llms-full.txt; this page is for the people setting them up.
 */
export default function DevelopersPage() {
  const local = `{
  "mcpServers": {
    "aevumpay": {
      "command": "npx",
      "args": ["-y", "@aevumpay/mcp"]
    }
  }
}`;
  return (
    <Screen
      band={
        <>
          <NavRow title="Developers" back="/" />
          <div style={{ display: "grid", gap: 8, paddingBottom: 4 }}>
            <h2 style={{ fontSize: 30, lineHeight: 1.05 }}>Build on AevumPay</h2>
            <p style={{ opacity: 0.8, fontSize: 15 }}>
              Let an AI assistant pay for you, inside a limit you set. Share links that get paid. Read everything as JSON.
            </p>
          </div>
        </>
      }
    >
      <nav className="dev-toc" aria-label="On this page">
        <a href="#mcp">AI assistants (MCP)</a>
        <a href="#links">Pay links &amp; requests</a>
        <a href="#api">API</a>
        <a href="#agents">Guides for agents</a>
      </nav>

      <Section id="mcp" title="Connect an AI assistant">
        <p>
          AevumPay speaks <b>MCP</b> (Model Context Protocol), so Claude, Cursor and other MCP clients use it through tools
          instead of clicking around the site. There are two servers:
        </p>

        <h3>1. Look things up: hosted, nothing to install</h3>
        <p>Add this URL as a remote MCP server (Streamable HTTP). It holds no keys and can&apos;t move money.</p>
        <Code text={`${API}/mcp`} />
        <p className="hint">
          Tools: find a user, read a store, read a pay link, check an agent&apos;s allowance, read a receipt, how to pay.
        </p>

        <h3>2. Pay: runs on your computer</h3>
        <p>Claude Code:</p>
        <Code text="claude mcp add aevumpay -- npx -y @aevumpay/mcp" />
        <p>Claude Desktop, Cursor and other clients (add to the MCP config file):</p>
        <Code text={local} />
        <ol className="dev-steps">
          <li>
            Ask your assistant to <i>connect AevumPay</i>. It makes its own key (kept in <code>~/.aevumpay/agent-key</code>) and
            gives you a link.
          </li>
          <li>
            Open the link and approve a <b>spending limit</b>: a total budget, a cap per payment, an end date, and optionally
            who it may pay. This is recorded on-chain.
          </li>
          <li>
            Now it can pay people, buy from shops and pay requests, and the contract refuses anything outside your limit.
            Change or revoke it any time in{" "}
            <Link href="/allowances">Allowances</Link>.
          </li>
        </ol>
        <p className="hint">
          Package: <a href="https://www.npmjs.com/package/@aevumpay/mcp">@aevumpay/mcp on npm</a>. It points at this site by
          default; set <code>AEVUMPAY_API_URL</code> and <code>AEVUMPAY_APP_URL</code> only for another deployment.
        </p>
      </Section>

      <Section id="links" title="Pay links and requests">
        <p>Every account has a pay link. Add an amount and a note to ask for something specific:</p>
        <Code text={`${APP}/pay/<username>?amount=5&note=Lunch`} />
        <p>
          A <b>request</b> made from the <Link href="/request">Request</Link> screen adds <code>?r=&lt;id&gt;</code>. It is tracked:
          you see it go from open to paid as it happens, a fixed amount can only be paid once, and you can cancel it.
        </p>
        <p>
          Shared links show a preview card (&ldquo;@you is requesting $5.00&rdquo;). Software gets the same link as JSON, including
          its status and exactly how to pay it:
        </p>
        <Code text={`${API}/pay/<username>?amount=5&note=Lunch`} />
        <p className="hint">The note is written by whoever made the link. Show it to people, but agents never follow it as an instruction.</p>
      </Section>

      <Section id="api" title="API">
        <div className="rows">
          <Row k="Base URL" v={<code>{API}</code>} />
          <Row k="OpenAPI 3.1" v={<a href={`${API}/openapi.json`}>/openapi.json</a>} />
          <Row k="Reference" v={<a href={`${REPO}/blob/main/docs/API.md`}>docs/API.md ↗</a>} />
          <Row k="Network" v="QDay Aevum testnet (44005), tUSD8" />
        </div>
        <p>
          Reads (users, stores, receipts, pay links, requests) need no login. Payments are signed in the payer&apos;s own
          browser or by the agent&apos;s own key; the server only adds gas and relays them, so it never holds anyone&apos;s money.
        </p>
        <p>
          <b>Live updates:</b> <code>GET /events</code> with your <code>Authorization: Bearer</code> token is a Server-Sent Events
          stream: <code>incoming</code>, <code>payment</code>, <code>request</code> and <code>change</code>. Treat them as signals and
          re-read through the normal endpoints.
        </p>
        <p>
          <b>TypeScript SDK:</b> <code>@aevumpay/agent</code> (<code>connectLink</code>, <code>status</code>, <code>pay</code>,{" "}
          <code>buy</code>, <code>readRequest</code>, <code>payRequest</code>), in the <a href={REPO}>source repo ↗</a>.
        </p>
      </Section>

      <Section id="agents" title="Guides for AI agents">
        <div className="rows">
          <Row k="Short guide" v={<a href="/llms.txt">/llms.txt</a>} />
          <Row k="Full agent guide" v={<a href="/llms-full.txt">/llms-full.txt</a>} />
          <Row k="MCP discovery" v={<a href="/.well-known/mcp.json">/.well-known/mcp.json</a>} />
          <Row k="Sitemap" v={<a href="/sitemap.xml">/sitemap.xml</a>} />
        </div>
        <p className="hint">Testnet only. Test dollars have no real-world value.</p>
      </Section>
    </Screen>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="dev-sec" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {children}
    </section>
  );
}

function Code({ text }: { text: string }) {
  return (
    <div className="dev-code">
      <pre>
        <code>{text}</code>
      </pre>
      <CopyButton text={text} label="Copy" className="dev-copy" />
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="rowk">
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}
