"use client";

import { useEffect, useState } from "react";
import { ShareIcon } from "@/components/Icons";
import { QrCode } from "@/components/QrCode";
import { CopyButton, Loading, NavRow, Screen } from "@/components/ui";
import { cleanAmount, isPositiveAmount, moneyText } from "@/lib/format";
import { useRequireUser } from "@/lib/session";

export default function RequestPage() {
  const user = useRequireUser();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [origin, setOrigin] = useState("");
  const [shared, setShared] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  if (!user) return <Loading />;

  const q = new URLSearchParams();
  if (isPositiveAmount(amount)) q.set("amount", amount);
  if (note.trim()) q.set("note", note.trim());
  const link = `${origin}/pay/${user.username}${q.toString() ? `?${q}` : ""}`;
  const message = isPositiveAmount(amount) ? `Pay me ${moneyText(amount)} on AevumPay: ${link}` : `Pay me on AevumPay: ${link}`;

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: "AevumPay request", text: message, url: link });
        return;
      }
    } catch {
      /* cancelled or unavailable: fall back to copying */
    }
    try {
      await navigator.clipboard.writeText(message);
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
          <QrCode value={link} label={`QR code to pay @${user.username}`} />
          <p style={{ textAlign: "center", fontSize: 14, opacity: 0.85 }}>
            Scan to pay @{user.username}
            {isPositiveAmount(amount) && ` ${moneyText(amount)}`}
          </p>
        </>
      }
    >
      <div className="field">
        <label htmlFor="amount">Amount (optional)</label>
        <div className="row">
          <span className="prefix">$</span>
          <input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(cleanAmount(e.target.value))} placeholder="Any amount" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="note">Note (optional)</label>
        <input id="note" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Dinner split" style={{ fontWeight: 500 }} />
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
    </Screen>
  );
}
