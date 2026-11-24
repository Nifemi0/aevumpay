"use client";

import { useState } from "react";
import { KeyIcon } from "@/components/Icons";
import { ErrorBox, Loading, NavRow, Screen, Spinner } from "@/components/ui";
import { api, type AgentAllowance, type User } from "@/lib/api";
import { agentName } from "@/lib/agentNames";
import { dateText, moneyText, shortAddr } from "@/lib/format";
import { useLoad, useRequireUser, useSession } from "@/lib/session";
import { signApproval, signContractCall } from "@/lib/sign";

export default function AllowancesPage() {
  const user = useRequireUser();
  if (!user) return <Loading />;
  return <Allowances user={user} />;
}

/**
 * "Spending permissions": everything that can draw from this wallet without asking each time.
 * Agents with an allowance, plus the token approval those allowances and subscriptions draw on.
 */
function Allowances({ user }: { user: User }) {
  const { account } = useSession();
  const list = useLoad(() => api.allowances(), [user.id]);
  const approval = useLoad(() => api.approval(), [user.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(agent: string) {
    setBusy(agent);
    setError(null);
    try {
      const raw = await signContractCall(await account(), { functionName: "revokeAllowance", args: [agent as `0x${string}`] });
      await api.sendTx(raw);
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function revokeAll() {
    setBusy("all");
    setError(null);
    try {
      await api.sendTx(await signApproval(await account(), 0n));
      approval.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const allowances = list.data?.allowances ?? [];
  const approved = approval.data?.approved ?? "0";

  return (
    <Screen
      tabs={{ business: user.role === "business" }}
      band={
        <>
          <NavRow title="Spending permissions" back="/profile" />
          <div className="balcard">
            <span className="unit">AevumPay may draw up to</span>
            <span className="bal" style={{ ["--bal-size" as string]: "34px" }}>
              {moneyText(approved)}
            </span>
            <span className="unit">for your agents and subscriptions</span>
          </div>
        </>
      }
    >
      <p className="hint">
        Agents and subscriptions can only spend within the limits below. The contract enforces them, so a misbehaving app or AI can&apos;t go further, and you can stop any of them instantly.
      </p>
      <ErrorBox>{error || list.error}</ErrorBox>

      <div className="section-head">
        <h2>Agents</h2>
        <span className="hint">{allowances.filter((a) => a.status === "active").length} active</span>
      </div>
      {list.loading && !list.data ? (
        <Loading />
      ) : allowances.length ? (
        <div className="list" style={{ gap: 12 }}>
          {allowances.map((a) => (
            <AllowanceCard key={a.agent} a={a} busy={busy === a.agent} onRevoke={() => revoke(a.agent)} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <span className="ic">
            <KeyIcon size={20} />
          </span>
          <p>No agents yet. When an app or AI assistant wants to pay for you, it gives you a connect link. You choose its budget and limits there.</p>
        </div>
      )}

      <div className="grow" />
      <button type="button" className="btn ghost" disabled={busy !== null || approved === "0" || approved === "0.0"} onClick={revokeAll}>
        {busy === "all" ? <Spinner /> : null}
        Stop all automatic spending
      </button>
      <p className="hint" style={{ textAlign: "center", marginTop: -4 }}>
        Sets the draw limit to $0. Agents and subscriptions stop until you approve again.
      </p>
    </Screen>
  );
}

function AllowanceCard({ a, busy, onRevoke }: { a: AgentAllowance; busy: boolean; onRevoke: () => void }) {
  const name = agentName(a.agent) ?? "Agent";
  const pct = Math.min(100, (Number(a.spent) / Number(a.budget)) * 100 || 0);
  return (
    <div className="card" style={{ gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{name}</div>
          <div className="mono hint">{shortAddr(a.agent)}</div>
        </div>
        {a.status === "active" ? <span className="pill ok">Active</span> : <span className="pill bad">{a.status === "expired" ? "Expired" : "Revoked"}</span>}
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span>
            {moneyText(a.spent)} of {moneyText(a.budget)} spent
          </span>
          <span className="hint">{moneyText(a.remaining)} left</span>
        </div>
        <div style={{ height: 8, borderRadius: 99, background: "var(--lime-wash)", marginTop: 6, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "var(--btn)" }} />
        </div>
      </div>
      <div className="rows">
        <div className="rowk">
          <span>Max per payment</span>
          <span>{moneyText(a.maxPerPayment)}</span>
        </div>
        <div className="rowk">
          <span>{a.status === "expired" ? "Expired" : "Expires"}</span>
          <span>{dateText(a.expiresAt)}</span>
        </div>
        <div className="rowk">
          <span>Who it can pay</span>
          <span>{a.payeesRestricted ? "Only the payees you chose" : "Any @username or store"}</span>
        </div>
      </div>
      {a.status === "active" && (
        <button type="button" className="btn ghost" onClick={onRevoke} disabled={busy}>
          {busy ? <Spinner /> : null}
          Revoke now
        </button>
      )}
    </div>
  );
}
