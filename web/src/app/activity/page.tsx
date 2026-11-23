"use client";

import { ActivityIcon } from "@/components/Icons";
import { TopUp } from "@/components/TopUp";
import { TxRow, TxSkeleton } from "@/components/TxRow";
import { Balance, ErrorBox, Loading, NavRow, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { sumAmounts as sum } from "@/lib/format";
import { useLoad, useRequireUser } from "@/lib/session";

export default function ActivityPage() {
  const user = useRequireUser();
  const activity = useLoad(user ? () => api.activity(200) : null, [user?.id]);
  if (!user) return <Loading />;

  const payments = activity.data?.payments ?? [];
  const inTotal = sum(payments.filter((p) => p.direction === "in").map((p) => p.amount));
  const outTotal = sum(payments.filter((p) => p.direction === "out").map((p) => p.amount));

  return (
    <Screen
      tabs={{ business: user.role === "business" }}
      band={
        <>
          <NavRow title="Activity" back="/" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="balcard">
              <span className="unit">Received</span>
              <Balance amount={inTotal} size={26} />
            </div>
            <div className="balcard">
              <span className="unit">Sent</span>
              <Balance amount={outTotal} size={26} />
            </div>
          </div>
        </>
      }
    >
      <div className="section-head">
        <h2>All payments</h2>
        {activity.data && <span className="hint">{payments.length} on-chain</span>}
      </div>
      <ErrorBox>{activity.error}</ErrorBox>
      {activity.loading && !activity.data ? (
        <TxSkeleton />
      ) : payments.length ? (
        <div className="list">
          {payments.map((p) => (
            <TxRow key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <span className="ic">
            <ActivityIcon size={20} />
          </span>
          <p>Payments you send and receive show up here, each with its on-chain receipt.</p>
          <TopUp onDone={activity.reload} />
        </div>
      )}
    </Screen>
  );
}
