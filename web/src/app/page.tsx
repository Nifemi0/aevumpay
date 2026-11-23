"use client";

import Link from "next/link";
import { useCallback } from "react";
import { Landing } from "@/components/Landing";
import { ActivityIcon, RequestIcon, SendIcon, StoreIcon } from "@/components/Icons";
import { TopUp } from "@/components/TopUp";
import { TxRow, TxSkeleton } from "@/components/TxRow";
import { Avatar, Balance, balSize, ErrorBox, Loading, Screen } from "@/components/ui";
import { AEVUM_CHAIN_ID, api, type User } from "@/lib/api";
import { moneyText } from "@/lib/format";
import { useLoad, useSession } from "@/lib/session";

export default function IndexPage() {
  const { status, user } = useSession();
  if (status === "loading") return <Loading />;
  if (status === "out" || !user) return <Landing />;
  return <Home user={user} />;
}

function Home({ user }: { user: User }) {
  const { chainId } = useSession();
  const balance = useLoad(() => api.balance(), [user.id]);
  const activity = useLoad(() => api.activity(5), [user.id]);
  const subs = useLoad(() => api.subscriptions(), [user.id]);
  const pastDue = (subs.data?.asSubscriber ?? []).filter((s) => s.pastDue);
  const business = user.role === "business";
  const refresh = useCallback(() => {
    balance.reload();
    activity.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const payments = activity.data?.payments ?? [];
  const network = chainId === AEVUM_CHAIN_ID ? "Aevum testnet" : chainId ? `Local chain ${chainId}` : "";

  return (
    <Screen
      tabs={{ business }}
      band={
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <Link href="/profile" className="who" style={{ textDecoration: "none" }}>
              <Avatar name={user.username} size="lg" />
              <div>
                <div className="name">Hi, @{user.username}</div>
                <div className="sub">{business ? "Business account" : "Personal account"}</div>
              </div>
            </Link>
          </div>
          <div className="balcard">
            <span className="unit">Balance</span>
            {balance.data ? <Balance amount={balance.data.balance} size={46} /> : <span className="bal" style={balSize(46, { opacity: 0.35 })}>$—</span>}
            <span className="unit">tUSD8{network && ` · ${network}`}</span>
          </div>
          <nav className="actionbar" aria-label="Actions">
            <Link href="/send">
              <span className="ic">
                <SendIcon size={17} />
              </span>
              Send
            </Link>
            <Link href="/request">
              <span className="ic">
                <RequestIcon size={17} />
              </span>
              Request
            </Link>
            {business ? (
              <Link href="/store">
                <span className="ic">
                  <StoreIcon size={17} />
                </span>
                Store
              </Link>
            ) : (
              <Link href="/activity">
                <span className="ic">
                  <ActivityIcon size={17} />
                </span>
                Activity
              </Link>
            )}
          </nav>
        </>
      }
    >
      {pastDue.length > 0 && (
        <Link href="/subscriptions" className="error" role="alert" style={{ textDecoration: "none", display: "block" }}>
          {pastDue.length === 1
            ? `Your ${pastDue[0]!.merchantUsername ? `@${pastDue[0]!.merchantUsername} ` : ""}subscription payment of ${moneyText(pastDue[0]!.amount)} didn't go through. Add funds to keep it. ›`
            : `${pastDue.length} subscription payments didn't go through. Add funds to keep them. ›`}
        </Link>
      )}
      <div className="section-head">
        <h2>Activity</h2>
        {payments.length > 0 && (
          <Link href="/activity" className="textlink">
            See all
          </Link>
        )}
      </div>
      <ErrorBox>{balance.error || activity.error}</ErrorBox>
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
          <p>No payments yet. Add some test tUSD8, then send your first payment to a friend&apos;s @username.</p>
          <TopUp onDone={refresh} />
        </div>
      )}
      {payments.length > 0 && balance.data && Number(balance.data.balance) < 5 && <TopUp onDone={refresh} compact />}
    </Screen>
  );
}
