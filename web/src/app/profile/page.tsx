"use client";

import { ExternalIcon, KeyIcon, LogoutIcon } from "@/components/Icons";
import Link from "next/link";
import { useState } from "react";
import { Avatar, CopyButton, ErrorBox, Loading, NavRow, Screen, SubmitButton } from "@/components/ui";
import { AEVUM_CHAIN_ID } from "@/lib/api";
import { useRequireUser, useSession } from "@/lib/session";

export default function ProfilePage() {
  const user = useRequireUser();
  const { chainId, logout } = useSession();
  if (!user) return <Loading />;

  const onAevum = chainId === AEVUM_CHAIN_ID;

  return (
    <Screen
      tabs={{ business: user.role === "business" }}
      bandClass="center"
      band={
        <>
          <div style={{ width: "100%" }}>
            <NavRow title="Profile" back="/" />
          </div>
          <Avatar name={user.username} size="xl" />
          <div style={{ display: "grid", gap: 2, paddingBottom: 6 }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 600 }}>@{user.username}</span>
            <span style={{ fontSize: 13, opacity: 0.8 }}>{user.role === "business" ? "Business account" : "Personal account"}</span>
          </div>
        </>
      }
    >
      <div style={{ display: "grid", gap: 6 }}>
        <span className="k" style={{ paddingInline: 4 }}>
          Wallet address
        </span>
        <div className="copyfield">
          <span className="v">{user.address}</span>
          <CopyButton text={user.address} label="Copy wallet address" />
        </div>
      </div>
      <div className="rows">
        <div className="rowk">
          <span>Network</span>
          <span>{onAevum ? "QDay Aevum testnet" : chainId ? `Development chain ${chainId}` : "…"}</span>
        </div>
        <div className="rowk">
          <span>Currency</span>
          <span>tUSD8 · USD stablecoin</span>
        </div>
        {onAevum && (
          <div className="rowk">
            <span>Explorer</span>
            <a href={`https://explorer-test.qday.info/address/${user.address}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
              Open <ExternalIcon size={13} />
            </a>
          </div>
        )}
      </div>
      <div className="rows">
        <Link href="/allowances" className="rowk" style={{ textDecoration: "none" }}>
          <span>Spending permissions</span>
          <span>Agents and limits ›</span>
        </Link>
        <Link href="/subscriptions" className="rowk" style={{ textDecoration: "none" }}>
          <span>Subscriptions</span>
          <span>Manage ›</span>
        </Link>
      </div>
      <KeyExport />
      <div className="grow" />
      <button
        type="button"
        className="btn ghost"
        onClick={async () => {
          // Full navigation, so this signed-in screen doesn't first bounce to /login?next=/profile.
          await logout();
          window.location.assign("/");
        }}
      >
        <LogoutIcon size={17} />
        Log out
      </button>
    </Screen>
  );
}

/** Self-custody made real: decrypt the key in this browser and show it, after the password again. */
function KeyExport() {
  const { exportKey } = useSession();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (key) {
    return (
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>Your private key</h3>
          <CopyButton text={key} label="Copy private key" className="linkbtn">
            Copy
          </CopyButton>
        </div>
        <div className="codebox">{key}</div>
        <p className="hint" style={{ color: "var(--out)" }}>
          Anyone with this key controls your wallet. Never share it. Store it somewhere offline.
        </p>
        <button type="button" className="btn ghost" onClick={() => setKey(null)}>
          Hide key
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span style={{ color: "var(--ink-2)", marginTop: 2 }}>
          <KeyIcon size={18} />
        </span>
        <p style={{ fontSize: 13.5, color: "var(--ink-2)" }}>
          Your key was created in this browser and is stored encrypted with your password. AevumPay keeps a locked backup it can&apos;t open, so it can&apos;t move your money.
        </p>
      </div>
      {open ? (
        <form
          style={{ display: "grid", gap: 10 }}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              setKey(await exportKey(password));
              setPassword("");
              setOpen(false);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="field">
            <label htmlFor="export-password">Password</label>
            <input id="export-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required autoFocus />
          </div>
          <ErrorBox>{error}</ErrorBox>
          <SubmitButton busy={busy} busyLabel="Decrypting…">
            Show private key
          </SubmitButton>
        </form>
      ) : (
        <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
          Export private key
        </button>
      )}
    </div>
  );
}
