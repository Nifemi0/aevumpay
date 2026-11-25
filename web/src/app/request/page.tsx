"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShareIcon } from "@/components/Icons";
import { QrCode } from "@/components/QrCode";
import { CopyButton, ErrorBox, Loading, NavRow, Screen, SubmitButton , CheckingSession } from "@/components/ui";
import { api, type PayRequest } from "@/lib/api";
import { cleanAmount, isPositiveAmount, moneyText } from "@/lib/format";
import { useLoad, useRequireUser } from "@/lib/session";

const STATUS: Record<PayRequest["status"], { text: string; pill: string }> = {
  open: { text: "Waiting", pill: "wait" },
  paid: { text: "Paid", pill: "ok" },
  expired: { text: "Expired", pill: "bad" },
  cancelled: { text: "Cancelled", pill: "bad" },
};

/**
 * Ask someone for money. Each request gets its own link and QR; you see it turn "Paid" (with who
 * paid) the moment it lands, without refreshing.
 */
export default function RequestPage() {
  const user = useRequireUser();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [oneTime, setOneTime] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<PayRequest | null>(null);
  const [origin, setOrigin] = useState("");
  const [shared, setShared] = useState<string | null>(null);
  const mine = useLoad(user ? () => api.requests() : null, [user?.id]);

  useEffect(() => setOrigin(window.location.origin), []);

  if (!user) return <CheckingSession />;

  // Keep the request on screen in step with live updates (it turns "Paid" by itself).
  const live = current ? (mine.data?.requests.find((r) => r.id === current.id) ?? current) : null;
  const link = live ? `${origin}/pay/${user.username}?r=${live.id}` : "";
  const everyday = `${origin}/pay/${user.username}`;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.createRequest({
        amount: isPositiveAmount(amount) ? amount : undefined,
        note: note.trim() || undefined,
        oneTime: isPositiveAmount(amount) ? oneTime : false,
      });
      setCurrent(r);
      mine.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!live) return;
    const text = live.amount ? `Pay me ${moneyText(live.amount)} on AevumPay${live.note ? ` for ${live.note}` : ""}: ${link}` : `Pay me on AevumPay: ${link}`;
    try {
      if (navigator.share) return void (await navigator.share({ title: "AevumPay request", text, url: link }));
    } catch {
      /* cancelled or unavailable: fall back to copying */
    }
    try {
      await navigator.clipboard.writeText(text);
      setShared("Link copied");
    } catch {
      setShared("Copy the link above to share it");
    }
    setTimeout(() => setShared(null), 2000);
  }

  return (
    <Screen
      band={
        <>
          <NavRow title="Request" back="/" />
          {live ? (
            <>
              <QrCode value={link} label={`QR code to pay @${user.username}`} />
              <p style={{ textAlign: "center", fontSize: 14, opacity: 0.85 }}>
                Scan to pay @{user.username}
                {live.amount && ` ${moneyText(live.amount)}`}
                {live.note && ` · ${live.note}`}
              </p>
            </>
          ) : (
            <p style={{ textAlign: "center", fontSize: 15, opacity: 0.85, paddingBlock: 8 }}>Make a link anyone can pay. You&rsquo;ll see it turn &ldquo;Paid&rdquo; the moment they do.</p>
          )}
        </>
      }
    >
      {live ? (
        <>
          <div className="req-status">
            <span className={`pill ${STATUS[live.status].pill}`}>{STATUS[live.status].text}</span>
            <span>
              {live.status === "paid"
                ? `by ${live.payments[0]?.payerUsername ? `@${live.payments[0].payerUsername}` : "someone"}`
                : live.status === "open"
                  ? live.paidCount
                    ? `${live.paidCount} payment${live.paidCount > 1 ? "s" : ""} so far · ${moneyText(live.paidTotal)}`
                    : "Updates by itself when they pay"
                  : ""}
            </span>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <span className="k" style={{ paddingInline: 4 }}>
              Payment link
            </span>
            <div className="copyfield">
              <span className="v">{link.replace(/^https?:\/\//, "")}</span>
              <CopyButton text={link} label="Copy payment link" />
            </div>
          </div>
          <div className="grow" />
          <button type="button" className="btn" onClick={share}>
            <ShareIcon size={17} />
            {shared ?? "Share link"}
          </button>
          <button type="button" className="btn ghost" onClick={() => setCurrent(null)}>
            New request
          </button>
        </>
      ) : (
        <form onSubmit={create} style={{ display: "contents" }}>
          <div className="field">
            <label htmlFor="amount">Amount (optional)</label>
            <div className="row">
              <span className="prefix">$</span>
              <input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(cleanAmount(e.target.value))} placeholder="Any amount" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="note">What&rsquo;s it for? (optional)</label>
            <input id="note" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Dinner split" style={{ fontWeight: 500 }} />
          </div>
          {isPositiveAmount(amount) && (
            <label className="req-toggle">
              <input type="checkbox" checked={oneTime} onChange={(e) => setOneTime(e.target.checked)} />
              <span>
                <strong>One payment only</strong>
                <small>Closes once it&rsquo;s paid. Untick to collect from several people (a group split).</small>
              </span>
            </label>
          )}
          <ErrorBox>{error}</ErrorBox>
          <SubmitButton busy={busy} busyLabel="Creating…">
            {isPositiveAmount(amount) ? `Request ${moneyText(amount)}` : "Create payment link"}
          </SubmitButton>

          {mine.data && mine.data.requests.length > 0 && (
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              <span className="k" style={{ paddingInline: 4 }}>
                Your requests
              </span>
              <div className="rows">
                {mine.data.requests.slice(0, 8).map((r) => (
                  <Link className="rowk" key={r.id} href={`/pay/${user.username}?r=${r.id}`}>
                    <span>
                      {r.amount ? moneyText(r.amount) : "Any amount"}
                      {r.note ? ` · ${r.note}` : ""}
                    </span>
                    <span className={`pill ${STATUS[r.status].pill}`}>
                      {r.status === "paid" && r.payments[0]?.payerUsername ? `Paid by @${r.payments[0].payerUsername}` : STATUS[r.status].text}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <p className="hint" style={{ textAlign: "center" }}>
            Your everyday link: <span className="mono">{everyday.replace(/^https?:\/\//, "")}</span> <CopyButton text={everyday} label="Copy your everyday link" className="inline" />
          </p>
        </form>
      )}
    </Screen>
  );
}
