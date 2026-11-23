import Link from "next/link";
import type { ActivityItem } from "@/lib/api";
import { moneyText, shortAddr, subAmounts } from "@/lib/format";
import { Avatar } from "./ui";

export function counterpartyName(p: Pick<ActivityItem, "counterparty" | "counterpartyUsername">): string {
  return p.counterpartyUsername ? `@${p.counterpartyUsername}` : shortAddr(p.counterparty);
}

export function TxRow({ p }: { p: ActivityItem }) {
  const name = counterpartyName(p);
  // A fee with no product means a subscription charge (person-to-person payments are free).
  const isSubscription = p.productId === "0" && Number(p.fee) > 0;
  const kind = p.productId !== "0"
    ? p.direction === "in" ? "Store sale" : "Store purchase"
    : isSubscription
      ? p.direction === "in" ? "Subscription payment" : "Subscription"
      : p.direction === "in" ? "Received" : "Sent";
  return (
    <Link href={`/receipt/${p.id}`} className="txrow">
      <Avatar name={p.counterpartyUsername ?? p.counterparty.slice(2)} />
      <div style={{ minWidth: 0 }}>
        <div className="t">{name}</div>
        <div className="s">
          {kind} · Block {p.blockNumber.toLocaleString("en-US")}
        </div>
      </div>
      <span className={`amt ${p.direction}`}>
        {p.direction === "in" ? "+" : "−"}
        {/* A merchant sees what actually arrived: the price minus the 0.5% store fee. */}
        {moneyText(p.direction === "in" && Number(p.fee) > 0 ? subAmounts(p.amount, p.fee) : p.amount)}
      </span>
    </Link>
  );
}

export function TxSkeleton() {
  return (
    <div className="list" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="txrow">
          <span className="av" style={{ background: "var(--lime-wash)" }} />
          <div style={{ display: "grid", gap: 6 }}>
            <div className="skeleton" style={{ width: "50%" }} />
            <div className="skeleton" style={{ width: "35%", height: 10 }} />
          </div>
          <div className="skeleton" style={{ width: 56 }} />
        </div>
      ))}
    </div>
  );
}
