"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { isAddress, parseUnits } from "viem";
import { CheckIcon, KeyIcon } from "@/components/Icons";
import { ErrorBox, Loading, NavRow, Screen, SubmitButton , CheckingSession } from "@/components/ui";
import { api } from "@/lib/api";
import { rememberAgentName } from "@/lib/agentNames";
import { cleanAmount, isPositiveAmount, moneyText, normUsername, shortAddr } from "@/lib/format";
import { useRequireUser, useSession } from "@/lib/session";
import { raiseApproval, signContractCall } from "@/lib/sign";

export default function ConnectPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Connect />
    </Suspense>
  );
}

/**
 * Where an agent's connect link lands, e.g.
 *   /connect?agent=0xAB…&name=Shopping%20assistant&budget=20&max=5&days=7&payees=kemi,bolabakes
 * The agent only proposes limits. The owner reviews and can change every one before approving,
 * and the browser signs the grant: the agent never sees the owner's key.
 */
function Connect() {
  const user = useRequireUser();
  const { account } = useSession();
  const router = useRouter();
  const q = useSearchParams();
  const agent = q.get("agent") ?? "";
  const name = (q.get("name") ?? "An agent").slice(0, 60);
  const [budget, setBudget] = useState(cleanAmount(q.get("budget") ?? "20"));
  const [max, setMax] = useState(cleanAmount(q.get("max") ?? "5"));
  const [days, setDays] = useState(String(Math.min(90, Math.max(1, Number(q.get("days") ?? 7) || 7))));
  const [payees, setPayees] = useState((q.get("payees") ?? "").split(",").map(normUsername).filter(Boolean).join(", "));
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return <CheckingSession />;

  if (!isAddress(agent)) {
    return (
      <Screen band={<NavRow title="Connect an agent" back="/allowances" />}>
        <ErrorBox>This link doesn&apos;t include a valid agent address. Ask the agent for a new connect link.</ErrorBox>
      </Screen>
    );
  }

  const valid = isPositiveAmount(budget) && isPositiveAmount(max) && Number(max) <= Number(budget) && Number(days) >= 1;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return setError("The per-payment limit must be above $0 and no more than the budget.");
    setBusy(true);
    setError(null);
    try {
      const names = payees.split(",").map(normUsername).filter(Boolean);
      const payeeWallets: `0x${string}`[] = [];
      for (const n of names) {
        setStep(`Checking @${n}…`);
        payeeWallets.push((await api.user(n)).address as `0x${string}`);
      }
      const signer = await account();
      const budgetUnits = parseUnits(budget, 6);
      setStep("Approving the budget…");
      await raiseApproval(signer, budgetUnits);
      setStep("Granting the allowance…");
      const expiresAt = BigInt(Math.floor(Date.now() / 1000) + Number(days) * 86400);
      const raw = await signContractCall(signer, {
        functionName: "grantAllowance",
        args: [agent as `0x${string}`, budgetUnits, parseUnits(max, 6), expiresAt, payeeWallets],
      });
      await api.sendTx(raw);
      rememberAgentName(agent, name);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  if (done) {
    return (
      <Screen
        bandClass="center"
        band={
          <>
            <span className="check" style={{ marginTop: 16 }}>
              <CheckIcon size={30} />
            </span>
            <h1 style={{ fontSize: 24, fontWeight: 600 }}>{name} is connected</h1>
            <p style={{ opacity: 0.85 }}>
              It can spend up to {moneyText(budget)}, at most {moneyText(max)} at a time, for {days} day{days === "1" ? "" : "s"}.
            </p>
          </>
        }
      >
        <p className="hint">Every payment it makes shows in Activity with a receipt. You can revoke it any time from Spending permissions.</p>
        <div className="grow" />
        <button type="button" className="btn" onClick={() => router.replace("/allowances")}>
          See spending permissions
        </button>
      </Screen>
    );
  }

  return (
    <Screen
      band={
        <>
          <NavRow title="Connect an agent" back="/allowances" />
          <div style={{ display: "grid", gap: 8, paddingBottom: 8 }}>
            <span className="round" style={{ width: 48, height: 48 }}>
              <KeyIcon size={22} />
            </span>
            <h1 style={{ fontSize: 26, fontWeight: 600 }}>{name} wants to pay for you</h1>
            <p style={{ opacity: 0.85 }}>
              Agent key <span className="mono">{shortAddr(agent)}</span>. Set the limits; the contract won&apos;t let it go past them.
            </p>
          </div>
        </>
      }
    >
      <form onSubmit={onSubmit} style={{ display: "contents" }}>
        <div className="field">
          <label htmlFor="budget">Total budget</label>
          <div className="row">
            <span className="prefix">$</span>
            <input id="budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(cleanAmount(e.target.value))} required />
          </div>
        </div>
        <div className="field">
          <label htmlFor="max">Max per payment</label>
          <div className="row">
            <span className="prefix">$</span>
            <input id="max" inputMode="decimal" value={max} onChange={(e) => setMax(cleanAmount(e.target.value))} required />
          </div>
        </div>
        <div className="field">
          <label htmlFor="days">For how many days</label>
          <input id="days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, "").slice(0, 2))} required />
        </div>
        <div className="field">
          <label htmlFor="payees">Only pay these @usernames (optional)</label>
          <input id="payees" value={payees} onChange={(e) => setPayees(e.target.value)} placeholder="Anyone. Or: kemi, bolabakes" style={{ fontWeight: 500 }} />
        </div>
        <p className="hint">You&apos;ll sign twice: once to let AevumPay draw up to the budget, once to grant the limits. Gas is covered.</p>
        <ErrorBox>{error}</ErrorBox>
        <div className="grow" />
        <SubmitButton busy={busy} busyLabel={step || "Connecting…"} disabled={!valid}>
          Allow up to {isPositiveAmount(budget) ? moneyText(budget) : "$0"}
        </SubmitButton>
        <button type="button" className="btn ghost" onClick={() => router.replace("/")} disabled={busy}>
          Don&apos;t connect
        </button>
      </form>
    </Screen>
  );
}
