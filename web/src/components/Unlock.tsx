"use client";

import { useState } from "react";
import { useSession } from "@/lib/session";
import { KeyIcon } from "./Icons";
import { ErrorBox, Screen, SubmitButton } from "./ui";

/** Shown when the session is valid but this browser doesn't hold the wallet key yet. */
export function Unlock() {
  const { user, unlock, logout } = useSession();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Screen
      band={
        <div style={{ display: "grid", gap: 10, paddingBlock: "18px 8px" }}>
          <span className="round" style={{ width: 48, height: 48 }}>
            <KeyIcon size={22} />
          </span>
          <h1 style={{ fontSize: 30, fontWeight: 600 }}>Unlock your wallet</h1>
          <p style={{ opacity: 0.85 }}>Your key lives in your browser. This one doesn&apos;t have it yet, so enter your password to unlock @{user?.username}.</p>
        </div>
      }
    >
      <form onSubmit={onSubmit} style={{ display: "contents" }}>
        <div className="field">
          <label htmlFor="unlock-password">Password</label>
          <input id="unlock-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required autoFocus />
        </div>
        <ErrorBox>{error}</ErrorBox>
        <div className="grow" />
        <SubmitButton busy={busy} busyLabel="Unlocking…">
          Unlock
        </SubmitButton>
        <button type="button" className="btn ghost" onClick={() => logout().then(() => window.location.assign("/"))}>
          Log out
        </button>
      </form>
    </Screen>
  );
}
