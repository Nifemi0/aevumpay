"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShareIcon } from "@/components/Icons";
import { QrCode } from "@/components/QrCode";
import { Avatar, Balance, balSize, ErrorBox, Loading, Screen, SubmitButton } from "@/components/ui";
import { api, type PayRequest, type PublicUser, type SendResult } from "@/lib/api";
import { cleanAmount, isPositiveAmount, moneyText, normUsername, shortAddr } from "@/lib/format";
import { saveLocalReceipt } from "@/lib/receipts";
import { useLoad, useSession } from "@/lib/session";
import { signPayment } from "@/lib/sign";

export interface PayLinkProps {
  username: string;
  /** The link's own query: `?amount=&note=&r=` (read on the server, so the page renders there too). */
  query: { amount: string; note: string; r: string };
  initialPayee: PublicUser | null;
  initialRequest: PayRequest | null;
  /** The server already knows no one has this name. */
  missing?: boolean;
}

const QUICK = ["1", "5", "10", "20"];

const STATUS_TEXT: Record<PayRequest["status"], string> = {
  open: "Waiting for payment",
  paid: "Paid",
  expired: "Expired",
  cancelled: "Cancelled",
};

/**
 * Where a shared pay link or QR code lands. Works signed out. Signed in, you pay right here; a
 * tracked request (?r=…) shows its live status, so the person who asked sees "Paid" the moment
 * it lands.
 */
