"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { BagIcon } from "@/components/Icons";
import { ErrorBox, Loading, Screen, Who } from "@/components/ui";
import { api } from "@/lib/api";
import { moneyText, normUsername, periodText } from "@/lib/format";
import { useLoad } from "@/lib/session";

/** Public storefront: what a customer sees from a shared shop link. */
export default function ShopPage() {
  const { username: raw } = useParams<{ username: string }>();
  const username = normUsername(decodeURIComponent(raw));
  const store = useLoad(() => api.store(username), [username]);
  const plans = useLoad(() => api.plans(username), [username]);

  if (store.loading && !store.data) return <Loading />;
  const s = store.data;
  const products = s?.products.filter((p) => p.active) ?? [];

  return (
    <Screen
      band={
        <div style={{ display: "grid", gap: 14, paddingBlock: "18px 6px" }}>
          <span className="unit">Shop on AevumPay</span>
          {s ? <Who name={s.name} sub={`@${username}`} size="lg" /> : <h1 style={{ fontSize: 26 }}>@{username}</h1>}
        </div>
      }
    >
      {store.error ? (
        <ErrorBox>{/no store|unknown/i.test(store.error) ? `@${username} doesn't have a store yet.` : store.error}</ErrorBox>
      ) : (
        <>
          <div className="section-head">
            <h2>Products</h2>
            <span className="hint">Paid in tUSD8 · no fees</span>
          </div>
          {products.length ? (
            <div className="list">
              {products.map((p) => (
                <Link key={p.id} href={`/shop/${username}/${p.id}`} className="prod txrow" style={{ gridTemplateColumns: "44px minmax(0,1fr) auto" }}>
                  <span className="img">
                    <BagIcon size={18} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="n">{p.name}</div>
                    <div className="p">{moneyText(p.price)}</div>
                  </div>
                  <span className="linkbtn">Buy</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty">
              <span className="ic">
                <BagIcon size={20} />
              </span>
              <p>Nothing for sale yet.</p>
            </div>
          )}
          {(plans.data?.plans ?? []).some((p) => p.active) && (
            <>
              <div className="section-head" style={{ marginTop: 8 }}>
                <h2>Subscriptions</h2>
                <span className="hint">Cancel any time</span>
              </div>
              <div className="list">
                {plans.data!.plans
                  .filter((p) => p.active)
                  .map((p) => (
                    <Link key={p.id} href={`/subscribe/${p.id}`} className="prod txrow" style={{ gridTemplateColumns: "44px minmax(0,1fr) auto" }}>
                      <span className="img" style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}>
                        ↻
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div className="n">{p.name}</div>
                        <div className="p">
                          {moneyText(p.amount)} {periodText(p.period)}
                        </div>
                      </div>
                      <span className="linkbtn">Subscribe</span>
                    </Link>
                  ))}
              </div>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
