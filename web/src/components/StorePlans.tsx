"use client";

import { useEffect, useState } from "react";
import { parseUnits } from "viem";
import { api, type User } from "@/lib/api";
import { cleanAmount, dateText, isPositiveAmount, moneyText, periodText } from "@/lib/format";
import { useLoad, useSession } from "@/lib/session";
import { signContractCall } from "@/lib/sign";
import { PlusIcon } from "./Icons";
import { SubStatusPill } from "./SubStatusPill";
import { CopyButton, ErrorBox, Spinner, SubmitButton } from "./ui";

const PERIODS = [
  { label: "Every minute (demo)", seconds: 60 },
  { label: "Every day", seconds: 86400 },
  { label: "Every week", seconds: 7 * 86400 },
  { label: "Every 30 days", seconds: 30 * 86400 },
];

/**
 * The merchant's subscriptions: plans to share, who is subscribed, and a button to collect
 * renewals that are due. Collecting is open to anyone on-chain; our server also does it on a
 * timer, so this button is a fallback the merchant controls.
 */
export function StorePlans({ user }: { user: User }) {
  const { account } = useSession();
  const plans = useLoad(() => api.plans(user.username), [user.id]);
  const subs = useLoad(() => api.subscriptions(), [user.id]);
  const [adding, setAdding] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const subscribers = subs.data?.asMerchant ?? [];
  const due = subscribers.filter((s) => s.due);

  async function collectDue() {
    setCollecting(true);
    setError(null);
    setNote(null);
    let ok = 0;
    try {
      const signer = await account();
      for (const s of due) {
        try {
          await api.sendTx(await signContractCall(signer, { functionName: "collect", args: [BigInt(s.id)] }));
          ok++;
        } catch {
          /* already collected by the server, or not due yet on-chain: skip */
        }
      }
      setNote(ok ? `Sent ${ok} collection${ok === 1 ? "" : "s"}. Payments that couldn't be covered are marked "Payment due".` : "Nothing was due right now.");
      subs.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCollecting(false);
    }
  }

  return (
    <>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h2>Subscriptions</h2>
        <span className="hint">{subscribers.filter((s) => s.status === "active").length} active subscribers</span>
      </div>
      <ErrorBox>{error || plans.error}</ErrorBox>

      {(plans.data?.plans ?? []).map((p) => (
        <div key={p.id} className="prod">
          <span className="img" style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}>
            ↻
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="n">{p.name}</div>
            <div className="p">
              {moneyText(p.amount)} {periodText(p.period)}
              {!p.active && " · paused"}
            </div>
          </div>
          <CopyButton text={`${origin}/subscribe/${p.id}`} label={`Copy subscribe link for ${p.name}`} className="linkbtn">
            Link
          </CopyButton>
        </div>
      ))}

      {adding ? (
        <NewPlan
          onDone={() => {
            setAdding(false);
            plans.reload();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" className="btn ghost" onClick={() => setAdding(true)}>
          <PlusIcon size={16} />
          New subscription plan
        </button>
      )}

      {subscribers.length > 0 && (
        <div className="list" style={{ gap: 2 }}>
          {subscribers.map((s) => (
            <div key={s.id} className="txrow" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
              <div style={{ minWidth: 0 }}>
                <div className="t">
                  {s.subscriberUsername ? `@${s.subscriberUsername}` : "Subscriber"} · {s.planName}
                </div>
                <div className="s">{s.status === "active" ? `Next ${dateText(s.nextDue)} · paid ${s.paidCount}×` : `Paid ${s.paidCount}×`}</div>
              </div>
              <SubStatusPill s={s} />
            </div>
          ))}
        </div>
      )}
      {due.length > 0 && (
        <button type="button" className="btn" onClick={collectDue} disabled={collecting}>
          {collecting ? <Spinner /> : null}
          Collect {due.length} due payment{due.length === 1 ? "" : "s"}
        </button>
      )}
      {note && <p className="hint">{note}</p>}
    </>
  );
}

function NewPlan({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { account } = useSession();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState(PERIODS[3]!.seconds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !isPositiveAmount(amount)) return setError("Give the plan a name and a price above $0.");
    setBusy(true);
    setError(null);
    try {
      const raw = await signContractCall(await account(), {
        functionName: "createPlan",
        args: [name.trim(), parseUnits(amount, 6), BigInt(period)],
      });
      await api.sendTx(raw);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <h3 style={{ fontSize: 17, fontWeight: 600 }}>New subscription plan</h3>
      <div className="field">
        <label htmlFor="plan-name">Name</label>
        <input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Coffee club" required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="plan-amount">Price per period</label>
        <div className="row">
          <span className="prefix">$</span>
          <input id="plan-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(cleanAmount(e.target.value))} placeholder="10.00" required />
        </div>
      </div>
      <div className="field">
        <label htmlFor="plan-period">How often</label>
        <select
          id="plan-period"
          value={period}
          onChange={(e) => setPeriod(Number(e.target.value))}
          style={{ border: "none", background: "transparent", color: "var(--ink)", font: "inherit", fontSize: 16, fontWeight: 600, padding: "2px 0" }}
        >
          {PERIODS.map((p) => (
            <option key={p.seconds} value={p.seconds}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <p className="hint">Subscribers keep the price they signed up at. AevumPay takes 0.5% of each charge.</p>
      <ErrorBox>{error}</ErrorBox>
      <SubmitButton busy={busy} busyLabel="Creating on Aevum…">
        Create plan
      </SubmitButton>
      <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </form>
  );
}
