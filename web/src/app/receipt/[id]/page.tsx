"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { CheckIcon, ExternalIcon } from "@/components/Icons";
import { counterpartyName } from "@/components/TxRow";
import { Balance, CopyButton, ErrorBox, Loading, NavRow, Screen, StatusPill } from "@/components/ui";
import { api } from "@/lib/api";
import { moneyText, shortAddr, shortHash, subAmounts } from "@/lib/format";
import { loadLocalReceipt } from "@/lib/receipts";
import { useLoad, useSession } from "@/lib/session";

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { status, user } = useSession();
  const receipt = useLoad(() => api.receipt(id), [id]);
  // The signed-in history knows the tx hash, block and usernames for this payment.
  const activity = useLoad(status === "in" ? () => api.activity(200) : null, [status, id]);
  const local = useMemo(() => (typeof window === "undefined" ? null : loadLocalReceipt(id)), [id]);

  if (receipt.loading && !receipt.data) return <Loading label="Loading receipt" />;

  if (receipt.error || !receipt.data) {
    return (
      <Screen band={<NavRow title="Receipt" back="/" />}>
        <ErrorBox>{receipt.error ?? "This receipt doesn't exist."}</ErrorBox>
      </Screen>
    );
  }

  const r = receipt.data;
  const item = activity.data?.payments.find((p) => p.id === r.id);
  const me = user?.address.toLowerCase();
  const direction = me === r.payer.toLowerCase() ? "out" : me === r.payee.toLowerCase() ? "in" : null;

  const counterparty = item ? counterpartyName(item) : local?.counterparty ? `@${local.counterparty}` : null;
  const myName = user ? `@${user.username}` : null;
  const fromLabel = direction === "out" ? myName : direction === "in" ? counterparty : null;
  const toLabel = direction === "out" ? counterparty : direction === "in" ? myName : null;

  const txHash = item?.txHash ?? local?.txHash;
  const blockNumber = item?.blockNumber ?? local?.blockNumber;
  const explorer = item?.explorer || local?.explorer || "";
  const isProduct = r.productId !== "0";

  const headline =
    direction === "out"
      ? isProduct
        ? `Paid ${counterparty ?? "the store"}`
        : `Sent to ${counterparty ?? shortAddr(r.payee)}`
      : direction === "in"
        ? `Received from ${counterparty ?? shortAddr(r.payer)}`
        : "Payment";

  const paidAt = new Date(r.paidAt * 1000);

  return (
    <Screen
      bandClass="center"
      band={
        <>
          <div style={{ width: "100%" }}>
            <NavRow title="" back="/" />
          </div>
          <span className="check">
            <CheckIcon size={30} />
          </span>
          <div style={{ display: "grid", gap: 6, paddingBottom: 6 }}>
            <span style={{ fontSize: 15, opacity: 0.85 }}>{headline}</span>
            <Balance amount={r.amount} size={44} />
            <span className="unit">tUSD8</span>
          </div>
        </>
      }
    >
      <div className="section-head">
        <h2>Receipt #{r.id}</h2>
        <StatusPill status="ok" />
      </div>
      <div className="rows">
        <div className="rowk">
          <span>From</span>
          <span>{fromLabel ?? <span className="mono">{shortAddr(r.payer)}</span>}</span>
        </div>
        <div className="rowk">
          <span>To</span>
          <span>{toLabel ?? <span className="mono">{shortAddr(r.payee)}</span>}</span>
        </div>
        {isProduct && (
          <div className="rowk">
            <span>Product</span>
            <span>{local?.product ?? `#${r.productId}`}</span>
          </div>
        )}
        {local?.note && (
          <div className="rowk">
            <span>Note</span>
            <span>{local.note}</span>
          </div>
        )}
        <div className="rowk">
          <span>Date</span>
          <span>{paidAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
        </div>
        {blockNumber !== undefined && (
          <div className="rowk">
            <span>Block</span>
            <span className="mono">{blockNumber.toLocaleString("en-US")}</span>
          </div>
        )}
        {txHash && (
          <div className="rowk">
            <span>Tx</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="mono">{shortHash(txHash)}</span>
              <CopyButton text={txHash} label="Copy transaction hash" className="linkbtn" />
            </span>
          </div>
        )}
        {Number(r.fee) > 0 && (
          <div className="rowk">
            <span>Store fee (0.5%)</span>
            <span>{direction === "out" ? "Paid by the store" : `−${moneyText(r.fee)}`}</span>
          </div>
        )}
        {Number(r.fee) > 0 && direction === "in" && (
          <div className="rowk">
            <span>You received</span>
            <span>{moneyText(subAmounts(r.amount, r.fee))}</span>
          </div>
        )}
        {r.via && (
          <div className="rowk">
            <span>Paid by agent</span>
            <span className="mono">{shortAddr(r.via)}</span>
          </div>
        )}
        <div className="rowk">
          <span>Network fee</span>
          <span>$0.00</span>
        </div>
      </div>
      {!explorer && txHash && <p className="hint">Explorer links appear on Aevum testnet. This payment is on a local chain.</p>}
      <div className="grow" />
      {explorer && (
        <a className="btn ghost" href={explorer} target="_blank" rel="noreferrer">
          View on explorer <ExternalIcon size={15} />
        </a>
      )}
      <Link className="btn" href="/">
        Done
      </Link>
    </Screen>
  );
}
