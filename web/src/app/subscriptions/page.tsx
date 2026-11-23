"use client";

import Link from "next/link";
import { useState } from "react";
import { ActivityIcon } from "@/components/Icons";
import { SubStatusPill } from "@/components/SubStatusPill";
import { ErrorBox, Loading, NavRow, Screen } from "@/components/ui";
import { api, type Subscription, type User } from "@/lib/api";
import { dateText, moneyText, periodText } from "@/lib/format";
import { useLoad, useRequireUser, useSession } from "@/lib/session";
import { signContractCall } from "@/lib/sign";

export default function SubscriptionsPage() {
  const user = useRequireUser();
  if (!user) return <Loading />;
  return <Subscriptions user={user} />;
}

function Subscriptions({ user }: { user: User }) {
  const { account } = useSession();
  const subs = useLoad(() => api.subscriptions(), [user.id]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cancel(id: number) {
    setBusy(id);
    setError(null);
    try {
      await api.sendTx(await signContractCall(await account(), { functionName: "cancelSubscription", args: [BigInt(id)] }));
      subs.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const mine = subs.data?.asSubscriber ?? [];
  const active = mine.filter((s) => s.status === "active");

  return (
    <Screen
      tabs={{ business: user.role === "business" }}
      band={
        <>
          <NavRow title="Subscriptions" back="/profile" />
          <div className="balcard">
            <span className="unit">Active</span>
            <span className="bal" style={{ ["--bal-size" as string]: "34px" }}>
              {active.length}
            </span>
            <span className="unit">subscriptions</span>
          </div>
        </>
      }
    >
      <ErrorBox>{error || subs.error}</ErrorBox>
      {subs.loading && !subs.data ? (
        <Loading />
      ) : mine.length ? (
        <div className="list" style={{ gap: 12 }}>
          {mine.map((s) => (
            <div key={s.id} className="card" style={{ gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{s.planName}</div>
                  <div className="hint">{s.merchantUsername ? `@${s.merchantUsername}` : "Store"}</div>
                </div>
                <SubStatusPill s={s} />
              </div>
              {s.pastDue && (
                <p className="error" role="alert">
                  The last {moneyText(s.amount)} payment didn&apos;t go through. Add funds; it&apos;s retried automatically for a few days.
                </p>
              )}
              <div className="rows">
                <div className="rowk">
                  <span>Price</span>
                  <span>
                    {moneyText(s.amount)} {periodText(s.period)}
                  </span>
                </div>
                {s.status === "active" && (
                  <div className="rowk">
                    <span>Next charge</span>
                    <span>{dateText(s.nextDue)}</span>
                  </div>
                )}
                <div className="rowk">
                  <span>Paid so far</span>
                  <span>
                    {s.paidCount} time{s.paidCount === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              {s.status === "active" && (
                <button type="button" className="btn ghost" disabled={busy === s.id} onClick={() => cancel(s.id)}>
                  {busy === s.id ? <span className="spinner" aria-hidden="true" /> : null}
                  Cancel subscription
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <span className="ic">
            <ActivityIcon size={20} />
          </span>
          <p>No subscriptions. When a store shares a subscription link, you&apos;ll see it here after you subscribe.</p>
        </div>
      )}
      <div className="grow" />
      <Link href="/allowances" className="textlink" style={{ textAlign: "center" }}>
        Manage spending permissions
      </Link>
    </Screen>
  );
}
