"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BagIcon, ExternalIcon, PlusIcon, StoreIcon } from "@/components/Icons";
import { Balance, CopyButton, ErrorBox, Loading, NavRow, Screen, SubmitButton, Who } from "@/components/ui";
import { ApiError, api, type User } from "@/lib/api";
import { cleanAmount, isPositiveAmount, moneyText, subAmounts, sumAmounts } from "@/lib/format";
import { parseUnits } from "viem";
import { useLoad, useRequireUser, useSession } from "@/lib/session";
import { StorePlans } from "@/components/StorePlans";
import { signContractCall } from "@/lib/sign";

export default function StorePage() {
  const user = useRequireUser();
  if (!user) return <Loading />;
  return <MyStore user={user} />;
}

function MyStore({ user }: { user: User }) {
  const store = useLoad(() => api.store(user.username), [user.id]);
  const activity = useLoad(() => api.activity(200), [user.id]);
  const [origin, setOrigin] = useState("");
  const [adding, setAdding] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  const noStore = store.error !== null && !store.data;
  if (store.loading && !store.data) return <Loading />;
  if (noStore) return <CreateStore user={user} onCreated={store.reload} loadError={store.error} />;
  const s = store.data!;

  const sales = (activity.data?.payments ?? []).filter((p) => p.direction === "in" && p.productId !== "0");
  const shopLink = `${origin}/shop/${user.username}`;

  return (
    <Screen
      tabs={{ business: user.role === "business" }}
      band={
        <>
          <NavRow title="Store" back="/" />
          <Who name={s.name} sub={`@${user.username}`} size="lg" />
          <div className="balcard" style={{ textAlign: "left", gridTemplateColumns: "1fr auto", alignItems: "end" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <span className="unit">Store sales · after 0.5% fee</span>
              <Balance amount={sumAmounts(sales.map((p) => subAmounts(p.amount, p.fee)))} size={32} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {sales.length} order{sales.length === 1 ? "" : "s"}
            </span>
          </div>
        </>
      }
    >
      <div className="section-head">
        <h2>Products</h2>
        <Link href={`/shop/${user.username}`} className="textlink" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          View shop <ExternalIcon size={13} />
        </Link>
      </div>
      <ErrorBox>{store.error}</ErrorBox>
      {s.products.length ? (
        <div className="list">
          {s.products.map((p) => (
            <div key={p.id} className="prod">
              <span className="img">
                <BagIcon size={18} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="n">{p.name}</div>
                <div className="p">
                  {moneyText(p.price)}
                  {!p.active && " · paused"}
                </div>
              </div>
              <CopyButton text={`${origin}/shop/${user.username}/${p.id}`} label={`Copy checkout link for ${p.name}`} className="linkbtn">
                Link
              </CopyButton>
            </div>
          ))}
        </div>
      ) : (
        !adding && (
          <div className="empty">
            <span className="ic">
              <BagIcon size={20} />
            </span>
            <p>Add your first product. Each one gets its own checkout link to share.</p>
          </div>
        )
      )}

      {adding ? (
        <AddProduct
          onCancel={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            store.reload();
          }}
        />
      ) : (
        <>
          <div className="copyfield">
            <span className="v">{shopLink.replace(/^https?:\/\//, "")}</span>
            <CopyButton text={shopLink} label="Copy shop link" />
          </div>
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <PlusIcon size={17} />
            Add product
          </button>
        </>
      )}
      <StorePlans user={user} />
    </Screen>
  );
}

function AddProduct({ onAdded, onCancel }: { onAdded: () => void; onCancel: () => void }) {
  const { account } = useSession();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !isPositiveAmount(price)) return setError("Give the product a name and a price above $0.");
    setBusy(true);
    setError(null);
    try {
      // The product belongs to the wallet that signs this call, so it is signed here, not by the server.
      const raw = await signContractCall(await account(), { functionName: "addProduct", args: [name.trim(), parseUnits(price, 6)] });
      await api.sendTx(raw);
      onAdded();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <h3 style={{ fontSize: 17, fontWeight: 600 }}>New product</h3>
      <div className="field">
        <label htmlFor="pname">Name</label>
        <input id="pname" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Sourdough loaf" required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="pprice">Price</label>
        <div className="row">
          <span className="prefix">$</span>
          <input id="pprice" inputMode="decimal" value={price} onChange={(e) => setPrice(cleanAmount(e.target.value))} placeholder="12.50" required />
        </div>
      </div>
      <p className="hint">Products are saved on Aevum. Prices are in tUSD8.</p>
      <ErrorBox>{error}</ErrorBox>
      <SubmitButton busy={busy} busyLabel="Adding to Aevum…">
        Add product
      </SubmitButton>
      <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </form>
  );
}

function CreateStore({ user, onCreated, loadError }: { user: User; onCreated: () => void; loadError: string | null }) {
  const { account } = useSession();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "No store" is the expected 404 here; anything else is a real error worth showing.
  const realError = loadError && !/no store|unknown owner/i.test(loadError) ? loadError : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give your store a name.");
    setBusy(true);
    setError(null);
    try {
      const raw = await signContractCall(await account(), { functionName: "createStore", args: [name.trim()] });
      await api.sendTx(raw);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Screen
      tabs={{ business: user.role === "business" }}
      band={
        <>
          <NavRow title="Store" back="/" />
          <div style={{ display: "grid", gap: 8, paddingBottom: 8 }}>
            <span className="round" style={{ width: 48, height: 48 }}>
              <StoreIcon size={22} />
            </span>
            <h1 style={{ fontSize: 28, fontWeight: 600 }}>Open your store</h1>
            <p style={{ opacity: 0.85 }}>Customers pay you in tUSD8 straight to your wallet. No fees, no middleman.</p>
          </div>
        </>
      }
    >
      <form onSubmit={onSubmit} style={{ display: "contents" }}>
        <ErrorBox>{realError}</ErrorBox>
        <div className="field">
          <label htmlFor="sname">Store name</label>
          <input id="sname" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Bola's Bakery" required />
        </div>
        <p className="hint" style={{ marginTop: -6, paddingInline: 4 }}>
          Your shop will live at /shop/{user.username}.
        </p>
        <ErrorBox>{error}</ErrorBox>
        <div className="grow" />
        <SubmitButton busy={busy} busyLabel="Opening on Aevum…">
          Open store
        </SubmitButton>
      </form>
    </Screen>
  );
}