export default function PayClient({ username: rawName, query, initialPayee, initialRequest, missing = false }: PayLinkProps) {
  const { status, user, account } = useSession();
  const username = normUsername(rawName);
  const requestId = query.r || null;
  const linkAmount = cleanAmount(query.amount);
  const linkNote = query.note.slice(0, 80);
  const params = new URLSearchParams();
  if (query.amount) params.set("amount", query.amount);
  if (query.note) params.set("note", query.note);
  if (query.r) params.set("r", query.r);

  const payee = useLoad(missing ? null : () => api.user(username), [username], initialPayee);
  const request = useLoad(requestId ? () => api.request(requestId) : null, [requestId], initialRequest);
  const signedIn = status === "in";
  const balance = useLoad(signedIn ? () => api.balance() : null, [signedIn, user?.id]);

  const fixed = request.data ? request.data.amount : isPositiveAmount(linkAmount) ? linkAmount : null;
  const note = request.data ? request.data.note : linkNote;
  const [amount, setAmount] = useState("");
  useEffect(() => setAmount(fixed ?? ""), [fixed]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SendResult | null>(null);
  const [origin, setOrigin] = useState("");
  const [shared, setShared] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);

  if (!missing && ((payee.loading && !payee.data) || (requestId && request.loading && !request.data))) return <Loading />;

  if (payee.error || !payee.data) {
    return (
      <Screen bandClass="center" band={<h1 style={{ fontSize: 26, paddingBlock: 24 }}>Payment link</h1>}>
        <div className="paylink-empty">
          <strong>No one is called @{username}</strong>
          <span>Check the spelling with the person who sent you this link. AevumPay names are letters, numbers, dots and underscores.</span>
        </div>
        <div className="grow" />
        <Link href="/" className="btn ghost">
          Go to AevumPay
        </Link>
      </Screen>
    );
  }

  const to = payee.data;
  const req = request.data;
  const isOwner = signedIn && user?.username === to.username;
  const reqStatus = req?.status ?? "open";
  const closed = reqStatus !== "open";
  const amountOk = isPositiveAmount(amount);
  const over = balance.data && amountOk && Number(amount) > Number(balance.data.balance);
  const link = `${origin}/pay/${to.username}${params.toString() ? `?${params}` : ""}`;
  const here = `/pay/${to.username}${params.toString() ? `?${params}` : ""}`;

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!amountOk || over || busy || !to) return;
    setBusy(true);
    setError(null);
    try {
      // Signed here with the key in this browser; the server only relays it and pays the gas.
      const authorization = await signPayment(await account(), amount, { payee: to.address as `0x${string}`, memo: note });
      const r = await api.send(to.username, amount, note, authorization, req?.id ?? null);
      saveLocalReceipt(r.paymentId, { note: note || undefined, txHash: r.txHash, explorer: r.explorer, blockNumber: r.blockNumber, counterparty: to.username });
      setDone(r);
      request.reload();
      balance.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    const text = fixed ? `Pay me ${moneyText(fixed)} on AevumPay${note ? ` for ${note}` : ""}: ${link}` : `Pay me on AevumPay: ${link}`;
    try {
      if (navigator.share) return void (await navigator.share({ title: "AevumPay request", text, url: link }));
    } catch {
      /* cancelled: fall back to copying */
    }
    try {
      await navigator.clipboard.writeText(text);
      setShared("Link copied");
    } catch {
      setShared("Copy the address bar to share");
    }
    setTimeout(() => setShared(null), 2000);
  }

  return (
    <Screen
      bandClass="center"
      band={
        <>
          <div style={{ paddingTop: 18 }}>
            <Avatar name={`@${to.username}`} size="xl" />
          </div>
          <div style={{ display: "grid", gap: 4, justifyItems: "center" }}>
            <span style={{ fontSize: 15, opacity: 0.85 }}>{done ? `You paid @${to.username}` : `@${to.username} is requesting`}</span>
            {done ? (
              <Balance amount={done.amount ?? amount} size={44} />
            ) : fixed ? (
              <Balance amount={fixed} size={44} />
            ) : (
              <span className="bal" style={balSize(34)}>
                Any amount
              </span>
            )}
            <span className="unit">tUSD8{note ? ` · ${note}` : ""}</span>
            {req && !done && <span className={`pill ${reqStatus === "paid" ? "ok" : reqStatus === "open" ? "wait" : "bad"}`}>{STATUS_TEXT[reqStatus]}</span>}
          </div>
        </>
      }
    >
      {done ? (
        <div className="paylink-done" role="status">
          <span className="paylink-check" aria-hidden>
            ✓
          </span>
          <strong>Paid {moneyText(done.amount ?? amount)} to @{to.username}</strong>
          <span>{req ? "Their request is marked paid. They see it right away." : "It's in their wallet now."}</span>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 6 }}>
            <Link href={`/receipt/${done.paymentId}`} className="linkbtn">
              View receipt
            </Link>
            {done.explorer && (
              <a href={done.explorer} target="_blank" rel="noreferrer" className="linkbtn">
                On the explorer ↗
              </a>
            )}
          </div>
        </div>
      ) : isOwner ? (
        <>
          <div className="paylink-own">
            <QrCode value={link} label={`QR code to pay @${to.username}`} />
            <strong>{req ? (closed ? STATUS_TEXT[reqStatus] : "Waiting for payment…") : "This is your payment link"}</strong>
            <span>{req && !closed ? "This updates by itself when someone pays." : "Share it with the person paying you."}</span>
          </div>
          {req && req.payments.length > 0 && <PaidList request={req} />}
          <div className="grow" />
          <button type="button" className="btn" onClick={share}>
            <ShareIcon size={17} />
            {shared ?? "Share link"}
          </button>
          {req && !closed && (
            <button
              type="button"
              className="btn ghost"
              onClick={async () => {
                await api.cancelRequest(req.id).catch(() => {});
                request.reload();
              }}
            >
              Cancel this request
            </button>
          )}
        </>
      ) : closed ? (
        <>
          <div className="paylink-empty">
            <strong>{reqStatus === "paid" ? "This request has been paid" : `This request is ${reqStatus}`}</strong>
            <span>
              {reqStatus === "paid"
                ? `@${to.username} already got this one${req?.payments[0]?.payerUsername ? ` from @${req.payments[0].payerUsername}` : ""}. Nothing more to pay.`
                : `Ask @${to.username} for a new link if you still need to pay.`}
            </span>
          </div>
          {req && req.payments.length > 0 && <PaidList request={req} />}
        </>
      ) : signedIn ? (
        <form onSubmit={pay} style={{ display: "contents" }}>
          {!fixed && (
            <>
              <div className="amount-input">
                <span>$</span>
                <label htmlFor="amount" className="sr-only">
                  Amount in tUSD8
                </label>
                <input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(cleanAmount(e.target.value))} placeholder="0.00" autoFocus />
              </div>
              <div className="quick-amounts" role="group" aria-label="Quick amounts">
                {QUICK.map((q) => (
                  <button key={q} type="button" className={amount === q ? "on" : ""} onClick={() => setAmount(q)}>
                    ${q}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="rows">
            <div className="rowk">
              <span>Your balance</span>
              <span>{balance.data ? moneyText(balance.data.balance) : "…"}</span>
            </div>
            <div className="rowk">
              <span>Fee</span>
              <span>$0.00 · gas covered</span>
            </div>
          </div>
          {over && (
            <p className="hint hint-bad" style={{ textAlign: "center" }}>
              That's more than your balance. <Link href={`/topup?next=${encodeURIComponent(here)}`}>Add money</Link>
            </p>
          )}
          <ErrorBox>{error}</ErrorBox>
          <TrustLine username={to.username} address={to.address} />
          <div className="grow" />
          <SubmitButton busy={busy} busyLabel="Paying…" disabled={!amountOk || Boolean(over)}>
            {amountOk ? `Pay ${moneyText(amount)}` : "Choose an amount"}
          </SubmitButton>
        </form>
      ) : (
        <>
          <TrustLine username={to.username} address={to.address} />
          <div className="grow" />
          <Link href={`/login?next=${encodeURIComponent(here)}`} className="btn">
            Log in to pay
          </Link>
          <Link href={`/signup?next=${encodeURIComponent(here)}`} className="btn ghost">
            New here? Create an account
          </Link>
        </>
      )}
    </Screen>
  );
}

function TrustLine({ username, address }: { username: string; address: string }) {
  return (
    <p className="paylink-trust">
      Goes straight to @{username}&rsquo;s wallet <span className="mono">{shortAddr(address)}</span>. AevumPay never holds your money.
    </p>
  );
}

function PaidList({ request }: { request: PayRequest }) {
  return (
    <div className="rows">
      {request.payments.map((p) => (
        <div className="rowk" key={p.txHash}>
          <span>✓ {p.payerUsername ? `@${p.payerUsername}` : "Someone"}</span>
          <Link href={`/receipt/${p.paymentId}`}>{moneyText(p.amount)}</Link>
        </div>
      ))}
    </div>
  );
}
