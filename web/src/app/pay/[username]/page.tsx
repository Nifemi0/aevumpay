"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Avatar, Balance, balSize, ErrorBox, Loading, Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { cleanAmount, isPositiveAmount, moneyText, normUsername, shortAddr } from "@/lib/format";
import { useLoad, useSession } from "@/lib/session";

export default function PayLinkPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PayLink />
    </Suspense>
  );
}

/** Where a shared request link or QR code lands. Works signed out. */
function PayLink() {
  const { username: rawName } = useParams<{ username: string }>();
  const params = useSearchParams();
  const { status, user } = useSession();
  const username = normUsername(decodeURIComponent(rawName));
  const amount = cleanAmount(params.get("amount") ?? "");
  const note = (params.get("note") ?? "").slice(0, 80);
  const payee = useLoad(() => api.user(username), [username]);

  const q = new URLSearchParams({ to: username });
  if (isPositiveAmount(amount)) q.set("amount", amount);
  if (note) q.set("note", note);
  const sendPath = `/send?${q}`;

  if (payee.loading && !payee.data) return <Loading />;

  return (
    <Screen
      bandClass="center"
      band={
        payee.data ? (
          <>
            <div style={{ paddingTop: 18 }}>
              <Avatar name={`@${payee.data.username}`} size="xl" />
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 15, opacity: 0.85 }}>@{payee.data.username} is requesting</span>
              {isPositiveAmount(amount) ? <Balance amount={amount} size={44} /> : <span className="bal" style={balSize(34)}>Any amount</span>}
              <span className="unit">tUSD8</span>
            </div>
          </>
        ) : (
          <h1 style={{ fontSize: 26, paddingBlock: 24 }}>Payment link</h1>
        )
      }
    >
      {payee.error ? (
        <ErrorBox>{payee.error === "Unknown user" ? `No one has the username @${username}.` : payee.error}</ErrorBox>
      ) : payee.data ? (
        <>
          <div className="rows">
            <div className="rowk">
              <span>To</span>
              <span>@{payee.data.username}</span>
            </div>
            <div className="rowk">
              <span>Wallet</span>
              <span className="mono">{shortAddr(payee.data.address)}</span>
            </div>
            {note && (
              <div className="rowk">
                <span>Note</span>
                <span>{note}</span>
              </div>
            )}
            <div className="rowk">
              <span>Network fee</span>
              <span>$0.00</span>
            </div>
          </div>
          <div className="grow" />
          {status === "in" && user?.username === username ? (
            <p className="hint" style={{ textAlign: "center" }}>
              This is your own payment link. Share it with the person paying you.
            </p>
          ) : status === "in" ? (
            <Link href={sendPath} className="btn">
              {isPositiveAmount(amount) ? `Pay ${moneyText(amount)}` : "Choose amount"}
            </Link>
          ) : (
            <>
              <Link href={`/login?next=${encodeURIComponent(sendPath)}`} className="btn">
                Log in to pay
              </Link>
              <Link href={`/signup?next=${encodeURIComponent(sendPath)}`} className="btn ghost">
                Create an account
              </Link>
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}
