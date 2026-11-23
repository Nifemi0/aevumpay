"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { parseUnits } from "viem";
import { Balance, ErrorBox, Loading, NavRow, Screen, Who } from "@/components/ui";
import { api } from "@/lib/api";
import { moneyText, periodText } from "@/lib/format";
import { useLoad, useSession } from "@/lib/session";
import { raiseApproval, signContractCall } from "@/lib/sign";

/** How many periods' worth we approve up front, so renewals don't need a new signature each time. */
const PERIODS_APPROVED = 12n;

/** A merchant's shared subscription link. Works signed out; subscribing needs an account. */
export default function SubscribePage() {
  const { planId } = useParams<{ planId: string }>();
  const router = useRouter();
  const { status, user, account } = useSession();
  const plan = useLoad(() => api.plan(planId), [planId]);
  const balance = useLoad(status === "in" ? () => api.balance() : null, [status]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (plan.loading && !plan.data) return <Loading />;
  const p = plan.data;
  if (!p) {
    return (
      <Screen band={<NavRow title="Subscribe" back="/" />}>
        <ErrorBox>{plan.error ?? "This plan doesn't exist."}</ErrorBox>
      </Screen>
    );
  }

  const here = `/subscribe/${planId}`;
  const own = user?.address.toLowerCase() === p.merchant.toLowerCase();
  const short = balance.data ? Number(balance.data.balance) < Number(p.amount) : false;

  async function subscribe() {
    setBusy(true);
    setError(null);
    try {
      const signer = await account();
      setStep("Approving renewals…");
      await raiseApproval(signer, parseUnits(p!.amount, 6) * PERIODS_APPROVED);
      setStep("Subscribing…");
      await api.sendTx(await signContractCall(signer, { functionName: "subscribe", args: [BigInt(p!.id), 0] }));
      router.replace("/subscriptions");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setStep("");
    }
  }

  return (
    <Screen
      band={
        <>
          <NavRow title="Subscribe" back={p.merchantUsername ? `/shop/${p.merchantUsername}` : "/"} />
          <Who name={p.merchantUsername ? `@${p.merchantUsername}` : "Store"} sub="Subscription" />
          <div style={{ display: "grid", gap: 6, paddingBlock: "6px 4px" }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600 }}>{p.name}</span>
            <Balance amount={p.amount} size={44} />
            <span className="unit">tUSD8 {periodText(p.period)}</span>
          </div>
        </>
      }
    >
      <div className="rows">
        <div className="rowk">
          <span>First payment</span>
          <span>Today, {moneyText(p.amount)}</span>
        </div>
        <div className="rowk">
          <span>Then</span>
          <span>
            {moneyText(p.amount)} {periodText(p.period)}
          </span>
        </div>
        <div className="rowk">
          <span>Cancel</span>
          <span>Any time, in one tap</span>
        </div>
        <div className="rowk">
          <span>Network fee</span>
          <span>$0.00</span>
        </div>
      </div>
      <p className="hint">
        The price and schedule are fixed on-chain when you subscribe; the store can&apos;t raise them. You&apos;re never charged twice in one period or for periods you missed. If a renewal
        can&apos;t be covered, it&apos;s retried for a few days, then the subscription stops.
      </p>
      {!p.active && <ErrorBox>This plan isn&apos;t taking new subscribers.</ErrorBox>}
      {short && <ErrorBox>Your balance is below the first payment. Add tUSD8 first.</ErrorBox>}
      <ErrorBox>{error}</ErrorBox>
      <div className="grow" />
      {status === "out" ? (
        <>
          <Link className="btn" href={`/login?next=${encodeURIComponent(here)}`}>
            Log in to subscribe
          </Link>
          <Link className="btn ghost" href={`/signup?next=${encodeURIComponent(here)}`}>
            Create an account
          </Link>
        </>
      ) : own ? (
        <p className="hint" style={{ textAlign: "center" }}>
          This is your plan. Share this page&apos;s link with customers.
        </p>
      ) : (
        <button type="button" className="btn" disabled={busy || short || !p.active || status !== "in"} onClick={subscribe}>
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" />
              {step}
            </>
          ) : (
            `Subscribe for ${moneyText(p.amount)} ${periodText(p.period)}`
          )}
        </button>
      )}
    </Screen>
  );
}
