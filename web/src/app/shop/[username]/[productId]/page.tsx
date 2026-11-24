"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Balance, ErrorBox, Loading, NavRow, Screen, Spinner, Who } from "@/components/ui";
import { api } from "@/lib/api";
import { moneyText, normUsername } from "@/lib/format";
import { saveLocalReceipt } from "@/lib/receipts";
import { useLoad, useSession } from "@/lib/session";
import { signPayment } from "@/lib/sign";

/** Checkout for one product, reached from a merchant's shared link. */
export default function CheckoutPage() {
  const { username: raw, productId } = useParams<{ username: string; productId: string }>();
  const username = normUsername(decodeURIComponent(raw));
  const router = useRouter();
  const { status, user, account } = useSession();
  const store = useLoad(() => api.store(username), [username]);
  const balance = useLoad(status === "in" ? () => api.balance() : null, [status]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (store.loading && !store.data) return <Loading />;

  const s = store.data;
  const product = s?.products.find((p) => String(p.id) === productId);
  const here = `/shop/${username}/${productId}`;

  if (!s || !product) {
    return (
      <Screen band={<NavRow title="Checkout" back={`/shop/${username}`} />}>
        <ErrorBox>{store.error && !/no store|unknown/i.test(store.error) ? store.error : "This product doesn't exist."}</ErrorBox>
      </Screen>
    );
  }

  const own = user?.username === username;
  const short = balance.data ? Number(balance.data.balance) < Number(product.price) : false;

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      // Signed in this browser for exactly the on-chain price; the server relays it.
      const authorization = await signPayment(await account(), product!.price, {
        payee: s!.owner as `0x${string}`,
        productId: BigInt(product!.id),
      });
      const r = await api.payProduct(product!.id, authorization);
      saveLocalReceipt(r.paymentId, {
        product: r.product,
        txHash: r.txHash,
        explorer: r.explorer,
        blockNumber: r.blockNumber,
        counterparty: r.merchantUsername ?? username,
      });
      router.replace(`/receipt/${r.paymentId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Screen
      band={
        <>
          <NavRow title="Checkout" back={`/shop/${username}`} />
          <Who name={s.name} sub={`@${username}`} />
          <div style={{ display: "grid", gap: 6, paddingBlock: "6px 4px" }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600 }}>{product.name}</span>
            <Balance amount={product.price} size={44} />
            <span className="unit">tUSD8</span>
          </div>
        </>
      }
    >
      <div className="rows">
        <div className="rowk">
          <span>Quantity</span>
          <span>1</span>
        </div>
        {status === "in" && user && (
          <>
            <div className="rowk">
              <span>Paying as</span>
              <span>@{user.username}</span>
            </div>
            <div className="rowk">
              <span>Your balance</span>
              <span className="tab">{balance.data ? moneyText(balance.data.balance) : "…"}</span>
            </div>
          </>
        )}
        <div className="rowk">
          <span>Network fee</span>
          <span>$0.00</span>
        </div>
      </div>
      <p className="hint">Paid straight to the shop&apos;s wallet. AevumPay never holds your money, and the receipt is recorded on Aevum.</p>
      {!product.active && <ErrorBox>This product isn&apos;t for sale right now.</ErrorBox>}
      {short && <ErrorBox>Your balance is too low for this. Add tUSD8 from the home screen first.</ErrorBox>}
      <ErrorBox>{error}</ErrorBox>
      <div className="grow" />
      {status === "loading" ? null : status === "out" ? (
        <>
          <Link className="btn" href={`/login?next=${encodeURIComponent(here)}`}>
            Log in to pay {moneyText(product.price)}
          </Link>
          <Link className="btn ghost" href={`/signup?next=${encodeURIComponent(here)}`}>
            Create an account
          </Link>
        </>
      ) : own ? (
        <p className="hint" style={{ textAlign: "center" }}>
          This is your product. Share this page&apos;s link with customers.
        </p>
      ) : (
        <button type="button" className="btn" onClick={pay} disabled={busy || short || !product.active}>
          {busy ? (
            <>
              <Spinner />
              Paying…
            </>
          ) : (
            `Pay ${moneyText(product.price)}`
          )}
        </button>
      )}
    </Screen>
  );
}
